(function(root){
'use strict';
const KEY='occulert-session-history';
const validId=value=>typeof value==='string'&&Boolean(value.trim());
function parse(raw){
 if(raw===null)return [];
 let rows;try{rows=JSON.parse(raw)}catch(error){throw Error('Local history is unreadable; no changes were made')}
 if(!Array.isArray(rows)||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw Error('Local history has an unexpected format; no changes were made');
 for(const row of rows){
  if(Object.hasOwn(row,'historyVersion')&&row.historyVersion!==1)throw Error('Local history has an unsupported version; no changes were made');
  if(Object.hasOwn(row,'localRecordId')&&!validId(row.localRecordId))throw Error('Local history identity is invalid; no changes were made');
 }
 return rows;
}
function migrate(rows,makeId){
 const used=new Set(rows.flatMap(row=>[row.localRecordId,row.id,row.sessionId].filter(validId)));
 let changed=false;
 const next=rows.map(row=>{
  let id=row.localRecordId||[row.id,row.sessionId].find(validId);
  if(!id){for(let attempt=0;attempt<32;attempt++){const candidate=makeId();if(validId(candidate)&&!used.has(candidate)){id=candidate;break}}if(!id)throw Error('Local history identity could not be assigned; no changes were made');used.add(id)}
  if(row.historyVersion===1&&row.localRecordId===id)return row;
  changed=true;return {...row,historyVersion:1,localRecordId:id};
 });
 return {rows:changed?next:rows,changed};
}
function create(storage,makeId=()=>root.crypto?.randomUUID?.()||'local-legacy-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)){
 function read(){return parse(storage.getItem(KEY))}
 function load(){const result=migrate(read(),makeId);if(result.changed)storage.setItem(KEY,JSON.stringify(result.rows));return result.rows}
 function update(change){
  const current=migrate(read(),makeId).rows;
  const candidate=change(current);
  const checked=parse(JSON.stringify(candidate));
  const result=migrate(checked,makeId).rows;
  storage.setItem(KEY,JSON.stringify(result));return result;
 }
 function changeRecord(id,change){
  if(!validId(id))throw Error('Local history identity is unavailable');
  return update(rows=>{
   const matches=rows.map((row,index)=>row.localRecordId===id||row.id===id||row.sessionId===id?index:-1).filter(index=>index>=0);
   if(matches.length!==1)throw Error('Local history identity is missing or ambiguous');
   return rows.map((row,index)=>index===matches[0]?change(row):row);
  });
 }
 return {load,update,changeRecord};
}
const api={parse,migrate,create};
if(typeof module==='object'&&module.exports)module.exports=api;else root.OcculertLocalHistory=api;
})(globalThis);
