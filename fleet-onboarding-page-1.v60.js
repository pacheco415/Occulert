let currentFleet=null,fleetContext=null,fleetGeneration=0,inviteLoadGeneration=0;
function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function showPage(message,type){let el=document.getElementById('pageStatus');el.className='notice '+(type||'');el.textContent=message}
function showInvite(message,type){let el=document.getElementById('inviteStatus');el.className='notice '+(type||'');el.textContent=message}
function messageFor(error){return({email_not_verified:'Confirm your email, then sign in again.',invalid_company_name:'Enter a company or fleet name.',invalid_email:'Enter a valid driver email.',cannot_invite_self:'Use a different email for the driver.',active_invitation_exists:'A current invitation already exists for that email.',too_many_pending_invitations:'Revoke unused invitations before creating more.',invitation_rate_limited:'Too many invitations were created recently. Wait about an hour and try again.',resend_too_soon:'Wait one minute before sending a new link.',invitation_not_found:'That pending invitation is no longer available.',invitation_not_pending:'That invitation is no longer pending.',sign_in_required:'Sign in as the fleet owner first.',auth_session_changed:'Your signed-in account changed. Review this account and try again.'})[error]||'The request could not be completed. Please try again.'}
function fleetViewCurrent(context){return Boolean(context&&context===fleetContext&&window.OcculertBackend.isAuthContextCurrent(context))}
function fleetRequireView(context){if(fleetViewCurrent(context))return true;if(context&&context===fleetContext)boot();return false}
function clearInvitationLink(){document.getElementById('inviteLink').value='';document.getElementById('emailInvite').href='#';document.getElementById('inviteLinkBox').classList.add('hidden')}
function clearFleetView(){
  currentFleet=null;fleetContext=null;inviteLoadGeneration++;
  ['createCard','inviteCard','listCard','inviteStatus'].forEach(id=>document.getElementById(id).classList.add('hidden'));
  ['companyName','driverEmail'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('fleetName').textContent='Invite drivers';document.getElementById('inviteList').innerHTML='';
  document.getElementById('inviteStatus').textContent='';clearInvitationLink();setInviteBusy(true);
  showPage('Checking your signed-in account…');
}
function fleetActionContext(requireFleet=true){
  if(fleetViewCurrent(fleetContext)&&(!requireFleet||currentFleet))return fleetContext;
  boot();return null;
}
function inviteStatus(invite){if(invite.accepted_at)return['Accepted','accepted'];if(invite.revoked_at)return['Revoked','closed'];if(Date.parse(invite.expires_at)<=Date.now())return['Expired','closed'];return['Pending','pending']}
function renderInvitations(invitations){let list=document.getElementById('inviteList');if(!invitations.length){list.innerHTML='<div class="notice">No invitations yet.</div>';return}list.innerHTML=invitations.map(i=>{let state=inviteStatus(i),pending=state[0]==='Pending',id=encodeURIComponent(i.id);return `<div class="invite"><div><strong>${esc(i.email)}</strong><div class="status">Created ${esc(new Date(i.created_at).toLocaleString())} · Expires ${esc(new Date(i.expires_at).toLocaleString())}</div><span class="pill ${state[1]}">${state[0]}</span></div>${pending?`<div class="invite-actions"><button class="btn" onclick="resendInvite('${id}')">Send New Link</button><button class="btn danger" onclick="revokeInvite('${id}')">Revoke</button></div>`:''}</div>`}).join('')}
async function loadInvitations(context=fleetContext){
  if(!fleetRequireView(context))return;const generation=++inviteLoadGeneration;
  try{let result=await window.OcculertBackend.listFleetInvitations();if(generation!==inviteLoadGeneration||!fleetRequireView(context))return;if(result.ok)renderInvitations(result.body.invitations||[]);else{renderInvitations([]);showInvite(messageFor(result.body?.error),'bad')}}
  catch(err){if(fleetViewCurrent(context)&&generation===inviteLoadGeneration){renderInvitations([]);showInvite('Invitations could not be loaded. Please try again.','bad')}}
}
function showFleet(fleet,context){if(!fleetRequireView(context))return;currentFleet=fleet;document.getElementById('createCard').classList.add('hidden');document.getElementById('inviteCard').classList.remove('hidden');document.getElementById('listCard').classList.remove('hidden');document.getElementById('fleetName').textContent='Invite drivers to '+fleet.company_name;showPage('Signed in as the verified owner of '+fleet.company_name+'.','good');setInviteBusy(false);loadInvitations(context)}
async function createFleet(event){
  event.preventDefault();const context=fleetActionContext(false);if(!context)return;
  showPage('Creating your protected fleet…');
  try{let result=await window.OcculertBackend.createFleet(document.getElementById('companyName').value.trim());if(!fleetRequireView(context))return;if(result.ok)showFleet(result.body.fleet,context);else showPage(messageFor(result.body?.error),'bad')}
  catch(err){if(fleetViewCurrent(context))showPage('The fleet could not be created. Please try again.','bad')}
}
function setInviteBusy(busy){document.getElementById('inviteCard').setAttribute('aria-busy',String(busy));document.querySelectorAll('#inviteCard button,#inviteList button').forEach(button=>button.disabled=busy)}
function showNewInvitation(result,renewed){let invitation=result.body.invitation,path=invitation.accept_path,link=new URL(path,window.location.origin).href,email=invitation.email,subject='Join '+currentFleet.company_name+' on Occulert',body='You are invited to join '+currentFleet.company_name+' on Occulert.\n\nOpen this one-time link with '+email+':\n'+link+'\n\nThe link expires in seven days.';document.getElementById('inviteLink').value=link;document.getElementById('emailInvite').href='mailto:'+encodeURIComponent(email)+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);document.getElementById('inviteLinkBox').classList.remove('hidden');showInvite((renewed?'A fresh one-time link was created. ':'Invite created. ')+'Choose Email Link or Copy Link; it will not be shown again.','good')}
async function createInvite(event){
  event.preventDefault();const context=fleetActionContext();if(!context)return;setInviteBusy(true);
  try{showInvite('Creating a one-time invitation…');clearInvitationLink();let result=await window.OcculertBackend.createFleetInvitation(document.getElementById('driverEmail').value.trim());if(!fleetRequireView(context))return;if(!result.ok){showInvite(messageFor(result.body?.error),'bad');return}showNewInvitation(result,false);document.getElementById('driverEmail').value='';await loadInvitations(context)}
  catch(err){if(fleetViewCurrent(context))showInvite('The invitation was not confirmed. Refresh invitations before trying again.','bad')}
  finally{if(fleetViewCurrent(context))setInviteBusy(false)}
}
async function resendInvite(encodedId){
  const context=fleetActionContext();if(!context)return;let id;try{id=decodeURIComponent(encodedId)}catch(e){return}setInviteBusy(true);
  try{showInvite('Revoking the old link and creating a fresh invitation…');clearInvitationLink();let result=await window.OcculertBackend.resendFleetInvitation(id);if(!fleetRequireView(context))return;if(!result.ok){showInvite(messageFor(result.body?.error),'bad');return}showNewInvitation(result,true);await loadInvitations(context)}
  catch(err){if(fleetViewCurrent(context))showInvite('The new link was not confirmed. Refresh invitations before trying again.','bad')}
  finally{if(fleetViewCurrent(context))setInviteBusy(false)}
}
async function revokeInvite(encodedId){
  const context=fleetActionContext();if(!context)return;let id;try{id=decodeURIComponent(encodedId)}catch(e){return}setInviteBusy(true);
  try{let result=await window.OcculertBackend.revokeFleetInvitation(id);if(!fleetRequireView(context))return;clearInvitationLink();showInvite(result.ok?'Invitation revoked.':messageFor(result.body?.error),result.ok?'good':'bad');await loadInvitations(context)}
  catch(err){if(fleetViewCurrent(context))showInvite('Revocation was not confirmed. Refresh invitations before trying again.','bad')}
  finally{if(fleetViewCurrent(context))setInviteBusy(false)}
}
async function copyInvite(){
  const context=fleetActionContext();if(!context)return;let input=document.getElementById('inviteLink');if(!input.value)return;
  try{await navigator.clipboard.writeText(input.value);if(fleetViewCurrent(context))showInvite('Invitation link copied.','good')}
  catch(e){if(!fleetRequireView(context))return;input.select();if(document.execCommand('copy'))showInvite('Invitation link copied.','good');else showInvite('Copy failed. Select the link and copy it manually.','bad')}
}
async function boot(){
  const generation=++fleetGeneration;clearFleetView();const backend=window.OcculertBackend;
  try{
    const session=await backend.getSession();if(generation!==fleetGeneration)return;
    if(!session){showPage('Sign in as a fleet manager to create or manage a fleet.','bad');return}
    const context=backend.captureAuthContext();
    if(!context.auth||context.auth.access_token!==session.access_token||context.auth.refresh_token!==session.refresh_token||context.auth.user?.id!==session.user?.id)return;
    let result=await backend.getFleet();if(generation!==fleetGeneration||!backend.isAuthContextCurrent(context))return;
    if(result.ok){fleetContext=context;showFleet(result.body.fleet,context);return}
    if(result.status===404){fleetContext=context;document.getElementById('createCard').classList.remove('hidden');showPage('Signed in. Create your fleet to begin inviting drivers.');return}
    showPage(messageFor(result.body?.error),'bad');
  }catch(err){if(generation===fleetGeneration)showPage('Account verification is unavailable. Refresh this page to retry.','bad')}
}
if(window.addEventListener){window.addEventListener('storage',event=>{if(event.key==='occulert-auth'||event.key===null)boot()});window.addEventListener('focus',()=>{if(fleetContext&&!fleetViewCurrent(fleetContext)||!fleetContext&&window.OcculertBackend.currentUser())boot()})}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&(fleetContext&&!fleetViewCurrent(fleetContext)||!fleetContext&&window.OcculertBackend.currentUser()))boot()});
document.getElementById('emailInvite').addEventListener('click',event=>{if(!fleetActionContext())event.preventDefault()});
boot();
