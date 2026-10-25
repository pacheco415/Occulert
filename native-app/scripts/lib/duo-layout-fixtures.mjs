import { readFileSync } from 'node:fs';

export const duoProfile = JSON.parse(readFileSync(new URL('../fixtures/iphone-duo-xcode27.1.json', import.meta.url), 'utf8'));
const points = name => {
  const display = duoProfile.displays.find(display => display.deviceName === name);
  return { width: display.width / display.scale, height: display.height / display.scale, scale: display.scale };
};
const outer = points('primary');
const inner = points('primary-1');
const portraitInsets = { top: 62, bottom: 34, left: 0, right: 0 };
const landscapeInsets = { top: 0, bottom: 21, left: 62, right: 62 };

// Display pixels AND backing scale are copied from Xcode's device profile.
// Insets are explicit stress inputs, not measured Duo safe areas. Split widths
// model equal allocation before a system divider; narrower stress cases below
// cover additional space loss without claiming a live Split View measurement.
export const duoWindows = [
  { name: 'outer portrait', window: outer, safeArea: portraitInsets },
  { name: 'outer landscape', window: { ...outer, width: outer.height, height: outer.width }, safeArea: landscapeInsets },
  { name: 'inner portrait', window: inner, safeArea: portraitInsets },
  { name: 'inner landscape', window: { ...inner, width: inner.height, height: inner.width }, safeArea: landscapeInsets },
  { name: 'inner portrait 50/50 Split View allocation', window: { ...inner, width: inner.width / 2 }, safeArea: portraitInsets },
  { name: 'inner landscape 50/50 Split View allocation', window: { ...inner, width: inner.height / 2, height: inner.width }, safeArea: portraitInsets },
  { name: 'narrow split stress (not a device measurement)', window: { width: 313, height: inner.width, scale: inner.scale }, safeArea: portraitInsets },
  { name: 'wide split stress (not a device measurement)', window: { width: 445, height: inner.width, scale: inner.scale }, safeArea: portraitInsets },
];
