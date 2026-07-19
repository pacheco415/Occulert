// Occulert Firebase Auth helper with local fallback.
(function(){
  var currentUser=null;
  function read(k,f){try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(f));}catch(e){return f;}}
  function write(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
  function cleanId(v,prefix){var s=String(v||'').trim().replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,80);return s||((prefix||'id')+'-'+Date.now());}
  function initFirebase(){
    if(!window.OCCULERT_FIREBASE_ENABLED||!window.OCCULERT_FIREBASE_CONFIG||!window.firebase)return false;
    try{
      if(window.firebase.initializeApp&&!(window.firebase.apps&&window.firebase.apps.length))window.firebase.initializeApp(window.OCCULERT_FIREBASE_CONFIG);
      return !!window.firebase.auth;
    }catch(e){console.warn('Auth init failed',e);return false;}
  }
  function getProfile(){return read('occulert-profile',null);}
  function saveProfile(profile){
    profile=profile||{};
    profile.role=profile.role||localStorage.getItem('occulert-role')||'driver';
    profile.fleetId=cleanId(profile.fleetId||localStorage.getItem('occulert-fleet-id')||'OCCULERT-DEMO','fleet');
    profile.driverId=cleanId(profile.driverId||localStorage.getItem('occulert-driver-id')||('D-'+Math.floor(Math.random()*900+100)),'driver');
    profile.savedAt=profile.savedAt||new Date().toISOString();
    localStorage.setItem('occulert-driver-id',profile.driverId);
    localStorage.setItem('occulert-role',profile.role);
    localStorage.setItem('occulert-fleet-id',profile.fleetId);
    write('occulert-profile',profile);
    return profile;
  }
  function mergeUserIntoProfile(user, extra){
    var p=Object.assign({},getProfile()||{},extra||{});
    p.uid=user&&user.uid?user.uid:p.uid;
    p.email=user&&user.email?user.email:p.email;
    p.name=p.name||(user&&user.displayName)||'';
    p.authenticated=!!(user&&user.uid);
    p.lastLogin=new Date().toISOString();
    return saveProfile(p);
  }
  function backendUser(user){return user?{uid:user.id,email:user.email||'',displayName:''}:null;}
  async function saveBackendProfile(profile){
    if(profile.role==='fleet'){profile.cloudProfile=false;return saveProfile(profile);}
    var result=await window.OcculertBackend.ensureDriverProfile(profile);
    profile.cloudProfile=!!result.ok;
    return saveProfile(profile);
  }
  async function signInEmail(email,password,mode,extra){
    if(window.OcculertBackend&&await window.OcculertBackend.isConfigured()){
      var result=mode==='signup'?await window.OcculertBackend.signUp(email,password):await window.OcculertBackend.signIn(email,password);
      if(!result.ok){
        var message=result.body&&(result.body.msg||result.body.message||result.body.error);
        throw new Error(message||'Cloud sign-in failed.');
      }
      var user=window.OcculertBackend.currentUser();
      if(!user)throw new Error(mode==='signup'?'Check your email to confirm the account, then sign in.':'Cloud sign-in did not return a session.');
      currentUser=backendUser(user);
      return saveBackendProfile(mergeUserIntoProfile(currentUser,extra));
    }
    var ok=initFirebase();
    if(!ok)throw new Error('Cloud sign-in is not configured yet. You can still use the Driver App in local-only mode.');
    var auth=window.firebase.auth();
    var cred;
    if(mode==='signup')cred=await auth.createUserWithEmailAndPassword(email,password);
    else cred=await auth.signInWithEmailAndPassword(email,password);
    currentUser=cred.user;
    return mergeUserIntoProfile(currentUser,extra);
  }
  async function signInGoogle(extra){
    var ok=initFirebase();
    if(!ok)throw new Error('Firebase Auth script is not loaded.');
    var auth=window.firebase.auth(),provider=new window.firebase.auth.GoogleAuthProvider();
    var cred=await auth.signInWithPopup(provider);
    currentUser=cred.user;
    return mergeUserIntoProfile(currentUser,extra);
  }
  async function signOut(){
    try{if(window.OcculertBackend)window.OcculertBackend.signOut();}catch(e){}
    try{if(initFirebase())await window.firebase.auth().signOut();}catch(e){}
    localStorage.removeItem('occulert-auth-user');
    var profile=getProfile();
    if(profile){profile.authenticated=false;profile.cloudProfile=false;saveProfile(profile);}
    currentUser=null;
  }
  function onAuth(cb){
    var backend=window.OcculertBackend&&window.OcculertBackend.currentUser();
    if(backend){currentUser=backendUser(backend);cb(currentUser,getProfile());return;}
    if(initFirebase()){
      window.firebase.auth().onAuthStateChanged(function(user){
        currentUser=user||null;
        if(user)write('occulert-auth-user',{uid:user.uid,email:user.email,name:user.displayName||''});
        cb(user,getProfile());
      });
    }else cb(null,getProfile());
  }
  window.OcculertAuth={initFirebase:initFirebase,getProfile:getProfile,saveProfile:saveProfile,signInEmail:signInEmail,signInGoogle:signInGoogle,signOut:signOut,onAuth:onAuth,mergeUserIntoProfile:mergeUserIntoProfile};
})();
