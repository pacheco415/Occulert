let cloudRevision=0,cloudFlight=null,cloudState=null,cloudClearFailed=false;
function readCloudState(){
  const backend=window.OcculertBackend, user=backend?.currentUser();
  if(!backend?.createCloudSummaryOutbox||!user?.id)return {ownerId:null,pending:[],outbox:null,scope:null};
  const context=backend.captureAuthContext(),revision=cloudRevision,scope={ownerId:user.id,revision};
  const sameOwner=()=>backend.isAuthContextCurrent(context)&&backend.currentUser()?.id===user.id;
  const canSend=()=>sameOwner()&&cloudRevision===revision&&document.getElementById('historyCloudConsent')?.checked===true;
  const outbox=backend.createCloudSummaryOutbox(canSend,entry=>{
    if(!canSend()||!entry.localSessionId)return;
    try{window.OcculertLocalHistory.create(localStorage).changeRecord(entry.localSessionId,row=>({...row,cloudSynced:true,cloudSessionId:entry.sessionId,cloudOwnerId:entry.ownerId}))}catch(error){/* Cloud acknowledgement cannot authorize rewriting unreadable local history. */}
  },sameOwner);
  return {ownerId:user.id,pending:outbox.pendingEntries(scope),outbox,scope,canSend};
}
function cloudLabel(row){
  if(cloudState?.ownerId&&row.cloudOwnerId===cloudState.ownerId&&row.cloudSynced===true&&typeof row.cloudSessionId==='string'&&row.cloudSessionId.trim())return 'Local copy saved · Cloud summary confirmed';
  if(cloudState?.ownerId&&cloudState.pending.some(entry=>entry.localSessionId&&(entry.localSessionId===row.localRecordId||entry.localSessionId===row.id||entry.localSessionId===row.sessionId)))return 'Local copy saved · Cloud summary pending';
  return 'Local record · Cloud summary not confirmed';
}
function updateCloudControls(){
  const button=document.getElementById('historyCloudRetry'),status=document.getElementById('historyCloudStatus');
  if(!button||!status)return;
  try{cloudState=readCloudState();status.textContent=cloudState.ownerId?(cloudState.pending.length+' pending cloud summaries for this signed-in account. Local copies remain separate.'):'Sign in to review your account’s pending cloud summaries. Local history remains available.';}
  catch(error){cloudState=null;status.textContent='Pending cloud data could not be read. Its saved bytes were preserved.';}
  if(cloudClearFailed)status.textContent='Cloud retries are off; pending data could not be removed. Its saved bytes were preserved.';
  button.disabled=Boolean(cloudFlight||!cloudState?.pending.length||!document.getElementById('historyCloudConsent')?.checked);
  button.textContent=cloudFlight?'Retrying cloud summaries…':'Retry pending cloud summaries';
}
async function retryHistoryCloudSummaries(){
  if(cloudFlight)return;
  updateCloudControls();const state=cloudState;
  if(!state?.pending.length||!state.canSend?.())return;
  cloudFlight=state.outbox.flush(state.scope);updateCloudControls();
  try{await cloudFlight;}catch(error){/* The queue remains available after an uncertain response or storage failure. */}
  finally{cloudFlight=null;render();}
}
function cancelHistoryCloudPermission(clearQueue){
  cloudRevision++;const consent=document.getElementById('historyCloudConsent');if(consent)consent.checked=false;
  if(clearQueue&&cloudState?.outbox){try{cloudClearFailed=!cloudState.outbox.clearOwner(cloudState.scope);}catch(error){cloudClearFailed=true;}}
  updateCloudControls();
}
function cls(s){return s==='ALERT'||s==='HIGH'?'danger':s==='WATCH'?'watch':s==='SAFE'?'safe':''}
function readStored(key,fallback){try{return JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback))}catch(e){return fallback}}
function record(x){return x&&typeof x==='object'&&!Array.isArray(x)}
function getHistory(){let h=window.OcculertLocalHistory.create(localStorage).load().slice(0,50);let live=readStored('occulert-live-session',null);if(record(live)&&!h.find(x=>(live.sessionId&&(x.id===live.sessionId||x.sessionId===live.sessionId))||(live.driverId&&live.lastUpdate&&x.driverId===live.driverId&&x.lastUpdate===live.lastUpdate)))h.unshift(live);return h.slice(0,50)}
function metric(value){if(value===null||value===undefined||typeof value==='boolean'||!['number','string'].includes(typeof value)||String(value).trim()==='')return null;const number=Number(value);return Number.isFinite(number)&&number>=0?number:null}
function count(value){const number=metric(value);return number!==null&&Number.isSafeInteger(number)?number:null}
function score(value){const number=metric(value);return number===null||number>100?null:number}
function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function csvCell(v){let text=String(v??'');if(/^[\s]*[=+\-@]|^[\t\r\n]/.test(text))text="'"+text;return '"'+text.split('"').join('""')+'"'}
function dateValue(value){
  if(typeof value!=='string')return null;
  const parts=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if(!parts)return null;
  const [year,month,day,hour,minute,second]=parts.slice(1,7).map(Number);
  const leap=year%4===0&&(year%100!==0||year%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if(year<1||month<1||month>12||day<1||day>days[month-1]||hour>23||minute>59||second>59)return null;
  const zone=parts[7];if(zone!=='Z'&&(Number(zone.slice(1,3))>14||Number(zone.slice(4,6))>59||Number(zone.slice(1,3))===14&&Number(zone.slice(4,6))!==0))return null;
  const milliseconds=Date.parse(value);return Number.isFinite(milliseconds)?milliseconds:null;
}
function csvDate(value){const parsed=dateValue(value);return parsed===null?'':new Date(parsed).toISOString()}
function displayDate(value){const parsed=dateValue(value);return parsed===null?'Not recorded':new Date(parsed).toLocaleString()}
function countTotal(history,key){const values=history.map(row=>count(row[key])),known=values.filter(value=>value!==null);if(!known.length)return '--';const total=known.reduce((sum,value)=>sum+value,0);return String(total)+(known.length<values.length?' (partial)':'')}
function buildCSV(){let h=getHistory();let headers=['Driver Name','Driver ID','Status','Safety Score','Current Fatigue','Average Fatigue','Max Fatigue','Alerts','Head Nods','Confidence','Last Update','Saved At'];let rows=h.map(x=>[x.name||'Driver',x.driverId||'local',x.status||'NOT RECORDED',score(x.safetyScore)??'',score(x.fatigue)??'',score(x.avgFatigue)??'',score(x.maxFatigue)??'',count(x.alerts)??'',count(x.headNods)??'',score(x.confidence)??'',csvDate(x.lastUpdate),csvDate(x.savedAt)]);return [headers.map(csvCell).join(','),...rows.map(r=>r.map(csvCell).join(','))].join('\n')}
function showCSV(){let h;try{h=getHistory()}catch(error){alert('Local history is unavailable. The saved data was preserved.');return}if(!h.length){alert('No sessions to export yet.');return}let box=document.getElementById('csvBox');box.value=buildCSV();box.style.display='block';box.focus();box.select();try{document.execCommand('copy');alert('CSV copied. You can paste it into Notes, Excel, or Google Sheets.')}catch(e){alert('CSV is ready to copy. Select the text box and copy it.')}}
function emptyState(){return '<div class="empty"><h2>No sessions saved yet</h2><p>Open the driver app, press Start Monitoring, stop the session, then return here to view a report.</p><div class="empty-actions"><a class="btn primary" href="/app.html">Launch Driver App</a><a class="btn" href="/fleet-dashboard.html">Open Fleet Dashboard</a></div></div>'}
function render(){updateCloudControls();let h;try{h=getHistory()}catch(error){document.getElementById('sessions').textContent='--';document.getElementById('avgScore').textContent='--';document.getElementById('alerts').textContent='--';document.getElementById('nods').textContent='--';document.getElementById('table').innerHTML='<div class="empty"><h2>Local history unavailable</h2><p>The saved data was preserved. Check storage access before trying again.</p></div>';return}document.getElementById('sessions').textContent=h.length;document.getElementById('alerts').textContent=countTotal(h,'alerts');document.getElementById('nods').textContent=countTotal(h,'headNods');document.getElementById('avgScore').textContent=(()=>{const scores=h.map(x=>score(x.safetyScore)).filter(x=>x!==null);return scores.length?Math.round(scores.reduce((a,x)=>a+x,0)/scores.length):'--'})();let t=document.getElementById('table');if(!h.length){t.innerHTML=emptyState();return}t.innerHTML='<div class="row" style="background:transparent;border:0;color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:1px"><div>Driver</div><div>Status</div><div>Safety</div><div>Fatigue</div><div>Alerts</div><div>Last Update</div></div>'+h.map(x=>`<div class="row"><div><strong>${esc(x.name||'Driver')}</strong><br><span class="small">${esc(x.driverId||'local')} · ${dateValue(x.savedAt)!==null?'saved':x.savedAt?'Saved date not recorded':'live/latest'} · ${esc(cloudLabel(x))}${x.recoveredInterrupted===true?' · Partial session':''}</span></div><div><span class="pill ${cls(x.status)}">${esc(x.status||'NOT RECORDED')}</span></div><div><strong>${esc(score(x.safetyScore)??'--')}</strong>/100<div class="scorebar" data-score-recorded="${score(x.safetyScore)!==null}"><span style="width:${score(x.safetyScore)??0}%"${score(x.safetyScore)===null?' hidden':''}></span></div></div><div><strong>${esc(score(x.avgFatigue??x.fatigue)??'--')}</strong> avg<br><span class="small">Max ${esc(score(x.maxFatigue??x.fatigue)??'--')}/100</span></div><div>${esc(count(x.alerts)??'--')} alerts<br><span class="small">${esc(count(x.headNods)??'--')} head nods</span></div><div>${esc(displayDate(dateValue(x.lastUpdate)!==null?x.lastUpdate:x.savedAt))}</div></div>`).join('')}
function clearHistory(){if(confirm('Clear local Occulert history on this browser?')){try{localStorage.removeItem('occulert-session-history');localStorage.removeItem('occulert-live-session');render()}catch(e){alert('Local history could not be fully cleared. Check browser storage access and try again.');render()}}}
document.getElementById('historyCloudRetry')?.addEventListener('click',()=>{void retryHistoryCloudSummaries()});
document.getElementById('historyCloudConsent')?.addEventListener('change',()=>{cloudRevision++;if(!document.getElementById('historyCloudConsent').checked)cancelHistoryCloudPermission(true);else cloudClearFailed=false;render()});
window.addEventListener('storage',event=>{if(event.key==='occulert-auth'||event.key===null){cancelHistoryCloudPermission(false);render()}else if(event.key==='occulert-cloud-outbox')render()});
window.addEventListener('pagehide',()=>cancelHistoryCloudPermission(false));
render();setInterval(render,3000);
