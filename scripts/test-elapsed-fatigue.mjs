import assert from 'node:assert/strict';
import test from 'node:test';
import {createAppHarness} from './lib/app-page-harness.mjs';

export function ready(elapsed=true){
 const h=createAppHarness({sandboxOverrides:{URLSearchParams,location:{search:elapsed?'?fatigue-timing=elapsed':''}}});
 h.startSession();h.run('calibrating=false;calibrated=true;confidence=100;fatigue=0;eyeClosedThreshold=.18;eyeWatchThreshold=.22;lastFatigueFrameAt=null;lastFatigueFrameObserved=false;');
 return h;
}
export function closedTimeline(fps,elapsed=true){
 const h=ready(elapsed),start=h.clock.now;let at=null;
 for(let i=0;i<fps*5;i++){
  h.clock.set(start+i*1000/fps);h.run('updateScore(.08,false,false,true)');
  if(h.run('riskText()[0]')==='ALERT'){at=i*1000/fps;break;}
 }
 return{fps,alert_ms:at,fatigue:h.run('fatigue'),scope:'direct score accumulation with sustained closed-eye input; synthetic'};
}

test('sustained identical closures reach the score alert boundary within 150 ms across 3/7/15 fps',()=>{
 const runs=[3,7,15].map(fps=>closedTimeline(fps));
 assert.ok(runs.every(run=>run.alert_ms!==null));
 assert.ok(Math.max(...runs.map(run=>run.alert_ms))-Math.min(...runs.map(run=>run.alert_ms))<=150);
 const legacy=[3,7,15].map(fps=>closedTimeline(fps,false));
 assert.ok(Math.max(...legacy.map(run=>run.alert_ms))-Math.min(...legacy.map(run=>run.alert_ms))>500);
});

test('the flag preserves the released 135 ms increments after observed tracking begins',()=>{
 const h=ready();h.run('updateScore(.08,false,false,true)');assert.equal(h.run('fatigue'),0);
 h.clock.advance(135);h.run('updateScore(.08,false,false,true)');assert.equal(h.run('fatigue'),17);
 const legacy=ready(false);legacy.run('updateScore(.08,false,false,true)');assert.equal(legacy.run('fatigue'),17);
});

test('tracking gaps, backward clocks and long stalls cannot grant unbounded observed fatigue',()=>{
 const h=ready();h.run('updateScore(.08,false,false,true)');
 h.clock.advance(10000);h.run('updateScore(.08,false,false,true)');assert.ok(h.run('fatigue')<80,'a long stall cannot immediately saturate the fatigue score');
 h.clock.advance(135);h.run('updateScore(0,false,false,false)');const before=h.run('fatigue');
 h.clock.advance(10000);h.run('updateScore(.08,false,false,true)');assert.equal(h.run('fatigue'),before);
 h.clock.advance(-1000);h.run('updateScore(.08,false,false,true)');assert.equal(h.run('fatigue'),before);
});

test('head nods retain their discrete event penalty and experimental sessions remain local',async()=>{
 const h=ready();h.run('updateScore(.30,false,false,true)');
 h.clock.advance(135);h.run('updateScore(.30,false,true,true)');assert.equal(h.run('fatigue'),15);
 h.run('cloudReady=true;cloudConsent.checked=true;');
 await h.run('initCloud()');assert.equal(h.run('cloudReady'),false);
 assert.equal(h.el('cloudConsent').disabled,true);
 assert.equal(h.run('fleetPayload().fatigueTiming'),'elapsed-135ms-experiment');
 assert.equal(h.run('fleetPayload().detectorVersion'),'web-ear-elapsed-experiment-1');
});

test('browser elapsed accumulation ignores a wall-clock jump',()=>{
 let monotonic=0;
 const h=createAppHarness({sandboxOverrides:{URLSearchParams,location:{search:'?fatigue-timing=elapsed'},performance:{now:()=>monotonic}}});
 h.startSession();h.run('calibrating=false;calibrated=true;confidence=100;fatigue=0;');
 h.run('updateScore(.08,false,false,true)');
 h.clock.advance(86400000);monotonic=135;h.run('updateScore(.08,false,false,true)');
 // Existing episode timers can classify a microsleep after a wall-clock jump;
 // this experiment isolates accumulation rates, not those separate timers.
 assert.ok(h.run('fatigue')>=17&&h.run('fatigue')<=18);
});
