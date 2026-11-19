// Deliberate local JSON export → existing event benchmark inputs. Labels are external.
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {toCsv} from './prepare-dataset.mjs';
import {parseFile,validateInput} from './run-event-benchmark.mjs';
import {contentSha256,sourceSnapshot} from './provenance.mjs';
import {validateParkedAppVersionSources} from '../scripts/lib/app-version-stamp.mjs';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
// Import a trace with its matching source revision. Unknown future versions need
// an explicit contract update; pin-shaped strings alone are not provenance.
const versions=JSON.parse(readFileSync(new URL('../asset-versions.json',import.meta.url),'utf8'));
const helperBytes=readFileSync(new URL('../'+versions['detection-experiments.js'],import.meta.url));
const core=readFileSync(new URL('../'+versions['driver-app.js'],import.meta.url),'utf8');
const corePrefix=validateParkedAppVersionSources(core,helperBytes.toString('utf8'),versions);
const runtime=JSON.parse(readFileSync(new URL('../vendor/mediapipe/tasks-vision-1.0.1-occulert.1/runtime-manifest.json',import.meta.url),'utf8'));
export const traceContract=Object.freeze({detectorPrefix:corePrefix,runtimeVersion:runtime.runtimeVersion,
 helperIntegrity:'sha256-'+createHash('sha256').update(helperBytes).digest('base64'),
 runtimePins:Object.freeze(runtime.files.map(({url,integrity})=>Object.freeze({url,integrity}))),
 modelIntegrity:runtime.files.find(pin=>pin.file==='face_landmarker.task').integrity});
const knownFlags=new Set(['calibrationMin','distractionConfidence','elapsed','eyeVisibility','noface','observer','perclosTurn','pitch','pixels','tasks','timePerclos','turnFatigue']);
export function validateProvenance(s){
 const flags=s.experimentFlags;
 if(!Array.isArray(flags)||(!flags.includes('tasks')&&!flags.includes('observer')&&!flags.includes('eyeVisibility'))||flags.some(flag=>!knownFlags.has(flag))||new Set(flags).size!==flags.length||
   flags.join('+')!==[...flags].sort().join('+')||s.detectorVersion!==traceContract.detectorPrefix+flags.join('+')||
   s.geometryUnits!==(flags.includes('pixels')?'pixels-reference-3x4':'normalized'))throw Error('Detector and experiment flags disagree');
 if(s.runtimeVersion!==traceContract.runtimeVersion||s.helperIntegrity!==traceContract.helperIntegrity||s.modelIntegrity!==traceContract.modelIntegrity||
   !Array.isArray(s.runtimePins)||s.runtimePins.length!==traceContract.runtimePins.length||new Set(s.runtimePins.map(pin=>pin?.url)).size!==s.runtimePins.length||
   traceContract.runtimePins.some(expected=>!s.runtimePins.some(pin=>pin?.url===expected.url&&pin.integrity===expected.integrity)))throw Error('Unknown exact owned runtime, model or helper provenance');
}

const columns=['session_id','frame_id','at_ms','media_time','raw_ear','smoothed_ear','eye_blink_left','eye_blink_right','jaw_open','pitch_deg','yaw_deg','legacy_inference_ms','tasks_inference_ms','combined_frame_ms','perclos','observed_ms','closed_ms','fatigue','confidence','legacy_usable','tasks_usable','calibrating','pitch_down'];
const keys=['frameId','atMs','mediaTime','rawEar','smoothedEar','eyeBlinkLeft','eyeBlinkRight','jawOpen','pitchDeg','yawDeg','legacyInferenceMs','tasksInferenceMs','combinedFrameMs','perclos','observedMs','closedMs','fatigue','confidence','legacyUsable','tasksUsable','calibrating','pitchDown'];
const decisionColumns = ['tasks_closed','tasks_perclos','tasks_fatigue','tasks_alert_candidate'];
const decisionKeys = ['tasksClosed','tasksPerclos','tasksFatigue','tasksAlertCandidate'];

