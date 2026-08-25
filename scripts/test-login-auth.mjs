// Exercises login.html's three account modes without sending real credentials.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../login.html', import.meta.url), 'utf8');
const inline = [...source.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .find((body) => body.includes('function showAuthMode'));

assert.ok(inline, 'login.html must contain the account mode script');

function makeElement(id) {
  const classes = new Set(['profileFields', 'backToSignInBtn'].includes(id) ? ['hidden'] : []);
  return {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    href: '',
    disabled: false,
    required: false,
    autocomplete: '',
    dataset: {},
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle(name, force) {
        if (force === undefined ? !classes.has(name) : force) classes.add(name);
        else classes.delete(name);
      },
    },
    setAttribute(name, value) { this[name] = String(value); },
    focus() {},
  };
}

function boot({ resetResult = { ok: true, body: {} }, fleetResult = { status: 404, ok: false, body: { error: 'fleet_not_found' } }, passkeyError = null, search = '', savedProfile = null, initialUser = null } = {}) {
  const elements = new Map();
  const calls = { auth: [], reset: [], fleet: 0, passkey: 0, retry: 0 };
  let currentPasskeyError = passkeyError;
  let signedInUser = initialUser;
  const context = {
    console,
    JSON,
    String,
    Object,
    Date,
    Math,
    Promise,
    URLSearchParams,
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, makeElement(id));
        return elements.get(id);
      },
    },
  };
  context.window = context;
  context.window.location = { search };
  context.window.OcculertBackend = {
    requestPasswordReset(email) { calls.reset.push(email); return Promise.resolve(resetResult); },
    passwordResetMessage: () => 'mapped reset failure',
    isEmailRateLimited: () => false,
    currentUser: () => signedInUser,
    getFleet() { calls.fleet += 1; return Promise.resolve(fleetResult); },
  };
  context.window.OcculertPasskeys = {
    isSupported: () => true,
    message: () => 'mapped passkey failure',
    canRetry: (error) => error && error.code === 'sdk_load_failed',
    retry() { calls.retry += 1; currentPasskeyError = null; return Promise.resolve(); },
  };
  context.window.OcculertAuth = {
    getProfile: () => savedProfile,
    onAuth(callback) { callback(signedInUser, savedProfile); },
    signOut() { signedInUser = null; return Promise.resolve(); },
    signInPasskey() {
      calls.passkey += 1;
      if (currentPasskeyError) return Promise.reject(currentPasskeyError);
      signedInUser = { id: 'driver-1', email: 'driver@example.com' };
      return Promise.resolve({ role: 'driver', email: 'driver@example.com', authenticated: true });
    },
    signInEmail(email, password, mode, extra) {
      calls.auth.push({ email, password, mode, extra });
      signedInUser = { id: 'driver-1', email };
      return Promise.resolve({ role: extra.role || 'driver', email, authenticated: true });
    },
  };
  vm.runInNewContext(inline, context);
  return { context, calls, el: (id) => context.document.getElementById(id) };
}

const preventDefault = () => {};
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('sign-in shows only email and password fields', () => {
  const { el } = boot();
  assert.equal(el('profileFields').classList.contains('hidden'), true);
  assert.equal(el('passwordField').classList.contains('hidden'), false);
  assert.equal(el('submitBtn').textContent, 'Sign In');
  assert.equal(el('forgotPasswordBtn').classList.contains('hidden'), false);
  assert.equal(el('passkeyEntry').classList.contains('hidden'), false);
});

test('a saved local profile is not presented as a signed-in account', () => {
  const { el } = boot({ savedProfile: { role: 'driver', email: 'saved@example.com', authenticated: false } });

  assert.equal(el('profileStateLabel').textContent, 'Account status');
  assert.match(el('profileBox').innerHTML, /Not signed in/);
  assert.doesNotMatch(el('profileBox').innerHTML, /saved@example\.com/);
  assert.doesNotMatch(el('profileActions').innerHTML, /Sign Out/);
  assert.equal(el('email').value, '');
});

test('only an active backend session is presented as signed in', async () => {
  const { calls, el } = boot({
    savedProfile: { role: 'driver', email: 'old-local@example.com', authenticated: false },
    initialUser: { id: 'driver-1', email: 'active@example.com' },
  });
  await settle();

  assert.equal(el('profileStateLabel').textContent, 'Signed-in account');
  assert.match(el('profileBox').innerHTML, /active@example\.com/);
  assert.match(el('profileBox').innerHTML, /Verified role<\/span><span>Driver/);
  assert.match(el('profileBox').innerHTML, /No owned fleet/);
  assert.match(el('profileBox').innerHTML, /Authenticated<\/span><span>Yes/);
  assert.match(el('profileActions').innerHTML, /Account/);
  assert.match(el('profileActions').innerHTML, /Use another account/);
  assert.equal(el('authCard').classList.contains('hidden'), true);
  assert.equal(el('loginGrid').classList.contains('signed-in'), true);
  assert.equal(el('email').value, 'active@example.com');
  assert.equal(calls.fleet, 1);
});

test('server ownership overrides a stale local driver role', async () => {
  const { calls, el } = boot({
    fleetResult: { status: 200, ok: true, body: { fleet: { id: 'fleet-1', company_name: 'Testing123' } } },
    savedProfile: { role: 'driver', email: 'owner@example.com', authenticated: true },
    initialUser: { id: 'owner-1', email: 'owner@example.com' },
  });
  await settle();

  assert.equal(calls.fleet, 1);
  assert.match(el('profileBox').innerHTML, /Verified role<\/span><span>Fleet Manager/);
  assert.match(el('profileBox').innerHTML, /Verified owner of Testing123/);
  assert.doesNotMatch(el('profileBox').innerHTML, /Manager invitation required/);
});

