// Occulert auth helper. Wraps Supabase Auth via OcculertBackend, with a local-only fallback.
(function(){
  var currentUser=null;
  function read(k,f){try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(f));}catch(e){return f;}}
  function write(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
  function cleanId(v,prefix){var s=String(v||'').trim().replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,80);return s||((prefix||'id')+'-'+Date.now());}
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
    await window.OcculertPasskeys.signIn();
    var user=window.OcculertBackend&&window.OcculertBackend.currentUser();
    if(!user)throw new Error('Passkey sign-in did not return a session.');
    currentUser=backendUser(user);
    return saveBackendProfile(mergeUserIntoProfile(currentUser,{}));
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
