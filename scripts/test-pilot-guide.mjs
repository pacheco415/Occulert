import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const guide = read('pilot-guide.html');
const dashboard = read('fleet-dashboard.html');
const hub = read('product-hub.html');

test('pilot guide provides distinct manager and driver launch paths', () => {
  assert.match(guide, /id="manager-start"/);
  assert.match(guide, /id="driver-start"/);
  assert.match(guide, /Create the protected fleet/);
  assert.match(guide, /Invite up to five drivers/);
  assert.match(guide, /Review at 7 and 30 days/);
  assert.match(guide, /Set up only while parked/);
  assert.match(guide, /Respond to an alert by stopping safely/);
});

test('pilot guide preserves privacy and safety boundaries without tracking progress', () => {
  assert.match(guide, /Keep Occulert open and visible/);
  assert.match(guide, /An alert never makes it safe to continue driving/);
  assert.match(guide, /GPS coordinates and personal media/);
  assert.match(guide, /Raw camera and motion timelines/);
  assert.match(guide, /not a medical device, emergency service, or sole basis/i);
  assert.doesNotMatch(guide, /localStorage|sessionStorage|fetch\(|latitude|longitude/i);
});

test('pilot quick start is discoverable from manager surfaces', () => {
  assert.match(dashboard, /href="\/pilot-guide\.html">Pilot quick start/);
  assert.match(hub, /href="\/pilot-guide\.html"/);
  assert.match(guide, /href="\/fleet-dashboard\.html"/);
  assert.match(guide, /href="\/fleet-onboarding\.html"/);
  assert.match(guide, /href="\/app\.html"/);
});
