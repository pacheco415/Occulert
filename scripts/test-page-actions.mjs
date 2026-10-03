import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('page-actions.v1.js','utf8');
function boot(path){const listeners=new Map(),calls=[],window={location:{pathname:path}};
 const context={window,document:{addEventListener(type,handler,capture=false){listeners.set(type,{handler,capture})}}};vm.createContext(context);vm.runInContext(source,context);
 const invoke=(type,action,extra={})=>{let prevented=false;const element={dataset:{pageAction:action,...extra},closest(){return this}};listeners.get(type)?.handler({type,target:element,preventDefault(){prevented=true}});return prevented};
 return {window,listeners,calls,context,invoke};
}
test('actions are restricted to the current page and unknown or inherited actions cannot execute',()=>{
 const b=boot('/login.html');b.window.seedDemoData=()=>b.calls.push('wrong page');b.invoke('click','seedDemoData');
 vm.runInContext("Object.prototype.evil={type:'click',call:()=>{window.pollutedActionRan=true}}",b.context);b.invoke('click','evil');assert.equal(b.window.pollutedActionRan,undefined);assert.deepEqual(b.calls,[]);
});
test('sign-in mode buttons and form submission preserve fixed arguments and prevent navigation',()=>{
 const b=boot('/login.html');b.window.showAuthMode=value=>b.calls.push(value);b.window.submitAuth=event=>b.calls.push(event.type);
 assert.equal(b.invoke('click','showAuthMode-signup'),true);assert.equal(b.invoke('submit','submitAuth-event'),true);assert.deepEqual(b.calls,['signup','submit']);assert.equal(b.invoke('click','submitAuth-event'),false);
});
test('dynamic driver and invitation identifiers pass as data rather than executable code',()=>{
 const b=boot('/fleet-dashboard.html');b.window.copyDriver=id=>b.calls.push(id);const encoded=encodeURIComponent('driver-"<script>');b.invoke('click','copy-driver',{driverArg:encoded});assert.deepEqual(b.calls,[encoded]);
 const c=boot('/fleet-onboarding.html');c.window.resendInvite=id=>c.calls.push(id);c.invoke('click','replaceInvite',{invitation:'raw " invitation'});assert.deepEqual(c.calls,[encodeURIComponent('raw " invitation')]);
});
test('non-bubbling details and font load events use capture without changing unrelated links',()=>{
 const b=boot('/fleet-dashboard.html');b.window.handleHistoryToggle=event=>b.calls.push(event.type);assert.equal(b.listeners.get('toggle').capture,true);b.invoke('toggle','handleHistoryToggle-event');assert.deepEqual(b.calls,['toggle']);
 const c=boot('/');assert.equal(c.listeners.get('load').capture,true);const link={dataset:{pageAction:'font-ready'},media:'print',closest(){return this}};c.listeners.get('load').handler({type:'load',target:link});assert.equal(link.media,'all');
});

test('search input and filter changes each invoke roster updates through distinct event bindings',()=>{const b=boot('/fleet-dashboard.html');b.window.queueDriverListRender=()=>b.calls.push('render');b.invoke('input','queueDriverListRender-input');b.invoke('change','queueDriverListRender');assert.deepEqual(b.calls,['render','render'])});
