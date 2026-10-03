import assert from 'node:assert/strict';
import test from 'node:test';
import { comparePipelines, parseFile, scoreByDetector, scoreBySlice, scoreEvents, selectSessions, validateInput } from './run-event-benchmark.mjs';

const fixture = () => ({
  sessions: parseFile('session_id,participant,platform,detector_version,duration_ms,split,lighting\ns1,p1,web,web-1,10000,test,day\ns2,p2,ios,ios-1,10000,test,night\n', 'sessions'),
  tracking: parseFile('session_id,start_ms,end_ms\ns1,0,10000\ns2,0,5000\n', 'tracking'),
  episodes: parseFile('session_id,start_ms,end_ms,label\ns1,2000,4000,drowsy\ns2,6000,8000,high_fatigue\n', 'episodes'),
  alerts: parseFile('session_id,at_ms\ns1,3000\ns1,9000\ns2,2000\n', 'alerts'),
});

test('scores event recall only when the episode had complete tracking', () => {
  const result = scoreEvents(fixture());
  assert.equal(result.sessions, 2);
  assert.equal(result.trackingCoverage, 0.75);
  assert.equal(result.fullyTrackedEpisodes, 1);
  assert.equal(result.insufficientTrackingEpisodes, 1);
  assert.equal(result.detectedEpisodes, 1);
  assert.equal(result.eventRecall, 1);
  assert.equal(result.falseAlerts, 2);
  assert.equal(result.medianAlertDelayMs, 1000);
  assert.equal(result.alertsOutsideTracking, 0);
});

test('reports an estimable miss, rather than dropping a fully tracked episode', () => {
  const input = fixture();
  input.alerts = input.alerts.filter(alert => alert.at_ms !== 3000);
  const result = scoreEvents(input);
  assert.equal(result.eventRecall, 0);
  assert.equal(result.missedFullyTrackedEpisodes, 1);
  assert.equal(result.medianAlertDelayMs, null);
});

test('uses earliest alert time even when export rows are out of order', () => {
  const input = fixture();
  input.alerts.unshift({ session_id: 's1', at_ms: 3500 });
  assert.equal(scoreEvents(input).medianAlertDelayMs, 1000);
});

test('keeps web and iPhone session slices separate', () => {
  const sliced = scoreByDetector(fixture());
  assert.equal(sliced['web / web-1'].sessions, 1);
  assert.equal(sliced['ios / ios-1'].sessions, 1);
  assert.equal(sliced['web / web-1'].eventRecall, 1);
  assert.equal(sliced['ios / ios-1'].eventRecall, null);
  assert.equal(scoreBySlice(fixture(), 'lighting').day['web / web-1'].sessions, 1);
  const bothDay = fixture();
  bothDay.sessions[1].lighting = 'day';
  assert.deepEqual(Object.keys(scoreBySlice(bothDay, 'lighting').day), ['ios / ios-1', 'web / web-1']);
});

test('separates detector versions on one platform', () => {
  const input = fixture();
  input.sessions[1].platform = 'web';
  assert.deepEqual(Object.keys(scoreByDetector(input)), ['web / ios-1', 'web / web-1']);
});

test('never estimates recall or false alerts per hour from missing coverage', () => {
  const input = fixture();
  input.tracking = [];
  const result = scoreEvents(input);
  assert.equal(result.eventRecall, null);
  assert.equal(result.falseAlertsPerTrackedHour, null);
  assert.equal(result.insufficientTrackingEpisodes, 2);
});

test('excludes untracked alerts from the false-alert rate and reports them separately', () => {
  const input = fixture();
  input.alerts.push({ session_id: 's2', at_ms: 7500 });
  const result = scoreEvents(input);
  assert.equal(result.falseAlerts, 2);
  assert.equal(result.alertsOutsideTracking, 1);
});

test('checks participant split leakage before selecting held-out data', () => {
  const input = fixture();
  input.sessions.push({ ...input.sessions[0], session_id: 's3', split: 'train' });
  assert.throws(() => selectSessions(input, 'test'), /Participant leakage/);
});

