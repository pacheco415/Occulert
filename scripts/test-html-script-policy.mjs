import assert from 'node:assert/strict';
import test from 'node:test';
import { scriptMarkupPolicy } from './lib/html-script-policy.mjs';

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
  assert.deepEqual(scriptMarkupPolicy(source).handlers.map(value => value.attribute), ['onclick']);
});
for (const quote of ['"', "'"]) {
  test(`a literal ${quote} in an unquoted value cannot hide the next event attribute`, () => {
    const result = scriptMarkupPolicy(`<button data-note=a${quote} OnClIcK=window.auditBypass=true>Click</button>`);
    assert.deepEqual(result.handlers.map(value => value.attribute), ['onclick']);
  });
}
