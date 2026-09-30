const formStartedAt = new Date().toISOString();
let leadSubmissionPending = false;
const form = document.getElementById('pilotForm');
form.noValidate = true;

const params = new URLSearchParams(location.search);
const paidPlans = new Set(['starter', 'growth', 'custom']);
const planParam = params.get('plan');
const requestedInterest = params.get('interest');
const freeTrialInterest = requestedInterest === 'free-trial' && planParam === 'free-trial';
const rolloutInterest = requestedInterest === 'paid-rollout' && paidPlans.has(planParam);
const planSelect = document.getElementById('plan');
const button = document.getElementById('saveBtn');
const intro = document.getElementById('requestIntro');
const formIntro = document.getElementById('formIntro');
const planNote = document.getElementById('planNote');
let buttonLabel = 'Send Fleet Request';

if (freeTrialInterest) {
  document.title = 'Request a Free Fleet Trial — Occulert';
  document.querySelector('.brand').textContent = 'Occulert Free Fleet Trial';
  document.getElementById('requestPill').textContent = 'Free for 30 days after approval';
  document.getElementById('requestTitle').textContent = 'Request a free Occulert fleet trial';
  intro.textContent = 'Tell us how to contact you. We will confirm fit, available devices, driver consent and the start date before the 30-day trial begins. Up to five willing drivers can participate.';
  document.getElementById('formTitle').textContent = 'Request the free trial';
  formIntro.textContent = 'No credit card is needed. This request does not enroll your fleet or start the 30-day clock.';
  planNote.textContent = 'The free trial does not renew automatically. Any paid service requires a separate agreement.';
  planSelect.value = 'free-trial';
  Array.from(planSelect.options).forEach(option => { option.disabled = option.value !== 'free-trial'; });
  buttonLabel = 'Send Trial Request';
} else if (rolloutInterest) {
  document.title = 'Discuss a Paid Fleet Rollout — Occulert';
  document.querySelector('.brand').textContent = 'Occulert Fleet Rollout';
  document.getElementById('requestPill').textContent = 'Paid fleet conversation';
  document.getElementById('requestTitle').textContent = 'Discuss a paid fleet rollout';
  intro.textContent = 'Tell us about your fleet so we can confirm the available product, roster scope, manager workflow and introductory price before any paid service begins.';
  document.getElementById('formTitle').textContent = 'Request a rollout conversation';
  formIntro.textContent = 'Submitting this form does not start a subscription or charge you.';
  planNote.textContent = 'Select the proposed plan to discuss. Final scope, support and terms are confirmed in writing.';
  planSelect.value = planParam;
  Array.from(planSelect.options).forEach(option => { option.disabled = !paidPlans.has(option.value); });
  buttonLabel = 'Request Rollout Conversation';
}
button.textContent = buttonLabel;

function value(id) { return document.getElementById(id).value.trim(); }
function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function planMatchesInterest(plan) {
  return freeTrialInterest ? plan === 'free-trial' : rolloutInterest ? paidPlans.has(plan) : true;
}
const validatedFieldIds = ['name', 'company', 'email', 'plan'];
function clearFieldErrors() {
  validatedFieldIds.forEach(id => document.getElementById(id).removeAttribute('aria-invalid'));
}
function showFieldError(id, message) {
  const field = document.getElementById(id);
  const error = document.getElementById('error');
  field.setAttribute('aria-invalid', 'true');
  error.textContent = message;
  error.style.display = 'block';
  field.focus();
}
validatedFieldIds.forEach(id => {
  const field = document.getElementById(id);
  ['input', 'change'].forEach(eventName => field.addEventListener(eventName, () => field.removeAttribute('aria-invalid')));
});

async function saveLead(event) {
  event?.preventDefault();
  if (leadSubmissionPending) return;
  const success = document.getElementById('success');
  const error = document.getElementById('error');
  success.style.display = 'none';
  error.style.display = 'none';
  clearFieldErrors();
  const plan = planSelect.value;
  const interest = freeTrialInterest || plan === 'free-trial'
    ? 'free_trial'
    : rolloutInterest || paidPlans.has(plan)
      ? 'paid_rollout'
      : 'pilot';
  const lead = {
    name: value('name'),
    company: value('company'),
    email: value('email'),
    fleet: planSelect.form.elements.fleet.value,
    plan,
    message: value('message'),
    interest,
    startedAt: formStartedAt,
    website: value('website')
  };
  if (!lead.name) { showFieldError('name', 'Enter your name.'); return; }
  if (!lead.company) { showFieldError('company', 'Enter your company name.'); return; }
  if (!lead.email || !validEmail(lead.email)) { showFieldError('email', 'Enter a valid email address.'); return; }
  if (!planMatchesInterest(lead.plan)) { showFieldError('plan', 'Choose a plan that matches this request.'); return; }

  leadSubmissionPending = true;
  button.disabled = true;
  button.textContent = 'Sending…';
  const controller = new AbortController();
  let timeoutId;
  const deadline = new Promise((_, reject) => {
    timeoutId = setTimeout(() => { controller.abort(); reject(new Error('request_timeout')); }, 8000);
  });
  try {
    const request = (async () => {
      const response = await fetch('/api/pilot-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lead),
        signal: controller.signal
      });
      const result = await response.json().catch(() => ({}));
      return { response, result };
    })();
    const { response, result } = await Promise.race([request, deadline]);
    if (!response.ok || result.stored !== true) throw new Error(result.error || 'request_not_stored');
    success.textContent = interest === 'free_trial'
      ? 'Free trial request received. We will follow up by email to confirm the scope and start date. No trial or paid subscription has started.'
      : interest === 'paid_rollout'
        ? 'Rollout conversation requested. We will follow up by email about scope and pricing. No subscription has started.'
        : 'Fleet request received. We will follow up by email about possible next steps.';
    success.style.display = 'block';
    success.setAttribute('tabindex', '-1');
    success.focus();
    document.getElementById('nextSteps').hidden = false;
    ['name', 'company', 'email', 'message', 'website'].forEach(id => {
      const field = document.getElementById(id);
      if (field.value.trim() === lead[id]) field.value = '';
    });
  } catch (e) {
    error.textContent = 'We could not confirm that your request was saved. Your entries are still here. Please try again later or email fleet@occulert.com.';
    error.style.display = 'block';
    error.setAttribute('tabindex', '-1');
    error.focus();
  } finally {
    clearTimeout(timeoutId);
    leadSubmissionPending = false;
    button.disabled = false;
    button.textContent = buttonLabel;
  }
}
