// Occulert auth helper. Wraps Supabase Auth via OcculertBackend, with a local-only fallback.
(function(){
  var currentUser=null;
  function read(k,f){try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(f));}catch(e){return f;}}
  function write(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
  function cleanId(v,prefix){var s=String(v||'').trim().replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,80);return s||((prefix||'id')+'-'+Date.now());}
  function createLocalDriverId(){try{if(globalThis.crypto&&typeof globalThis.crypto.randomUUID==='function')return'local-'+globalThis.crypto.randomUUID();if(globalThis.crypto&&typeof globalThis.crypto.getRandomValues==='function'){var bytes=new Uint8Array(16);globalThis.crypto.getRandomValues(bytes);return'local-'+Array.from(bytes,function(value){return value.toString(16).padStart(2,'0');}).join('');}}catch(e){}return'local-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);}
  function normalizeLocalDriverId(value){var id=String(value||'').trim();if(!id||/^D-\d{3}$/.test(id))return createLocalDriverId();return cleanId(id,'driver');}
  function rewriteStoredDriverId(key,oldId,newId){try{var value=JSON.parse(localStorage.getItem(key)||'null'),changed=false;if(Array.isArray(value)){value.forEach(function(item){if(item&&item.driverId===oldId){item.driverId=newId;changed=true;}});}else if(value&&value.driverId===oldId){value.driverId=newId;changed=true;}if(changed)localStorage.setItem(key,JSON.stringify(value));}catch(e){}}
  function migrateLocalDriverReferences(oldId,newId){if(!oldId||oldId===newId)return;['occulert-profile','occulert-live-session','occulert-session-history','occulert-drivers'].forEach(function(key){rewriteStoredDriverId(key,oldId,newId);});}
  function resolveLocalDriverId(profileId,storedId){var profileValue=String(profileId||'').trim(),storedValue=String(storedId||'').trim(),legacyProfile=/^D-\d{3}$/.test(profileValue),legacyStored=/^D-\d{3}$/.test(storedValue),id=legacyProfile&&storedValue&&!legacyStored?normalizeLocalDriverId(storedValue):normalizeLocalDriverId(profileValue||storedValue);if(legacyProfile)migrateLocalDriverReferences(profileValue,id);if(legacyStored)migrateLocalDriverReferences(storedValue,id);return id;}
  function getProfile(){return read('occulert-profile',null);}
  function saveProfile(profile){
    profile=profile||{};
    profile.role=profile.role||localStorage.getItem('occulert-role')||'driver';
    profile.fleetId=cleanId(profile.fleetId||localStorage.getItem('occulert-fleet-id')||'OCCULERT-DEMO','fleet');
    profile.driverId=resolveLocalDriverId(profile.driverId,localStorage.getItem('occulert-driver-id'));
    profile.savedAt=profile.savedAt||new Date().toISOString();
    localStorage.setItem('occulert-driver-id',profile.driverId);
    localStorage.setItem('occulert-role',profile.role);
    localStorage.setItem('occulert-fleet-id',profile.fleetId);
    write('occulert-profile',profile);
    return profile;
  }
  function mergeUserIntoProfile(user, extra){
    var saved=getProfile();
    if(saved&&saved.uid&&user&&user.uid&&saved.uid!==user.uid)saved={driverId:user.uid,role:'driver',fleetId:'OCCULERT-DEMO'};
    var p=Object.assign({},saved||{},extra||{});
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
    if(!window.OcculertBackend||!await window.OcculertBackend.isConfigured()){
      throw new Error('Cloud sign-in is not configured yet. You can still use the Driver App in local-only mode.');
    }
    var result=mode==='signup'?await window.OcculertBackend.signUp(email,password):await window.OcculertBackend.signIn(email,password);
    if(!result.ok){
      throw new Error(window.OcculertBackend.authMessage(result,mode));
    }
    if(mode==='signup'&&!result.body.access_token){var pending=new Error('Account created. Check your email to confirm it, then return and sign in.');pending.code='confirmation_required';throw pending;}
    var user=window.OcculertBackend.currentUser();
    if(!user)throw new Error(mode==='signup'?'Check your email to confirm the account, then sign in.':'Cloud sign-in did not return a session.');
    currentUser=backendUser(user);
    return saveBackendProfile(mergeUserIntoProfile(currentUser,extra));
  }
  async function signInPasskey(){
    if(!window.OcculertPasskeys)throw new Error('Passkey sign-in is not available on this page.');
    var verified=await window.OcculertPasskeys.signIn();
    var user=window.OcculertBackend&&window.OcculertBackend.currentUser();
    if(!user)throw new Error('Passkey sign-in did not return a session.');
    currentUser=backendUser(user);
    var metadata=verified&&verified.user_metadata||{},extra={};
    var saved=getProfile();
    if(!saved||saved.uid!==user.id){extra={name:String(metadata.name||'').slice(0,120),vehicle:String(metadata.vehicle||'').slice(0,120),company:String(metadata.company||'').slice(0,120),role:'driver',driverId:user.id,fleetId:'OCCULERT-DEMO'};}
    return saveBackendProfile(mergeUserIntoProfile(currentUser,extra));
  }
  async function signOut(){
    try{if(window.OcculertPasskeys)await window.OcculertPasskeys.signOutLocal();}catch(e){}
    try{if(window.OcculertBackend)window.OcculertBackend.signOut();}catch(e){}
    localStorage.removeItem('occulert-auth-user');
    var profile=getProfile();
    if(profile){profile.authenticated=false;profile.cloudProfile=false;saveProfile(profile);}
    currentUser=null;
  }
  async function onAuth(cb){
    var backend=null;
    try{
      var session=window.OcculertBackend&&window.OcculertBackend.getSession?await window.OcculertBackend.getSession():null;
      backend=session&&session.user;
    }catch(e){}
    if(backend){currentUser=backendUser(backend);cb(currentUser,getProfile());return;}
    currentUser=null;
    cb(null,getProfile());
  }
  window.OcculertAuth={getProfile:getProfile,saveProfile:saveProfile,signInEmail:signInEmail,signInPasskey:signInPasskey,signOut:signOut,onAuth:onAuth,mergeUserIntoProfile:mergeUserIntoProfile};
})();
