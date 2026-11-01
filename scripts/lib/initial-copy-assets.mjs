import { createHash } from 'node:crypto';
import { parse } from 'acorn';
import { parse as parseHtml } from 'parse5';

export const INITIAL_COPY_PIN = 'sha256-INIT-COPY';
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pin = bytes => 'sha256-' + createHash('sha256').update(bytes).digest('base64');
const apply = (source, edits) => edits.sort((a, b) => b.start - a.start).reduce((text, edit) => text.slice(0, edit.start) + edit.value + text.slice(edit.end), source);

// Match a whole root-relative URL literal, never a source path or logical key.
export function replaceInitialCopyUrl(source, logical, filename) {
  return source.replace(new RegExp("([\"'`])/" + escape(logical) + '(?=\\1|[?#])', 'g'), (_, quote) => quote + '/' + filename);
}

export function assertInitialCopyRuntimeSource(source, { logical, filename }) {
  if (source.includes(INITIAL_COPY_PIN)) throw new Error('Initial copy integrity placeholders are unsupported in runtime JS/CSS');
  if (filename.endsWith('.js')) {
    const ast = parse(source, { ecmaVersion: 2022, sourceType: 'module' });
    function visit(node) {
      const value = node.type === 'Literal' && typeof node.value === 'string' ? node.value : node.type === 'TemplateElement' ? node.value.cooked : null;
      if (value?.startsWith('/' + logical)) throw new Error('Initial copy logical URLs are supported only in HTML and worker pins, not runtime JS/CSS');
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) for (const child of value) { if (child?.type) visit(child); }
        else if (value?.type) visit(value);
      }
    }
    visit(ast);
  } else if (new RegExp("([\"'])/" + escape(logical) + '|url\\(\\s*/' + escape(logical), 'i').test(source)) {
    throw new Error('Initial copy logical URLs are supported only in HTML and worker pins, not runtime JS/CSS');
  }
}

function acceptPin(value, expected) {
  if (value !== INITIAL_COPY_PIN && value !== expected) throw new Error('Initial copy reference needs its exact SHA-256 pin or sha256-INIT-COPY');
}

export function synchronizeInitialCopyHtml(source, { logical, filename, bytes }) {
  const errors = [];
  const tree = parseHtml(source, { sourceCodeLocationInfo: true, onParseError: error => errors.push(error) });
  if (errors.some(error => error.code === 'duplicate-attribute')) throw new Error('Ambiguous HTML attributes during initial copy release');
  const edits = [], expected = pin(bytes), url = '/' + filename;
  function visit(node) {
    const attrs = new Map((node.attrs || []).map(attr => [attr.name, attr.value]));
    const reference = node.tagName === 'link' ? attrs.get('href') : attrs.get('src') || attrs.get('href');
    if ([logical, '/' + logical].includes(reference?.split(/[?#]/, 1)[0])) throw new Error('Initial copy HTML URLs must be quoted and root-relative');
    if (reference?.split(/[?#]/, 1)[0] === url) {
      const script = node.tagName === 'script';
      const style = node.tagName === 'link' && attrs.get('rel')?.split(/\s+/).includes('stylesheet');
      if (script || style) {
        if (script !== logical.endsWith('.js')) throw new Error('Initial copy HTML reference has the wrong asset type');
        acceptPin(attrs.get('integrity'), expected);
        if (attrs.get('crossorigin') !== 'anonymous') throw new Error('Initial copy HTML references require crossorigin="anonymous"');
        const location = node.sourceCodeLocation?.attrs?.integrity;
        if (!location) throw new Error('Initial copy HTML reference is missing its owned integrity attribute');
        edits.push({ start: location.startOffset, end: location.endOffset, value: `integrity="${expected}"` });
      } else if (attrs.has('integrity')) {
        throw new Error('Initial copy HTML pins require a script or stylesheet reference');
      }
    } else if (attrs.get('integrity') === INITIAL_COPY_PIN) {
      throw new Error('Initial copy integrity placeholder belongs to an unrelated HTML URL');
    }
    for (const child of node.childNodes || []) visit(child);
    if (node.content) visit(node.content);
  }
  visit(tree);
  const result = apply(source, edits);
  if (result.includes(INITIAL_COPY_PIN)) throw new Error('Unresolved initial copy HTML integrity placeholder');
  return result;
}

export function synchronizeInitialCopyWorker(source, { logical, filename, bytes }) {
  const ast = parse(source, { ecmaVersion: 2022, sourceType: 'script' });
  const edits = [], allowedUrls = new Set(), expected = pin(bytes), url = '/' + filename;
  const key = property => property.key?.name ?? property.key?.value;
  function visit(node) {
    if (node.type === 'ObjectExpression') {
      const urls = node.properties.filter(property => key(property) === 'url');
      const relevant = urls.some(property => typeof property.value?.value === 'string' && [logical, url].includes(property.value.value.split(/[?#]/, 1)[0]));
      if (relevant) {
        const integrity = node.properties.filter(property => key(property) === 'integrity');
        if (urls.length !== 1 || integrity.length !== 1 || node.properties.length !== 2
          || node.properties.some(property => property.type !== 'Property' || property.computed || property.method || property.kind !== 'init')
          || urls[0].value.type !== 'Literal' || urls[0].value.value !== url || integrity[0].value.type !== 'Literal') {
          throw new Error('Initial copy worker pins require one literal root-relative url/integrity pair');
        }
        acceptPin(integrity[0].value.value, expected);
        allowedUrls.add(urls[0].value);
        edits.push({ start: integrity[0].value.start, end: integrity[0].value.end, value: JSON.stringify(expected) });
      }
    }
    const literal = node.type === 'Literal' && typeof node.value === 'string' ? node.value : node.type === 'TemplateElement' ? node.value.cooked : null;
    if (literal?.startsWith('/' + logical)) throw new Error('Unresolved initial logical worker URL or template prefix');
    if (literal?.split(/[?#]/, 1)[0] === url && !allowedUrls.has(node)) throw new Error('Initial copy worker URLs must belong to a literal url/integrity pair');
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const child of value) { if (child?.type) visit(child); }
      else if (value?.type) visit(value);
    }
  }
  visit(ast);
  const result = apply(source, edits);
  if (result.includes(INITIAL_COPY_PIN)) throw new Error('Unresolved or unrelated initial copy worker integrity placeholder');
  return result;
}
