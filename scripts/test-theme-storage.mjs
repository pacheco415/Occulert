import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const baseline = process.env.OCCULERT_THEME_BASELINE === '1';
const variants = [
  ['homepage', baseline ? 'homepage.js' : 'homepage.v60.js'],
  ['public', baseline ? 'public-page.v51.js' : 'public-page.v60.js'],
  ['static', baseline ? 'static-page.v52.js' : 'static-page.v60.js'],
];

function boot(file, { blockedRead = false, blockedWrite = false, blockedAccess = false,
  saved = null, light = true, noMedia = false } = {}) {
  const elements = new Map(), registrations = [], writes = [], handlers = new Map();
  function element(id) {
    const attrs = new Map(), classes = new Set(), listeners = new Map();
    const value = { textContent: '', style: {}, focused: false, scrolled: false,
      getAttribute: name => attrs.get(name) ?? null,
      setAttribute: (name, text) => attrs.set(name, String(text)),
      addEventListener: (name, fn) => listeners.set(name, fn),
      click: () => listeners.get('click')?.({ preventDefault() {} }),
      focus() { this.focused = true; }, scrollIntoView() { this.scrolled = true; },
      classList: { contains: name => classes.has(name), add: name => classes.add(name),
        remove: name => classes.delete(name), toggle(name, enabled) {
          const next = enabled ?? !classes.has(name); if (next) classes.add(name); else classes.delete(name);
        } }, contains: other => other === value, matches: () => false,
      querySelectorAll: () => [], querySelector: () => null };
    elements.set(id, value); return value;
  }
  const html = element('html'), meta = element('meta'), target = element('target'), skip = element('skip');
  skip.setAttribute('href', '#main-content');
  const faq = element('faq'), item = element('faq-item'); faq.parentElement = item;
  item.querySelector = selector => selector === '.faq-q' ? faq : null;
  for (const id of ['themeToggle', 'themeToggleMobile', 'menuBtn', 'mobileMenu', 'scrollTop', 'siteNav']) element(id);
  const context = { document: { documentElement: html,
    getElementById: id => elements.get(id) ?? null,
    querySelector: selector => selector === '#main-content' ? target : meta,
    querySelectorAll: selector => selector === '.faq-q' ? [faq] : selector === '.faq-item' ? [item]
      : selector === '.skip-link[href^="#"]' ? [skip] : [],
    addEventListener: (name, fn) => handlers.set(name, fn) },
    navigator: { serviceWorker: { register: url => { registrations.push(url); return Promise.resolve(); } } },
    scrollY: 0, scrollTo() {}, addEventListener() {},
    requestAnimationFrame: fn => fn(), setInterval: () => 1, clearInterval() {},
  };
  if (!noMedia) context.matchMedia = () => ({ matches: light });
  const storage = { getItem() { if (blockedRead) throw Error('Storage read blocked'); return saved; },
    setItem(key, value) { if (blockedWrite) throw Error('Storage write blocked'); writes.push([key, value]); } };
  Object.defineProperty(context, 'localStorage', { configurable: true,
    get() { if (blockedAccess) throw Error('Storage access blocked'); return storage; } });
  context.window = context;
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), context);
  return { context, elements, html, meta, faq, item, skip, target, registrations, writes, storage };
}

function verifyBindings(app, kind) {
  assert.deepEqual(app.registrations, ['/sw.js'], 'optional theme must not prevent later page setup');
  if (kind === 'static') {
    app.skip.click(); assert.equal(app.target.focused, true); assert.equal(app.target.scrolled, true);
  } else {
    app.elements.get('menuBtn').click();
    assert.equal(app.elements.get('mobileMenu').classList.contains('open'), true);
    app.faq.click(); assert.equal(app.item.classList.contains('open'), true);
    assert.equal(app.faq.getAttribute('aria-expanded'), 'true');
  }
}

for (const [kind, file] of variants) {
  test(`${kind}: blocked theme read preserves subsequent page bindings and system theme`, () => {
    const app = boot(file, { blockedRead: true });
    assert.equal(app.html.getAttribute('data-theme'), 'light');
    assert.equal(app.elements.get('themeToggle').textContent, '☀️'); verifyBindings(app, kind);
  });
  test(`${kind}: blocked theme write preserves toggle metadata and subsequent page bindings`, () => {
    const app = boot(file, { blockedWrite: true }); verifyBindings(app, kind);
    app.elements.get('themeToggle').click();
    assert.equal(app.html.getAttribute('data-theme'), 'dark');
    assert.equal(app.elements.get('themeToggle').textContent, '🌙');
    assert.equal(app.meta.getAttribute('content'), '#0a0e1a');
    assert.deepEqual(app.writes, []);
    if (kind === 'static') assert.equal(app.elements.get('themeToggle').getAttribute('aria-label'), 'Use light theme');
    else {
      app.elements.get('themeToggleMobile').click();
      assert.equal(app.html.getAttribute('data-theme'), 'light');
      assert.equal(app.elements.get('themeToggleMobile').textContent, '☀️ Light Mode');
      assert.equal(app.elements.get('mobileMenu').classList.contains('open'), false);
    }
  });
  test(`${kind}: inaccessible storage object also preserves page setup`, () => {
    const app = boot(file, { blockedAccess: true, light: false }); verifyBindings(app, kind);
    assert.equal(app.html.getAttribute('data-theme'), 'dark');
  });
  test(`${kind}: persistence becoming unavailable after setup cannot break a click`, () => {
    const app = boot(file, { saved: 'dark' });
    app.storage.setItem = () => { throw Error('Quota exceeded after setup'); };
    assert.doesNotThrow(() => app.elements.get('themeToggle').click());
    assert.equal(app.html.getAttribute('data-theme'), 'light');
    assert.equal(app.elements.get('themeToggle').textContent, '☀️');
    assert.equal(app.meta.getAttribute('content'), '#f0f4f8');
  });
  test(`${kind}: valid saved preference wins and invalid preferences fall back safely`, () => {
    const saved = boot(file, { saved: 'dark' });
    assert.equal(saved.html.getAttribute('data-theme'), 'dark');
    assert.deepEqual(saved.writes, [['occulert-theme', 'dark']]);
    const invalid = boot(file, { saved: 'unexpected' });
    assert.equal(invalid.html.getAttribute('data-theme'), 'light');
    const unavailable = boot(file, { blockedRead: true, noMedia: true });
    assert.equal(unavailable.html.getAttribute('data-theme'), 'dark');
    verifyBindings(unavailable, kind);
  });
}