function readDecision(sample, row, durationMs, scoringFrame) {
 for (const [i, key] of decisionKeys.entries()) {
  const value = sample[key];
  const binary = key === 'tasksClosed' || key === 'tasksAlertCandidate';
  if (value !== null && !(binary ? value === 0 || value === 1 : finite(value) && value >= 0 && value <= 100))
   throw Error('Invalid Tasks observation: ' + key);
  row[decisionColumns[i]] = value;
 }
 if ((sample.tasksClosed !== null && (!sample.tasksUsable || sample.calibrating)) ||
     (sample.tasksAlertCandidate === null) !== (sample.tasksFatigue === null) ||
     (sample.tasksFatigue === null && (sample.tasksClosed !== null || sample.tasksPerclos !== null)) ||
     (sample.tasksAlertCandidate === 1 && sample.calibrating)) throw Error('Inconsistent Tasks observation');
 const at = sample.tasksAlertAtMs;
 if (sample.tasksAlertCandidate === 1) {
  if (!finite(at) || at < sample.atMs || at > durationMs ||
      !scoringFrame || at !== (scoringFrame.clocks?.trigger?.atMs ?? scoringFrame.atMs)) throw Error('Invalid Tasks candidate timestamp');
 } else if (at !== null) throw Error('Unexpected Tasks candidate timestamp');
 return at;
}

export function readParkedMeasurements(trace){
 const s=trace?.session;
 if(trace?.schema!=='occulert.parked-detection-trace'||![1,2,3,4].includes(trace.version)||!s||s.platform!=='web'||
   typeof s.sessionId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(s.sessionId)||typeof s.detectorVersion!=='string'||!s.detectorVersion||
   !finite(s.durationMs)||s.durationMs<=0||!Array.isArray(trace.samples)||trace.samples.length>20000||!Array.isArray(trace.legacyAlerts)||trace.legacyAlerts.length>4096)throw Error('Invalid parked trace');
 validateProvenance(s);
 const session_id=s.sessionId;
 let lastId=0,lastAt=-1,lastMedia=null,previous=null;
 const tracking=[],comparison=[],tasksAlerts=[];
 const decisions = trace.version === 4;
 const available = decisions && s.tasksDecisionsAvailable === true;
 if (decisions && (!s.experimentFlags.includes('tasks') || typeof s.tasksDecisionsAvailable !== 'boolean' ||
     !Array.isArray(trace.scoringReplay?.frames) || trace.scoringReplay.frames.length > 2400))
  throw Error('Missing Tasks observation metadata');
 const scoringFrames = new Map((decisions ? trace.scoringReplay.frames : []).map(frame => [frame.frameId, frame]));
 if (available && (s.experimentFlags.includes('pixels') || s.experimentFlags.includes('pitch') ||
     trace.scoringReplay.droppedFrames !== 0 || trace.scoringReplay.droppedControls !== 0 ||
     trace.scoringReplay.invalidatedFrames !== 0 || s.droppedFrames !== 0 || scoringFrames.size !== trace.samples.length))
  throw Error('Complete Tasks decision history is required');
 for(const sample of trace.samples){
  if(!Number.isSafeInteger(sample.frameId)||sample.frameId<=lastId||!finite(sample.atMs)||sample.atMs<0||sample.atMs<=lastAt||sample.atMs>s.durationMs||
    (finite(sample.mediaTime)&&sample.mediaTime===lastMedia))throw Error('Duplicate, unordered or out-of-bounds captured frame');
  const row={session_id};
  for(let i=0;i<keys.length;i++){const value=sample[keys[i]];if(i>=18){if(typeof value!=='boolean')throw Error('Invalid trace boolean');row[columns[i+1]]=value?1:0}else{if(value!==null&&value!==undefined&&!finite(value))throw Error('Invalid trace measurement');row[columns[i+1]]=value??null}}
  for(const name of ['eyeBlinkLeft','eyeBlinkRight','jawOpen'])if(sample[name]!==null&&sample[name]!==undefined&&(sample[name]<0||sample[name]>1))throw Error('Invalid blendshape coefficient');
  if(!s.experimentFlags.includes('tasks')&&(sample.tasksUsable||['eyeBlinkLeft','eyeBlinkRight','jawOpen','pitchDeg','yawDeg','tasksInferenceMs'].some(name=>sample[name]!==null&&sample[name]!==undefined)))throw Error('Observer-only trace cannot contain Tasks measurements');
  for(const name of ['legacyInferenceMs','tasksInferenceMs','combinedFrameMs','observedMs','closedMs'])if(sample[name]!==null&&sample[name]!==undefined&&sample[name]<0)throw Error('Invalid nonnegative measurement');
  if(sample.legacyUsable&&(sample.calibrating||sample.pitchDown))throw Error('Usable legacy frame contradicts calibration or downward pitch');
  if(sample.pitchDown&&!s.experimentFlags.includes('pitch'))throw Error('Downward pitch requires the selected pitch gate');
  if(sample.legacyUsable&&(!finite(sample.rawEar)||!finite(sample.smoothedEar)))throw Error('Usable legacy frame lacks EAR');
  if(sample.tasksUsable&&(!finite(sample.eyeBlinkLeft)||!finite(sample.eyeBlinkRight)))throw Error('Usable Tasks frame lacks bilateral eyes');
  if (decisions) {
   if (available && (sample.frameId !== lastId + 1 || !scoringFrames.has(sample.frameId))) throw Error('Missing Tasks decision frame');
   const at = readDecision(sample, row, s.durationMs, scoringFrames.get(sample.frameId));
   if (at !== null) tasksAlerts.push({session_id, at_ms: at});
  }
  const gap=previous?sample.atMs-previous.atMs:0;
  if(previous?.legacyUsable&&sample.legacyUsable&&gap>0&&gap<=1000){
   const tail=tracking.at(-1);if(tail&&tail.end_ms===previous.atMs)tail.end_ms=sample.atMs;else tracking.push({session_id,start_ms:previous.atMs,end_ms:sample.atMs});
  }
  comparison.push(row);previous=sample;lastId=sample.frameId;lastAt=sample.atMs;lastMedia=finite(sample.mediaTime)?sample.mediaTime:null;
 }
 if (available && (!comparison.some(row => row.tasks_closed !== null) || comparison.some(row => row.tasks_fatigue === null)))
  throw Error('Tasks decision evidence is missing');
 return {comparison, tracking, tasksAlerts: available ? tasksAlerts : null};
}

