import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import test from 'node:test';
const read=path=>readFileSync(path,'utf8');
const fontCSS=JSON.parse(read('asset-versions.json'))['inter-fonts.css'];

test('owned font files retain reviewed upstream bytes, notices and bounded Latin payload',()=>{
 const base='vendor/inter-5.3.0/',receipt=JSON.parse(read(base+'upstream.json'));
 assert.equal(receipt.package,'@fontsource-variable/inter');assert.equal(receipt.version,'5.3.0');assert.equal(receipt.license,'OFL-1.1');
 for(const [name,sha] of Object.entries(receipt.files))assert.equal(createHash('sha256').update(readFileSync(base+name)).digest('hex'),sha,name);
 assert.match(read(base+'LICENSE.txt'),/SIL OPEN FONT LICENSE Version 1.1/);
 assert.ok(readFileSync(base+'inter-latin-wght-normal.woff2').length<=50000);
 assert.match(fontCSS,/^inter-fonts\.v\d+\.css$/);
 const css=read(fontCSS);
 assert.equal(createHash('sha256').update(css).digest('hex'),JSON.parse(read('asset-integrity.json'))[fontCSS]);
 const fonts=[...css.matchAll(/url\(([^)]+)\)/g)].map(match=>match[1]);assert.equal(fonts.length,7);
 for(const font of fonts){assert.ok(font.startsWith('/'+base));assert.equal(readFileSync(font.slice(1)).subarray(0,4).toString(),'wOF2');}
 assert.match(css,/font-weight: 100 900/);assert.match(css,/font-display: swap/);
});

test('public documents and their font policy cannot reintroduce Google font requests',()=>{
 for(const asset of readdirSync('.').filter(name=>/\.(?:html|css|js)$/.test(name)))assert.doesNotMatch(read(asset),/fonts\.(?:googleapis|gstatic)\.com/,asset);
 assert.doesNotMatch(read('vercel.json'),/fonts\.(?:googleapis|gstatic)\.com/);
 assert.ok(read('sw.js').includes('/'+fontCSS),'service worker must install the active font stylesheet');
 assert.doesNotMatch(read('sw.js'),/\/vendor\/inter-5\.3\.0\/[^'"\s]+\.woff2/,'font subsets must load on demand within the existing install budget');
});
