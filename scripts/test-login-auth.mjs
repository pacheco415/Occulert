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

function boot({ resetResult = { ok: true, body: {} }, passkeyError = null } = {}) {
  const elements = new Map();
  const calls = { auth: [], reset: [], passkey: 0, retry: 0 };
  let currentPasskeyError = passkeyError;
  const context = {
    console,
    JSON,
    String,
    Object,
    Date,
    Math,
    Promise,
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, makeElement(id));
        return elements.get(id);
      },
    },
  };
  context.window = context;
  context.window.OcculertBackend = {
    requestPasswordReset(email) { calls.reset.push(email); return Promise.resolve(resetResult); },
    passwordResetMessage: () => 'mapped reset failure',
    isEmailRateLimited: () => false,
  };
  context.window.OcculertPasskeys = {
    isSupported: () => true,
    message: () => 'mapped passkey failure',
    canRetry: (error) => error && error.code === 'sdk_load_failed',
    retry() { calls.retry += 1; currentPasskeyError = null; return Promise.resolve(); },
  };
  context.window.OcculertAuth = {
    getProfile: () => null,
    onAuth(callback) { callback(null, null); },
    signOut: () => Promise.resolve(),
    signInPasskey() {
      calls.passkey += 1;
      if (currentPasskeyError) return Promise.reject(currentPasskeyError);
      return Promise.resolve({ role: 'driver', email: 'driver@example.com', authenticated: true });
    },
    signInEmail(email, password, mode, extra) {
      calls.auth.push({ email, password, mode, extra });
      return Promise.resolve({ role: extra.role || 'driver', email, authenticated: true });
    },
  };
  vm.runInNewContext(inline, context);
  return { context, calls, el: (id) => context.document.getElementById(id) };
}

const preventDefault = () => {};

test('sign-in shows only email and password fields', () => {
  const { el } = boot();
  assert.equal(el('profileFields').classList.contains('hidden'), true);
  assert.equal(el('passwordField').classList.contains('hidden'), false);
  assert.equal(el('submitBtn').textContent, 'Sign In');
  assert.equal(el('forgotPasswordBtn').classList.contains('hidden'), false);
  assert.equal(el('passkeyEntry').classList.contains('hidden'), false);
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
