import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { initializeTestSchema } from './lib/test-schema.mjs';

const require = createRequire(import.meta.url);
const apple = require('../api/_lib/apple-account');
const db = require('../api/_lib/supabase');
const owner = '11111111-1111-4111-8111-111111111111';
const user = { id: owner, email: 'relay@example.test', email_confirmed_at: '2026-01-01',
  identities: [{ provider: 'apple', identity_data: { sub: 'apple-owner' } }] };

test('Apple grants are isolated from clients and cascade on Auth deletion', async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  await initializeTestSchema(pg, { supabaseDefaults: true });
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const result = await pg.query("select has_table_privilege($1,'public.apple_account_grants','SELECT') as allowed", [role]);
    assert.equal(result.rows[0].allowed, role === 'service_role');
  }
  const { rows } = await pg.query("select relrowsecurity from pg_class where oid='public.apple_account_grants'::regclass");
  assert.equal(rows[0].relrowsecurity, true);
  await pg.query('insert into auth.users(id) values ($1)', [owner]);
  await pg.query('insert into public.apple_account_grants values ($1,$2)', [owner, 'x'.repeat(50)]);
  await pg.query('delete from auth.users where id=$1', [owner]);
  assert.equal((await pg.query('select * from public.apple_account_grants')).rows.length, 0);
});

test('server exchanges PKCE, validates the Apple subject, seals the grant and revokes on deletion', async t => {
  const env = { APPLE_GRANT_KEY: '56'.repeat(32), APPLE_WEB_CLIENT_ID: 'my.web', APPLE_WEB_CLIENT_SECRET: 'fixture-client',
    SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_ANON_KEY: 'fixture-publishable', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service' };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  let subject = 'somebody-else', sealed, revoked;
  t.mock.method(db, 'fetchTextWithDeadline', async (url, options) => {
    let result;
    if (url.startsWith(env.SUPABASE_URL)) {
      assert.deepEqual(JSON.parse(options.body), { auth_code: 'code', code_verifier: 'verifier' });
      result = { user, access_token: 'session', refresh_token: 'refresh', provider_refresh_token: 'apple-private',
        expires_in: 3600 };
    } else if (url.endsWith('/token')) {
      const claims = { iss: 'https://appleid.apple.com', aud: 'my.web', sub: subject };
      result = { id_token: 'header.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.signature' };
    } else {
      assert.equal(url, 'https://appleid.apple.com/auth/revoke'); revoked = options.body.get('token'); result = {};
    }
    return { response: { ok: true }, text: JSON.stringify(result) };
  });
  t.mock.method(db, 'pgFetch', async (path, opts) => {
    assert.equal(path, 'apple_account_grants');
    if (opts.method === 'POST') { assert.equal(opts.body.user_id, owner); sealed = opts.body.sealed_token; return [opts.body]; }
    assert.equal(opts.params.user_id, 'eq.' + owner);
    return [{ sealed_token: sealed }];
  });
  assert.equal(await apple.exchange('code', 'verifier'), null);
  assert.equal(sealed, undefined);
  subject = 'apple-owner';
  const session = await apple.exchange('code', 'verifier');
  assert.equal(session.user.id, owner); assert.equal(session.access_token, 'session');
  assert.ok(!JSON.stringify(session).includes('apple-private'));
  assert.ok(sealed && !sealed.includes('apple-private'));
  await apple.revokeForDeletion(user);
  assert.equal(revoked, 'apple-private');
});
