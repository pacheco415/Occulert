// Occulert cloud sync helper. Firestore when available, localStorage fallback.
(function(){
var db=null, ready=null;
function saveLocal(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
function readLocal(k,f){try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(f));}catch(e){return f;}}
async function init(){
  if(ready)return ready;
  ready=new Promise(function(resolve){
    try{
      if(!window.OCCULERT_FIREBASE_ENABLED||!window.OCCULERT_FIREBASE_CONFIG)return resolve(false);
      if(!window.firebase||!window.firebase.initializeApp||!window.firebase.firestore)return resolve(false);
      if(!(window.firebase.apps&&window.firebase.apps.length))window.firebase.initializeApp(window.OCCULERT_FIREBASE_CONFIG);
      db=window.firebase.firestore();
      resolve(true);
    }catch(e){console.warn('Firebase init failed',e);resolve(false);}
  });
  return ready;
}
async function writeDoc(col,id,data){
  var ok=await init();
  if(!ok||!db)return false;
  try{await db.collection(col).doc(id).set(data,{merge:true});return true;}catch(e){console.warn('Firestore write failed',e);return false;}
}
window.OcculertSync={
  init:init,
  saveLiveSession:async function(data){
    data.updatedAt=data.updatedAt||new Date().toISOString();
    saveLocal('occulert-live-session',data);
    var h=readLocal('occulert-session-history',[]);
    if(h.length&&h[0].driverId===data.driverId)h[0]=data;else h.unshift(data);
    saveLocal('occulert-session-history',h.slice(0,50));
    await writeDoc('liveSessions',data.driverId||'local-driver',data);
    return data;
  },
  saveSessionHistory:async function(data){
    data.savedAt=data.savedAt||new Date().toISOString();
    await writeDoc('sessionHistory',(data.driverId||'local-driver')+'-'+Date.now(),data);
    return data;
  },
  savePilotLead:async function(lead){
    lead.createdAt=lead.createdAt||new Date().toISOString();
    var leads=readLocal('occulert-pilot-leads',[]);leads.unshift(lead);saveLocal('occulert-pilot-leads',leads.slice(0,100));
    await writeDoc('pilotLeads','lead-'+Date.now(),lead);
    return lead;
  },
  getLiveSession:function(){return readLocal('occulert-live-session',null);},
  getSessionHistory:function(){return readLocal('occulert-session-history',[]);},
  listenLiveSessions:async function(cb){
    var ok=await init();
    if(!ok||!db)return null;
    return db.collection('liveSessions').onSnapshot(function(snap){var rows=[];snap.forEach(function(d){rows.push(Object.assign({id:d.id},d.data()));});cb(rows);});
  }
};
})();
