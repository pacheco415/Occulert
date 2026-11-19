import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, mkdir, access } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { toCsv } from './prepare-dataset.mjs';
import { contentSha256 } from './provenance.mjs';
import { evaluatePolicy, trainFatigueModel } from './train-fatigue-model.mjs';

const sandbox = { module:{exports:{}}, URLSearchParams };
vm.runInNewContext(readFileSync(new URL('../src/detection-experiments.js',import.meta.url),'utf8'),sandbox);
const {fatigueModelScore,fatigueFeatureConfig:config} = sandbox.module.exports;
const fields = Array.from(config.windowsMs).flatMap(ms => Array.from(config.fields,k => k+'_'+ms/1000+'s'));
const inputNames = ['sessions.csv','episodes.csv','comparison.csv','trace-provenance.json'];
const testModel = new URL('./fixtures/fatigue-model-synthetic.json',import.meta.url);

async function syntheticInput(dir, edit = () => {}) {
  await mkdir(dir);
  const inputs = [], rows = [];
  for (let p = 0; p < 4; p++) {
    const session_id = 'synthetic-'+p, participant = 'fixture-'+p, split = p < 3 ? 'train' : 'test';
    const inputHashes = Object.fromEntries(inputNames.map(name => [name,contentSha256('synthetic '+p+' '+name)]));
    inputs.push({session_id,participant,split,inputHashes,counts:{included:24}});
    for (let i = 0; i < 24; i++) {
      const label = Number(i >= 10 && i < 20);
      const row = {session_id,participant,split,end_ms:60000+i*1000,label};
      for (const key of fields) {
        if (key.startsWith('perclos_')) row[key] = 5 + 75*label + p;
        else if (key.startsWith('usable_fraction_')) row[key] = 0.75;
        else if (key.startsWith('ear_')) row[key] = (label ? 0.14 : 0.29) + p*0.01;
        else if (key.startsWith('tasks_') || key.startsWith('closure_')) row[key] = null;
        else row[key] = 0;
      }
      rows.push(row);
    }
  }
  edit(rows,inputs);
  await writeFile(join(dir,'windows.csv'),toCsv(['session_id','participant','split','end_ms','label',...fields],rows)+'\n');
  await writeFile(join(dir,'windows-manifest.json'),JSON.stringify({features:fields,featureVersion:config.version,stepMs:1000,inputs}));
}

async function scratch(t) {
  const path = await mkdtemp(join(tmpdir(),'occulert-trainer-'));
  t.after(() => rm(path,{recursive:true,force:true}));
  return path;
}

test('canonical feature columns and hand-computed logistic score include mean-imputed missing values', () => {
  const model = {schemaVersion:1,kind:'fatigue-logreg',featureVersion:config.version,features:['a','b'],
    means:[10,2],stds:[2,3],weights:[Math.log(3),0.25],bias:0};
  assert.ok(Math.abs(fatigueModelScore(model,{a:12,b:null}) - 0.75) < 1e-15);
  assert.equal(fatigueModelScore(model,{a:null,b:null}),0.5);
  assert.throws(() => fatigueModelScore(model,{a:12}),/feature/);
  assert.throws(() => fatigueModelScore({...model,stds:[0,1]},{a:12,b:null}),/coefficient/);
});

test('CLI reproduces the committed synthetic fixture; changing every held-out label leaves model bytes intact', async t => {
  const dir = await scratch(t);
  const original = join(dir,'original'), changed = join(dir,'changed');
  await syntheticInput(original);
  await syntheticInput(changed,(rows,inputs) => {
    for (const row of rows.filter(r=>r.split==='test')) { row.label = 1-row.label; row.tasks_blink_mean_30s=0.9; }
    inputs.at(-1).inputHashes['episodes.csv'] = contentSha256('different held-out labels');
  });
  const outputs = ['first','second','changed'].map(name=>join(dir,name+'-out'));
  execFileSync(process.execPath,['benchmark/train-fatigue-model.mjs',original,'--target-false-alerts-per-hour','0','--out',outputs[0]]);
  const baseline = await trainFatigueModel(original,outputs[1],0);
  const altered = await trainFatigueModel(changed,outputs[2],0);
  const expected = await readFile(testModel,'utf8');
  for (const path of outputs) assert.equal(await readFile(join(path,'model.json'),'utf8'),expected);
  assert.equal(baseline.metrics.auc,1);
  assert.equal(altered.metrics.auc,0);
  assert.equal(baseline.metrics.participants,1);
  assert.equal(baseline.metrics.windows,24);
  assert.equal(baseline.model.training.participants,3);
  assert.equal(baseline.model.training.crossValidation.falseAlertsPerHour,0);
  assert.equal(baseline.model.training.crossValidation.detectedRuns,3);
  assert.equal(baseline.model.validated,false);
  await assert.rejects(trainFatigueModel(original,outputs[0],0),{code:'EEXIST'});
});

test('a gap breaks a positive streak and cooldown applies within each session', () => {
  const rows = [[0,0],[2000,0],[3000,0],[4000,1],[5000,1],[15000,1],[16000,1]].map(([end,label])=>({end,label,session:'a',score:1}));
  rows.push({end:0,label:1,session:'b',score:1},{end:1000,label:1,session:'b',score:1});
  const result = evaluatePolicy(rows,.5,2);
  assert.equal(result.falseAlerts,1);
  assert.equal(result.positiveRuns,3);
  assert.equal(result.detectedRuns,2);
  assert.equal(result.scoredHours,rows.length/3600);
});

test('cross-split participants, duplicates, missing classes and malformed exports fail before output', async t => {
  const root = await scratch(t);
  const edits = [
    [/crosses/,(_,inputs)=>{inputs.at(-1).participant=inputs[0].participant;}],
    [/duplicate/,rows=>{rows[1].end_ms=rows[0].end_ms;}],
    [/label classes/,rows=>{for(const r of rows) if(r.participant!=='fixture-0') r.label=0;}],
    [/numeric/,rows=>{rows[0].ear_mean_60s='broken';}],
  ];
  for (const [i,[pattern,edit]] of edits.entries()) {
    const dir=join(root,'in-'+i), out=join(root,'out-'+i);
    await syntheticInput(dir,edit);
    await assert.rejects(trainFatigueModel(dir,out,1),pattern);
    await assert.rejects(access(out),{code:'ENOENT'});
  }
});

test('tied held-out scores give half-credit AUC; undefined precision and recall are explicit', async t => {
  const root=await scratch(t), dir=join(root,'input');
  await syntheticInput(dir,rows=>{for(const row of rows.filter(r=>r.split==='test')) for(const k of fields) row[k]=null;});
  const {metrics}=await trainFatigueModel(dir,join(root,'model'),0);
  assert.equal(metrics.auc,0.5);
  const empty=join(root,'unscored');
  await syntheticInput(empty,(rows,inputs)=>{rows.splice(72);inputs.at(-1).counts.included=0;});
  const {metrics:noTest}=await trainFatigueModel(empty,join(root,'model2'),0);
  assert.equal(noTest.windows,0);
  for(const key of ['auc','precision','recall']) assert.equal(noTest[key],null);
});