test('a failed ownership lookup does not guess a manager role', async () => {
  const { el } = boot({
    fleetResult: { status: 503, ok: false, body: { error: 'cloud_unavailable' } },
    savedProfile: { role: 'fleet', email: 'unknown@example.com', authenticated: true },
    initialUser: { id: 'unknown-1', email: 'unknown@example.com' },
  });
  await settle();

  assert.match(el('profileBox').innerHTML, /Verified role<\/span><span>Not verified/);
  assert.match(el('profileBox').innerHTML, /Server verification unavailable/);
  assert.doesNotMatch(el('profileBox').innerHTML, /Verified owner/);
});

test('a late ownership response cannot restore signed-in controls after logout', async () => {
  let resolveFleet;
  const fleetResult = new Promise((resolve) => { resolveFleet = resolve; });
  const { context, el } = boot({
    fleetResult,
    savedProfile: { role: 'driver', email: 'owner@example.com', authenticated: true },
    initialUser: { id: 'owner-1', email: 'owner@example.com' },
  });

  await context.logout();
  resolveFleet({ status: 200, ok: true, body: { fleet: { id: 'fleet-1', company_name: 'Testing123' } } });
  await settle();

  assert.equal(el('profileStateLabel').textContent, 'Account status');
  assert.match(el('profileBox').innerHTML, /Not signed in/);
  assert.doesNotMatch(el('profileBox').innerHTML, /Fleet Manager|Verified owner/);
  assert.doesNotMatch(el('profileActions').innerHTML, /Use another account/);
  assert.equal(el('authCard').classList.contains('hidden'), false);
  assert.equal(el('loginGrid').classList.contains('signed-in'), false);
});

test('passkey sign-in does not require email or password input', async () => {
  const { context, calls, el } = boot();
  await context.signInPasskey();

  assert.equal(calls.passkey, 1);
  assert.equal(calls.auth.length, 0);
  assert.match(el('passkeyStatus').textContent, /Signed in with your passkey/);
  assert.equal(el('status').textContent, '');
  assert.equal(el('passkeySignInBtn').disabled, false);
});

test('passkey failures stay beside the passkey action instead of below the account notices', async () => {
  const { context, el } = boot({ passkeyError: new Error('provider detail') });
  await context.signInPasskey();

  assert.match(el('passkeyStatus').textContent, /mapped passkey failure/);
  assert.match(el('passkeyStatus').className, /bad/);
  assert.equal(el('status').textContent, '');
  assert.ok(source.indexOf('id="passkeyStatus"') > source.indexOf('id="passkeySignInBtn"'));
  assert.ok(source.indexOf('id="passkeyStatus"') < source.indexOf('id="authForm"'));
});

test('retryable Safari loader failures reveal a retry action that can recover', async () => {
  const error = new Error('loader unavailable');
  error.code = 'sdk_load_failed';
  const { context, calls, el } = boot({ passkeyError: error });

  await context.signInPasskey();
  assert.equal(el('passkeyRetryBtn').classList.contains('hidden'), false);

  await context.signInPasskey(true);
  assert.equal(calls.retry, 1);
  assert.equal(calls.passkey, 2);
  assert.equal(el('passkeyRetryBtn').classList.contains('hidden'), true);
  assert.match(el('passkeyStatus').textContent, /Signed in with your passkey/);
});

test('account creation reveals setup fields and sends them only for signup', async () => {
  const { context, calls, el } = boot();
  context.showAuthMode('signup');
  context.setRole('fleet');
  el('name').value = 'Fleet Owner';
  el('company').value = 'Pilot Fleet';
  el('vehicle').value = 'Route 12';
  el('email').value = 'owner@example.com';
  el('password').value = 'longenough';
  await context.submitAuth({ preventDefault });

  assert.equal(el('profileFields').classList.contains('hidden'), false);
  assert.equal(el('passkeyEntry').classList.contains('hidden'), true);
  assert.equal(calls.auth[0].mode, 'signup');
  assert.equal(JSON.stringify(calls.auth[0].extra), JSON.stringify({ role: 'fleet', name: 'Fleet Owner', company: 'Pilot Fleet', vehicle: 'Route 12' }));

  context.showAuthMode('signin');
  await context.submitAuth({ preventDefault });
  assert.equal(calls.auth[1].mode, 'signin');
  assert.equal(JSON.stringify(calls.auth[1].extra), '{}');
});

test('password recovery hides the password and returns a privacy-safe message', async () => {
  const { context, calls, el } = boot();
  context.showAuthMode('reset');
  el('email').value = 'forgotten@example.com';
  await context.submitAuth({ preventDefault });

  assert.equal(el('profileFields').classList.contains('hidden'), true);
  assert.equal(el('passwordField').classList.contains('hidden'), true);
  assert.deepEqual(calls.reset, ['forgotten@example.com']);
  assert.match(el('status').textContent, /If an Occulert account uses that email/);
  assert.doesNotMatch(el('status').textContent, /registered|not found/i);
  assert.equal(el('submitBtn').disabled, false);
});

test('password recovery has a stable deep link that opens reset mode directly', () => {
  const { el } = boot({ search: '?mode=reset' });

  assert.match(source, /id="forgotPasswordBtn" href="\/login\.html\?mode=reset"/);
  assert.match(source, /id="backToSignInBtn" href="\/login\.html"/);
  assert.equal(el('authHeading').textContent, 'Reset your password');
  assert.equal(el('passwordField').classList.contains('hidden'), true);
  assert.equal(el('backToSignInBtn').classList.contains('hidden'), false);
});
