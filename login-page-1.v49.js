let selectedRole='driver';
let authMode='signin';
let enrollmentActive=false;
let emailLinkPending=false;
let profileRenderVersion=0;
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
  let sessionUser=window.OcculertBackend&&window.OcculertBackend.currentUser?window.OcculertBackend.currentUser():null;
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
  clearStatus();clearPasskeyStatus();setPasskeyRetry(false);setAuthBusy(true);
  let button=document.getElementById('passkeySignInBtn');button.textContent='Waiting for passkey...';
  showPasskey('Checking this device for a saved Occulert passkey…','pending');
  try{if(retry&&window.OcculertPasskeys&&window.OcculertPasskeys.retry)await window.OcculertPasskeys.retry();let profile=await window.OcculertAuth.signInPasskey();renderProfile(window.OcculertBackend&&window.OcculertBackend.currentUser(),profile);showPasskey('Signed in with your passkey. Choose where to continue.','good');focusSignInContinuation()}
  catch(err){showPasskey(window.OcculertPasskeys?window.OcculertPasskeys.message(err,'signin'):'Passkey sign-in is unavailable. Use email and password.','bad');setPasskeyRetry(Boolean(window.OcculertPasskeys&&window.OcculertPasskeys.canRetry&&window.OcculertPasskeys.canRetry(err)))}
  finally{button.textContent='Sign in with a passkey';setAuthBusy(false)}
}
function initPasskeySignIn(){let button=document.getElementById('passkeySignInBtn'),help=document.getElementById('passkeyHelp');if(passkeySupported()){button.disabled=false;return}button.disabled=true;help.textContent='Passkeys require a supported browser on a secure Occulert page. Email and password remain available.'}
async function submitAuth(e){
  e.preventDefault();if(emailLinkPending)return;setAuthBusy(true);
  let email=document.getElementById('email').value.trim();
  try{
    if(authMode==='signup'||authMode==='email'){
      emailLinkPending=true;
      await window.OcculertPasswordless.start(email,authMode==='signup'?extras():null);
      show('Check your email for a secure link. Open it to '+(authMode==='signup'?'confirm your account and create a passkey.':'sign in.')+' You can request another link after one minute.','good');
      return;
    }
    if(authMode==='reset'){
      let result=await window.OcculertBackend.requestPasswordReset(email);
      if(!result.ok){if(window.OcculertBackend.isEmailRateLimited(result))document.getElementById('submitBtn').dataset.rateLimited='reset';return show(window.OcculertBackend.passwordResetMessage(result),'bad')}
      show('If an Occulert account uses that email, a password reset link is on the way. Check your inbox and spam folder.','good');
      return;
    }
    let p=await window.OcculertAuth.signInEmail(email,document.getElementById('password').value,authMode,authMode==='signup'?extras():{});
    renderProfile(window.OcculertBackend&&window.OcculertBackend.currentUser(),p);
    show(authMode==='signup'?'Account created. Check your email if confirmation is required.':'Signed in. Choose where to continue.','good');
    if(authMode==='signin')focusSignInContinuation();
  }catch(err){
    let message=err.message||String(err);
    if(authMode==='signup'&&message.startsWith('Too many confirmation emails'))document.getElementById('submitBtn').dataset.rateLimited='signup';
    show(message,err.code==='confirmation_required'?'good':'bad');
  }finally{emailLinkPending=false;setAuthBusy(false)}
}
async function logout(){document.getElementById('fleetSetupLink').classList.add('hidden');document.getElementById('completionStatus').textContent='';document.getElementById('retryProfileBtn').classList.add('hidden');await window.OcculertAuth.signOut();renderProfile(null,window.OcculertAuth.getProfile());show('Signed out on this browser.','good');focusSignInForm()}
function profileUserId(user){return String(user&&(user.uid||user.id)||'')}
function showSignedInProfile(p,role,fleetAccess){
  let box=document.getElementById('profileBox'),actions=document.getElementById('profileActions');
  box.innerHTML=`<p class="signed-in-copy">You're signed in. Continue to your workspace or manage this account.</p><div class="row"><span>Verified role</span><span>${esc(role)}</span></div><div class="row"><span>Name</span><span>${esc(p.name||'Not set')}</span></div><div class="row"><span>Email</span><span>${esc(p.email||'Not set')}</span></div><div class="row"><span>Company</span><span>${esc(p.company||'Not set')}</span></div><div class="row"><span>Fleet access</span><span>${esc(fleetAccess)}</span></div><div class="row"><span>Authenticated</span><span>Yes</span></div>`;
  actions.innerHTML=role==='Fleet Manager'?'<a class="btn primary" href="/fleet-dashboard.html">Open Fleet Dashboard</a><a class="btn" href="/account.html">Account</a><a class="btn" href="/fleet-onboarding.html">Fleet setup</a><a class="btn" href="/app.html">Driver App</a><button class="btn" onclick="logout()">Use another account</button>':'<a class="btn primary" href="/app.html">Open Driver App</a><a class="btn" href="/account.html">Account</a><button class="btn" onclick="logout()">Use another account</button>';
}
async function verifyManagerRole(user,p,version){
  let backend=window.OcculertBackend,result=null;
  try{if(backend&&backend.getFleet)result=await backend.getFleet()}catch(err){}
  if(version!==profileRenderVersion)return;
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
  p=Object.assign({},p||window.OcculertAuth.getProfile()||{},{email:user.email||(p&&p.email)||'',authenticated:true});
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
  let button=document.getElementById('createPasskeyBtn'),skip=document.getElementById('skipPasskeyBtn');
  if(button.disabled)return;button.disabled=true;skip.disabled=true;
  setupStatus('Follow your device’s prompt to save your passkey.','pending');
  try{await window.OcculertPasskeys.register();finishPasskeySetup('Passkey saved. Your account is ready.')}
  catch(error){setupStatus('Your email is confirmed. '+(error.name==='NotAllowedError'?'The prompt was cancelled. Try again, or continue with email for now.':'The passkey could not be saved. Try again, or continue with email for now.'),'bad')}
  finally{button.disabled=false;skip.disabled=false}
}
function finishPasskeySetup(message){
  document.getElementById('completionStatus').textContent=message||'Signed in with email. You can add a passkey later from Account.';
  enrollmentActive=false;document.getElementById('passkeySetup').classList.add('hidden');
  document.getElementById('authForm').classList.remove('hidden');setAuthBusy(false);
  showAuthMode('signin');renderProfile(window.OcculertBackend.currentUser(),window.OcculertAuth.getProfile());focusSignInContinuation();
}
async function initializeLogin(){
  try{
    let result=window.OcculertPasswordless&&window.location.hash?await window.OcculertPasswordless.consumeRedirect():null;
    if(result){
      renderProfile(window.OcculertBackend.currentUser(),result.profile);
      document.getElementById('fleetSetupLink').classList.toggle('hidden',!result.fleetRequested);
      if(result.enroll)openPasskeySetup();else{showAuthMode('signin');focusSignInContinuation()}
      if(!result.profile.cloudProfile){show('You are signed in. Your cloud profile could not sync yet. Use Retry profile sync when your connection returns.','pending');document.getElementById('retryProfileBtn').classList.remove('hidden')}
      return;
    }
  }catch(error){show(error.message||'The email link could not be verified. Request a new link.','bad')}
  window.OcculertAuth.onAuth(function(user,profile){renderProfile(user,profile)});
}
initializeLogin();

async function retryProfileSync(){
  let button=document.getElementById('retryProfileBtn');if(button.disabled)return;button.disabled=true;
  let profile=window.OcculertAuth.getProfile(),user=window.OcculertBackend.currentUser();
  try{
    if(!user||!profile||user.id!==profile.uid)throw new Error('Sign in again to sync your profile.');
    let result=await window.OcculertBackend.ensureDriverProfile(profile);
    if(!result.ok)throw new Error('Profile sync is still unavailable. Check your connection and retry.');
    if(window.OcculertBackend.currentUser()?.id!==user.id)return;
    profile.cloudProfile=true;window.OcculertAuth.saveProfile(profile);button.classList.add('hidden');
    document.getElementById('completionStatus').textContent='Your profile is synced.';clearStatus();
  }catch(error){document.getElementById('completionStatus').textContent=error.message}
  finally{button.disabled=false}
}
