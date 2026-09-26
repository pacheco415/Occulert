let selectedRole='driver';
let authMode='signin';
let enrollmentActive=false;
let emailLinkPending=false;
let profileRenderVersion=0;
let loginContext=null,loginGeneration=0,loginPendingAction=null;
function loginViewCurrent(context=loginContext){return Boolean(context&&context===loginContext&&window.OcculertBackend.isAuthContextCurrent(context))}
function loginRequireView(context){if(loginViewCurrent(context))return true;if(context&&context===loginContext)refreshLoginState();return false}
function clearLoginView(){
  loginContext=null;loginPendingAction=null;profileRenderVersion++;enrollmentActive=false;emailLinkPending=false;
  ['name','company','vehicle','email','password'].forEach(id=>document.getElementById(id).value='');
  ['status','passkeyStatus','passkeySetupStatus','completionStatus','passkeySetupEmail'].forEach(id=>{let el=document.getElementById(id);if(el)el.textContent=''});
  document.getElementById('profileBox').innerHTML='<div class="notice">Checking your signed-in account…</div>';
  document.getElementById('profileStateLabel').textContent='Account status';document.getElementById('profileActions').innerHTML='';
  document.getElementById('passkeySetup').classList.add('hidden');document.getElementById('authForm').classList.remove('hidden');
  document.getElementById('fleetSetupLink').classList.add('hidden');document.getElementById('retryProfileBtn').classList.add('hidden');
  document.getElementById('createPasskeyBtn').disabled=true;document.getElementById('skipPasskeyBtn').disabled=true;
  setRole('driver');setSignedInLayout(false);setPasskeyRetry(false);setAuthBusy(true);
}
async function refreshLoginState(){
  const generation=++loginGeneration;clearLoginView();const backend=window.OcculertBackend;
  try{
    const session=await backend.getSession();if(generation!==loginGeneration)return;
    const context=backend.captureAuthContext(),stored=context.auth;
    if(session&&(!stored||stored.access_token!==session.access_token||stored.refresh_token!==session.refresh_token||stored.user?.id!==session.user?.id))return;
    if(!session&&stored)return;
    loginContext=context;setAuthBusy(false);showAuthMode(authMode);
    renderProfile(session&&session.user,window.OcculertAuth.getProfile());
  }catch(err){if(generation===loginGeneration){setAuthBusy(false);show('Account verification is unavailable. Reload this page to retry.','bad')}}
}
function loginActionContext(){if(loginViewCurrent())return loginContext;refreshLoginState();return null}
function retainUnchangedLoginContext(context,generation,attempt){
  if(generation!==loginGeneration||context!==loginContext)return false;
  const backend=window.OcculertBackend,current=backend.captureAuthContext(),before=context.auth,after=current.auth;
  const unchanged=!before&&!after||before&&after&&before.access_token===after.access_token&&before.refresh_token===after.refresh_token&&before.expires_at===after.expires_at&&before.user?.id===after.user?.id&&before.user?.email===after.user?.email;
  if(!unchanged){refreshLoginState();return false}
  if(!backend.isAuthContextCurrent(attempt)){
    loginGeneration++;clearLoginView();show('Your sign-in changed. Refresh this page before trying again.','bad');return false;
  }
  // A failed auth attempt advances the revision without changing credentials.
  // Keep the form usable only for the exact attempt started by this action.
  loginContext=attempt;return true;
}
function beginLoginAction(){
  if(loginPendingAction)return null;
  const context=loginActionContext();if(!context)return null;
  const action={context,generation:loginGeneration,attempt:context};loginPendingAction=action;return action;
}
function finishLoginAction(action){
  if(loginPendingAction!==action)return false;
  loginPendingAction=null;
  if(action.generation!==loginGeneration||!loginViewCurrent())return false;
  setAuthBusy(false);return true;
}
function acceptLoginResult(profile,generation){
  if(generation!==loginGeneration)return false;
  const backend=window.OcculertBackend,context=backend.captureAuthContext();
  if(!context.auth||context.auth.user?.id!==profile?.uid){refreshLoginState();return false}
  loginContext=context;return true;
}
function checkLoginContext(){
  const action=loginPendingAction;
  if(action&&action.generation===loginGeneration&&window.OcculertBackend.isAuthContextCurrent(action.attempt))return;
  if(loginContext&&!loginViewCurrent()||!loginContext&&window.OcculertBackend.currentUser())refreshLoginState();
}
if(window.addEventListener){window.addEventListener('storage',event=>{if(event.key==='occulert-auth'||event.key===null)refreshLoginState()});window.addEventListener('focus',checkLoginContext)}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkLoginContext()});
function setRole(role){selectedRole=role;let driver=document.getElementById('driverRole'),fleet=document.getElementById('fleetRole');driver.classList.toggle('active',role==='driver');fleet.classList.toggle('active',role==='fleet');driver.setAttribute('aria-pressed',String(role==='driver'));fleet.setAttribute('aria-pressed',String(role==='fleet'))}
function extras(){return{role:selectedRole,name:document.getElementById('name').value.trim(),company:document.getElementById('company').value.trim()||'Occulert Pilot Fleet',vehicle:document.getElementById('vehicle').value.trim()}}
function show(msg,type){let s=document.getElementById('status');s.className='status show '+(type||'good');s.textContent=msg}
function clearStatus(){let s=document.getElementById('status');s.className='status';s.textContent=''}
function showPasskey(msg,type){let s=document.getElementById('passkeyStatus');s.className='status show '+(type||'pending');s.textContent=msg}
function clearPasskeyStatus(){let s=document.getElementById('passkeyStatus');s.className='status';s.textContent=''}
function setPasskeyRetry(show){let b=document.getElementById('passkeyRetryBtn');b.classList.toggle('hidden',!show)}
function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function setSignedInLayout(signedIn){document.getElementById('loginGrid').classList.toggle('signed-in',signedIn);document.getElementById('authCard').classList.toggle('hidden',signedIn)}
function focusSignInContinuation(){document.getElementById('profileStateLabel').focus()}
function focusSignInForm(){document.getElementById('email').focus()}
function showAuthMode(mode){
  if(enrollmentActive)return;
  authMode=mode;clearStatus();clearPasskeyStatus();setPasskeyRetry(false);
  let sessionUser=loginViewCurrent()&&window.OcculertBackend.currentUser?window.OcculertBackend.currentUser():null;
  setSignedInLayout(mode==='signin'&&Boolean(sessionUser));
  let signup=mode==='signup',reset=mode==='reset',emailLink=mode==='email',password=document.getElementById('password'),submit=document.getElementById('submitBtn');
  document.getElementById('authEyebrow').textContent=signup?'Get started':'Welcome back';
  document.getElementById('profileFields').classList.toggle('hidden',!signup);
  document.getElementById('passkeyEntry').classList.toggle('hidden',mode!=='signin');
  document.getElementById('passwordField').classList.toggle('hidden',reset||signup||emailLink);
  document.getElementById('forgotPasswordBtn').classList.toggle('hidden',mode!=='signin');
  document.getElementById('backToSignInBtn').classList.toggle('hidden',!reset&&!emailLink);
  document.getElementById('signInModeBtn').classList.toggle('active',mode==='signin');
  document.getElementById('signUpModeBtn').classList.toggle('active',signup);
  document.getElementById('signInModeBtn').setAttribute('aria-pressed',String(mode==='signin'));
  document.getElementById('signUpModeBtn').setAttribute('aria-pressed',String(signup));
  document.getElementById('emailLinkBtn').classList.toggle('hidden',mode!=='signin');
  password.required=mode==='signin';password.autocomplete=signup?'new-password':'current-password';
  document.getElementById('authHeading').textContent=emailLink?'Sign in with an email link':reset?'Reset your password':signup?'Create your Occulert account':'Sign in to Occulert';
  document.getElementById('authIntro').textContent=emailLink?'We will email you a secure sign-in link. No password needed.':reset?'Enter your account email. We will send a secure link for choosing a new password.':signup?'Enter your details, confirm your email, then create a passkey. No password required.':'Use the email and password for your existing Occulert account.';
  document.getElementById('modeHelp').textContent=reset?'For privacy, the confirmation message is the same whether or not the email is registered.':signup?'We’ll confirm your email before you save a passkey. Fleet access requires a separate invitation or fleet setup.':'Fleet access is verified automatically after you sign in.';
  submit.textContent=emailLink?'Send Sign-In Link':reset?'Send Reset Link':signup?'Continue to passkey setup':'Sign In';
  submit.disabled=submit.dataset.rateLimited===mode;
  if(!document.getElementById('authCard').classList.contains('hidden'))focusSignInForm();
}
function passkeySupported(){return Boolean(window.OcculertPasskeys&&window.OcculertPasskeys.isSupported())}
function setAuthBusy(busy){let form=document.getElementById('authForm'),submit=document.getElementById('submitBtn'),passkey=document.getElementById('passkeySignInBtn'),retry=document.getElementById('passkeyRetryBtn');form.setAttribute('aria-busy',String(busy));submit.disabled=busy||submit.dataset.rateLimited===authMode;passkey.disabled=busy||!passkeySupported();retry.disabled=busy;document.getElementById('signInModeBtn').disabled=busy;document.getElementById('signUpModeBtn').disabled=busy;document.getElementById('forgotPasswordBtn').disabled=busy;document.getElementById('backToSignInBtn').disabled=busy}
async function signInPasskey(retry){
  const action=beginLoginAction();if(!action)return;const{context,generation}=action;
  clearStatus();clearPasskeyStatus();setPasskeyRetry(false);setAuthBusy(true);
  let button=document.getElementById('passkeySignInBtn');button.textContent='Waiting for passkey...';
  showPasskey('Checking this device for a saved Occulert passkey…','pending');
  try{if(retry&&window.OcculertPasskeys&&window.OcculertPasskeys.retry)await window.OcculertPasskeys.retry();if(generation!==loginGeneration||!loginRequireView(context))return;const request=window.OcculertAuth.signInPasskey();action.attempt=window.OcculertBackend.captureAuthContext();let profile=await request;if(!acceptLoginResult(profile,generation))return;renderProfile(window.OcculertBackend&&window.OcculertBackend.currentUser(),profile);showPasskey('Signed in with your passkey. Choose where to continue.','good');focusSignInContinuation()}
  catch(err){if(!retainUnchangedLoginContext(context,generation,action.attempt))return;showPasskey(window.OcculertPasskeys?window.OcculertPasskeys.message(err,'signin'):'Passkey sign-in is unavailable. Use email and password.','bad');setPasskeyRetry(Boolean(window.OcculertPasskeys&&window.OcculertPasskeys.canRetry&&window.OcculertPasskeys.canRetry(err)))}
  finally{if(finishLoginAction(action))button.textContent='Sign in with a passkey'}
}
function initPasskeySignIn(){let button=document.getElementById('passkeySignInBtn'),help=document.getElementById('passkeyHelp');if(passkeySupported()){button.disabled=false;return}button.disabled=true;help.textContent='Passkeys require a supported browser on a secure Occulert page. Email and password remain available.'}
async function submitAuth(e){
  e.preventDefault();const action=beginLoginAction();if(!action)return;const{context,generation}=action;setAuthBusy(true);
  let email=document.getElementById('email').value.trim();
  try{
    if(authMode==='signup'||authMode==='email'){
      emailLinkPending=true;
      const request=window.OcculertPasswordless.start(email,authMode==='signup'?extras():null);action.attempt=window.OcculertBackend.captureAuthContext();await request;
      if(!retainUnchangedLoginContext(context,generation,action.attempt))return;
      show('Check your email for a secure link. Open it to '+(authMode==='signup'?'confirm your account and create a passkey.':'sign in.')+' You can request another link after one minute.','good');
      return;
    }
    if(authMode==='reset'){
      let result=await window.OcculertBackend.requestPasswordReset(email);
      if(generation!==loginGeneration||!loginRequireView(context))return;
      if(!result.ok){if(window.OcculertBackend.isEmailRateLimited(result))document.getElementById('submitBtn').dataset.rateLimited='reset';return show(window.OcculertBackend.passwordResetMessage(result),'bad')}
      show('If an Occulert account uses that email, a password reset link is on the way. Check your inbox and spam folder.','good');
      return;
    }
    const request=window.OcculertAuth.signInEmail(email,document.getElementById('password').value,authMode,authMode==='signup'?extras():{});action.attempt=window.OcculertBackend.captureAuthContext();let p=await request;
    if(!acceptLoginResult(p,generation))return;
    renderProfile(window.OcculertBackend&&window.OcculertBackend.currentUser(),p);
    show(authMode==='signup'?'Account created. Check your email if confirmation is required.':'Signed in. Choose where to continue.','good');
    if(authMode==='signin')focusSignInContinuation();
  }catch(err){
    if(!retainUnchangedLoginContext(context,generation,action.attempt))return;
    let message=err.message||String(err);
    if(authMode==='signup'&&message.startsWith('Too many confirmation emails'))document.getElementById('submitBtn').dataset.rateLimited='signup';
    show(message,err.code==='confirmation_required'?'good':'bad');
  }finally{if(loginPendingAction===action){emailLinkPending=false;finishLoginAction(action)}}
}
async function logout(){const context=loginActionContext();if(!context)return;const cleanup=window.OcculertAuth.signOut(),cleared=window.OcculertBackend.captureAuthContext();await cleanup;if(!window.OcculertBackend.isAuthContextCurrent(cleared)){refreshLoginState();return}await refreshLoginState();if(loginViewCurrent()&&!window.OcculertBackend.currentUser()){show('Signed out on this browser.','good');focusSignInForm()}}
function profileUserId(user){return String(user&&(user.uid||user.id)||'')}
function showSignedInProfile(p,role,fleetAccess){
  let box=document.getElementById('profileBox'),actions=document.getElementById('profileActions');
  box.innerHTML=`<p class="signed-in-copy">You're signed in. Continue to your workspace or manage this account.</p><div class="row"><span>Verified role</span><span>${esc(role)}</span></div><div class="row"><span>Name</span><span>${esc(p.name||'Not set')}</span></div><div class="row"><span>Email</span><span>${esc(p.email||'Not set')}</span></div><div class="row"><span>Company</span><span>${esc(p.company||'Not set')}</span></div><div class="row"><span>Fleet access</span><span>${esc(fleetAccess)}</span></div><div class="row"><span>Authenticated</span><span>Yes</span></div>`;
  actions.innerHTML=role==='Fleet Manager'?'<a class="btn primary" href="/fleet-dashboard.html">Open Fleet Dashboard</a><a class="btn" href="/account.html">Account</a><a class="btn" href="/fleet-onboarding.html">Fleet setup</a><a class="btn" href="/app.html">Driver App</a><button class="btn" onclick="logout()">Use another account</button>':'<a class="btn primary" href="/app.html">Open Driver App</a><a class="btn" href="/account.html">Account</a><button class="btn" onclick="logout()">Use another account</button>';
}
async function verifyManagerRole(user,p,version){
  let context=loginContext,backend=window.OcculertBackend,result=null;
  try{if(backend&&backend.getFleet)result=await backend.getFleet()}catch(err){}
  if(version!==profileRenderVersion||!loginRequireView(context))return;
  let active=backend&&backend.currentUser?backend.currentUser():null;
  if(!active||profileUserId(active)!==profileUserId(user))return;
  if(result&&result.ok&&result.body&&result.body.fleet){
    let fleetName=result.body.fleet.company_name||'your fleet';
    showSignedInProfile(p,'Fleet Manager','Verified owner of '+fleetName);
    return;
  }
  if(result&&result.status===404){showSignedInProfile(p,'Driver','No owned fleet');return}
  showSignedInProfile(p,'Not verified',result&&result.status===401?'Sign in again to verify':'Server verification unavailable');
}
function renderProfile(user,p){
  let version=++profileRenderVersion;
  let box=document.getElementById('profileBox'),label=document.getElementById('profileStateLabel'),actions=document.getElementById('profileActions');
  setSignedInLayout(Boolean(user)&&authMode==='signin'&&!enrollmentActive);
  if(!user){
    label.textContent='Account status';
    box.innerHTML='<div class="notice"><strong>Not signed in.</strong><br>A saved local setup may remain on this browser, but it is not an authenticated Occulert account. Sign in to access protected fleet data.</div>';
    actions.innerHTML='<a class="btn primary" href="/app.html">Open Driver App</a>';
    return;
  }
  p=p||window.OcculertAuth.getProfile()||{};if(p.uid!==profileUserId(user))p={};
  p=Object.assign({},p,{email:user.email||(p&&p.email)||'',authenticated:true});
  label.textContent='Signed-in account';
  setRole(p.role||'driver');
  ['name','company','vehicle','email'].forEach(id=>{let el=document.getElementById(id);if(el&&!el.value)el.value=p[id]||''});
  showSignedInProfile(p,'Checking…','Checking server ownership…');
  verifyManagerRole(user,p,version);
}

