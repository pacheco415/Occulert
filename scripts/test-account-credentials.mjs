// Executes account.html's inline script against a stub DOM so the credential
// flows are tested as behavior, not just as source patterns.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../account.html', import.meta.url), 'utf8');
const inline = [...source.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .find((body) => body.includes('function changeEmail'));

assert.ok(inline, 'account.html must contain the credential script');

function makeElement(id) {
  const classes = new Set(id === 'securityForms' ? ['hidden'] : []);
  return {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    href: '',
    disabled: false,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    setAttribute() {},
    getAttribute() { return 'dark'; },
    addEventListener() {},
  };
}

function boot({ user, updateEmail, updatePassword }) {
  const elements = new Map();
  const store = new Map();
  const context = {
    console,
    JSON,
    String,
    Object,
    Date,
    Math,
    Promise,
    document: {
      documentElement: makeElement('html'),
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, makeElement(id));
        return elements.get(id);
      },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      addEventListener() {},
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
  context.window = context;
  context.window.matchMedia = () => ({ matches: false });
  context.window.OcculertBackend = {
    currentUser: () => user,
    updateEmail,
    updatePassword,
    accountMessage: (result, mode) => `mapped:${mode}:${(result.body && result.body.error) || 'unknown'}`,
  };
  context.window.OcculertAuth = null;

  vm.runInNewContext(inline, context);
  const el = (id) => context.document.getElementById(id);
  return { context, el };
}

const noCall = () => { throw new Error('backend must not be called'); };
const preventDefault = () => {};

test('credential forms stay hidden until a session exists', () => {
  const { el } = boot({ user: null, updateEmail: noCall, updatePassword: noCall });
  assert.equal(el('securityForms').classList.contains('hidden'), true);
  assert.match(el('securityIntro').textContent, /Sign in to change/);
});

test('a signed-in session reveals the forms and names the account', () => {
  const { el } = boot({
    user: { id: 'u1', email: 'driver@example.com' },
    updateEmail: noCall,
    updatePassword: noCall,
  });
  assert.equal(el('securityForms').classList.contains('hidden'), false);
  assert.match(el('securityIntro').textContent, /driver@example\.com/);
  assert.equal(el('newEmail').value, 'driver@example.com');
});

test('signed-out submits never reach the network', async () => {
  const { context, el } = boot({ user: null, updateEmail: noCall, updatePassword: noCall });
  el('newEmail').value = 'new@example.com';
  await context.changeEmail({ preventDefault });
  assert.match(el('status').textContent, /Sign in first/);

  el('newPassword').value = 'longenough';
  await context.changePassword({ preventDefault });
  assert.match(el('status').textContent, /Sign in first/);
});

test('short passwords are rejected before any request', async () => {
  const { context, el } = boot({
    user: { id: 'u1', email: 'driver@example.com' },
    updateEmail: noCall,
    updatePassword: noCall,
  });
  el('newPassword').value = 'abc';
  await context.changePassword({ preventDefault });
  assert.match(el('status').textContent, /at least 6 characters/);
});

test('a successful email change reports that confirmation is pending', async () => {
  const sent = [];
  const { context, el } = boot({
    user: { id: 'u1', email: 'driver@example.com' },
    updateEmail: (email) => { sent.push(email); return Promise.resolve({ ok: true, body: {} }); },
    updatePassword: noCall,
  });
  el('newEmail').value = 'second@example.com';
  await context.changeEmail({ preventDefault });

  assert.deepEqual(sent, ['second@example.com']);
  assert.match(el('status').textContent, /Confirmation sent to second@example\.com/);
  assert.match(el('status').textContent, /changes once you open the link/);
  assert.equal(el('status').className.includes('good'), true);
  assert.equal(el('emailBtn').disabled, false, 'button must be re-enabled');
});

test('a successful password change clears the field and never echoes the secret', async () => {
  const { context, el } = boot({
    user: { id: 'u1', email: 'driver@example.com' },
    updateEmail: noCall,
    updatePassword: () => Promise.resolve({ ok: true, body: {} }),
  });
  el('newPassword').value = 'longenough';
  await context.changePassword({ preventDefault });

  assert.equal(el('newPassword').value, '');
  assert.doesNotMatch(el('status').textContent, /longenough/);
  assert.equal(el('passwordBtn').disabled, false);
});

test('backend failures surface the mapped message, not a raw error', async () => {
  const { context, el } = boot({
    user: { id: 'u1', email: 'driver@example.com' },
    updateEmail: () => Promise.resolve({ ok: false, body: { error: 'email_exists' } }),
    updatePassword: noCall,
  });
  el('newEmail').value = 'taken@example.com';
  await context.changeEmail({ preventDefault });

  assert.equal(el('status').textContent, 'mapped:email:email_exists');
  assert.equal(el('status').className.includes('bad'), true);
  assert.equal(el('emailBtn').disabled, false);
});

test('a thrown request still restores the button', async () => {
  const { context, el } = boot({
    user: { id: 'u1', email: 'driver@example.com' },
    updateEmail: noCall,
    updatePassword: () => Promise.reject(new Error('network down')),
  });
  el('newPassword').value = 'longenough';
  await context.changePassword({ preventDefault });

  assert.match(el('status').textContent, /could not be updated/);
  assert.equal(el('passwordBtn').disabled, false);
});
