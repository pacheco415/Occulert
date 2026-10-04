import assert from 'node:assert/strict';
import test from 'node:test';
import { scriptMarkupPolicy, generatedScriptMarkupPolicy } from './lib/html-script-policy.mjs';

for (const markup of ['<button onclick=alert(1)>', '<button onClick="alert(1)">', "<button ONCLICK = 'alert(1)'>", '<button\nOnClIcK\n=alert(1)>', '<script src = "/owned.js" onerror=alert(1)></script>']) {
  test(`HTML handler policy rejects browser-recognized attribute: ${markup}`, () => {
    assert.equal(scriptMarkupPolicy(markup).handlers.length, 1);
  });
}
test('quoted data text, ordinary property callbacks and comments are not HTML event attributes', () => {
  const markup = '<button data-text=" onclick=alert(1) >" data-page-action="save">Save</button>';
  assert.equal(scriptMarkupPolicy(markup).handlers.length, 0);
  assert.equal(scriptMarkupPolicy('element.onclick = () => save(); <!-- <button onclick=bad()> -->').handlers.length, 0);
});
test('script attributes are case-insensitive and quoted greater-than characters preserve the script body', () => {
  const result = scriptMarkupPolicy('<SCRIPT id="guard>name">run();</SCRIPT><script SRC = "/owned.js"></script>');
  assert.equal(result.inlineScripts.length, 1);
  assert.equal(result.inlineScripts[0].attributes.id, 'guard>name');
  assert.equal(result.inlineScripts[0].body, 'run();');
});
test('quoted data containing src= cannot disguise an inline script as external', () => {
  const result = scriptMarkupPolicy('<script data-note="src=not-an-attribute">window.auditInlineBypass=true</script><script src = "/owned.js"></script>');
  assert.equal(result.inlineScripts.length, 1);
  assert.equal(result.inlineScripts[0].body, 'window.auditInlineBypass=true');
});
test('active generated markup is checked without matching quoted data text', () => {
  const source = 'function render(){return `<button data-label=" onclick=ignore()" onClick=save()>Save</button>`}';
  assert.deepEqual(generatedScriptMarkupPolicy(source).handlers.map(value => value.attribute), ['onclick']);
});
for (const quote of ['"', "'"]) {
  test(`a literal ${quote} in an unquoted value cannot hide the next event attribute`, () => {
    const result = scriptMarkupPolicy(`<button data-note=a${quote} OnClIcK=window.auditBypass=true>Click</button>`);
    assert.deepEqual(result.handlers.map(value => value.attribute), ['onclick']);
  });
}
for (const prefix of ['<!-->', '<!-- x --!>', '<script src="/owned.js"></script/>', '<script src="/owned.js"></script note=x>']) {
  test(`browser comment and script-end recovery does not hide following handlers: ${prefix}`, () => {
    assert.deepEqual(scriptMarkupPolicy(prefix + '<button onclick=window.extraBypass=true>Click</button>').handlers.map(value => value.attribute), ['onclick']);
  });
}
test('inert template contents are audited before any later insertion into the page', () => {
  assert.deepEqual(scriptMarkupPolicy('<template><button onclick=bad()>Action</button><script>bad()</script></template>').handlers.map(value => value.attribute), ['onclick']);
  assert.equal(scriptMarkupPolicy('<template><script>bad()</script></template>').inlineScripts.length, 1);
});

test('document-level handlers and insertion-only table tags remain visible', () => {
  const document = '<!doctype html><html onclick=run()><head></head><body onload=run()><button onClick=run()>Click</button></body></html>';
  assert.deepEqual(scriptMarkupPolicy(document).handlers.map(item => item.tag), ['html', 'body', 'button']);
  assert.equal(scriptMarkupPolicy('<tr onclick=run()><td onmouseover=run()>Value</td></tr>').handlers.length, 2);
});
test('JavaScript comparisons and ordinary property callbacks are not generated markup', () => {
  const source = 'if(now-lastPush<FLEET_PUSH_INTERVAL)return; element.onclick=()=>save(); const text="only";';
  assert.equal(generatedScriptMarkupPolicy(`function update(){${source}}`).handlers.length, 0);
});
test('decoded literals, split concatenations and template interpolations expose inline attributes', () => {
  const sources = [
    'const markup="<button onClick=run()>Action</button>";',
    'const markup="<"+"button onClick=run()>Action</button>";',
    'const markup=`<button data-id="${id}" onClick=run()>Action</button>`;',
    'const markup="<button "+label+" onClick=run()>Action</button>";',
  ];
  for (const source of sources) assert.ok(generatedScriptMarkupPolicy(source).handlers.some(item => item.attribute === 'onclick'));
});

test('generated inline script bodies remain visible while owned external scripts are allowed', () => {
  const source = `document.write('<script>window.x=true</script>');`;
  assert.equal(generatedScriptMarkupPolicy(source).inlineScripts.length, 1);
  assert.equal(generatedScriptMarkupPolicy(`document.write('<script src="/owned.js"></script>');`).inlineScripts.length, 0);
});
