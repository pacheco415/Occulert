// Software storage/latency probe. This does not measure camera accuracy or alert delay.
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import os from 'node:os';
const root=new URL('../',import.meta.url),file=JSON.parse(readFileSync(new URL('asset-versions.json',root),'utf8'))['detection-experiments.js'];
const {createTimePerclos}=createRequire(import.meta.url)('../'+file);
const count=100000,runs=5;
function naive(){let rows=[],previous=null;return {update(now,state){rows=rows.filter(row=>row.end>now-60000);if(rows.length&&rows[0].start<now-60000)rows[0].start=now-60000;if(typeof state==='boolean'&&previous&&now-previous.now>0&&now-previous.now<=1000)rows.push({start:previous.now,end:now,closed:previous.state});previous=typeof state==='boolean'?{now,state}:null;let total=0,closed=0;for(const row of rows){const dt=row.end-row.start;total+=dt;if(row.closed)closed+=dt}return total?closed/total*100:null}}}
function measure(factory){const timings=[];let last=null,bytes=null,drops=null;
 for(let run=0;run<runs;run++){const w=factory(),started=performance.now();for(let i=0;i<count;i++)last=w.update(i*135,i%17===0?null:i%2===0);timings.push(performance.now()-started);if(w.buffers)bytes=w.buffers.starts.byteLength+w.buffers.ends.byteLength+w.buffers.closed.byteLength;if(w.snapshot)drops=w.snapshot().droppedIntervals;}
 timings.sort((a,b)=>a-b);return {updatesPerRun:count,runs,medianTotalMs:timings[2],medianUsPerUpdate:timings[2]*1000/count,finalPerclos:last,typedBackingBytes:bytes,droppedIntervals:drops};}
const deque=measure(()=>createTimePerclos()),rebuildingArray=measure(naive);if(Math.abs(deque.finalPerclos-rebuildingArray.finalPerclos)>1e-10)throw Error('Control implementations disagree');
console.log(JSON.stringify({workload:'synthetic alternating 135ms samples with every 17th frame unknown; no camera; no accuracy claim',node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,helper:file,helperSha256:createHash('sha256').update(readFileSync(new URL(file,root))).digest('hex'),deque,rebuildingArray},null,2));