initPasskeySignIn();
let initialMode='signin';
try{let mode=new URLSearchParams(window.location.search).get('mode');if(['reset','signup','email'].includes(mode))initialMode=mode}catch(err){}
showAuthMode(initialMode);

function setupStatus(message,type){let el=document.getElementById('passkeySetupStatus');el.textContent=message;el.className='status show '+(type||'good')}
function openPasskeySetup(){
  enrollmentActive=true;setSignedInLayout(false);
  document.getElementById('authForm').classList.add('hidden');
  document.getElementById('passkeyEntry').classList.add('hidden');
  document.getElementById('passkeySetup').classList.remove('hidden');
  document.getElementById('authHeading').textContent='Email confirmed';
  document.getElementById('authIntro').textContent='One last step: add a passkey for faster sign-in next time.';
  document.getElementById('passkeySetupEmail').textContent=window.OcculertBackend.currentUser().email;
  document.getElementById('createPasskeyBtn').disabled=!passkeySupported();
  document.getElementById('signInModeBtn').disabled=true;document.getElementById('signUpModeBtn').disabled=true;
  if(!passkeySupported())setupStatus('This browser cannot create a passkey. Continue with email and add one later from Account.','pending');
  document.getElementById('passkeySetupHeading').focus();
}
async function createProfilePasskey(){
  const context=loginActionContext(),generation=loginGeneration;if(!context)return;
  let button=document.getElementById('createPasskeyBtn'),skip=document.getElementById('skipPasskeyBtn');
  if(button.disabled)return;button.disabled=true;skip.disabled=true;
  setupStatus('Follow your device’s prompt to save your passkey.','pending');
  try{await window.OcculertPasskeys.register();if(generation!==loginGeneration||!loginRequireView(context))return;finishPasskeySetup('Passkey saved. Your account is ready.')}
  catch(error){if(generation!==loginGeneration||!loginRequireView(context))return;setupStatus('Your email is confirmed. '+(error.name==='NotAllowedError'?'The prompt was cancelled. Try again, or continue with email for now.':'The passkey could not be saved. Try again, or continue with email for now.'),'bad')}
  finally{if(generation===loginGeneration&&loginViewCurrent(context)){button.disabled=false;skip.disabled=false}}
}
function finishPasskeySetup(message){
  if(!loginActionContext())return;
  document.getElementById('completionStatus').textContent=message||'Signed in with email. You can add a passkey later from Account.';
  enrollmentActive=false;document.getElementById('passkeySetup').classList.add('hidden');
  document.getElementById('authForm').classList.remove('hidden');setAuthBusy(false);
  showAuthMode('signin');renderProfile(window.OcculertBackend.currentUser(),window.OcculertAuth.getProfile());focusSignInContinuation();
}
async function initializeLogin(){
  const generation=++loginGeneration;clearLoginView();
  try{
    let result=window.OcculertPasswordless&&window.location.hash?await window.OcculertPasswordless.consumeRedirect():null;
    if(generation!==loginGeneration)return;
    if(result){
      if(!acceptLoginResult(result.profile,generation))return;
      setAuthBusy(false);renderProfile(window.OcculertBackend.currentUser(),result.profile);
      document.getElementById('fleetSetupLink').classList.toggle('hidden',!result.fleetRequested);
      if(result.enroll){document.getElementById('skipPasskeyBtn').disabled=false;openPasskeySetup()}else{showAuthMode('signin');focusSignInContinuation()}
      if(!result.profile.cloudProfile){show('You are signed in. Your cloud profile could not sync yet. Use Retry profile sync when your connection returns.','pending');document.getElementById('retryProfileBtn').classList.remove('hidden')}
      return;
    }
  }catch(error){if(generation!==loginGeneration)return;await refreshLoginState();if(loginViewCurrent())show(error.message||'The email link could not be verified. Request a new link.','bad');return}
  if(generation===loginGeneration)refreshLoginState();
}
initializeLogin();

async function retryProfileSync(){
  const context=loginActionContext(),generation=loginGeneration;if(!context)return;
  let button=document.getElementById('retryProfileBtn');if(button.disabled)return;button.disabled=true;
  let profile=window.OcculertAuth.getProfile(),user=window.OcculertBackend.currentUser();
  try{
    if(!user||!profile||user.id!==profile.uid)throw new Error('Sign in again to sync your profile.');
    let result=await window.OcculertBackend.ensureDriverProfile(profile);
    if(!result.ok)throw new Error('Profile sync is still unavailable. Check your connection and retry.');
    if(generation!==loginGeneration||!loginRequireView(context))return;
    profile.cloudProfile=true;window.OcculertAuth.saveProfile(profile);button.classList.add('hidden');
    document.getElementById('completionStatus').textContent='Your profile is synced.';clearStatus();
  }catch(error){if(generation===loginGeneration&&loginRequireView(context))document.getElementById('completionStatus').textContent=error.message}
  finally{if(generation===loginGeneration&&loginViewCurrent(context))button.disabled=false}
}
