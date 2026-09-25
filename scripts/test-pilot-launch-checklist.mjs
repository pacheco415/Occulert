import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const dashboard = readFileSync(new URL('../fleet-dashboard.html', import.meta.url), 'utf8');
const start = dashboard.indexOf('/* pilot-launch-checklist:start */');
const end = dashboard.indexOf('/* pilot-launch-checklist:end */');
assert.ok(start >= 0 && end > start, 'pilot launch checklist block must be present');
const block = dashboard.slice(start + '/* pilot-launch-checklist:start */'.length, end);
const context = {};
vm.runInNewContext(`${block};globalThis.pilotLaunchStateForTest=pilotLaunchState`, context);
const state = context.pilotLaunchStateForTest;

test('pilot launch state progresses only from protected-record inputs', () => {
  const now = Date.parse('2026-09-24T12:00:00.000Z');
  const prelaunch = state({ now, fleetReady: false, drivers: [], sessions: [] });
  assert.deepEqual(JSON.parse(JSON.stringify(prelaunch)), {
    fleetReady: false,
    activeDrivers: 0,
    driverTarget: 0,
    overPilotTarget: false,
    firstSessionReady: false,
    sessionCount: 0,
    displayReady: false,
    sevenDayReady: false,
    thirtyDayReady: false,
    pilotDay: 0,
  });

  const active = state({
    now,
    fleetReady: true,
    drivers: Array.from({ length: 7 }, (_, index) => ({ id: `driver-${index}`, active: index !== 6 })),
    sessions: [
      { started_at: '2026-08-20T12:00:00.000Z' },
      { started_at: '2026-09-23T12:00:00.000Z' },
      { started_at: 'invalid' },
    ],
  });
  assert.equal(active.activeDrivers, 6);
  assert.equal(active.driverTarget, 5);
  assert.equal(active.overPilotTarget, true);
  assert.equal(active.sessionCount, 2);
  assert.equal(active.displayReady, true);
  assert.equal(active.sevenDayReady, true);
  assert.equal(active.thirtyDayReady, true);
  assert.equal(active.pilotDay, 30);
});

test('pilot checklist exposes the approved manager actions without creating new telemetry', () => {
  assert.match(dashboard, /30-day pilot checklist/);
  assert.match(dashboard, /href="\/fleet-onboarding\.html">Invite drivers/);
  assert.match(dashboard, /href="\/app\.html">Open driver app/);
  assert.match(dashboard, /href="\/fleet-display\.html">Open TV display/);
  assert.match(dashboard, /href="#pilotValueTitle">Review results/);
  assert.doesNotMatch(block, /localStorage|fetch\(|getFleetSummary|latitude|longitude|media|raw motion/i);
});
