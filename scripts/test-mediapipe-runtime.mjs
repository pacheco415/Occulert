import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const originals = JSON.parse(readFileSync('scripts/mediapipe/upstream-helpers.json', 'utf8'));
function runtime(patched, additions = {}) {
  const context = vm.createContext({
    makeLegalFunctionName: name => name.replace(/[^a-zA-Z0-9_]/g, '$'),
    throwBindingError: message => { throw new Error(message); },
    new_: (constructor, args) => Reflect.construct(constructor, args),
    __emval_addMethodCaller: fn => fn,
    ...additions,
  }, { codeGeneration: { strings: !patched, wasm: false } });
  for (const [name, original] of Object.entries(originals)) {
    vm.runInContext(patched ? readFileSync(`scripts/mediapipe/${name}.js`, 'utf8') : original, context);
  }
  return context;
}
for (const isMethod of [false, true]) {
  for (const stack of [false, true]) {
    for (const returns of [false, true]) {
      test(`invoker preserves arguments and cleanup: method=${isMethod}, stack=${stack}, returns=${returns}`, () => {
        function run(patched) {
          const events = [];
          const context = runtime(patched, { runDestructors: destructors => { events.push(['cleanup', ...destructors]); } });
          const converter = name => ({ name,
            destructorFunction: stack ? undefined : function(value) { events.push(['destroy', this === undefined, name, value]); },
            toWireType: (destructors, value) => { events.push(['convert', name, value]); if (destructors) destructors.push(name); return value + '-wire'; },
          });
          const ret = { name: returns ? 'string' : 'void', fromWireType: value => { events.push(['return', value]); return value + '-js'; } };
          const argTypes = [ret, isMethod ? converter('this') : null, converter('a'), converter('b')];
          const fn = context.craftInvokerFunction('Class.method', argTypes, isMethod ? {} : null, function(...args) { events.push(['call', this === undefined, ...args]); return 'result'; }, 'target');
          const result = fn.call('owner', 'first', 'second');
          let error;
          try { fn('missing'); } catch (e) { error = e.message; }
          return { result, events, name: fn.name, length: fn.length, error };
        }
        // Normalize boxed sloppy-mode receivers across VM realms.
        assert.equal(JSON.stringify(run(true)), JSON.stringify(run(false)));
      });
    }
  }
}
test('native exceptions preserve upstream cleanup behavior', () => {
  for (const patched of [false, true]) {
    let cleaned = false;
    const context = runtime(patched, { runDestructors: () => { cleaned = true; } });
    const fn = context.craftInvokerFunction('fails', [{ name: 'void' }, null, { name: 'arg', toWireType: () => 1 }], null, () => { throw new Error('native failure'); }, 0);
    assert.throws(() => fn(1), /native failure/);
    assert.equal(cleaned, false);
  }
});
for (const isVoid of [false, true]) {
  test(`method caller preserves packed offsets, receiver and object deletion: void=${isVoid}`, () => {
    function run(patched) {
      const events = [];
      const types = [{ name: isVoid ? 'void' : 'result', isVoid, toWireType: (d, value) => { events.push(['return', d, value]); return value + 1; } },
        ...[4, 8].map((advance, index) => ({ name: 'arg' + index, argPackAdvance: advance, readValueFromPointer: address => { events.push(['read', address]); return address; }, deleteObject: value => events.push(['delete', value]) }))];
      const context = runtime(patched, { __emval_lookupTypes: () => types });
      const fn = context.__emval_get_method_caller(3, 99);
      const handle = { marker: 'receiver', method(a, b) { events.push(['call', this.marker, a, b]); return a + b; } };
      return { result: fn(handle, 'method', 'destructors', 100), events, name: fn.name, length: fn.length };
    }
    assert.equal(JSON.stringify(run(true)), JSON.stringify(run(false)));
  });
}
test('named functions retain strict receivers, names and constructor behavior', () => {
  for (const patched of [false, true]) {
    const context = runtime(patched);
    vm.runInContext('var named = createNamedFunction("Some.Class", function(value) { "use strict"; if (value) this.value = value; return this; });', context);
    assert.equal(context.named.call(undefined), undefined);
    assert.equal(context.named.name, 'Some$Class');
    assert.equal(context.named.length, 0);
    assert.equal(new context.named(42).value, 42);
  }
});
