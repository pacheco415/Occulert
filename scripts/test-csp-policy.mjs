import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { auditCspPolicy, SUPABASE_HOST } from './lib/csp-policy.mjs';
const valid = `script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' https://${SUPABASE_HOST} wss://${SUPABASE_HOST}; img-src 'self' data:; media-src 'self'`;
test('owned scripts and media, data images and only the actual project connection host pass', () => assert.deepEqual(auditCspPolicy(valid), []));
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
for (const host of ['https://cdn.jsdelivr.net', 'https://unpkg.com', 'https://*.googleapis.com']) {
 test(`script host ${host} outside the owned origin is rejected`, () => assert.ok(auditCspPolicy(valid.replace("script-src ", `script-src ${host} `)).includes('Script CSP contains an unapproved source')));
 test(`connection host ${host} outside the site and project is rejected`, () => assert.ok(auditCspPolicy(valid.replace("connect-src ", `connect-src ${host} `)).includes('Connection policy contains an unapproved host')));
}
test('both deployed policies retain exact image and media sources alongside owned scripts and the configured project', () => {
 const policies = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).headers
  .flatMap(rule => rule.headers).filter(header => header.key === 'Content-Security-Policy').map(header => header.value);
 assert.equal(policies.length, 2);
 for (const policy of policies) {
  assert.deepEqual(auditCspPolicy(policy), []);
  assert.doesNotMatch(policy, /jsdelivr|unpkg|googleapis/);
  assert.match(policy, /(?:^|;\s*)img-src 'self' data:(?:;|$)/);
  assert.match(policy, /(?:^|;\s*)media-src 'self'(?:;|$)/);
 }
});
test('missing script or connection directives are rejected', () => {
 assert.ok(auditCspPolicy(`connect-src https://${SUPABASE_HOST}`).includes('CSP must specify script-src'));
 assert.ok(auditCspPolicy("script-src 'self' 'wasm-unsafe-eval'").includes('CSP must specify connect-src'));
});

for (const directive of ['script-src-elem', 'script-src-attr']) {
 for (const value of ["'unsafe-inline'", '*', "'self'"]) test(`${directive} ${value} cannot override the shared script restriction`, () => assert.ok(auditCspPolicy(`${valid}; ${directive} ${value}`).length));
}

for (const name of ['ScRiPt-SrC-ElEm', 'ScRiPt-SrC-AtTr']) test(`mixed-case ${name} cannot hide an override`, () => assert.ok(auditCspPolicy(`${valid}; ${name} 'unsafe-inline'`).length));
test('mixed-case directive duplicates cannot conceal an unsafe first policy', () => {
 assert.ok(auditCspPolicy(`ScRiPt-SrC 'unsafe-inline'; ${valid}`).length);
 assert.ok(auditCspPolicy(`${valid}; ScRiPt-SrC 'unsafe-inline'`).length);
});
test('valid mixed-case directive names retain their browser-equivalent policy', () => assert.deepEqual(auditCspPolicy(valid.replace('script-src','ScRiPt-SrC').replace('connect-src','CoNnEcT-SrC').replace('img-src','ImG-SrC').replace('media-src','MeDiA-SrC')), []));

for (const [directive, sources] of [['img-src', "'self' data:"], ['media-src', "'self'"]]) {
 for (const source of ['*', 'https:', 'http:', 'blob:', 'https://unexpected.invalid', 'https://www.occulert.com', 'https://*.occulert.com', `https://${SUPABASE_HOST}`, "'unsafe-inline'"]) {
  test(`${directive} rejects unapproved source ${source}`, () => {
   const policy = valid.replace(`${directive} `, `${directive} ${source} `);
   assert.ok(auditCspPolicy(policy).includes(`${directive} contains an unapproved source`));
  });
 }
 test(`missing ${directive} cannot fall back to a broader default source`, () => {
  const policy = valid.replace(`; ${directive} ${sources}`, '');
  assert.ok(auditCspPolicy(`default-src https:; ${policy}`).includes(`CSP must specify ${directive}`));
 });
 test(`empty ${directive} cannot remove supported resources`, () => {
  const policy = valid.replace(`${directive} ${sources}`, directive);
  assert.ok(auditCspPolicy(policy).includes(`${directive} must retain ${sources.replace(' ', ' and ')}`));
 });
 test(`duplicate ${directive} cannot hide a broad first source`, () => {
  assert.ok(auditCspPolicy(`${directive} https:; ${valid}`).includes('CSP directives must not be duplicated'));
  assert.ok(auditCspPolicy(`${valid}; ${directive.toUpperCase()} https:`).includes('CSP directives must not be duplicated'));
 });
}
test('data images remain supported without allowing data media', () => {
 assert.ok(auditCspPolicy(valid.replace("img-src 'self' data:", "img-src 'self'")).includes("img-src must retain 'self' and data:"));
 assert.ok(auditCspPolicy(valid.replace("img-src 'self' data:", 'img-src data:')).includes("img-src must retain 'self' and data:"));
 assert.ok(auditCspPolicy(valid.replace("media-src 'self'", "media-src 'self' data:")).includes('media-src contains an unapproved source'));
});