export function adaptTrace(trace,{participant,split,episodes}={}){
 if(!/^[A-Za-z0-9_-]{1,64}$/.test(participant||''))throw Error('Supply a pseudonymous participant identifier');
 if(split!=='train'&&split!=='test')throw Error('Supply an explicit participant-level train/test split');
 if(!Array.isArray(episodes))throw Error('Supply independently labeled episodes (an explicit empty list is permitted)');
 const {comparison,tracking,tasksAlerts}=readParkedMeasurements(trace);
 const s=trace.session, session_id=s.sessionId, runtimePins=s.runtimePins;
 const sessions=[{session_id,participant,platform:'web',detector_version:s.detectorVersion,duration_ms:s.durationMs,split}];
 const available=tasksAlerts!==null;
 const alerts=trace.legacyAlerts.map(alert=>{if(!finite(alert.atMs)||alert.atMs<0||alert.atMs>s.durationMs)throw Error('Invalid legacy alert time');return {session_id,at_ms:alert.atMs}});
 const input={sessions,tracking,episodes,alerts};validateInput(input);
 if (available) validateInput({...input, alerts:tasksAlerts});
 return {...input,comparison,tasksAlerts:available ? tasksAlerts : null,summary:{retainedFrames:comparison.length,totalFrames:s.totalFrames??null,droppedFrames:s.droppedFrames??null,droppedAlerts:s.droppedAlerts??null,
   trackingConvention:'both usable endpoints; previous-state interval; gaps above 1000ms unknown; retained trace only',
   experimentFlags:s.experimentFlags,geometryUnits:s.geometryUnits,helperIntegrity:s.helperIntegrity,runtimeVersion:s.runtimeVersion,runtimePins:runtimePins.map(({url,integrity})=>({url,integrity})),modelIntegrity:s.modelIntegrity,
   tasksEventMetricsAvailable:false,tasksEventRecall:null,tasksFalseAlertsPerTrackedHour:null,tasksAlertDelayMs:null,
   tasksDecisionsAvailable:available, reason:available ? 'Parked candidate timestamps are available for independent scoring.' : 'No complete supported parked Tasks decision series is available.'}};
}
// The comparison table predates accepted-yawn recording. Preserve its schema
// and carry recorded event evidence separately for offline feature extraction.
export function acceptedYawnFrames(trace) {
 const recorded = new Map();
 if ([3,4].includes(trace.version) && trace.scoringReplay) {
  if (!Array.isArray(trace.scoringReplay.frames) || trace.scoringReplay.frames.length > 2400) {
   throw Error('Invalid recorded accepted-yawn frame history');
  }
  for (const frame of trace.scoringReplay.frames) {
   if (!Number.isSafeInteger(frame.frameId) || frame.frameId < 1 || recorded.has(frame.frameId) ||
       typeof frame.yawn !== 'boolean' || (frame.yawn && frame.hasFace !== true)) {
    throw Error('Invalid recorded accepted-yawn evidence');
   }
   recorded.set(frame.frameId, Number(frame.yawn));
  }
 }
 return trace.samples.map(sample => ({ session_id: trace.session.sessionId,
  frame_id: sample.frameId, accepted_yawn: recorded.get(sample.frameId) ?? null }));
}

