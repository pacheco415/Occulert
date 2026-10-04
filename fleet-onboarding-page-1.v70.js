let currentFleet=null,fleetContext=null,fleetGeneration=0,inviteLoadGeneration=0;
let invitationRows=[],invitationLoadedAt=null,invitationLoading=false,invitationReady=false,invitationUncertain=false,inviteMutationBusy=false,shownInvitationId=null,shownEmailHref=null,invitationFocus=null;
const INVITATION_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function showPage(message,type){let el=document.getElementById('pageStatus');el.className='notice '+(type||'');el.textContent=message}
function showInvite(message,type){let el=document.getElementById('inviteStatus');el.className='notice '+(type||'');el.textContent=message}
function setupStatus(id,message){document.getElementById(id).textContent=message}
function renderSetupDrivers(){
  if(!invitationReady){setupStatus('setupDriverStatus','Invitation status is unavailable. Refresh the list below before relying on it.');return}
  const accepted=invitationRows.filter(invite=>inviteStatus(invite)[1]==='accepted').length;
  const pending=invitationRows.filter(invite=>inviteStatus(invite)[1]==='pending').length;
  setupStatus('setupDriverStatus',accepted+' accepted and '+pending+' pending among the latest '+invitationRows.length+' invitation records. Check the list below for details.');
}
function messageFor(error){return({email_not_verified:'Confirm your email, then sign in again.',unauthorized:'Sign in as the verified fleet owner, then reload this page.',fleet_not_found:'This account does not own a protected fleet. Sign in with the owner account or reload Fleet Setup.',invalid_company_name:'Enter a company or fleet name.',invalid_email:'Enter a valid driver email.',cannot_invite_self:'Use a different email for the driver.',active_invitation_exists:'A current invitation already exists for that email.',too_many_pending_invitations:'Revoke unused invitations before creating more.',invitation_rate_limited:'Too many invitations were created recently. Wait about an hour and try again.',resend_too_soon:'Wait one minute before sending a new link.',invitation_not_found:'That pending invitation is no longer available.',invitation_not_pending:'That invitation is no longer pending.',sign_in_required:'Sign in as the fleet owner first.',auth_session_changed:'Your signed-in account changed. Review this account and try again.'})[error]||'The request could not be completed. Please try again.'}
function fleetViewCurrent(context){return Boolean(context&&context===fleetContext&&window.OcculertBackend.isAuthContextCurrent(context))}
function fleetRequireView(context){if(fleetViewCurrent(context))return true;if(context&&context===fleetContext)boot();return false}
function clearInvitationLink(){shownInvitationId=null;shownEmailHref=null;document.getElementById('inviteLink').value='';document.getElementById('emailInvite').href='#';document.getElementById('inviteLinkBox').classList.add('hidden')}
function clearFleetView(){
  currentFleet=null;fleetContext=null;inviteLoadGeneration++;
  invitationRows=[];invitationLoadedAt=null;invitationLoading=false;invitationReady=false;invitationUncertain=false;invitationFocus=null;
  document.getElementById('invitationSearch').value='';document.getElementById('invitationStatusFilter').value='all';
  document.getElementById('invitationCounts').textContent='No invitations loaded.';document.getElementById('invitationListStatus').textContent='';
  ['createCard','inviteCard','listCard','inviteStatus'].forEach(id=>document.getElementById(id).classList.add('hidden'));
  ['companyName','driverEmail'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('fleetName').textContent='Invite drivers';document.getElementById('inviteList').innerHTML='';
  document.getElementById('inviteList').setAttribute('aria-busy','false');
  document.getElementById('inviteStatus').textContent='';clearInvitationLink();setInviteBusy(true);
  setupStatus('setupAccountStatus','Checking your sign-in.');
  setupStatus('setupFleetStatus','Checking for a protected fleet.');
  setupStatus('setupDriverStatus','Create invitations, deliver each link, then check accepted status below.');
  showPage('Checking your signed-in account…');
}
function fleetActionContext(requireFleet=true){
  if(fleetViewCurrent(fleetContext)&&(!requireFleet||currentFleet))return fleetContext;
  boot();return null;
}
function rejectedFleetAccess(result){if(result.status!==401&&result.status!==403)return false;let message=messageFor(result.body?.error);clearFleetView();showPage(message,'bad');return true}
function markInvitationUncertain(id){invitationReady=false;invitationUncertain=true;if(!id||shownInvitationId===id)clearInvitationLink();document.getElementById('invitationListStatus').textContent='The saved result is unknown. Refresh invitations before creating, replacing or revoking again. A created usable link cannot be recovered from the invitation list.';updateInviteControls()}
function inviteTime(value){
  if(typeof value!=='string'||value.length>35)return null;
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if(!match||match[0]!==value)return null;
  const [year,month,day,hour,minute,second]=match.slice(1,7).map(Number),leap=year%4===0&&(year%100!==0||year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if(year<1||month<1||month>12||day<1||day>days[month-1]||hour>23||minute>59||second>59)return null;
  const zone=match[8];if(zone!=='Z'){const hours=Number(zone.slice(1,3)),minutes=Number(zone.slice(4,6));if(hours>14||minutes>59||hours===14&&minutes!==0)return null}
  const parsed=Date.parse(value);return Number.isFinite(parsed)?parsed:null;
}
function inviteStatus(invite){if(invite.accepted_at)return['Accepted','accepted'];if(invite.revoked_at)return['Revoked','revoked'];if(Date.parse(invite.expires_at)<=Date.now())return['Expired','expired'];return['Pending','pending']}
function renderInvitations(){
  if(!fleetViewCurrent(fleetContext))return;
  let query=document.getElementById('invitationSearch').value.trim().toLocaleLowerCase(),selectedStatus=document.getElementById('invitationStatusFilter').value;
  let shown=invitationRows.filter(invite=>(!query||invite.email.toLocaleLowerCase().includes(query))&&(selectedStatus==='all'||inviteStatus(invite)[1]===selectedStatus));
  let list=document.getElementById('inviteList');
  list.innerHTML=shown.length?shown.map(i=>{let state=inviteStatus(i),pending=state[1]==='pending',id=encodeURIComponent(i.id);return `<div class="invite"><div><strong>${esc(i.email)}</strong><div class="status">Created ${esc(new Date(i.created_at).toLocaleString())} · Expires ${esc(new Date(i.expires_at).toLocaleString())}</div><span class="pill ${state[1]}">${state[0]}</span></div>${pending?`<div class="invite-actions"><button class="btn" type="button" data-invitation="${esc(i.id)}" data-action="replace" aria-label="Replace invitation link for ${esc(i.email)}" data-page-action="replaceInvite" title="Revokes this link and creates a replacement for you to deliver">Replace link</button><button class="btn danger" type="button" data-invitation="${esc(i.id)}" data-action="revoke" aria-label="Revoke invitation for ${esc(i.email)}" data-page-action="revokeInvite">Revoke invitation</button></div>`:''}</div>`}).join(''):`<div class="notice">${invitationRows.length?'No loaded invitations match these filters.':'No invitations have been loaded for this fleet.'}</div>`;
  document.getElementById('invitationCounts').textContent=shown.length+' of '+invitationRows.length+' loaded invitations match (latest up to 100).'+(invitationLoadedAt?' Loaded '+new Date(invitationLoadedAt).toLocaleString()+'.':'');
  updateInviteControls();
}
function selectInvitations(data){
  if(!data||data.ok!==true||data.fleet?.id!==currentFleet?.id||!Array.isArray(data.invitations)||data.invitations.length>100)throw new Error('invalid_invitation_list');
  let ids=new Set();return data.invitations.map(invite=>{
    if(!invite||typeof invite.id!=='string'||invite.id.length!==36||!INVITATION_UUID.test(invite.id)||ids.has(invite.id.toLowerCase())||typeof invite.email!=='string'||!invite.email.trim()||invite.email.length>240)throw new Error('invalid_invitation_list');
    const created=inviteTime(invite.created_at),expires=inviteTime(invite.expires_at),accepted=invite.accepted_at===null?null:inviteTime(invite.accepted_at),revoked=invite.revoked_at===null?null:inviteTime(invite.revoked_at);
    if(created===null||expires===null||expires<created||invite.accepted_at!==null&&accepted===null||invite.revoked_at!==null&&revoked===null||
      accepted!==null&&(accepted<created||accepted>expires)||revoked!==null&&revoked<created||accepted!==null&&revoked!==null)throw new Error('invalid_invitation_list');
    ids.add(invite.id.toLowerCase());return{id:invite.id,email:invite.email,created_at:invite.created_at,expires_at:invite.expires_at,accepted_at:invite.accepted_at,revoked_at:invite.revoked_at};
  });
}
async function loadInvitations(context=fleetContext){
  if(!fleetRequireView(context))return;const generation=++inviteLoadGeneration;
  invitationLoading=true;invitationReady=false;updateInviteControls();document.getElementById('inviteList').setAttribute('aria-busy','true');document.getElementById('invitationListStatus').textContent='Refreshing invitation records…';
  try{
    let result=await window.OcculertBackend.listFleetInvitations();if(generation!==inviteLoadGeneration||!fleetRequireView(context))return;
    if(rejectedFleetAccess(result))return;
    if(!result.ok)throw new Error(messageFor(result.body?.error));
    invitationRows=selectInvitations(result.body);invitationLoadedAt=Date.now();invitationReady=true;invitationUncertain=false;renderInvitations();renderSetupDrivers();
    document.getElementById('invitationListStatus').textContent='Invitation records refreshed. Creating or replacing a link does not send an email.';
  }catch(err){if(fleetViewCurrent(context)&&generation===inviteLoadGeneration){renderInvitations();setupStatus('setupDriverStatus','Invitation status could not be refreshed. Previously loaded records may be stale.');document.getElementById('invitationListStatus').textContent='Invitations could not be refreshed. '+(invitationRows.length?'Previously loaded records remain visible; row actions are disabled. ':'')+'Choose Refresh invitations to try again.'}}
  finally{if(fleetViewCurrent(context)&&generation===inviteLoadGeneration){invitationLoading=false;document.getElementById('inviteList').setAttribute('aria-busy','false');updateInviteControls()}}
}
function showFleet(fleet,context){if(!fleetRequireView(context))return;currentFleet=fleet;document.getElementById('createCard').classList.add('hidden');document.getElementById('inviteCard').classList.remove('hidden');document.getElementById('listCard').classList.remove('hidden');document.getElementById('fleetName').textContent='Invite drivers to '+fleet.company_name;setupStatus('setupAccountStatus','Signed in as the verified owner.');setupStatus('setupFleetStatus',fleet.company_name+' is available.');setupStatus('setupDriverStatus','Checking the latest invitation records.');showPage('Signed in as the verified owner of '+fleet.company_name+'.','good');setInviteBusy(false);loadInvitations(context)}
async function createFleet(event){
  event.preventDefault();const context=fleetActionContext(false);if(!context)return;
  showPage('Creating your protected fleet…');
  try{let result=await window.OcculertBackend.createFleet(document.getElementById('companyName').value.trim());if(!fleetRequireView(context))return;if(result.ok)showFleet(result.body.fleet,context);else showPage(messageFor(result.body?.error),'bad')}
  catch(err){if(fleetViewCurrent(context))showPage('The fleet could not be created. Please try again.','bad')}
}
function updateInviteControls(){let verified=fleetViewCurrent(fleetContext)&&!!currentFleet;document.querySelectorAll('#inviteCard button').forEach(button=>button.disabled=inviteMutationBusy||invitationUncertain||!verified);document.querySelectorAll('#inviteList button').forEach(button=>button.disabled=inviteMutationBusy||invitationLoading||!invitationReady||!verified);document.getElementById('refreshInvitations').disabled=inviteMutationBusy||invitationLoading||!verified;document.getElementById('invitationFilters').disabled=!verified;
  const email=document.getElementById('emailInvite'),disabled=inviteMutationBusy||invitationUncertain||!verified||!shownEmailHref;email.setAttribute('aria-disabled',String(disabled));email.href=disabled?'#':shownEmailHref;
  if(invitationFocus&&!inviteMutationBusy&&!invitationLoading&&verified){const focused=document.activeElement;if(focused===document.body||document.getElementById('inviteList').contains(focused)){let target=Array.from(document.querySelectorAll('#inviteList button')).find(button=>button.dataset.invitation===invitationFocus.id&&button.dataset.action===invitationFocus.action&&!button.disabled)||document.getElementById('refreshInvitations');if(!target.disabled)target.focus()}invitationFocus=null}
}
function setInviteBusy(busy){inviteMutationBusy=busy;document.getElementById('inviteCard').setAttribute('aria-busy',String(busy));updateInviteControls()}
function showNewInvitation(result,renewed){let invitation=result.body.invitation,path=invitation.accept_path;
  if(typeof path!=='string'||!/^\/accept-invite\.html#token=[A-Za-z0-9_-]{43}$/.test(path)||typeof invitation.id!=='string'||invitation.id.length!==36||!INVITATION_UUID.test(invitation.id)||typeof invitation.email!=='string'||invitation.email.length>240||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invitation.email)||inviteTime(invitation.expires_at)===null)throw new Error('invalid_invitation_link');
  let link=new URL(path,window.location.origin).href,email=invitation.email,subject='Join '+currentFleet.company_name+' on Occulert',body='You are invited to join '+currentFleet.company_name+' on Occulert.\n\nOpen this one-time link with '+email+':\n'+link+'\n\nThe link expires in seven days.';
  shownInvitationId=invitation.id;shownEmailHref='mailto:'+encodeURIComponent(email)+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);document.getElementById('inviteLink').value=link;document.getElementById('emailInvite').href=shownEmailHref;document.getElementById('inviteLinkBox').classList.remove('hidden');showInvite((renewed?'A replacement link was created; the old link no longer works. ':'Invitation link created. ')+'Nothing has been emailed. Choose Email link to review and send a draft, or Copy link to deliver it yourself. This link is shown once.','good');updateInviteControls()}
async function createInvite(event){
  event.preventDefault();const context=fleetActionContext();if(!context||inviteMutationBusy||invitationUncertain)return;setInviteBusy(true);
  try{showInvite('Creating a one-time invitation…');clearInvitationLink();let result=await window.OcculertBackend.createFleetInvitation(document.getElementById('driverEmail').value.trim());if(!fleetRequireView(context)||rejectedFleetAccess(result))return;if(!result.ok){if(result.status>=500){markInvitationUncertain();showInvite('The creation result is unknown. Refresh invitations before trying again.','bad')}else showInvite(messageFor(result.body?.error),'bad');return}showNewInvitation(result,false);document.getElementById('driverEmail').value='';await loadInvitations(context)}
  catch(err){if(fleetViewCurrent(context)){markInvitationUncertain();showInvite('The invitation result is unknown. Refresh invitations before trying again.','bad')}}
  finally{if(fleetViewCurrent(context))setInviteBusy(false)}
}
async function resendInvite(encodedId){
  const context=fleetActionContext();if(!context||inviteMutationBusy||invitationLoading||!invitationReady)return;let id;try{id=decodeURIComponent(encodedId)}catch(e){return}
  const invitation=invitationRows.find(row=>row.id===id);if(!invitation||inviteStatus(invitation)[1]!=='pending'){showInvite('This invitation is no longer pending. Refresh invitations to see its current status.','bad');return}
  invitationFocus={id,action:'replace'};setInviteBusy(true);
  try{showInvite('Revoking the old link and creating a fresh invitation…');clearInvitationLink();let result=await window.OcculertBackend.resendFleetInvitation(id);if(!fleetRequireView(context)||rejectedFleetAccess(result))return;if(!result.ok){if(result.status>=500){markInvitationUncertain(id);showInvite('The replacement result is unknown. Refresh invitations before trying again.','bad')}else showInvite(messageFor(result.body?.error),'bad');return}showNewInvitation(result,true);await loadInvitations(context)}
  catch(err){if(fleetViewCurrent(context)){markInvitationUncertain(id);showInvite('The new link result is unknown. Refresh invitations before trying again.','bad')}}
  finally{if(fleetViewCurrent(context))setInviteBusy(false)}
}
async function revokeInvite(encodedId){
  const context=fleetActionContext();if(!context||inviteMutationBusy||invitationLoading||!invitationReady)return;let id;try{id=decodeURIComponent(encodedId)}catch(e){return}
  const invitation=invitationRows.find(row=>row.id===id);if(!invitation||inviteStatus(invitation)[1]!=='pending')return;
  if(!window.confirm('Revoke the invitation for '+invitation.email+'? Its current link will stop working. Any email already sent will still exist, but the link cannot be accepted.'))return;
  if(!fleetRequireView(context))return;invitationFocus={id,action:'revoke'};setInviteBusy(true);
  try{let result=await window.OcculertBackend.revokeFleetInvitation(id);if(!fleetRequireView(context)||rejectedFleetAccess(result))return;if(!result.ok&&result.status>=500){markInvitationUncertain(id);showInvite('The revocation result is unknown. Refresh invitations before trying again.','bad');return}if(result.ok&&shownInvitationId===id)clearInvitationLink();showInvite(result.ok?'Invitation revoked for '+invitation.email+'. Its link no longer works.':messageFor(result.body?.error),result.ok?'good':'bad');await loadInvitations(context)}
  catch(err){if(fleetViewCurrent(context)){markInvitationUncertain(id);showInvite('The revocation result is unknown. Refresh invitations before trying again.','bad')}}
  finally{if(fleetViewCurrent(context))setInviteBusy(false)}
}
async function copyInvite(){
  const context=fleetActionContext();if(!context||inviteMutationBusy||invitationUncertain)return;let input=document.getElementById('inviteLink');if(!input.value)return;
  try{await navigator.clipboard.writeText(input.value);if(fleetViewCurrent(context))showInvite('Invitation link copied.','good')}
  catch(e){if(!fleetRequireView(context))return;input.select();if(document.execCommand('copy'))showInvite('Invitation link copied.','good');else showInvite('Copy failed. Select the link and copy it manually.','bad')}
}
async function boot(){
  const generation=++fleetGeneration;clearFleetView();const backend=window.OcculertBackend;
  try{
    const session=await backend.getSession();if(generation!==fleetGeneration)return;
    if(!session){setupStatus('setupAccountStatus','Sign in as a fleet manager to continue.');setupStatus('setupFleetStatus','A signed-in owner is required.');showPage('Sign in as a fleet manager to create or manage a fleet.','bad');return}
    const context=backend.captureAuthContext();
    if(!context.auth||context.auth.access_token!==session.access_token||context.auth.refresh_token!==session.refresh_token||context.auth.user?.id!==session.user?.id)return;
    let result=await backend.getFleet();if(generation!==fleetGeneration||!backend.isAuthContextCurrent(context))return;
    if(result.ok){fleetContext=context;showFleet(result.body.fleet,context);return}
    if(result.status===404){fleetContext=context;document.getElementById('createCard').classList.remove('hidden');setupStatus('setupAccountStatus','Signed in.');setupStatus('setupFleetStatus','Create a protected fleet below.');showPage('Signed in. Create your fleet to begin inviting drivers.');return}
    showPage(messageFor(result.body?.error),'bad');
  }catch(err){if(generation===fleetGeneration)showPage('Account verification is unavailable. Refresh this page to retry.','bad')}
}
if(window.addEventListener){window.addEventListener('storage',event=>{if(event.key==='occulert-auth'||event.key===null)boot()});window.addEventListener('focus',()=>{if(fleetContext&&!fleetViewCurrent(fleetContext)||!fleetContext&&window.OcculertBackend.currentUser())boot()})}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&(fleetContext&&!fleetViewCurrent(fleetContext)||!fleetContext&&window.OcculertBackend.currentUser()))boot()});
document.getElementById('emailInvite').addEventListener('click',event=>{if(!fleetActionContext()||inviteMutationBusy||invitationUncertain||!shownEmailHref||!document.getElementById('inviteLink').value){event.preventDefault();return}showInvite('Email draft requested. Review and send it in your mail app. Occulert cannot confirm sending or delivery.','good')});
document.getElementById('invitationSearch').addEventListener('input',renderInvitations);
document.getElementById('invitationStatusFilter').addEventListener('change',renderInvitations);
document.getElementById('refreshInvitations').addEventListener('click',()=>{if(!inviteMutationBusy&&!invitationLoading)loadInvitations()});
window.addEventListener('pagehide',()=>{fleetGeneration++;clearFleetView()});
boot();
