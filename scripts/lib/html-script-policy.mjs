// Read HTML tag attributes without treating quoted text as attributes. This
// intentionally ignores script bodies and comments, including generated markup
// inside those bodies; callers scan active JS separately for that markup.
export function scriptMarkupPolicy(source) {
  const handlers = [], inlineScripts = [];
  let offset = 0;
  while (offset < source.length) {
    const start = source.indexOf('<', offset);
    if (start < 0) break;
    if (source.startsWith('<!--', start)) {
      const end = source.indexOf('-->', start + 4);
      offset = end < 0 ? source.length : end + 3; continue;
    }
    const name = /^<([a-z][a-z0-9:-]*)\b/i.exec(source.slice(start));
    if (!name) { offset = start + 1; continue; }
    let end = start + name[0].length, quote = '';
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (end === source.length) break;
    const attributes = Object.create(null);
    let index = start + name[0].length;
    while (index < end) {
      while (/[\s/]/.test(source[index] || '')) index += 1;
      if (index >= end) break;
      const attribute = /^[^\s=/>]+/.exec(source.slice(index, end));
      if (!attribute) { index += 1; continue; }
      const key = attribute[0].toLowerCase(); index += attribute[0].length;
      while (/\s/.test(source[index] || '')) index += 1;
      let value = '';
      if (source[index] === '=') {
        index += 1; while (/\s/.test(source[index] || '')) index += 1;
        const delimiter = source[index];
        if (delimiter === '"' || delimiter === "'") {
          const from = ++index;
          while (index < end && source[index] !== delimiter) index += 1;
          value = source.slice(from, index); index += 1;
        } else {
          const from = index;
          while (index < end && !/\s/.test(source[index])) index += 1;
          value = source.slice(from, index);
        }
      }
      attributes[key] = value;
      if (/^on[a-z]+$/.test(key)) handlers.push({ tag: name[1].toLowerCase(), attribute: key, offset: start });
    }
    offset = end + 1;
    if (name[1].toLowerCase() === 'script') {
      const closing = /<\/script\s*>/gi; closing.lastIndex = offset;
      const match = closing.exec(source);
      const body = source.slice(offset, match ? match.index : source.length);
      if (!Object.hasOwn(attributes, 'src')) inlineScripts.push({ attributes, body, offset: start });
      offset = match ? closing.lastIndex : source.length;
    }
  }
  return { handlers, inlineScripts };
}
