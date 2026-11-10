import { createHash } from 'node:crypto';
import { parse } from 'acorn';
import { parse as parseHtml } from 'parse5';
import { parseRuntimeAssetPath } from './asset-paths.mjs';

const catalogUrl = value => typeof value === 'string' && /^(?:\/?(?:assets\/runtime\/)?driver-i18n\.v\d+\.js|\/?driver-i18n\.js)/.test(value);
const walk = (node, visit) => {
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) { for (const child of value) if (child?.type) walk(child, visit); }
    else if (value?.type) walk(value, visit);
  }
};

// This is the driver's owned inert template and optional worker pair only.
// Never infer ownership from matching digest text or from a runtime JS loader.
export function synchronizeDriverCatalogPins(html, worker, { filename, bytes, previousDigest }) {
  if (parseRuntimeAssetPath(filename).logicalName !== 'driver-i18n.js' || !/^[a-f0-9]{64}$/.test(previousDigest)) throw new Error('Invalid driver catalog release identity or previous digest');
  const url = '/' + filename;
  const pin = 'sha256-' + createHash('sha256').update(bytes).digest('base64');
  const previous = 'sha256-' + Buffer.from(previousDigest, 'hex').toString('base64');
  const acceptPin = value => {
    if (value !== previous && value !== pin) throw new Error('Driver catalog reference needs its previous or exact final SHA-256 pin');
  };
  const errors = [], templates = [], references = [];
  const tree = parseHtml(html, { sourceCodeLocationInfo: true, onParseError: error => errors.push(error) });
  function visitHtml(node, inert = false) {
    const attrs = new Map((node.attrs || []).map(attr => [attr.name, attr.value]));
    if (attrs.get('id') === 'driverCatalog') {
      if (inert) throw new Error('Driver catalog template must be reachable in the page document');
      templates.push(node);
    }
    if (catalogUrl(attrs.get('src')) || catalogUrl(attrs.get('href'))) references.push(node);
    for (const child of node.childNodes || []) visitHtml(child, inert);
    if (node.content) visitHtml(node.content, true);
  }
  visitHtml(tree);
  if (errors.some(error => error.code === 'duplicate-attribute') || templates.length !== 1 || templates[0].tagName !== 'template') throw new Error('Driver catalog needs one unambiguous owned inert template');
  const children = templates[0].content.childNodes.filter(node => node.nodeName !== '#comment' && !(node.nodeName === '#text' && !node.value.trim()));
  const script = children[0], attrs = new Map((script?.attrs || []).map(attr => [attr.name, attr.value]));
  const quoted = name => {
    const location = script?.sourceCodeLocation?.attrs?.[name];
    return location && new RegExp('^' + name + '\\s*=\\s*(["\'])([\\s\\S]*)\\1$', 'i').test(html.slice(location.startOffset, location.endOffset));
  };
  if (children.length !== 1 || script.tagName !== 'script' || attrs.get('src') !== url || attrs.get('crossorigin') !== 'anonymous'
    || !quoted('src') || !quoted('integrity') || !quoted('crossorigin') || references.length !== 1 || references[0] !== script
    || script.childNodes.some(node => node.nodeName !== '#text' || node.value.trim())) throw new Error('Driver catalog template needs its sole literal owned script URL and anonymous SRI');
  acceptPin(attrs.get('integrity'));
  const location = script.sourceCodeLocation?.attrs?.integrity;
  if (!location) throw new Error('Driver catalog template is missing its owned integrity attribute');

  const ast = parse(worker, { ecmaVersion: 2022, sourceType: 'script' }), declarations = [];
  walk(ast, node => { if (node.type === 'VariableDeclarator' && node.id.name === 'DRIVER_I18N_ASSETS') declarations.push(node); });
  const declaration = declarations[0];
  const owner = ast.body.find(node => node.type === 'VariableDeclaration' && node.kind === 'const' && node.declarations.includes(declaration));
  const array = declaration?.init, pair = array?.elements?.[0];
  if (declarations.length !== 1 || !owner || array?.type !== 'ArrayExpression' || array.elements.length !== 1 || pair?.type !== 'ObjectExpression' || pair.properties.length !== 2
    || pair.properties.some(property => property.type !== 'Property' || property.computed || property.method || property.kind !== 'init' || property.value.type !== 'Literal')) throw new Error('Driver catalog worker needs one owned literal url/integrity pair');
  const key = property => property.key.name ?? property.key.value;
  const urls = pair.properties.filter(property => key(property) === 'url'), pins = pair.properties.filter(property => key(property) === 'integrity');
  if (urls.length !== 1 || pins.length !== 1 || urls[0].value.value !== url) throw new Error('Driver catalog worker needs its exact owned URL and integrity');
  acceptPin(pins[0].value.value);
  walk(ast, node => {
    const value = node.type === 'Literal' ? node.value : node.type === 'TemplateElement' ? node.value.cooked : null;
    if (catalogUrl(value) && node !== urls[0].value) throw new Error('Driver catalog worker URL must belong only to its owned literal pair');
  });
  return {
    html: html.slice(0, location.startOffset) + `integrity="${pin}"` + html.slice(location.endOffset),
    worker: worker.slice(0, pins[0].value.start) + JSON.stringify(pin) + worker.slice(pins[0].value.end),
  };
}
