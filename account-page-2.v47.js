// ── Theme System ──
const html=document.documentElement;
const THEME_KEY='occulert-theme';
function getTheme(){return localStorage.getItem(THEME_KEY)||(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark')}
function setTheme(t){html.setAttribute('data-theme',t);localStorage.setItem(THEME_KEY,t);const btn=document.getElementById('themeToggle');if(btn)btn.textContent=t==='light'?'\u2600\uFE0F':'\u263E';document.querySelector('meta[name="theme-color"]')?.setAttribute('content',t==='light'?'#f0f4f8':'#0a0e1a');const ts=document.getElementById('themeStatus');if(ts)ts.textContent=t==='light'?'Light':'Dark'}
setTheme(getTheme());
document.getElementById('themeToggle')?.addEventListener('click',()=>setTheme(html.getAttribute('data-theme')==='light'?'dark':'light'));
// ── Profile Logic ──
function show(msg,type){let s=document.getElementById('status');s.className='status show '+(type||'good');s.textContent=msg}
function showDelete(msg,type){let s=document.getElementById('deleteStatus');s.className='status show '+(type||'good');s.textContent=msg}
function showPasskey(msg,type){let s=document.getElementById('passkeyStatus');s.className='status show '+(type||'good');s.textContent=msg}
function setPasskeyRetry(show){let b=document.getElementById('passkeyRetryBtn');if(b)b.classList.toggle('hidden',!show)}
function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function cleanFleet(v){return String(v||'OCCULERT-DEMO').trim().toUpperCase().replace(/[^A-Z0-9_-]/g,'-').slice(0,40)||'OCCULERT-DEMO'}
function getProfile(){return window.OcculertAuth&&window.OcculertAuth.getProfile?window.OcculertAuth.getProfile():JSON.parse(localStorage.getItem('occulert-profile')||'null')}
function setProfile(p){if(window.OcculertAuth&&window.OcculertAuth.saveProfile)return window.OcculertAuth.saveProfile(p);localStorage.setItem('occulert-profile',JSON.stringify(p));localStorage.setItem('occulert-role',p.role);localStorage.setItem('occulert-fleet-id',p.fleetId);return p}
function load(){let p=getProfile()||{};document.getElementById('name').value=p.name||'';document.getElementById('role').value=p.role||localStorage.getItem('occulert-role')||'driver';document.getElementById('company').value=p.company||'';document.getElementById('fleetId').value=p.fleetId||localStorage.getItem('occulert-fleet-id')||'OCCULERT-DEMO';document.getElementById('vehicle').value=p.vehicle||'';document.getElementById('bio').value=p.bio||'';const dEl=document.getElementById('driverIdDisplay');if(dEl)dEl.textContent=localStorage.getItem('occulert-driver-id')||'--';const cEl=document.getElementById('cloudStatus');if(cEl)cEl.textContent=localStorage.getItem('occulert-cloud-consent')==='true'?'Enabled':'Disabled';render(p)}
function saveProfile(e){e.preventDefault();let p=getProfile()||{};p.name=document.getElementById('name').value.trim();p.role=document.getElementById('role').value;p.company=document.getElementById('company').value.trim()||'Occulert';p.fleetId=cleanFleet(document.getElementById('fleetId').value);p.vehicle=document.getElementById('vehicle').value.trim();p.bio=document.getElementById('bio').value.trim();p.savedAt=new Date().toISOString();p=setProfile(p);render(p);show('Profile saved successfully.','good')}
async function signOut(){try{if(window.OcculertAuth)await window.OcculertAuth.signOut();show('Signed out.','good')}catch(e){show('Signed out locally.','good')}verifiedAccountAccess={status:'local'};renderSecurity();render(getProfile()||{})}
let deletionInProgress=false;
async function deleteAccount(e){
  e.preventDefault();
  if(deletionInProgress)return;
  if(!signedInUser())return showDelete('Sign in before deleting your account.','bad');
  const confirmation=document.getElementById('deleteConfirmation').value.trim();
  if(confirmation!=='DELETE')return showDelete('Type DELETE exactly to confirm permanent deletion.','bad');
  if(!window.confirm('Permanently delete your Occulert sign-in, personal driving history, invitations, and any fleet you own? Other fleet members keep their accounts and driving history. This cannot be undone.'))return;
  deletionInProgress=true;
  setBusy('deleteAccountBtn',true,'Delete account permanently');
  try{
    const result=await window.OcculertBackend.deleteAccount();
    if(!result.ok)return showDelete('Deletion was not confirmed. Try signing in again to check your account, or contact support.','bad');
    try{if(window.OcculertAuth)await window.OcculertAuth.signOut()}catch(err){}
    try{for(let i=localStorage.length-1;i>=0;i--){const key=localStorage.key(i);if(key&&key.indexOf('occulert-')===0)localStorage.removeItem(key)}}catch(err){}
    showDelete('Your account was permanently deleted. Redirecting to sign in…','good');
    setTimeout(()=>{window.location.href='/login.html'},900);
  }catch(err){showDelete('Deletion was not confirmed. Try signing in again to check your account, or contact support.','bad')}
  finally{deletionInProgress=false;setBusy('deleteAccountBtn',false,'Delete account permanently')}
}
function signedInUser(){return window.OcculertBackend&&window.OcculertBackend.currentUser?window.OcculertBackend.currentUser():null}
function recoveryRequested(){return /(?:^|[?&])recovery=1(?:&|$)/.test((window.location&&window.location.search)||'')}
function profileUserId(user){return String(user&&(user.uid||user.id)||'')}
let accountAccessRenderVersion=0;
let verifiedAccountAccess={status:'local'};
async function verifyAccountAccess(user){
  let version=++accountAccessRenderVersion;
  if(!user){verifiedAccountAccess={status:'local'};render(getProfile()||{});return}
  verifiedAccountAccess={status:'checking'};render(getProfile()||{});
  let backend=window.OcculertBackend,result=null;
  try{if(backend&&backend.getFleet)result=await backend.getFleet()}catch(err){}
  if(version!==accountAccessRenderVersion)return;
  let active=backend&&backend.currentUser?backend.currentUser():null;
  if(!active||profileUserId(active)!==profileUserId(user))return;
  if(result&&result.ok&&result.body&&result.body.fleet){verifiedAccountAccess={status:'verified',role:'fleet',fleetName:result.body.fleet.company_name||'your fleet'}}
  else if(result&&result.status===404){verifiedAccountAccess={status:'verified',role:'driver'}}
  else{verifiedAccountAccess={status:'unavailable',reauth:!!(result&&result.status===401)}}
  render(getProfile()||{});
}
let passkeysById={};
let passkeyLoadId=0;
function validPasskeyId(value){let id=String(value||'');return /^[0-9a-f-]{20,80}$/i.test(id)?id:''}
function passkeySupported(){return Boolean(window.OcculertPasskeys&&window.OcculertPasskeys.isSupported())}
function formatPasskeyDate(value){let date=new Date(value||'');return Number.isNaN(date.getTime())?'Unknown':date.toLocaleDateString()}
function setPasskeyBusy(busy){let add=document.getElementById('registerPasskeyBtn'),retry=document.getElementById('passkeyRetryBtn');if(add){add.disabled=busy||!passkeySupported();add.textContent=busy?'Working…':'Add a passkey'}if(retry)retry.disabled=busy;document.querySelectorAll('[data-passkey-action]').forEach(button=>{button.disabled=busy})}
function handlePasskeyError(err,action){showPasskey(window.OcculertPasskeys.message(err,action),'bad');setPasskeyRetry(Boolean(window.OcculertPasskeys.canRetry&&window.OcculertPasskeys.canRetry(err)))}
function renderPasskeys(passkeys){
  let list=document.getElementById('passkeyList');passkeysById={};
  (Array.isArray(passkeys)?passkeys:[]).forEach(item=>{let id=validPasskeyId(item&&item.id);if(id)passkeysById[id]=item});
  let ids=Object.keys(passkeysById);
  if(!ids.length){list.innerHTML='<div class="passkey-empty">No passkeys added yet. Your password and reset link continue to work.</div>';return}
  list.innerHTML=ids.map(id=>{let item=passkeysById[id],name=esc(item.friendly_name||item.friendlyName||'Passkey'),created=formatPasskeyDate(item.created_at||item.createdAt),last=item.last_used_at||item.lastUsedAt;return '<div class="passkey-item"><div><strong>'+name+'</strong><div class="passkey-meta">Added '+esc(created)+(last?' · Last used '+esc(formatPasskeyDate(last)):'')+'</div></div><div class="passkey-actions"><button class="btn" type="button" data-passkey-action="rename" data-passkey-id="'+id+'">Rename</button><button class="btn red" type="button" data-passkey-action="remove" data-passkey-id="'+id+'">Remove</button></div></div>'}).join('')
}
async function loadPasskeys(){
  let list=document.getElementById('passkeyList'),requestId=++passkeyLoadId;
  if(!signedInUser()){passkeysById={};list.innerHTML='<div class="passkey-empty">Sign in to manage passkeys.</div>';return}
  if(!passkeySupported()){passkeysById={};list.innerHTML='<div class="passkey-empty">Passkeys require a supported browser on a secure Occulert page.</div>';setPasskeyBusy(false);return}
  setPasskeyRetry(false);setPasskeyBusy(true);
  try{let passkeys=await window.OcculertPasskeys.list();if(requestId===passkeyLoadId)renderPasskeys(passkeys)}
  catch(err){if(requestId===passkeyLoadId){passkeysById={};list.innerHTML='<div class="passkey-empty">Passkeys could not be loaded.</div>';handlePasskeyError(err,'manage')}}
  finally{if(requestId===passkeyLoadId)setPasskeyBusy(false)}
}
async function registerPasskey(){
  if(!signedInUser())return showPasskey('Sign in with your email and password before adding a passkey.','bad');
  setPasskeyBusy(true);
  try{setPasskeyRetry(false);await window.OcculertPasskeys.register();await loadPasskeys();showPasskey('Passkey added. You can use it the next time you sign in.','good')}
  catch(err){handlePasskeyError(err,'register')}
  finally{setPasskeyBusy(false)}
}
async function renamePasskey(id){
  id=validPasskeyId(id);let item=id&&passkeysById[id];if(!item)return;
  let current=item.friendly_name||item.friendlyName||'Passkey',next=window.prompt('Name this passkey',current);if(next===null)return;next=next.trim();
  if(!next||next.length>120)return showPasskey('Use a passkey name between 1 and 120 characters.','bad');
  setPasskeyBusy(true);
  try{await window.OcculertPasskeys.rename(id,next);await loadPasskeys();showPasskey('Passkey renamed.','good')}
  catch(err){handlePasskeyError(err,'manage')}
  finally{setPasskeyBusy(false)}
}
async function removePasskey(id){
  id=validPasskeyId(id);let item=id&&passkeysById[id];if(!item)return;let name=item.friendly_name||item.friendlyName||'this passkey';
  if(!window.confirm('Remove '+name+' from this Occulert account?'))return;
  setPasskeyBusy(true);
  try{await window.OcculertPasskeys.remove(id);await loadPasskeys();showPasskey('Passkey removed. Your password and reset link still work.','good')}
  catch(err){handlePasskeyError(err,'manage')}
  finally{setPasskeyBusy(false)}
}
function handlePasskeyAction(event){let button=event.target&&event.target.closest?event.target.closest('[data-passkey-action]'):null;if(!button)return;let action=button.dataset.passkeyAction,id=button.dataset.passkeyId;if(action==='rename')renamePasskey(id);else if(action==='remove')removePasskey(id)}
async function retryPasskeySetup(){setPasskeyRetry(false);setPasskeyBusy(true);try{await window.OcculertPasskeys.retry();await loadPasskeys();showPasskey('Passkey helper reloaded. You can add or manage passkeys now.','good')}catch(err){handlePasskeyError(err,'manage')}finally{setPasskeyBusy(false)}}
function renderSecurity(){const user=signedInUser(),forms=document.getElementById('securityForms'),intro=document.getElementById('securityIntro');if(!forms||!intro)return;if(user){forms.classList.remove('hidden');intro.textContent=recoveryRequested()?'Recovery link verified for '+user.email+'. Choose a new password below.':'Signed in as '+user.email+'.';const e=document.getElementById('newEmail');if(e&&!e.value)e.value=user.email||'';if(window.OcculertPasskeys)loadPasskeys()}else{forms.classList.add('hidden');intro.textContent='Sign in to change your email or password.';passkeysById={};setPasskeyRetry(false)}}
function setBusy(id,busy,label){const b=document.getElementById(id);if(!b)return;b.disabled=busy;b.textContent=busy?'Working...':label}
async function changeEmail(e){
  e.preventDefault();
  if(!signedInUser())return show('Sign in first before changing your email.','bad');
  const email=document.getElementById('newEmail').value.trim();
  if(!email)return show('Enter a new email address.','bad');
  setBusy('emailBtn',true,'Change Email');
  try{
    const result=await window.OcculertBackend.updateEmail(email);
    if(!result.ok)return show(window.OcculertBackend.accountMessage(result,'email'),'bad');
    show('Confirmation sent to '+email+'. Your sign-in email changes once you open the link.','good');
  }catch(err){show('The email could not be updated. Please try again.','bad')}
  finally{setBusy('emailBtn',false,'Change Email')}
}
async function changePassword(e){
  e.preventDefault();
  if(!signedInUser())return show('Sign in first before changing your password.','bad');
  const field=document.getElementById('newPassword'),pw=field.value;
  if(!pw||pw.length<6)return show('Use a password with at least 6 characters.','bad');
  setBusy('passwordBtn',true,'Change Password');
  try{
    const result=await window.OcculertBackend.updatePassword(pw);
    if(!result.ok)return show(window.OcculertBackend.accountMessage(result,'password'),'bad');
    field.value='';
    const recovered=recoveryRequested();
    if(recovered&&window.history&&window.history.replaceState)window.history.replaceState(null,'','/account.html');
    show(recovered?'Password reset. You are signed in and can continue.':'Password updated. Use it the next time you sign in.','good');
  }catch(err){show('The password could not be updated. Please try again.','bad')}
  finally{setBusy('passwordBtn',false,'Change Password')}
}
function render(p){
  p=p||getProfile()||{};
  let user=signedInUser(),access=verifiedAccountAccess||{status:'local'},localRole=p.role==='fleet'?'Fleet Manager':'Driver';
  let verifiedRole='Not signed in',fleetAccess='Sign in to verify',cloudLogin=!!user;
  if(access.status==='checking'){verifiedRole='Checking…';fleetAccess='Checking server ownership…'}
  else if(access.status==='verified'&&access.role==='fleet'){verifiedRole='Fleet Manager';fleetAccess='Verified owner of '+access.fleetName}
  else if(access.status==='verified'){verifiedRole='Driver';fleetAccess='No owned fleet'}
  else if(access.status==='unavailable'){verifiedRole='Not verified';fleetAccess=access.reauth?'Sign in again to verify':'Server verification unavailable'}
  let continueBtn=document.getElementById('continueBtn'),manager=access.status==='verified'&&access.role==='fleet';
  continueBtn.href=manager?'/fleet-dashboard.html':'/app.html';continueBtn.textContent=manager?'Open Fleet Dashboard':'Open Driver App';
  const initials=esc((p.name||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)||'?'),email=esc((user&&user.email)||p.email||'No email set');
  document.getElementById('profileBox').innerHTML='<div class="avatar-row"><div class="avatar">'+initials+'</div><div class="avatar-info"><h3>'+esc(p.name||'No name set')+'</h3><p>'+email+'</p></div></div><div class="row"><span>Verified role</span><span>'+esc(verifiedRole)+'</span></div><div class="row"><span>Fleet access</span><span>'+esc(fleetAccess)+'</span></div><div class="row"><span>Local app role</span><span>'+esc(localRole)+'</span></div><div class="row"><span>Company</span><span>'+esc(p.company||'Not set')+'</span></div><div class="row"><span>Vehicle</span><span>'+esc(p.vehicle||'Not set')+'</span></div><div class="row"><span>Login</span><span class="badge">'+(cloudLogin?'Cloud':'Local')+'</span></div>'
}
async function initAccount(){
  let recovery={handled:false,ok:false};
  try{if(window.OcculertBackend&&window.OcculertBackend.consumeAuthRedirect)recovery=await window.OcculertBackend.consumeAuthRedirect()}catch(err){recovery={handled:true,ok:false,body:{error:'cloud_unavailable'}}}
  document.getElementById('passkeyList')?.addEventListener('click',handlePasskeyAction);
  if(window.OcculertAuth){window.OcculertAuth.onAuth(function(user,p){verifiedAccountAccess=user?{status:'checking'}:{status:'local'};load();renderSecurity();verifyAccountAccess(user)})}else{load();renderSecurity()}
  if(recovery.handled&&recovery.ok){show('Secure reset link verified. Choose a new password below.','good');document.getElementById('newPassword')?.focus()}
  else if(recovery.handled){show(window.OcculertBackend.passwordResetMessage(recovery),'bad')}
  else if(recoveryRequested()&&!signedInUser()){show('This password reset link is missing, invalid, or expired. Request a new one from the sign-in page.','bad')}
}
initAccount();
