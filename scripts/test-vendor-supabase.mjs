import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { assetByStem } from './lib/current-assets.mjs';
const read=path=>readFileSync(new URL(`../${path}`,import.meta.url));
const manifest=JSON.parse(read('vendor/supabase-2.112.3/upstream.json'));
test('owned SDK and collected upstream notices match their reviewed bytes and loader SRI',()=>{
 for(const [path,sha] of Object.entries(manifest.files))assert.equal(createHash('sha256').update(read(path)).digest('hex'),sha,path);
 assert.ok(Object.keys(manifest.files).every(path=>!path.endsWith('.md')), 'notices must survive the deployment Markdown exclusion');
 assert.equal('sha384-'+createHash('sha384').update(read('vendor/supabase-2.112.3.js')).digest('base64'),manifest.sdk_sri);
 assert.ok(read(assetByStem('supabase-loader.js')).toString().includes(manifest.sdk_sri));
 assert.equal(manifest.version,'2.112.3');assert.equal(manifest.packages.length,9);
 assert.ok(manifest.packages.every(pkg=>['MIT','0BSD'].includes(pkg.license)));
});
test('upstream browser bundle retains its public auth/client API without opening a connection',async()=>{
 const network=[];
 const context={console,URL,URLSearchParams,Headers,Request,Response,AbortController,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,setTimeout,clearTimeout,setInterval,clearInterval,fetch(...args){network.push(['fetch',...args]);throw Error('Unexpected network request');},WebSocket:class{constructor(...args){network.push(['WebSocket',...args]);throw Error('Unexpected WebSocket connection');}}};
 vm.runInNewContext(read('vendor/supabase-2.112.3.js').toString(),context);
 assert.equal(typeof context.supabase.createClient,'function');
 const client=context.supabase.createClient('https://fixture.supabase.co','fixture-public-key',{auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false,experimental:{passkey:true}}});
 for(const method of ['signInWithPassword','getSession','signOut'])assert.equal(typeof client.auth[method],'function');
 for(const method of ['signInWithPasskey','registerPasskey'])assert.equal(typeof client.auth[method],'function');
 for(const method of ['list','update','delete'])assert.equal(typeof client.auth.passkey[method],'function');
 assert.equal(typeof client.from,'function');assert.equal(typeof client.rpc,'function');
 await client.auth.initialize();
 assert.deepEqual(network, [], 'asynchronous initialization must not silently attempt network access');
});
