import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sitemap = resolve(root, 'sitemap.xml');
const original = readFileSync(sitemap, 'utf8');
const records = [...original.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(match => ({ body: match[1], url: new URL(match[1].match(/<loc>(.*?)<\/loc>/)[1]) }));
if (process.argv.includes('--check')) {
  const seen = new Set();
  for (const record of records) {
    if (record.url.origin !== 'https://www.occulert.com' || record.url.hash || record.url.search || seen.has(record.url.href)) throw Error('Sitemap URLs must be unique canonical site pages without fragments');
    seen.add(record.url.href);
    const date = record.body.match(/<lastmod>(.*?)<\/lastmod>/)?.[1];
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date > new Date().toISOString().slice(0, 10)) throw Error('Sitemap lastmod must be a valid date no later than today');
    readFileSync(resolve(root, record.url.pathname === '/' ? 'index.html' : record.url.pathname.slice(1)));
  }
  console.log(`Sitemap checked: ${seen.size} canonical pages`);
} else {
  if (execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: root, encoding: 'utf8' }).trim() !== 'false') throw Error('Generate sitemap dates from a complete checkout, not shallow CI history');
  const pages = new Map();
  for (const record of records) {
    record.url.hash = ''; record.url.search = '';
    if (pages.has(record.url.href)) continue;
    const page = record.url.pathname === '/' ? 'index.html' : record.url.pathname.slice(1);
    const html = readFileSync(resolve(root, page), 'utf8');
    const assets = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g)].map(match => match[1]).filter(path => !/^(https?:|\/\/)/.test(path)).map(path => path.replace(/^\//, ''));
    const paths = [page, ...assets];
    const date = execFileSync('git', ['log', '-1', '--format=%cs', '--', ...paths], { cwd: root, encoding: 'utf8' }).trim();
    if (!date) throw Error(`No tracked source date for ${page}`);
    const body = record.body.replace(/<loc>.*?<\/loc>/, `<loc>${record.url.href}</loc>`).replace(/<lastmod>.*?<\/lastmod>/, `<lastmod>${date}</lastmod>`);
    pages.set(record.url.href, `  <url>${body.trim()}</url>`);
  }
  writeFileSync(sitemap, '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + [...pages.values()].join('\n') + '\n</urlset>\n');
  console.log(`Updated ${pages.size} canonical pages from their tracked HTML and direct JS/CSS changes`);
}
