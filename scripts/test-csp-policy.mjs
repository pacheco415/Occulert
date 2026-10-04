import assert from 'node:assert/strict';
import test from 'node:test';
import { auditCspPolicy, SUPABASE_HOST } from './lib/csp-policy.mjs';
const valid = `script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' https://${SUPABASE_HOST} wss://${SUPABASE_HOST}`;
test('owned WASM scripts and only the actual project host pass', () => assert.deepEqual(auditCspPolicy(valid), []));
for (const grant of ["'unsafe-inline'", "'unsafe-eval'", "'nonce-new'", "'sha256-new'", '*', 'https://unexpected.invalid']) {
 test(`unneeded executable grant ${grant} is rejected`, () => assert.ok(auditCspPolicy(valid.replace("script-src ", `script-src ${grant} `)).length));
}
for (const host of ['https://*.supabase.co', 'https://another.supabase.co', 'wss://another.supabase.co', '*', 'https:']) {
 test(`broad or different project connection ${host} is rejected`, () => assert.ok(auditCspPolicy(valid.replace("connect-src ", `connect-src ${host} `)).length));
}
test('an unsafe first duplicate directive cannot be hidden by a safe last one', () => {
 assert.ok(auditCspPolicy(`script-src 'unsafe-inline'; ${valid}`).length);
 assert.ok(auditCspPolicy(`${valid}; script-src 'unsafe-inline'`).length);
});
test('missing script or connection directives are rejected', () => {
 assert.ok(auditCspPolicy(`connect-src https://${SUPABASE_HOST}`).length);
 assert.ok(auditCspPolicy("script-src 'self' 'wasm-unsafe-eval'").length);
});

for (const directive of ['script-src-elem', 'script-src-attr']) {
 for (const value of ["'unsafe-inline'", '*', "'self'"]) test(`${directive} ${value} cannot override the shared script restriction`, () => assert.ok(auditCspPolicy(`${valid}; ${directive} ${value}`).length));
}