test('rejects unknown sessions, out-of-bounds times and overlapping episodes', () => {
  const unknown = fixture();
  unknown.alerts.push({ session_id: 'other', at_ms: 100 });
  assert.throws(() => validateInput(unknown), /unknown session/);

  const outside = fixture();
  outside.alerts.push({ session_id: 's1', at_ms: 10001 });
  assert.throws(() => validateInput(outside), /outside session/);

  const overlap = fixture();
  overlap.episodes.push({ session_id: 's1', start_ms: 3000, end_ms: 5000, label: 'drowsy' });
  assert.throws(() => validateInput(overlap), /Overlapping episodes/);
});

test('CSV input rejects missing fields, malformed values and invalid labels', () => {
  assert.throws(() => parseFile('session_id,at_ms\ns1,\n', 'alerts'), /at_ms missing/);
  assert.throws(() => parseFile('session_id,start_ms,end_ms,label\ns1,0,10,awake\n', 'episodes'), /Invalid episode label/);
  assert.throws(() => parseFile('session_id,start_ms,end_ms\ns1,10,5\n', 'tracking'), /end_ms must be after/);
  assert.throws(() => parseFile('session_id,participant,platform,detector_version,duration_ms\ns1,p1,unknown,v1,10\n', 'sessions'), /Invalid platform/);
});


test('parallel pipeline scoring keeps independent tracking and never combines accuracy',()=>{
 const primary=fixture(),comparison=fixture();comparison.sessions.forEach(row=>row.detector_version='tasks-experiment');comparison.alerts=[];comparison.tracking=[];
 const result=comparePipelines(primary,comparison);assert.equal(result.combinedAccuracy,null);assert.equal(result.primary['web / web-1'].eventRecall,1);assert.equal(result.comparison['web / tasks-experiment'].eventRecall,null);
 for(const change of [value=>value.sessions[0].participant='different',value=>value.sessions[0].duration_ms=9000,value=>value.episodes[0].start_ms=2100]){
  const other=fixture();other.sessions.forEach(row=>row.detector_version='tasks-experiment');change(other);assert.throws(()=>comparePipelines(primary,other));
 }
 assert.throws(()=>comparePipelines(primary,fixture()),/distinct detector/);
});

test('comparison CLI keeps independent tracking coverage and hashes both exports', async () => {
  const {mkdtemp,writeFile,mkdir,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {execFileSync}=await import('node:child_process');
  const dir=await mkdtemp(join(tmpdir(),'occulert-event-comparison-'));
  try{
    const candidate=join(dir,'candidate');await mkdir(candidate);
    const files={sessions:'session_id,participant,platform,detector_version,duration_ms,split\ns1,p1,web,legacy,10000,test\n',tracking:'session_id,start_ms,end_ms\ns1,0,10000\n',episodes:'session_id,start_ms,end_ms,label\ns1,2000,4000,drowsy\n',alerts:'session_id,at_ms\ns1,3000\n'};
    for(const [name,bytes]of Object.entries(files)){await writeFile(join(dir,name+'.csv'),bytes);await writeFile(join(candidate,name+'.csv'),name==='sessions'?bytes.replace(',legacy,',',tasks,'):name==='tracking'?'session_id,start_ms,end_ms\n':name==='alerts'?'session_id,at_ms\n':bytes)}
    const args=Object.keys(files).flatMap(name=>['--'+name,join(dir,name+'.csv')]);
    const report=JSON.parse(execFileSync(process.execPath,['benchmark/run-event-benchmark.mjs',...args,'--comparison-dir',candidate,'--split','test'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
    assert.equal(report.comparison.primary['web / legacy'].eventRecall,1);assert.equal(report.comparison.comparison['web / tasks'].eventRecall,null);assert.equal(report.comparison.combinedAccuracy,null);
    for(const kind of Object.keys(files)){assert.match(report.provenance.inputs[kind].sha256,/^[a-f0-9]{64}$/);assert.match(report.provenance.comparisonInputs[kind].sha256,/^[a-f0-9]{64}$/)}
  }finally{await rm(dir,{recursive:true,force:true})}
});
