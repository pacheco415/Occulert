const formStartedAt=new Date().toISOString();
const params=new URLSearchParams(location.search),planOptions=new Set(['conversation','free-trial','starter','growth','custom']),paidRolloutPlans=new Set(['starter','growth','custom']),planParam=params.get('plan'),requestedInterest=params.get('interest'),freeTrialInterest=requestedInterest==='free-trial'&&planParam==='free-trial',rolloutInterest=requestedInterest==='paid-rollout'&&paidRolloutPlans.has(planParam),requestedPlan=freeTrialInterest||rolloutInterest?planParam:requestedInterest?'conversation':planOptions.has(planParam)?planParam:'conversation',planSelect=document.getElementById('plan');
planSelect.value=requestedPlan;
if(freeTrialInterest||rolloutInterest)Array.from(planSelect.options).forEach(option=>{option.disabled=freeTrialInterest?option.value!=='free-trial':!paidRolloutPlans.has(option.value)});
if(freeTrialInterest){
  const steps=document.querySelectorAll('.step'),items=document.querySelectorAll('.item');
  document.title='Start a Free Fleet Trial — Occulert';
  document.querySelector('.brand').textContent='Occulert Free Fleet Trial';
  document.querySelector('.pill').textContent='Free for 30 days';
  document.querySelector('h1').textContent='Try Occulert free for 30 days';
  document.querySelector('.hero>div>.muted').textContent='Begin with up to five active drivers and the protected manager dashboard. No credit card is required, and the trial does not renew automatically.';
  steps[0].innerHTML='<strong>1. Confirm fit</strong><br><span class="small">Choose a small driver group and the operating goal you want to evaluate.</span>';
  steps[1].innerHTML='<strong>2. Try 30 days</strong><br><span class="small">Use protected reporting without buying dedicated fleet hardware.</span>';
  steps[2].innerHTML='<strong>3. Choose freely</strong><br><span class="small">Stop when the trial ends or deliberately choose a month-to-month plan.</span>';
  items[0].innerHTML='<strong>Free trial terms</strong><br><span class="muted">$0 for 30 days and up to five active drivers. No credit card and no automatic renewal.</span>';
  items[1].innerHTML='<strong>What the trial covers</strong><br><span class="muted">Self-service setup, owner-scoped dashboard access, 7- and 30-day reporting, and privacy-limited exports.</span>';
  document.querySelector('form h2').textContent='Start the Free Trial';
  document.getElementById('message').value='I am interested in the free 30-day Occulert fleet trial for up to five active drivers.';
  document.getElementById('saveBtn').textContent='Start Free Trial';
}else if(rolloutInterest){
  const steps=document.querySelectorAll('.step'),items=document.querySelectorAll('.item');
  document.title='Plan a Paid Fleet Rollout — Occulert';
  document.querySelector('.brand').textContent='Occulert Fleet Rollout';
  document.querySelector('.pill').textContent='Paid fleet rollout';
  document.querySelector('h1').textContent='Turn your Occulert trial into an operating plan';
  document.querySelector('.hero>div>.muted').textContent='Use your trial results to define a practical manager workflow, agree on rollout scope, and move toward a supported paid deployment without adding hidden claims or surveillance data.';
  steps[0].innerHTML='<strong>1. Review outcomes</strong><br><span class="small">Use the dashboard report to confirm participation, review workload, and operating goals.</span>';
  steps[1].innerHTML='<strong>2. Define rollout</strong><br><span class="small">Choose the driver group, manager workflow, reporting window, and support needs.</span>';
  steps[2].innerHTML='<strong>3. Agree on scope</strong><br><span class="small">Confirm the rollout plan and post-trial pricing before any paid deployment begins.</span>';
  items[0].innerHTML='<strong>What the rollout covers</strong><br><span class="muted">Owner-scoped dashboard access, protected driver invitations, 7- and 30-day reporting, privacy-limited exports, and rollout planning with Occulert.</span>';
  items[1].innerHTML='<strong>What happens next</strong><br><span class="muted">Share your fleet size and use case. Occulert will review the request and follow up by email to discuss scope, support, and pricing; submitting this form does not start a paid service.</span>';
  document.querySelector('form h2').textContent='Discuss a paid rollout';
  document.getElementById('message').value='I am interested in discussing an affordable Occulert fleet rollout based on our operating needs.';
  document.getElementById('saveBtn').textContent='Request Rollout Conversation';
}
function val(id){return document.getElementById(id).value.trim()}
function validEmail(email){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)}
function planMatchesInterest(plan){return freeTrialInterest?plan==='free-trial':rolloutInterest?paidRolloutPlans.has(plan):true}
async function saveLead(event){
  event?.preventDefault();
  const btn=document.getElementById('saveBtn'),success=document.getElementById('success'),error=document.getElementById('error'),buttonLabel=freeTrialInterest?'Start Free Trial':rolloutInterest?'Request Rollout Conversation':'Send Fleet Request';
  success.style.display='none';error.style.display='none';
  const lead={name:val('name'),role:val('role'),company:val('company'),email:val('email'),phone:val('phone'),fleet:document.getElementById('fleet').value,useCase:document.getElementById('useCase').value,plan:planSelect.value,timeline:document.getElementById('timeline').value,goal:document.getElementById('goal').value,message:val('message'),interest:freeTrialInterest?'free_trial':rolloutInterest?'paid_rollout':'pilot',createdAt:new Date().toISOString(),startedAt:formStartedAt,website:val('website')};
  if(!lead.name||!lead.company||!lead.email||!validEmail(lead.email)){error.textContent='Please add your name, company, and a valid email.';error.style.display='block';return}
  if(!planMatchesInterest(lead.plan)){error.textContent='Choose a plan that matches this trial or rollout request.';error.style.display='block';return}
  btn.disabled=true;btn.textContent='Sending...';
  try{
    const res=await fetch('/api/pilot-leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(lead)}),result=await res.json().catch(()=>({}));
    if(!res.ok||result.stored!==true)throw new Error(result.error||'request_not_stored');
    success.textContent=freeTrialInterest?'Free trial request saved securely. No credit card was collected, no automatic renewal was created, and no contact copy was kept in this browser.':rolloutInterest?'Rollout conversation requested and saved securely. No contact copy was kept in this browser.':'Fleet request sent and saved securely. No contact copy was kept in this browser.';success.style.display='block';
    ['name','role','company','email','phone','message','website'].forEach(id=>document.getElementById(id).value='');
  }catch(e){error.textContent='Your request was not saved. Please try again later or email fleet@occulert.com.';error.style.display='block'}
  finally{btn.disabled=false;btn.textContent=buttonLabel}
}
