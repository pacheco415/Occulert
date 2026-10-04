import assert from 'node:assert/strict';
import { parse } from 'acorn';

function walk(node, visit) {
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) { for (const child of value) if (child?.type) walk(child, visit); }
    else if (value?.type) walk(value, visit);
  }
}
function canonical(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(Object.keys(value).sort().filter(key => !['start', 'end', 'raw'].includes(key)).map(key => [key, canonical(value[key])]));
}

export function auditDriverHooks(source) {
  const ast = parse(source, { ecmaVersion: 2022, sourceType: 'script' });
  const named = name => {
    const nodes = ast.body.filter(node => node.type === 'FunctionDeclaration' && node.id.name === name);
    assert.equal(nodes.length, 1, `One real ${name} declaration required`);
    return nodes[0];
  };
  walk(ast, node => {
    const left = node.type === 'AssignmentExpression' ? node.left : node.type === 'UpdateExpression' ? node.argument : null;
    assert.ok(!(left?.type === 'Identifier' && ['start', 'stop', 'trigger'].includes(left.name)), 'Lifecycle/accepted-alert functions must not be reassigned');
    if (left?.type === 'MemberExpression' && ['window', 'globalThis'].includes(left.object?.name)) {
      assert.ok(!left.computed || left.property.type === 'Literal', 'Unknown computed global property writes are unsupported');
      const key = left.computed ? left.property.value : left.property.name;
      assert.ok(!['start', 'stop'].includes(key), 'Native lifecycle properties must remain intact');
    }
  });
  const trigger = named('trigger');
  const guard = trigger.body.body.find(node => node.type === 'IfStatement' && node.consequent.type === 'ReturnStatement');
  const predicate = parse('now-lastAlert<12000||calibrating||confidence<45&&!qualified', { ecmaVersion: 2022 }).body[0].expression;
  assert.deepEqual(canonical(guard?.test), canonical(predicate), 'Accepted alerts retain cooldown, calibration and qualified-confidence guards');
  const calls = [];
  walk(trigger, node => { if (node.type === 'CallExpression' && node.callee.name === 'acceptedAlertHook') calls.push(node); });
  assert.equal(calls.length, 1, 'One actual accepted-alert dispatch required');
  const accepted = trigger.body.body.find(node => node.type === 'ExpressionStatement' && node.expression.type === 'UpdateExpression' && node.expression.argument.name === 'alerts');
  assert.ok(guard.end < accepted.start && accepted.end < calls[0].start, 'Dispatch follows guard and accepted alert count');
  const registrations = ast.body.filter(node => node.type === 'ExpressionStatement' && node.expression.type === 'CallExpression' && node.expression.callee.name === 'registerAcceptedAlertHook');
  assert.equal(registrations.length, 1, 'Register the actual accepted-alert effects once');
  const hook = registrations[0].expression.arguments[0];
  assert.equal(hook?.type, 'ArrowFunctionExpression');
  const effects = new Set();
  walk(hook, node => { if (node.type === 'CallExpression' && node.callee.type === 'Identifier') effects.add(node.callee.name); });
  for (const name of ['speak', 'triggerBreakCheck', 'logEvent', 'queueBackendEvent', 'updateChart']) assert.ok(effects.has(name), `Accepted hook retains ${name}`);
  named('registerAcceptedAlertHook');
  return true;
}
