import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const read = path => readFileSync(path, 'utf8');
const versions = JSON.parse(read('asset-versions.json'));
const integrity = JSON.parse(read('asset-integrity.json'));
const rules = JSON.parse(read('vercel.json')).headers;
const cachePolicy = path => rules.flatMap(rule => new RegExp(`^${rule.source}$`).test(path) ? rule.headers : [])
  .filter(header => header.key.toLowerCase() === 'cache-control').at(-1)?.value;
for (const [original, asset] of Object.entries(versions)) {
  assert.match(asset, /\.v\d+\.(js|css)$/, `${asset} needs an immutable version suffix`);
  assert.ok(existsSync(asset), `${original} must resolve to ${asset}`);
  assert.equal(createHash('sha256').update(readFileSync(asset)).digest('hex'), integrity[asset], `${asset} changed: bump its URL before updating its integrity record`);
  assert.equal(cachePolicy('/' + asset), 'public, max-age=31536000, immutable', `${asset} must be immutable`);
  if (asset.endsWith('.js')) new Function(read(asset));
}
for (const path of ['/index.html', '/app.html', '/manifest.json', '/sw.js']) {
  assert.equal(cachePolicy(path), 'public, max-age=0, must-revalidate', `${path} must revalidate`);
}
const extractedPages = 'account login driver-profiles faq features how-it-works install pilot-signup privacy product-hub safety session-history accept-invite fleet-onboarding fleet-pricing pilot-leads about'.split(' ');
for (const name of extractedPages) {
  const html = read(name + '.html');
  assert.doesNotMatch(html, /<style\b|<script(?![^>]*\bsrc=)/i, `${name} must use external styles and scripts`);
  assert.doesNotMatch(html, /<script[^>]+src=["'][^"']*mediapipe/i, `${name} must not load the detector`);
}
for (const file of readdirSync('.').filter(file => file.endsWith('.html'))) {
  const html = read(file);
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map(match => match[0]);
  if (links.some(link => /fonts\.googleapis\.com.*(?:family=)|(?:family=).*fonts\.googleapis\.com/.test(link))) {
    for (const host of ['fonts.googleapis.com', 'fonts.gstatic.com']) {
      assert.ok(links.some(link => link.includes(`https://${host}`) && /rel=["']preconnect["']/.test(link) && (host !== 'fonts.gstatic.com' || /\bcrossorigin\b/.test(link))), `${file} needs a preconnect to ${host}`);
    }
  }
  for (const match of html.matchAll(/<(?:link|script)\b[^>]*(?:href|src)=["']([^"']+)["']/gi)) {
    const ref = match[1].split(/[?#]/)[0].replace(/^\//, '');
    assert.ok(!Object.hasOwn(versions, ref), `${file} references obsolete ${ref}`);
  }
}
for (const asset of Object.values(versions).filter(asset => asset.endsWith('.css'))) {
  for (const match of read(asset).matchAll(/@import\s+url\(["']?\/?([^"')]+)["']?\)/g)) {
    assert.ok(existsSync(match[1]), `${asset} imports missing ${match[1]}`);
    assert.ok(Object.hasOwn(integrity, match[1]), `${asset} imports an unversioned stylesheet`);
  }
}
console.log('Asset versions, cache policies, extracted pages and font preconnects passed.');