export {comparisonSummary} from './detection-comparison.mjs';
import {comparisonSummary} from './detection-comparison.mjs';
export {columns as comparisonColumns, decisionColumns};
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1]};
 if(!arg('--trace')||!arg('--episodes')||!arg('--participant')||!arg('--split')||!arg('--out'))throw Error('Usage: --trace local.json --episodes independently-labeled.csv --participant pseudonym --split train|test --out directory');
 const raw=await readFile(arg('--trace')),labels=await readFile(arg('--episodes'));
 const trace=JSON.parse(raw);
 const result=adaptTrace(trace,{participant:arg('--participant'),split:arg('--split'),episodes:parseFile(labels.toString(),'episodes')});
 const yawnFrames=acceptedYawnFrames(trace);
 const tasksPath=join(arg('--out'),'tasks-alerts.csv');
 if (result.tasksAlerts === null) {
  try { await access(tasksPath); throw Error('Choose a fresh output directory; it contains Tasks candidate timestamps from another run'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
 }
 await mkdir(arg('--out'),{recursive:true});
 const headers={sessions:['session_id','participant','platform','detector_version','duration_ms','split'],tracking:['session_id','start_ms','end_ms'],episodes:['session_id','start_ms','end_ms','label'],alerts:['session_id','at_ms'],comparison:trace.version===4 ? [...columns,...decisionColumns] : columns};
 for(const [name,fields]of Object.entries(headers))await writeFile(join(arg('--out'),name+'.csv'),toCsv(fields,result[name])+'\n');
 if(result.tasksAlerts !== null) await writeFile(tasksPath,toCsv(['session_id','at_ms'],result.tasksAlerts)+'\n');
 await writeFile(join(arg('--out'),'accepted-yawns.csv'),toCsv(['session_id','frame_id','accepted_yawn'],yawnFrames)+'\n');
 await writeFile(join(arg('--out'),'trace-provenance.json'),JSON.stringify({...result.summary,...sourceSnapshot(['parked-detection-trace.mjs','run-event-benchmark.mjs']),traceSha256:contentSha256(raw),independentEpisodesSha256:contentSha256(labels),...comparisonSummary(result.comparison)},null,2)+'\n');
}
