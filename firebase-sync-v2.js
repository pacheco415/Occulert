// Occulert cloud sync helper. Firestore when available, localStorage fallback.
(function(){
var db=null, ready=null;
function saveLocal(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
function readLocal(k,f){try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(f));}catch(e){return f;}}
function cleanId(v,prefix){var s=String(v||'').trim().replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,80);return s||((prefix||'id')+'-'+Date.now());}
function uid(prefix){return cleanId((prefix||'id')+'-'+Date.now()+'-'+Math.floor(Math.random()*100000),prefix)}
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
  try{await db.collection(col).doc(cleanId(id,col)).set(data,{merge:true});return true;}catch(e){console.warn('Firestore write failed',e);return false;}
}
window.OcculertSync={
  init:init,
  saveLiveSession:async function(data){
    data.updatedAt=data.updatedAt||new Date().toISOString();
    data.driverId=cleanId(data.driverId||'local-driver','driver');
    saveLocal('occulert-live-session',data);
    var h=readLocal('occulert-session-history',[]);
    if(h.length&&h[0].driverId===data.driverId)h[0]=data;else h.unshift(data);
    saveLocal('occulert-session-history',h.slice(0,50));
    data.cloudSynced=await writeDoc('liveSessions',data.driverId,data);
    saveLocal('occulert-live-session',data);
    return data;
  },
  saveSessionHistory:async function(data){
    data.savedAt=data.savedAt||new Date().toISOString();
    data.driverId=cleanId(data.driverId||'local-driver','driver');
    data.sessionId=data.sessionId||uid('session');
    var h=readLocal('occulert-session-history',[]);
    if(!h.find(function(x){return x.sessionId===data.sessionId;}))h.unshift(data);
    saveLocal('occulert-session-history',h.slice(0,100));
    data.cloudSynced=await writeDoc('sessionHistory',data.sessionId,data);
    return data;
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
