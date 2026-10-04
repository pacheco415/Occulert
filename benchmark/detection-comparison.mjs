export function comparisonSummary(rows){
 const n=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value))?Number(value):null;
 const percentile=(values,f)=>{if(!values.length)return null;const s=[...values].sort((a,b)=>a-b),i=(s.length-1)*f,l=Math.floor(i),h=Math.ceil(i);return s[l]+(s[h]-s[l])*(i-l)};
 const times=name=>rows.map(row=>n(row[name])).filter(value=>value!==null&&value>=0);
 const paired=rows.filter(row=>Number(row.legacy_usable)===1&&Number(row.tasks_usable)===1);
 const timing=Object.fromEntries(['legacy_inference_ms','tasks_inference_ms','combined_frame_ms'].map(name=>{const v=times(name);return [name,{samples:v.length,medianMs:percentile(v,.5),p95Ms:percentile(v,.95)}]}));
 return {retainedFrames:rows.length,pairedUsableFrames:paired.length,timing,tasksEventMetricsAvailable:false,
   tasksEventRecall:null,tasksFalseAlertsPerTrackedHour:null,tasksAlertDelayMs:null,
   workload:'exported captured frames; software timings are descriptive, not physical accuracy evidence'};
}

export function validateComparisonRows(rows,sessions){
 const byId=new Map(sessions.map(row=>[row.session_id,row])),last=new Map();
 const measurements=['raw_ear','smoothed_ear','eye_blink_left','eye_blink_right','jaw_open','pitch_deg','yaw_deg','legacy_inference_ms','tasks_inference_ms','combined_frame_ms','perclos','observed_ms','closed_ms','fatigue','confidence'];
 for(const row of rows){const session=byId.get(row.session_id);if(!session)throw Error('Comparison refers to unknown session');
  const id=Number(row.frame_id),at=Number(row.at_ms);if(!String(row.frame_id).trim()||!String(row.at_ms).trim()||!Number.isSafeInteger(id)||id<=0||!Number.isFinite(at)||at<0||at>session.duration_ms)throw Error('Invalid comparison frame bounds');
  const previous=last.get(row.session_id);if(previous&&(id<=previous.id||at<=previous.at))throw Error('Duplicate or unordered comparison frame');last.set(row.session_id,{id,at});
  for(const name of measurements)if(row[name]!==null&&row[name]!==undefined&&String(row[name]).trim()!==''&&!Number.isFinite(Number(row[name])))throw Error('Invalid comparison measurement');
  for(const name of ['legacy_usable','tasks_usable','calibrating','pitch_down'])if(row[name]!=='0'&&row[name]!=='1'&&row[name]!==0&&row[name]!==1)throw Error('Invalid comparison usability');
  for(const name of ['eye_blink_left','eye_blink_right','jaw_open'])if(String(row[name]??'').trim()!==''&&(Number(row[name])<0||Number(row[name])>1))throw Error('Invalid comparison blendshape');
  for(const name of ['legacy_inference_ms','tasks_inference_ms','combined_frame_ms','observed_ms','closed_ms'])if(String(row[name]??'').trim()!==''&&Number(row[name])<0)throw Error('Invalid comparison timing');
 }
}
export function comparisonByDetector(rows,sessions){
 const known=new Map(sessions.map(row=>[row.session_id,row]));const groups=new Map();
 for(const row of rows){const session=known.get(row.session_id);if(!session)continue;const key=session.platform+' / '+session.detector_version;
  const group=groups.get(key)||[];group.push(row);groups.set(key,group)}
 const detectors=Object.fromEntries([...groups].map(([key,rows])=>[key,comparisonSummary(rows)]));
 return {overall:groups.size===1?comparisonSummary([...groups.values()][0]):null,detectors,tasksEventMetricsAvailable:false};
}
