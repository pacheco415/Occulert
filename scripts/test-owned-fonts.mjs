import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import test from 'node:test';
const read=path=>readFileSync(path,'utf8');

test('owned font files retain reviewed upstream bytes, notices and bounded Latin payload',()=>{
 const base='vendor/inter-5.3.0/',receipt=JSON.parse(read(base+'upstream.json'));
 assert.equal(receipt.package,'@fontsource-variable/inter');assert.equal(receipt.version,'5.3.0');assert.equal(receipt.license,'OFL-1.1');
 for(const [name,sha] of Object.entries(receipt.files))assert.equal(createHash('sha256').update(readFileSync(base+name)).digest('hex'),sha,name);
 assert.match(read(base+'LICENSE.txt'),/SIL OPEN FONT LICENSE Version 1.1/);
 assert.ok(readFileSync(base+'inter-latin-wght-normal.woff2').length<=50000);
 const css=read('inter-fonts.v1.css');
 const fonts=[...css.matchAll(/url\(([^)]+)\)/g)].map(match=>match[1]);assert.equal(fonts.length,7);
 for(const font of fonts){assert.ok(font.startsWith('/'+base));assert.equal(readFileSync(font.slice(1)).subarray(0,4).toString(),'wOF2');}
 assert.match(css,/font-weight: 100 900/);assert.match(css,/font-display: swap/);
});

test('public documents and their font policy cannot reintroduce Google font requests',()=>{
 for(const html of readdirSync('.').filter(name=>name.endsWith('.html')))assert.doesNotMatch(read(html),/fonts\.(?:googleapis|gstatic)\.com/,html);
 assert.doesNotMatch(read('vercel.json'),/fonts\.(?:googleapis|gstatic)\.com/);
 assert.match(read('sw.js'),/\/inter-fonts\.v1\.css/);
 assert.doesNotMatch(read('sw.js'),/\/vendor\/inter-5\.3\.0\/inter-latin-wght-normal\.woff2/,'fonts must load on demand within the existing install budget');
});
