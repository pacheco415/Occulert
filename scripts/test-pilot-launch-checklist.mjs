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
    sevenDayDataReady: false,
    thirtyDayDataReady: false,
    recordedAgeDays: 0,
    historyLimited: false,
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
  assert.equal(active.sevenDayDataReady, true);
  assert.equal(active.thirtyDayDataReady, true);
  assert.equal(active.recordedAgeDays, 35);
});

test('future and invalid starts cannot establish recorded-data age; latest 50 bound the view', () => {
  const now = Date.parse('2026-09-26T12:00:00Z');
  const future = state({ now, sessions: [{ started_at: '2026-09-27T12:00:00Z' }, { started_at: 'invalid' }] });
  assert.equal(future.firstSessionReady, false);
  assert.equal(future.sessionCount, 0);
  assert.equal(future.recordedAgeDays, 0);

  const sessions = Array.from({ length: 155 }, (_, i) => ({ started_at: new Date(now - i * 0.2 * 86400000).toISOString() }));
  const limited = state({ now, sessions });
  assert.equal(limited.sessionCount, 50);
  assert.equal(limited.historyLimited, true);
  assert.equal(limited.recordedAgeDays, 9);
  assert.equal(limited.sevenDayDataReady, true);
  assert.equal(limited.thirtyDayDataReady, false, 'an omitted old record must not imply an older loaded session');
  assert.equal(state({ now, sessions: [{ started_at: new Date(now - 30 * 86400000).toISOString() }, ...sessions] }).thirtyDayDataReady, true,
    'a recorded start 30 days old supports an oldest-loaded-session statement');
});

test('capped launch UI describes loaded data age without inventing trial dates', () => {
  const now = Date.parse('2026-09-26T12:00:00Z'), elements = new Map();
  class ClockDate extends Date { static now() { return now; } }
  const ui = { Date: ClockDate, fleetMode: true, protectedFleetName: 'Fleet', protectedDrivers: [{ active: true }],
    protectedSessions: [], document: { getElementById: id => {
      if (!elements.has(id)) elements.set(id, { textContent: '', dataset: {} });
      return elements.get(id);
    } } };
  vm.runInNewContext(block, ui);
  const render = days => {
    ui.protectedSessions = Array.from({ length: 50 }, () => ({ started_at: new Date(now - days * 86400000).toISOString() }));
    ui.renderPilotLaunchChecklist();
  };
  render(1);
  assert.equal(elements.get('pilotLaunchBadge').textContent, 'Earliest loaded session: 1 day ago · latest 50');
  assert.equal(elements.get('launchSessionStatus').textContent, '50 recent protected sessions recorded · 50-record limit');
  assert.equal(elements.get('launchReviewStatus').textContent, 'Recorded sessions available · use agreed review dates');
  assert.equal(elements.get('launchReviewStep').dataset.state, 'available');
  render(7);
  assert.equal(elements.get('launchReviewStatus').textContent, 'Oldest loaded session is at least 7 days old · use agreed review dates');
  render(30);
  assert.equal(elements.get('pilotLaunchBadge').textContent, 'Earliest loaded session: 30 days ago · latest 50');
  assert.equal(elements.get('launchReviewStatus').textContent, 'Oldest loaded session is at least 30 days old · use agreed review dates');
  assert.equal(elements.get('launchReviewStep').dataset.state, 'available');
});

test('pilot checklist exposes the approved manager actions without creating new telemetry', () => {
  assert.match(dashboard, /30-day pilot checklist/);
  assert.match(dashboard, /Recorded sessions do not start a trial/);
  assert.match(dashboard, /href="\/fleet-onboarding\.html">Invite drivers/);
  assert.match(dashboard, /href="\/app\.html">Open driver app/);
  assert.match(dashboard, /href="\/fleet-display\.html">Open TV display/);
  assert.match(dashboard, /href="#pilotValueTitle">Review results/);
  assert.doesNotMatch(block, /localStorage|fetch\(|getFleetSummary|latitude|longitude|media|raw motion/i);
});
