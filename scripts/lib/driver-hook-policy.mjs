import assert from 'node:assert/strict';
import { parse } from 'acorn';
import { analyze } from 'eslint-scope';

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
  return Object.fromEntries(Object.keys(value).sort().filter(key => !['start', 'end', 'range', 'raw'].includes(key)).map(key => [key, canonical(value[key])]));
}

export function auditDriverHooks(source) {
  const ast = parse(source, { ecmaVersion: 2022, sourceType: 'script', ranges: true });
  const named = name => {
    const nodes = ast.body.filter(node => node.type === 'FunctionDeclaration' && node.id.name === name);
    assert.equal(nodes.length, 1, `One real ${name} declaration required`);
    return nodes[0];
  };
  walk(ast, node => {
    const left = node.type === 'AssignmentExpression' ? node.left : node.type === 'UpdateExpression' ? node.argument : null;
    assert.ok(!(left?.type === 'Identifier' && ['start', 'stop', 'trigger', 'scoringTriggerEligible', 'scoringReadWallClock'].includes(left.name)), 'Lifecycle/accepted-alert functions must not be reassigned');
    if (left?.type === 'MemberExpression' && ['window', 'globalThis'].includes(left.object?.name)) {
      assert.ok(!left.computed || left.property.type === 'Literal', 'Unknown computed global property writes are unsupported');
      const key = left.computed ? left.property.value : left.property.name;
      assert.ok(!['start', 'stop'].includes(key), 'Native lifecycle properties must remain intact');
    }
  });
  const trigger = named('trigger');
  const guard = trigger.body.body.find(node => node.type === 'IfStatement' && node.consequent.type === 'ReturnStatement');
  const predicate = parse('!scoringTriggerEligible({lastAlert,calibrating,confidence},now,Boolean(qualified))', { ecmaVersion: 2022 }).body[0].expression;
  assert.deepEqual(canonical(guard?.test), canonical(predicate), 'Accepted alerts call the exact released eligibility phase with original state');
  const eligibility = named('scoringTriggerEligible');
  const expected = parse('function scoringTriggerEligible(state,nowMs,qualifiedLoss=false){return !(nowMs-state.lastAlert<12000||state.calibrating||state.confidence<45&&!qualifiedLoss)}', {ecmaVersion:2022}).body[0];
  assert.deepEqual(canonical(eligibility), canonical(expected), 'The actual pure eligibility retains cooldown, calibration and qualified-confidence guards');
  const scopes = analyze(ast, {ecmaVersion:2022,sourceType:'script',optimistic:false,ignoreEval:false}), scope = scopes.acquire(trigger);
  const call = guard.test.argument;
  const resolve = identifier => scope.references.find(reference => reference.identifier === identifier)?.resolved;
  const bound = resolve(call.callee);
  assert.ok(bound?.defs.length === 1 && bound.defs[0].node === eligibility, 'Trigger eligibility must resolve to the actual owned pure function');
  for (const property of call.arguments[0].properties) {
    assert.ok(resolve(property.value) === scopes.globalScope.variables.find(variable => variable.name === property.value.name),
      'Eligibility state must use the original driver binding: ' + property.value.name);
  }
  const time = resolve(call.arguments[1]);
  assert.ok(time?.scope === scope && time.defs.length === 1, 'Eligibility time must be the captured trigger clock');
  const timeWrites = time.references.filter(reference=>reference.isWrite());
  assert.ok(timeWrites.length===1 && timeWrites[0].init===true && timeWrites[0].identifier===time.defs[0].name
    && timeWrites[0].writeExpr===time.defs[0].node.init,'Trigger clock has one initialization and no later writes');
  const timeCall = parse("scoringReadWallClock('trigger')",{ecmaVersion:2022}).body[0].expression;
  assert.deepEqual(canonical(time.defs[0].node.init),canonical(timeCall),'Capture the original trigger phase clock once');
  const clock = named('scoringReadWallClock');
  assert.ok(resolve(time.defs[0].node.init.callee)?.defs[0]?.node === clock,'Trigger time must resolve to the owned clock adapter');
  const expectedClock = parse('function scoringReadWallClock(phase){const value=Date.now();experimentController?.recordScoringClock?.(phase,value);return value}',{ecmaVersion:2022}).body[0];
  assert.deepEqual(canonical(clock),canonical(expectedClock),'Clock adapter reads Date.now once, optionally records it, and returns the same value');
  const clockScope = scopes.acquire(clock);
  const clockReference = identifier => clockScope.references.find(reference=>reference.identifier===identifier)?.resolved;
  assert.ok(clockReference(clock.body.body[0].declarations[0].init.callee.object)===null,'Clock adapter uses the browser Date binding');
  const metadata = clock.body.body[1].expression.expression;
  assert.ok(clockReference(metadata.callee.object)===scopes.globalScope.variables.find(variable=>variable.name==='experimentController'),
    'Clock metadata uses the original controller binding');
  assert.ok(resolve(call.arguments[2].callee) === null,'Qualified eligibility cannot shadow Boolean');
  const qualified = resolve(call.arguments[2].arguments[0]);
  const privateLoss = parse("experimentFlags.noface&&running&&reason==='Face lost after fatigue'&&experimentController?.qualifiedLoss(eligibility)",{ecmaVersion:2022}).body[0].expression;
  assert.ok(qualified?.scope === scope && qualified.defs.length === 1,'Qualified loss is captured by the original trigger');
  const qualifiedWrites = qualified.references.filter(reference=>reference.isWrite());
  assert.ok(qualified.defs[0].parent.kind==='const' && qualifiedWrites.length===1 && qualifiedWrites[0].init===true
    && qualifiedWrites[0].identifier===qualified.defs[0].name && qualifiedWrites[0].writeExpr===qualified.defs[0].node.init,
  'Private qualification is initialized once and cannot be overwritten');
  assert.deepEqual(canonical(qualified.defs[0].node.init),canonical(privateLoss),'Only the current private no-face episode qualifies');
  const qualifiedGlobals = ['experimentFlags','running','experimentController'];
  walk(qualified.defs[0].node.init,node=>{
    if(node.type!=='Identifier')return;
    if(qualifiedGlobals.includes(node.name))assert.ok(resolve(node)===scopes.globalScope.variables.find(variable=>variable.name===node.name),
      'Private qualification uses the original driver binding: '+node.name);
    if(['reason','eligibility'].includes(node.name)){
      const parameter=resolve(node);
      assert.ok(parameter?.scope===scope && parameter.defs.length===1 && parameter.defs[0].type==='Parameter'
        && parameter.references.every(reference=>!reference.isWrite()),'Private qualification uses the unchanged trigger parameter: '+node.name);
    }
  });
  const calls = [];
  walk(trigger, node => { if (node.type === 'CallExpression' && node.callee.name === 'acceptedAlertHook') calls.push(node); });
  assert.equal(calls.length, 1, 'One actual accepted-alert dispatch required');
  const accepted = trigger.body.body.find(node => node.type === 'ExpressionStatement' && node.expression.type === 'UpdateExpression' && node.expression.argument.name === 'alerts');
  walk(trigger,node=>{
    const left=node.type==='AssignmentExpression'?node.left:node.type==='UpdateExpression'?node.argument:null;
    if(left?.type==='Identifier'&&['lastAlert','alerts','escalationLevel','lastEscalation'].includes(left.name))
      assert.ok(guard.end<=node.start,'Guard must precede accepted-alert state mutation: '+left.name);
  });
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
