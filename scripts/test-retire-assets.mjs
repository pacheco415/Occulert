import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { retireAssets } from './retire-assets.mjs';
import { auditRetiredAssets } from './lib/retired-assets.mjs';

function fixture(t) {
 const root = mkdtempSync(join(tmpdir(), 'retire-assets-'));
 t.after(() => rmSync(root, { recursive: true, force: true }));
 const write = (name, text) => writeFileSync(join(root, name), text);
 const git = args => execFileSync('git', args, {cwd:root, encoding:'utf8', env:{...process.env, GIT_AUTHOR_DATE:'2026-09-01T00:00:00Z', GIT_COMMITTER_DATE:'2026-09-01T00:00:00Z'}});
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
