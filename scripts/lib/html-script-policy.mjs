import { parse, parseFragment } from 'parse5';
import { parse as parseJavaScript } from 'acorn';

// Development-only policy checks: complete documents and insertion fragments have
// different parsing contexts. Union their located attributes rather than dropping
// html/body or table-fragment tags. This audits literal markup, not dynamic values.
export function scriptMarkupPolicy(source) {
  const handlers = new Map(), inlineScripts = new Map();
  function visit(node) {
    const location = node.sourceCodeLocation;
    const attributes = Object.create(null);
    for (const { name, value } of node.attrs || []) {
      attributes[name] = value;
      if (location && /^on[a-z]+$/.test(name)) handlers.set(`${location.startOffset}:${name}`, {
        tag: node.tagName, attribute: name, offset: location.startOffset,
      });
    }
    if (location && node.tagName === 'script' && !Object.hasOwn(attributes, 'src')) {
      inlineScripts.set(location.startOffset, {
        attributes,
        body: source.slice(location.startTag.endOffset, location.endTag?.startOffset ?? location.endOffset),
        offset: location.startOffset,
      });
    }
    for (const child of node.childNodes || []) visit(child);
    if (node.content) visit(node.content);
  }
  visit(parse(source, { sourceCodeLocationInfo: true }));
  visit(parseFragment(source, { sourceCodeLocationInfo: true }));
  return { handlers: [...handlers.values()], inlineScripts: [...inlineScripts.values()] };
}

// Parse JavaScript first: comparison operators and property callbacks are code,
// not markup. Inspect decoded string literals, template text and concatenations;
// placeholders preserve attribute boundaries without executing expressions.
export function generatedScriptMarkupPolicy(source) {
  const tree = parseJavaScript(source, { ecmaVersion: 'latest', sourceType: 'script' });
  const handlers = [], inlineScripts = [];
  function projection(node) {
    if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
    if (node.type === 'TemplateLiteral') return node.quasis.map((part, index) =>
      (part.value.cooked ?? part.value.raw) + (index < node.expressions.length ? 'auditValue' : '')).join('');
    if (node.type === 'BinaryExpression' && node.operator === '+') {
      const left = projection(node.left), right = projection(node.right);
      if (left !== null || right !== null) return (left ?? 'auditValue') + (right ?? 'auditValue');
    }
    return null;
  }
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    const markup = projection(node);
    if (markup !== null && markup.includes('<')) {
      const result = scriptMarkupPolicy(markup);
      for (const item of result.handlers) handlers.push({ ...item, sourceOffset: node.start });
      for (const item of result.inlineScripts) inlineScripts.push({ ...item, sourceOffset: node.start });
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'start' || key === 'end') continue;
      if (Array.isArray(value)) for (const child of value) visit(child);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(tree);
  return { handlers, inlineScripts };
}
