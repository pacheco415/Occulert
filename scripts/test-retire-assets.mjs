import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { retireAssets, parseRetirementArgs } from './retire-assets.mjs';
import { auditRetiredAssets } from './lib/retired-assets.mjs';
import { auditWorkflowPolicy } from './lib/workflow-policy.mjs';

function fixture(t, date = '2026-09-01T00:00:00Z') {
 const root = mkdtempSync(join(tmpdir(), 'retire-assets-'));
 t.after(() => rmSync(root, { recursive: true, force: true }));
 const write = (name, text) => writeFileSync(join(root, name), text);
 const git = args => execFileSync('git', args, {cwd:root, encoding:'utf8', env:{...process.env, GIT_AUTHOR_DATE:date, GIT_COMMITTER_DATE:date}});
 git(['init','-q']); git(['config','user.name','Test']); git(['config','user.email','test@example.test']);
 write('old.v1.js', '/* retired */'); write('active.v2.js', '/* active */');
 write('index.html','<script src="active.v2.js"></script>');
 write('asset-versions.json', JSON.stringify({'active.js':'active.v2.js'}));
 write('asset-integrity.json',JSON.stringify({'old.v1.js':'old','active.v2.js':'active'}));
 write('manifest.json','{}'); write('sw.js',"const CACHE = 'occulert-v3';\n");
 write('vercel.json',JSON.stringify({headers:[{source:'/(.*)\\.v1\\.(js|css)',headers:[{key:'Cache-Control',value:'public, immutable'}]},{source:'/(.*)\\.v2\\.(js|css)',headers:[{key:'Cache-Control',value:'public, immutable'}]}]}));
 git(['add','.']); git(['commit','-qm','Initial']);
 return {root,write,git};
}
const day = n => Date.parse('2026-09-01T00:00:00Z') + n*86400000;
const silent = () => {};
test('minimum window, dry run, complete cleanup and second write no-op', t => {
 const {root}=fixture(t);
 assert.deepEqual(retireAssets({root,now:day(13),write:true,log:silent}),[]);
 assert.deepEqual(retireAssets({root,now:day(14),log:silent}),['old.v1.js']);
 assert.ok(existsSync(join(root,'old.v1.js')));
 assert.deepEqual(retireAssets({root,now:day(14),write:true,log:silent}),['old.v1.js']);
 assert.ok(!existsSync(join(root,'old.v1.js')));
 assert.deepEqual(JSON.parse(readFileSync(join(root,'asset-integrity.json'))),{'active.v2.js':'active'});
 assert.equal(JSON.parse(readFileSync(join(root,'vercel.json'))).headers.length,1);
 assert.match(readFileSync(join(root,'sw.js'),'utf8'),/occulert-v4/);
 assert.deepEqual(retireAssets({root,now:day(30),write:true,log:silent}),[]);
 assert.match(readFileSync(join(root,'sw.js'),'utf8'),/occulert-v4/);
});
test('reachable dependencies and service worker entries are never removed', t => {
 const {root,write}=fixture(t);
 write('active.v2.js',"import './old.v1.js';");
 assert.deepEqual(retireAssets({root,now:day(30),write:true,log:silent}),[]);
 write('active.v2.js',''); write('sw.js',"const CACHE = 'occulert-v3';\nconst ASSETS=['/old.v1.js'];");
 assert.deepEqual(retireAssets({root,now:day(30),write:true,log:silent}),[]);
});
test('retained unreachable consumer keeps its dependency', t => {
 const {root,write,git}=fixture(t);
 write('recent.v9.js',"import './old.v1.js';");
 assert.deepEqual(retireAssets({root,now:day(30),write:true,log:silent}),[]);
});
test('audit warning period passes and failure starts at 21 days', t => {
 const {root}=fixture(t); const warnings=[];
 auditRetiredAssets(root,day(13),message=>warnings.push(message)); assert.equal(warnings.length,0);
 auditRetiredAssets(root,day(14),message=>warnings.push(message));
 auditRetiredAssets(root,day(20),message=>warnings.push(message)); assert.equal(warnings.length,2);
 assert.throws(()=>auditRetiredAssets(root,day(21),silent),/Retired asset audit failed/);
});
test('scheduled dry run fails exactly three days before the audit and never mutates files', t => {
 const {root,git}=fixture(t); const messages=[];
 const before=git(['status','--porcelain']);
 assert.deepEqual(retireAssets({root,now:day(14),check:true,log:silent}),['old.v1.js']);
 assert.deepEqual(retireAssets({root,now:day(18)-1,check:true,log:silent}),['old.v1.js']);
 for (const now of [day(18),day(21),day(30)]) {
  assert.throws(()=>retireAssets({root,now,check:true,log:message=>messages.push(message)}),/within 3 days.*or overdue/);
 }
 assert.match(messages[0],/Dry run: eligible for removal \(1\):\n- old\.v1\.js/);
 assert.match(messages[1],/old\.v1\.js: audit fails at 2026-09-22T00:00:00\.000Z; eligible for removal/);
 assert.ok(messages.every(message=>!message.includes('active.v2.js')));
 assert.equal(git(['status','--porcelain']),before);
 assert.ok(existsSync(join(root,'old.v1.js')));
 assert.match(readFileSync(join(root,'sw.js'),'utf8'),/occulert-v3/);
});
test('scheduled check reports a deadline even when a retained consumer protects the retired asset', t => {
 const {root,write,git}=fixture(t); const messages=[];
 write('recent.v9.js',"import './old.v1.js';");
 const before=git(['status','--porcelain']);
 assert.throws(()=>retireAssets({root,now:day(18),check:true,log:message=>messages.push(message)}),/cleanup required/);
 assert.match(messages[0],/eligible for removal \(0\)/);
 assert.match(messages[1],/old\.v1\.js: audit fails at 2026-09-22T00:00:00\.000Z; protected by a retained consumer/);
 assert.equal(git(['status','--porcelain']),before);
 assert.ok(existsSync(join(root,'old.v1.js')));
});
test('scheduled check passes an empty cleanup and cannot be combined with write mode', t => {
 const {root}=fixture(t);
 assert.deepEqual(retireAssets({root,now:day(13),check:true,log:silent}),[]);
 assert.throws(()=>retireAssets({root,now:day(30),check:true,write:true,log:silent}),/dry run.*cannot be combined/);
 assert.ok(existsSync(join(root,'old.v1.js')));
});
test('seven-day weekly window begins exactly at day 14 without changing the manual default', t => {
 const {root,git}=fixture(t);
 const before=git(['status','--porcelain']);
 assert.deepEqual(retireAssets({root,now:day(14)-1,check:true,failWithinDays:7,log:silent}),[]);
 assert.throws(()=>retireAssets({root,now:day(14),check:true,failWithinDays:7,log:silent}),/within 7 days/);
 assert.deepEqual(retireAssets({root,now:day(14),check:true,log:silent}),['old.v1.js']);
 assert.equal(git(['status','--porcelain']),before);
});
test('Monday weekly run flags a Sunday Pacific deadline before the next Monday run', t => {
 const {root}=fixture(t,'2026-10-12T01:35:00Z'); const messages=[];
 const monday = Date.parse('2026-10-26T16:17:00Z');
 assert.deepEqual(retireAssets({root,now:monday,check:true,log:silent}),['old.v1.js']);
 assert.throws(()=>retireAssets({root,now:monday,check:true,failWithinDays:7,log:message=>messages.push(message)}),/within 7 days/);
 assert.match(messages[1],/audit fails at 2026-11-02T01:35:00\.000Z/);
 auditRetiredAssets(root,monday,silent);
 assert.throws(()=>auditRetiredAssets(root,Date.parse('2026-11-02T01:35:00Z'),silent),/Retired asset audit failed/);
});
test('lookahead input is bounded and available only for dry-run checks', t => {
 const {root}=fixture(t);
 assert.deepEqual(parseRetirementArgs(['--check','--fail-within-days=7']),{write:false,check:true,failWithinDays:7});
 assert.throws(()=>retireAssets({root,...parseRetirementArgs(['--fail-within-days=7']),log:silent}),/requires --check/);
 for (const failWithinDays of [0,22,3.5,NaN,'7',null]) {
  assert.throws(()=>retireAssets({root,check:true,failWithinDays,log:silent}),/integer from 1 through 21/);
 }
 for (const args of [['--unknown'],['--check','--fail-within-days='],['--check','--fail-within-days=0'],['--check','--fail-within-days=-1'],['--check','--fail-within-days=3.5'],['--check','--fail-within-days=NaN'],['--check','--fail-within-days=7','--fail-within-days=3']]) {
  assert.throws(()=>parseRetirementArgs(args),/Usage:/);
 }
 const messages=[];
 assert.throws(()=>retireAssets({root,now:day(0),check:true,failWithinDays:21,log:message=>messages.push(message)}),/within 21 days/);
 assert.match(messages[1],/protected by the 14-day retention window/);
});
test('weekly workflow has a Monday morning schedule, full history and read-only deadline check', () => {
 const source=readFileSync(new URL('../.github/workflows/asset-retirement.yml',import.meta.url),'utf8');
 assert.match(source,/cron: '17 16 \* \* 1'/);
 assert.match(source,/workflow_dispatch:/);
 assert.match(source,/contents: read/);
 assert.match(source,/timeout-minutes: 10/);
 assert.match(source,/fetch-depth: 0/);
 assert.match(source,/run: npm run asset:retire -- --check --fail-within-days=7/);
 assert.doesNotMatch(source,/--write/);
 assert.deepEqual(auditWorkflowPolicy(source,{requireNodeSetup:true}),[]);
});
test('shallow history is rejected before mutation', t => {
 const {root,git}=fixture(t);
 writeFileSync(join(root,'.git/shallow'),git(['rev-parse','HEAD']).trim()+'\n');
 assert.throws(()=>retireAssets({root,now:day(30),write:true,log:silent}),/full Git history/);
 assert.ok(existsSync(join(root,'old.v1.js')));
});
test('shared immutable rule stays when retained asset needs it; unused exact fixture removed', t => {
 const {root,write,git}=fixture(t);
 write('keep.v1.js',''); write('index.html','<script src="active.v2.js"></script><script src="keep.v1.js"></script>');
 mkdirSync(join(root,'tests/fixtures'),{recursive:true});
 write('tests/fixtures/old.v1.js','old fixture');
 git(['add','.']); git(['commit','-qm','Add retained same-version asset and fixture']);
 retireAssets({root,now:day(30),write:true,log:silent});
 assert.ok(existsSync(join(root,'keep.v1.js')));
 assert.equal(JSON.parse(readFileSync(join(root,'vercel.json'))).headers.length,2);
 assert.ok(!existsSync(join(root,'tests/fixtures/old.v1.js')));
});
test('legacy root JS/CSS rules prune orphan assets while preserving shared and nested policies', t => {
 const {root,write,git}=fixture(t);
 write('old.v1.css',''); write('keep.v1.js','');
 mkdirSync(join(root,'audio')); mkdirSync(join(root,'vendor'));
 write('audio/alert.v1.wav','audio'); write('vendor/runtime.v1.js','vendor');
 write('index.html','<script src="active.v2.js"></script><script src="keep.v1.js"></script><script src="vendor/runtime.v1.js"></script><audio src="audio/alert.v1.wav"></audio>');
 const immutable=[{key:'Cache-Control',value:'public, max-age=31536000, immutable'}];
 const orphan={source:'/old.v1.js',headers:immutable};
 const orphanCss={source:'/old.v1.css',headers:immutable};
 const escapedOrphan={source:'/old\\.v1\\.js',headers:immutable};
 const groupedOrphan={source:'/(old|gone)\\.v1\\.(js|css)',headers:immutable};
 const shared={source:'/(.*).v1.(js|css)',headers:immutable};
 const active=JSON.parse(readFileSync(join(root,'vercel.json'),'utf8')).headers[1];
 const audio={source:'/audio/alert.v1.wav',headers:immutable};
 const vendor={source:'/vendor/runtime\\.v1\\.js',headers:immutable};
 const unrelated={source:'/images/(.*)',headers:immutable};
 const revalidating={source:'/old.v1.js',headers:[{key:'Cache-Control',value:'public, max-age=0, must-revalidate'}]};
 write('vercel.json',JSON.stringify({headers:[orphan,orphanCss,escapedOrphan,groupedOrphan,shared,active,audio,vendor,unrelated,revalidating]}));
 git(['add','.']); git(['commit','-qm','Add legacy root and active nested asset policies']);
 assert.deepEqual(retireAssets({root,now:day(30),write:true,log:silent}),['old.v1.css','old.v1.js']);
 assert.ok(existsSync(join(root,'keep.v1.js')));
 assert.ok(existsSync(join(root,'audio/alert.v1.wav')));
 assert.ok(existsSync(join(root,'vendor/runtime.v1.js')));
 assert.deepEqual(JSON.parse(readFileSync(join(root,'vercel.json'),'utf8')).headers,[shared,active,audio,vendor,unrelated,revalidating]);
});
