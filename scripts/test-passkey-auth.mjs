import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../passkey-auth.js', import.meta.url), 'utf8');

function boot({ supported = true, signInError = null, sdkAvailable = true, configAvailable = true } = {}) {
  const calls = { create: [], adopted: [], sessions: [], register: 0, list: 0, update: [], remove: [], signOut: [], loader: 0, refreshConfig: 0 };
  const session = {
    access_token: 'existing-access',
    refresh_token: 'existing-refresh',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'user-1', email: 'driver@example.com' },
  };
  const client = {
    auth: {
      async signInWithPasskey() {
        if (signInError) return { data: null, error: signInError };
        return {
          data: {
            session: { ...session, access_token: 'passkey-access', refresh_token: 'passkey-refresh' },
            user: session.user,
          },
          error: null,
        };
      },
      async setSession(value) { calls.sessions.push(value); return { data: { session }, error: null }; },
      async registerPasskey() {
        calls.register += 1;
        return { data: { id: '11111111-1111-4111-8111-111111111111', friendly_name: 'iCloud Keychain' }, error: null };
      },
      async signOut(value) { calls.signOut.push(value); return { error: null }; },
      passkey: {
        async list() {
          calls.list += 1;
          return { data: [{ id: '11111111-1111-4111-8111-111111111111', friendly_name: 'iCloud Keychain' }], error: null };
        },
        async update(value) { calls.update.push(value); return { data: value, error: null }; },
        async delete(value) { calls.remove.push(value); return { data: {}, error: null }; },
      },
    },
  };
  const sdk = {
    createClient(url, key, options) {
      calls.create.push({ url, key, options });
      return client;
    },
  };
  const window = {
    isSecureContext: supported,
    PublicKeyCredential: supported ? function PublicKeyCredential() {} : undefined,
    navigator: { credentials: supported ? {} : undefined },
    supabase: sdkAvailable ? sdk : undefined,
    OcculertSupabaseLoader: {
      load() {
        calls.loader += 1;
        if (!sdkAvailable) {
          const error = new Error('sdk_load_failed');
          error.code = 'sdk_load_failed';
          return Promise.reject(error);
        }
        return Promise.resolve(sdk);
      },
      retry() { return this.load(); },
    },
    OcculertBackend: {
      getAuthConfig: async () => configAvailable ? ({ configured: true, url: 'https://example.supabase.co', anonKey: 'public-key' }) : null,
      refreshAuthConfig: async () => { calls.refreshConfig += 1; return configAvailable ? ({ configured: true, url: 'https://example.supabase.co', anonKey: 'public-key' }) : null; },
      getSession: async () => session,
      adoptSession(value) { calls.adopted.push(value); return value; },
    },
  };
  const context = { window, navigator: window.navigator, Error, Boolean, Array, Number, String, Promise };
  window.window = window;
  vm.runInNewContext(source, context);
  return { passkeys: window.OcculertPasskeys, calls };
}

test('passkeys require a secure supported browser before contacting Supabase', async () => {
  const { passkeys, calls } = boot({ supported: false });
  assert.equal(passkeys.isSupported(), false);
  await assert.rejects(passkeys.signIn(), /passkey_unsupported/);
  assert.equal(calls.create.length, 0);
});

test('passkey sign-in opts into the pinned Supabase flow and adopts its verified session', async () => {
  const { passkeys, calls } = boot();
  const user = await passkeys.signIn();
  assert.equal(user.email, 'driver@example.com');
  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0].url, 'https://example.supabase.co');
  assert.equal(calls.create[0].key, 'public-key');
  assert.equal(calls.create[0].options.auth.experimental.passkey, true);
  assert.equal(calls.create[0].options.auth.persistSession, false);
  assert.equal(calls.adopted[0].access_token, 'passkey-access');
});

test('passkey enrollment and management reuse the existing authenticated session', async () => {
  const { passkeys, calls } = boot();
  const added = await passkeys.register();
  const listed = await passkeys.list();
  await passkeys.rename(listed[0].id, 'Work Mac');
  await passkeys.remove(listed[0].id);
  await passkeys.signOutLocal();

  assert.equal(added.friendly_name, 'iCloud Keychain');
  assert.equal(calls.register, 1);
  assert.equal(calls.list, 1);
  assert.equal(JSON.stringify(calls.update), JSON.stringify([{ passkeyId: listed[0].id, friendlyName: 'Work Mac' }]));
  assert.equal(JSON.stringify(calls.remove), JSON.stringify([{ passkeyId: listed[0].id }]));
  assert.equal(calls.sessions.length, 4);
  assert.ok(calls.sessions.every((value) => value.access_token === 'existing-access' && value.refresh_token === 'existing-refresh'));
  assert.equal(JSON.stringify(calls.signOut), JSON.stringify([{ scope: 'local' }]));
});

test('passkey errors are mapped to actionable messages without exposing raw server text', async () => {
  const raw = new Error('internal database detail must stay hidden');
  raw.code = 'webauthn_credential_not_found';
  const { passkeys } = boot({ signInError: raw });
  await assert.rejects(passkeys.signIn(), /internal database detail/);
  const message = passkeys.message(raw, 'signin');
  assert.match(message, /not registered with this Occulert account/);
  assert.doesNotMatch(message, /database detail/);
  assert.match(passkeys.message({ name: 'SecurityError', message: 'RP ID mismatch' }, 'signin'), /approved Occulert domain/);
  assert.match(passkeys.message({ code: 'sdk_load_failed' }, 'signin'), /Safari could not load Occulert's secure passkey helper/);
  assert.match(passkeys.message({ code: 'auth_config_unavailable' }, 'signin'), /could not load account settings/);
  assert.match(passkeys.message({ code: 'passkey_disabled' }, 'signin'), /not enabled for Occulert/);
  assert.equal(passkeys.canRetry({ code: 'sdk_load_failed' }), true);
  assert.equal(passkeys.canRetry({ code: 'auth_config_unavailable' }), true);
  assert.equal(passkeys.canRetry({ code: 'passkey_disabled' }), false);
  assert.equal(passkeys.canRetry({ code: 'sdk_unavailable' }), false);
});

test('missing browser SDK and runtime auth settings report distinct retryable failures', async () => {
  const missingSdk = boot({ sdkAvailable: false });
  await assert.rejects(missingSdk.passkeys.signIn(), /sdk_load_failed/);
  assert.equal(missingSdk.calls.loader, 1);

  const missingConfig = boot({ configAvailable: false });
  await assert.rejects(missingConfig.passkeys.signIn(), /auth_config_unavailable/);
});
