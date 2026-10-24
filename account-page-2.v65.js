// ── Theme System ──
const html=document.documentElement;
const THEME_KEY='occulert-theme';
function getTheme(){try{const stored=localStorage.getItem(THEME_KEY);if(stored)return stored}catch(err){}return window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}
function setTheme(t){html.setAttribute('data-theme',t);try{localStorage.setItem(THEME_KEY,t)}catch(err){}const btn=document.getElementById('themeToggle');if(btn)btn.textContent=t==='light'?'\u2600\uFE0F':'\u263E';document.querySelector('meta[name="theme-color"]')?.setAttribute('content',t==='light'?'#f0f4f8':'#0a0e1a');const ts=document.getElementById('themeStatus');if(ts)ts.textContent=t==='light'?'Light':'Dark'}
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
let accountContext=null,accountGeneration=0,recoveryVerified=false;
function accountBackend(){return window.OcculertBackend}
function accountViewCurrent(context){return Boolean(context&&context===accountContext&&accountBackend().isAuthContextCurrent(context))}
function accountRequireView(context){if(accountViewCurrent(context))return true;if(context&&context===accountContext)refreshAccountState();return false}
function accountProfile(user){let p=getProfile()||{};return p.uid&&(!user||p.uid!==user.id)?{}:p}
// A reset link this browser did not request waits here for Continue.
let recoveryPrompt=null;
function dismissRecoveryPrompt(){
  const prompt=recoveryPrompt;recoveryPrompt=null;
  const panel=document.getElementById('linkConfirm');if(panel)panel.classList.add('hidden');
  if(prompt){prompt.pending.cancel();prompt.resolve(null)}
}
function confirmRecoveryLink(pending){
  const panel=document.getElementById('linkConfirm'),text=document.getElementById('linkConfirmText'),heading=document.getElementById('linkConfirmHeading');
  if(!panel||!text){pending.cancel();return Promise.resolve(null)}
  dismissRecoveryPrompt();
  return new Promise(resolve=>{
    recoveryPrompt={pending,resolve};
    text.textContent='This password reset link signs this browser in as '+(pending.email||'another Occulert account')+'.';
    panel.classList.remove('hidden');if(heading)heading.focus();
  });
}
function acceptRecoveryPrompt(){
  const prompt=recoveryPrompt;if(!prompt)return;recoveryPrompt=null;
  document.getElementById('linkConfirm').classList.add('hidden');
  prompt.resolve(Promise.resolve().then(()=>prompt.pending.confirm()).catch(()=>({handled:true,ok:false,body:{error:'cloud_unavailable'}})));
}
function declineRecoveryPrompt(){
  if(!recoveryPrompt)return;dismissRecoveryPrompt();
  show('That reset link was not used. Nothing changed on this browser.','good');
}
function clearAccountView(){
  dismissRecoveryPrompt();
  deletionReauthOwner=null;deletionReauthBusy=false;const reauthSection=document.getElementById("deleteReauthSection");if(reauthSection)reauthSection.hidden=true;
  hideSecurityReauth();
  ['deleteReauthPasswordBtn','deleteReauthPasskeyBtn'].forEach(id=>{const button=document.getElementById(id);if(button)button.disabled=id==='deleteReauthPasskeyBtn'&&!passkeySupported()});
  accountContext=null;accountAccessRenderVersion++;passkeyLoadId++;passkeysById={};verifiedAccountAccess={status:'local'};recoveryVerified=false;
  ['name','company','fleetId','vehicle','bio','newEmail','currentPassword','newPassword','deleteConfirmation','deleteReauthPassword'].forEach(id=>{let el=document.getElementById(id);if(el)el.value=''});
  ['status','deleteStatus','passkeyStatus'].forEach(id=>{let el=document.getElementById(id);if(el){el.textContent='';el.className='status'}});
  document.getElementById('role').value='driver';
  document.getElementById('securityForms').classList.add('hidden');
  document.getElementById('securityIntro').textContent='Checking your signed-in account…';
  document.getElementById('profileBox').innerHTML='<div class="notice">Checking your signed-in account…</div>';
  document.getElementById('passkeyList').innerHTML='<div class="passkey-empty">Sign in to manage passkeys.</div>';
  document.getElementById('driverIdDisplay').textContent='--';
  const link=document.getElementById('continueBtn');link.href='/app.html';link.textContent='Open Driver App';
  ['emailBtn','passwordBtn','deleteAccountBtn','registerPasskeyBtn','passkeyRetryBtn'].forEach(id=>{let el=document.getElementById(id);if(el){el.disabled=true}});
  setPasskeyRetry(false);
}
function accountActionContext(){
  if(accountViewCurrent(accountContext))return accountContext;
  if(signedInUser()||accountContext){refreshAccountState();}
  return null;
}
async function refreshAccountState(){
  const generation=++accountGeneration;clearAccountView();
  const backend=accountBackend();
  if(!backend||!backend.getSession||!backend.captureAuthContext||!backend.isAuthContextCurrent)return;
  try{
    const session=await backend.getSession();if(generation!==accountGeneration)return;
    const context=backend.captureAuthContext(),stored=context.auth;
    if(session&&(!stored||stored.access_token!==session.access_token||stored.refresh_token!==session.refresh_token||stored.user?.id!==session.user?.id))return;
    if(!session&&stored)return;
    accountContext=session?context:null;
    load();renderSecurity();verifyAccountAccess(session&&session.user);
  }catch(err){if(generation===accountGeneration){document.getElementById('securityIntro').textContent='Account verification is unavailable. Refresh this page to retry.';}}
}
function accountAuthChanged(event){if(!event||event.key==='occulert-auth'||event.key===null)refreshAccountState()}
function checkAccountContext(){if(accountContext&&!accountViewCurrent(accountContext)||!accountContext&&signedInUser())refreshAccountState()}
if(window.addEventListener){window.addEventListener('storage',accountAuthChanged);window.addEventListener('focus',checkAccountContext)}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkAccountContext()});
function load(){let p=accountProfile(signedInUser());document.getElementById('name').value=p.name||'';document.getElementById('role').value=p.role||'driver';document.getElementById('company').value=p.company||'';document.getElementById('fleetId').value=p.fleetId||'OCCULERT-DEMO';document.getElementById('vehicle').value=p.vehicle||'';document.getElementById('bio').value=p.bio||'';const dEl=document.getElementById('driverIdDisplay');if(dEl)dEl.textContent=p.driverId||'--';const cEl=document.getElementById('cloudStatus');if(cEl)cEl.textContent=localStorage.getItem('occulert-cloud-consent')==='true'?'Enabled':'Disabled';render(p)}
function saveProfile(e){e.preventDefault();if(signedInUser()&&!accountActionContext())return;let p=accountProfile(signedInUser());p.name=document.getElementById('name').value.trim();p.role=document.getElementById('role').value;p.company=document.getElementById('company').value.trim()||'Occulert';p.fleetId=cleanFleet(document.getElementById('fleetId').value);p.vehicle=document.getElementById('vehicle').value.trim();p.bio=document.getElementById('bio').value.trim();p.savedAt=new Date().toISOString();p=setProfile(p);render(p);show('Profile saved successfully.','good')}
async function signOut(){
  if(signedInUser()&&!accountActionContext())return;
  try{if(window.OcculertAuth)await window.OcculertAuth.signOut();else accountBackend().signOut()}catch(e){}
  await refreshAccountState();show('Signed out.','good');
}
let deletionInProgress=false,deletionReauthOwner=null,deletionReauthBusy=false;
async function deleteAccount(e){
  e.preventDefault();
  if(deletionInProgress)return;
  const context=accountActionContext();
  if(!context)return showDelete('Sign in before deleting your account.','bad');
  const confirmation=document.getElementById('deleteConfirmation').value.trim();
  if(confirmation!=='DELETE')return showDelete('Type DELETE exactly to confirm permanent deletion.','bad');
  if(!window.confirm('Permanently delete your Occulert sign-in, personal driving history, invitations, and any fleet you own? Other fleet members keep their accounts and driving history. This cannot be undone.'))return;
  if(!accountRequireView(context))return;
  deletionInProgress=true;
  setBusy('deleteAccountBtn',true,'Delete account permanently');
  try{
    const result=await window.OcculertBackend.deleteAccount();
    if(!accountRequireView(context))return;
    if(result.status===401&&result.body?.error==='reauth_required'){deletionReauthOwner=signedInUser()?.id||null;const section=document.getElementById('deleteReauthSection');if(section)section.hidden=false;const passkey=document.getElementById('deleteReauthPasskeyBtn');if(passkey)passkey.disabled=!passkeySupported();document.getElementById('deleteReauthPassword')?.focus?.();return showDelete('Sign in again before deleting your account. No data was deleted.','bad')}
    if(!result.ok)return showDelete('Deletion was not confirmed. Try signing in again to check your account, or contact support.','bad');
    let cleanup;try{cleanup=window.OcculertAuth?window.OcculertAuth.signOut():accountBackend().signOut()}catch(err){}
    const cleared=accountBackend().captureAuthContext();
    try{await cleanup}catch(err){}
    if(!accountBackend().isAuthContextCurrent(cleared))return;
    accountGeneration++;clearAccountView();
    try{for(let i=localStorage.length-1;i>=0;i--){const key=localStorage.key(i);if(key&&key.indexOf('occulert-')===0)localStorage.removeItem(key)}}catch(err){}
    showDelete('Your account was permanently deleted. Redirecting to sign in…','good');
    setTimeout(()=>{if(accountBackend().isAuthContextCurrent(cleared))window.location.href='/login.html'},900);
  }catch(err){if(accountRequireView(context))showDelete('Deletion was not confirmed. Try signing in again to check your account, or contact support.','bad')}
  finally{deletionInProgress=false;if(accountViewCurrent(context))setBusy('deleteAccountBtn',false,'Delete account permanently')}
}
// Sign the same person in again by password or passkey. The caller checks the
// returned context is still the same account before continuing.
async function signInAgain(method,password){
  const backend=accountBackend(),user=signedInUser(),attempt=backend.beginAuthAttempt();accountContext=attempt;
  if(method==='passkey')await window.OcculertPasskeys.signIn(attempt);
  else{const result=await backend.signIn(user.email,password,attempt);if(!result.ok)throw Error(backend.authMessage(result,'signin'))}
  return backend.completedAuthContext(attempt);
}
async function reauthenticateForDeletion(event,method='password'){
  if(event)event.preventDefault();
  if(deletionReauthBusy)return;
  const backend=accountBackend(),owner=deletionReauthOwner,user=signedInUser();
  if(!owner||!user||user.id!==owner||!accountActionContext())return;
  const password=document.getElementById('deleteReauthPassword');
  if(method==='password'&&!password.value)return showDelete('Enter your current password.','bad');
  const enteredPassword=password.value;password.value='';
  const generation=accountGeneration;
  deletionReauthBusy=true;
  ['deleteReauthPasswordBtn','deleteReauthPasskeyBtn'].forEach(id=>{const button=document.getElementById(id);if(button)button.disabled=true});
  try{
    const completed=await signInAgain(method,enteredPassword);
    if(generation!==accountGeneration||deletionReauthOwner!==owner)return;
    if(completed.auth?.user?.id!==owner){await refreshAccountState();return showDelete('Your signed-in account changed. Deletion was cancelled.','bad')}
    accountContext=completed;password.value='';deletionReauthOwner=null;
    const section=document.getElementById('deleteReauthSection');if(section)section.hidden=true;
    load();renderSecurity();await verifyAccountAccess(signedInUser());
    if(!accountRequireView(completed))return;
    showDelete('Sign-in confirmed. Review and confirm permanent deletion.','good');
    await deleteAccount({preventDefault(){}});
  }catch(error){
    if(generation===accountGeneration&&signedInUser()?.id===owner){accountContext=backend.captureAuthContext();showDelete(method==='passkey'?window.OcculertPasskeys.message(error,'signin'):'Sign-in was not confirmed. Check your password and try again.','bad')}
  }finally{
    if(generation===accountGeneration&&signedInUser()?.id===owner){
      deletionReauthBusy=false;
      ['deleteReauthPasswordBtn','deleteReauthPasskeyBtn'].forEach(id=>{const button=document.getElementById(id);if(button)button.disabled=id==='deleteReauthPasskeyBtn'&&!passkeySupported()});
    }
  }
}
document.getElementById('deleteReauthForm')?.addEventListener('submit',event=>{void reauthenticateForDeletion(event)});
document.getElementById('deleteReauthPasskeyBtn')?.addEventListener('click',event=>{void reauthenticateForDeletion(event,'passkey')});
// Password and passkey changes need a sign-in within the last 10 minutes, the
// rule /api/account applies to deletion (api/_lib/recent-auth.js). A reset
// link counts: it is a fresh sign-in by email. This stops someone at an
// unattended session; Supabase's password settings cover a stolen token.
const RECENT_SIGN_IN_SECONDS=600,RECENT_SIGN_IN_METHODS=new Set(['password','passkey','otp','oauth','sso/saml','magiclink','totp','mfa/phone','mfa/webauthn','recovery']);
function tokenClaims(token){
  try{
    if(typeof token!=='string'||token.length>16384)return null;
    const parts=token.split('.');if(parts.length!==3||!/^[A-Za-z0-9_-]+$/.test(parts[1]))return null;
    const base64=parts[1].replace(/-/g,'+').replace(/_/g,'/'),binary=atob(base64+'==='.slice((base64.length+3)%4));
    const claims=JSON.parse(new TextDecoder().decode(Uint8Array.from(binary,c=>c.charCodeAt(0))));
    return claims&&typeof claims==='object'&&!Array.isArray(claims)?claims:null;
  }catch(err){return null}
}
function recentSignIn(auth,now=Math.floor(Date.now()/1000)){
  const claims=tokenClaims(auth&&auth.access_token);
  if(!claims||!auth.user||claims.sub!==auth.user.id||claims.role!=='authenticated'||claims.is_anonymous===true||typeof claims.session_id!=='string'||!Array.isArray(claims.amr))return false;
  return claims.amr.some(entry=>entry&&RECENT_SIGN_IN_METHODS.has(entry.method)&&Number.isSafeInteger(entry.timestamp)&&entry.timestamp>0&&now-entry.timestamp>=0&&now-entry.timestamp<=RECENT_SIGN_IN_SECONDS);
}
let securityReauth=null,securityReauthBusy=false;
function setSecurityReauthButtons(busy){['securityReauthPasswordBtn','securityReauthPasskeyBtn','securityReauthCancelBtn'].forEach(id=>{const button=document.getElementById(id);if(button)button.disabled=busy||id==='securityReauthPasskeyBtn'&&!passkeySupported()})}
function hideSecurityReauth(){
  securityReauth=null;securityReauthBusy=false;
  const section=document.getElementById('securityReauthSection');if(section)section.hidden=true;
  const field=document.getElementById('securityReauthPassword');if(field)field.value='';
  setSecurityReauthButtons(false);
}
// pending: {owner, message, notify, run(context, password)}. Nothing is sent
// until the same account signs in again; the action then runs once.
function requestSecurityReauth(pending){
  hideSecurityReauth();securityReauth=pending;
  const section=document.getElementById('securityReauthSection'),text=document.getElementById('securityReauthText');
  if(text)text.textContent=pending.message;
  setSecurityReauthButtons(false);
  if(section)section.hidden=false;
  document.getElementById('securityReauthPassword')?.focus?.();
  pending.notify(pending.message+' Nothing has changed yet.','bad');
}
function withRecentSignIn(context,pending){
  if(securityReauthBusy)return;
  if(recentSignIn(context.auth))return pending.run(context,'');
  requestSecurityReauth(pending);
}
async function runAfterSignIn(pending,method,password){
  const generation=accountGeneration;
  securityReauthBusy=true;setSecurityReauthButtons(true);
  try{
    const completed=await signInAgain(method,password);
    if(generation!==accountGeneration)return;
    if(completed.auth?.user?.id!==pending.owner){await refreshAccountState();return pending.notify('Your signed-in account changed. Nothing was changed.','bad')}
    // Same account, fresh tokens: keep the view and continue the action.
    accountContext=completed;
    const section=document.getElementById('securityReauthSection');if(section)section.hidden=true;securityReauth=null;
    if(!accountRequireView(completed))return;
    securityReauthBusy=false;setSecurityReauthButtons(false);
    await pending.run(completed,method==='password'?password:'');
  }catch(error){
    if(generation===accountGeneration&&signedInUser()?.id===pending.owner){accountContext=accountBackend().captureAuthContext();pending.notify(method==='passkey'?window.OcculertPasskeys.message(error,'signin'):'Sign-in was not confirmed. Check your password and try again.','bad')}
  }finally{
    if(generation===accountGeneration&&signedInUser()?.id===pending.owner){securityReauthBusy=false;setSecurityReauthButtons(false)}
  }
}
async function reauthenticateForSecurity(event,method='password'){
  if(event)event.preventDefault();
  const pending=securityReauth,user=signedInUser();
  if(securityReauthBusy||!pending||!user||user.id!==pending.owner||!accountActionContext())return;
  const field=document.getElementById('securityReauthPassword');
  if(method==='password'&&!field.value)return pending.notify('Enter your current password.','bad');
  const password=method==='password'?field.value:'';field.value='';
  await runAfterSignIn(pending,method,password);
}
function cancelSecurityReauth(){const pending=securityReauth;if(!pending)return;hideSecurityReauth();pending.notify('Cancelled. Nothing was changed.','good')}
document.getElementById('securityReauthForm')?.addEventListener('submit',event=>{void reauthenticateForSecurity(event)});
document.getElementById('securityReauthPasskeyBtn')?.addEventListener('click',event=>{void reauthenticateForSecurity(event,'passkey')});
document.getElementById('securityReauthCancelBtn')?.addEventListener('click',cancelSecurityReauth);
function signedInUser(){return window.OcculertBackend&&window.OcculertBackend.currentUser?window.OcculertBackend.currentUser():null}
function recoveryRequested(){return /(?:^|[?&])recovery=1(?:&|$)/.test((window.location&&window.location.search)||'')}
function profileUserId(user){return String(user&&(user.uid||user.id)||'')}
let accountAccessRenderVersion=0;
let verifiedAccountAccess={status:'local'};
async function verifyAccountAccess(user){
  let context=accountContext,version=++accountAccessRenderVersion;
  if(!user){verifiedAccountAccess={status:'local'};render(accountProfile(signedInUser()));return}
  verifiedAccountAccess={status:'checking'};render(accountProfile(signedInUser()));
  let backend=window.OcculertBackend,result=null;
  try{if(backend&&backend.getFleet)result=await backend.getFleet()}catch(err){}
  if(version!==accountAccessRenderVersion||!accountRequireView(context))return;
  let active=backend&&backend.currentUser?backend.currentUser():null;
  if(!active||profileUserId(active)!==profileUserId(user))return;
  if(result&&result.ok&&result.body&&result.body.fleet){verifiedAccountAccess={status:'verified',role:'fleet',fleetName:result.body.fleet.company_name||'your fleet'}}
  else if(result&&result.status===404){verifiedAccountAccess={status:'verified',role:'driver'}}
  else{verifiedAccountAccess={status:'unavailable',reauth:!!(result&&result.status===401)}}
  render(accountProfile(signedInUser()));
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
  let context=accountContext,list=document.getElementById('passkeyList'),requestId=++passkeyLoadId;
  if(!signedInUser()){passkeysById={};list.innerHTML='<div class="passkey-empty">Sign in to manage passkeys.</div>';return}
  if(!passkeySupported()){passkeysById={};list.innerHTML='<div class="passkey-empty">Passkeys require a supported browser on a secure Occulert page.</div>';setPasskeyBusy(false);return}
  setPasskeyRetry(false);setPasskeyBusy(true);
  try{let passkeys=await window.OcculertPasskeys.list();if(requestId===passkeyLoadId&&accountRequireView(context))renderPasskeys(passkeys)}
  catch(err){if(requestId===passkeyLoadId&&accountRequireView(context)){passkeysById={};list.innerHTML='<div class="passkey-empty">Passkeys could not be loaded.</div>';handlePasskeyError(err,'manage')}}
  finally{if(requestId===passkeyLoadId&&accountRequireView(context))setPasskeyBusy(false)}
}
async function registerPasskey(){
  const context=accountActionContext();
  if(!context)return showPasskey('Sign in with your email and password before adding a passkey.','bad');
  return withRecentSignIn(context,{owner:context.auth.user.id,message:'Sign in again to add a passkey.',notify:showPasskey,run:addPasskey});
}
async function addPasskey(context){
  setPasskeyBusy(true);
  try{setPasskeyRetry(false);await window.OcculertPasskeys.register();if(!accountRequireView(context))return;await loadPasskeys();if(!accountRequireView(context))return;showPasskey('Passkey added. You can use it the next time you sign in.','good')}
  catch(err){if(accountRequireView(context))handlePasskeyError(err,'register')}
  finally{if(accountViewCurrent(context))setPasskeyBusy(false)}
}
async function renamePasskey(id){
  const context=accountActionContext();if(!context)return;
  id=validPasskeyId(id);let item=id&&passkeysById[id];if(!item)return;
  let current=item.friendly_name||item.friendlyName||'Passkey',next=window.prompt('Name this passkey',current);if(next===null)return;next=next.trim();
  if(!next||next.length>120)return showPasskey('Use a passkey name between 1 and 120 characters.','bad');
  if(!accountRequireView(context))return;
  setPasskeyBusy(true);
  try{await window.OcculertPasskeys.rename(id,next);if(!accountRequireView(context))return;await loadPasskeys();if(!accountRequireView(context))return;showPasskey('Passkey renamed.','good')}
  catch(err){if(accountRequireView(context))handlePasskeyError(err,'manage')}
  finally{if(accountViewCurrent(context))setPasskeyBusy(false)}
}
async function removePasskey(id){
  const context=accountActionContext();if(!context)return;
  id=validPasskeyId(id);let item=id&&passkeysById[id];if(!item)return;let name=item.friendly_name||item.friendlyName||'this passkey';
  if(!window.confirm('Remove '+name+' from this Occulert account?'))return;
  if(!accountRequireView(context))return;
  return withRecentSignIn(context,{owner:context.auth.user.id,message:'Sign in again to remove '+name+'.',notify:showPasskey,run:current=>deletePasskey(current,id)});
}
async function deletePasskey(context,id){
  setPasskeyBusy(true);
  try{await window.OcculertPasskeys.remove(id);if(!accountRequireView(context))return;await loadPasskeys();if(!accountRequireView(context))return;showPasskey('Passkey removed. Your password and reset link still work.','good')}
  catch(err){if(accountRequireView(context))handlePasskeyError(err,'manage')}
  finally{if(accountViewCurrent(context))setPasskeyBusy(false)}
}
function handlePasskeyAction(event){let button=event.target&&event.target.closest?event.target.closest('[data-passkey-action]'):null;if(!button)return;let action=button.dataset.passkeyAction,id=button.dataset.passkeyId;if(action==='rename')renamePasskey(id);else if(action==='remove')removePasskey(id)}
async function retryPasskeySetup(){const context=accountActionContext();if(!context)return;setPasskeyRetry(false);setPasskeyBusy(true);try{await window.OcculertPasskeys.retry();if(!accountRequireView(context))return;await loadPasskeys();if(accountViewCurrent(context))showPasskey('Passkey helper reloaded. You can add or manage passkeys now.','good')}catch(err){if(accountRequireView(context))handlePasskeyError(err,'manage')}finally{if(accountViewCurrent(context))setPasskeyBusy(false)}}
function renderSecurity(){const user=accountViewCurrent(accountContext)?signedInUser():null,forms=document.getElementById('securityForms'),intro=document.getElementById('securityIntro');if(!forms||!intro)return;if(user){forms.classList.remove('hidden');intro.textContent=recoveryVerified?'Recovery link verified for '+user.email+'. Choose a new password below.':'Signed in as '+user.email+'.';const e=document.getElementById('newEmail');if(e&&!e.value)e.value=user.email||'';['emailBtn','passwordBtn','deleteAccountBtn'].forEach(id=>{let el=document.getElementById(id);if(el)el.disabled=false});if(window.OcculertPasskeys)loadPasskeys()}else{forms.classList.add('hidden');intro.textContent='Sign in to change your email or password.';passkeysById={};setPasskeyRetry(false)}}
function setBusy(id,busy,label){const b=document.getElementById(id);if(!b)return;b.disabled=busy;b.textContent=busy?'Working...':label}
async function changeEmail(e){
  e.preventDefault();
  const context=accountActionContext();
  if(!context)return show('Sign in first before changing your email.','bad');
  const email=document.getElementById('newEmail').value.trim();
  if(!email)return show('Enter a new email address.','bad');
  setBusy('emailBtn',true,'Change Email');
  try{
    const result=await window.OcculertBackend.updateEmail(email);
    if(!accountRequireView(context))return;
    if(!result.ok)return show(window.OcculertBackend.accountMessage(result,'email'),'bad');
    show('Confirmation sent to '+email+'. Your sign-in email changes once you open the link.','good');
  }catch(err){if(accountRequireView(context))show('The email could not be updated. Please try again.','bad')}
  finally{if(accountViewCurrent(context))setBusy('emailBtn',false,'Change Email')}
}
async function changePassword(e){
  e.preventDefault();
  const context=accountActionContext();
  if(!context)return show('Sign in first before changing your password.','bad');
  if(securityReauthBusy)return;
  const field=document.getElementById('newPassword'),pw=field.value,currentField=document.getElementById('currentPassword');
  if(!pw||pw.length<8)return show('Use a password with at least 8 characters.','bad');
  const current=currentField?currentField.value:'';if(currentField)currentField.value='';
  const pending={owner:context.auth.user.id,message:'Sign in again to change your password.',notify:show,run:(signedIn,password)=>savePassword(signedIn,pw,password)};
  // A typed current password is checked by signing in with it, then sent on.
  if(current)return runAfterSignIn(pending,'password',current);
  return withRecentSignIn(context,pending);
}
async function savePassword(context,pw,currentPassword){
  const field=document.getElementById('newPassword');
  setBusy('passwordBtn',true,'Change Password');
  try{
    const result=await window.OcculertBackend.updatePassword(pw,currentPassword);
    if(!accountRequireView(context))return;
    if(!result.ok)return show(window.OcculertBackend.accountMessage(result,'password'),'bad');
    field.value='';
    const recovered=recoveryVerified;
    if(recovered&&window.history&&window.history.replaceState)window.history.replaceState(null,'','/account.html');
    show(recovered?'Password reset. You are signed in and can continue.':'Password updated. Use it the next time you sign in.','good');
  }catch(err){if(accountRequireView(context))show('The password could not be updated. Please try again.','bad')}
  finally{if(accountViewCurrent(context))setBusy('passwordBtn',false,'Change Password')}
}
function render(p){
  p=p||accountProfile(signedInUser());
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
  clearAccountView();
  let recovery={handled:false,ok:false};
  try{if(accountBackend()?.consumeAuthRedirect)recovery=await accountBackend().consumeAuthRedirect()}catch(err){recovery={handled:true,ok:false,body:{error:'cloud_unavailable'}}}
  document.getElementById('passkeyList')?.addEventListener('click',handlePasskeyAction);
  document.getElementById('linkConfirmBtn')?.addEventListener('click',acceptRecoveryPrompt);
  document.getElementById('linkCancelBtn')?.addEventListener('click',declineRecoveryPrompt);
  await refreshAccountState();
  if(recovery.needsConfirmation){
    // Show the account currently signed in here, then ask before switching.
    const confirmed=await confirmRecoveryLink(recovery);
    if(!confirmed)return;
    recovery=confirmed;
    if(recovery.ok)await refreshAccountState();
  }
  if(recovery.handled&&recovery.ok&&accountViewCurrent(accountContext)&&accountContext.auth.user.id===recovery.body.id){recoveryVerified=true;renderSecurity();show('Secure reset link verified. Choose a new password below.','good');document.getElementById('newPassword')?.focus()}
  else if(recovery.handled&&accountViewCurrent(accountContext)){show(accountBackend().passwordResetMessage(recovery),'bad')}
  else if(recoveryRequested()&&!signedInUser()){show('This password reset link is missing, invalid, or expired. Request a new one from the sign-in page.','bad')}
}
initAccount();
