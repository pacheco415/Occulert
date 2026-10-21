import assert from 'node:assert/strict';
import test from 'node:test';
import { createMonitorLayoutFixture, flattenStyle } from './lib/monitor-layout-test-harness.mjs';

test('monitor controls remain outside scrolling details through preparation, monitoring and recovery', async () => {
  const f = createMonitorLayoutFixture();
  await f.mount();
  try {
    const assertSeparateControls = () => {
      const primary = f.host('monitor-primary-action');
      const scroll = f.host('monitor-details');
      assert.equal(scroll.type, 'ScrollView');
      assert.equal(primary.findAll(node => node === scroll).length, 0);
      assert.equal(scroll.findAll(node => node === primary).length, 0);
      assert.ok(scroll.findByProps({ testID: 'fixture-detail' }));
    };
    assertSeparateControls();
    await f.pressPrimary();
    assert.equal(f.events.starts, 1);
    await f.update({ preparing: true, detail: 'Preparing sensors. Not monitoring.' });
    assertSeparateControls();
    assert.equal(f.host('monitor-primary-action').findByType('TouchableOpacity').props.disabled, true);
    await f.update({ preparing: false, running: true, detail: 'Tracking · elapsed 00:01' });
    assertSeparateControls();
    await f.pressPrimary();
    assert.equal(f.events.stops, 1);
    await f.update({ running: false, attentionKey: 'camera-stopped', detail: 'Camera stopped. Return home to recover.' });
    assertSeparateControls();
    assert.match(f.host('monitor-details').findByType('Text').children.join(''), /Return home to recover/);
  } finally { await f.unmount(); }
});

test('window and large-text adaptations preserve the mounted camera instance', async () => {
  const f = createMonitorLayoutFixture();
  await f.mount();
  try {
    const camera = f.cameraIdentity;
    assert.equal(flattenStyle(f.host('monitor-body').props.style).flexDirection ?? 'column', 'column');
    await f.update({ window: { width: 844, height: 390 } });
    assert.equal(flattenStyle(f.host('monitor-body').props.style).flexDirection, 'row');
    await f.update({ window: { fontScale: 2 } });
    assert.equal(flattenStyle(f.host('monitor-body').props.style).flexDirection ?? 'column', 'column');
    await f.update({ window: { width: 320, height: 568, fontScale: 1 } });
    assert.equal(flattenStyle(f.host('monitor-body').props.style).flexDirection ?? 'column', 'column');
    assert.strictEqual(f.cameraIdentity, camera);
    assert.equal(f.events.cameraMounts, 1);
    assert.equal(f.events.cameraUnmounts, 0);
    assert.equal(f.host('monitor-camera-pane').findAllByType('CameraFixture').length, 1);
  } finally { await f.unmount(); }
  assert.equal(f.events.cameraUnmounts, 1);
});

test('new attention brings guidance into view without resetting ordinary detail updates', async () => {
  const f = createMonitorLayoutFixture();
  await f.mount();
  try {
    const initialScrolls = f.scrolls.length;
    await f.update({ running: true, detail: 'Tracking · elapsed 00:01' });
    await f.update({ detail: 'Tracking · elapsed 00:02' });
    assert.equal(f.scrolls.length, initialScrolls);
    await f.update({ attentionKey: 'camera-disconnected', detail: 'Camera stopped. Alerts unavailable.' });
    assert.deepEqual(f.scrolls.at(-1), { y: 0, animated: true });
    const attentionScrolls = f.scrolls.length;
    await f.update({ detail: 'Camera stopped. Recovery guidance stays readable.' });
    assert.equal(f.scrolls.length, attentionScrolls);
    await f.update({ attentionKey: 'recovery-required', reduceMotion: true });
    assert.deepEqual(f.scrolls.at(-1), { y: 0, animated: false });
  } finally { await f.unmount(); }
});

test('all safe-area edges follow changing device insets', async () => {
  const f = createMonitorLayoutFixture();
  await f.mount();
  try {
    const initial = flattenStyle(f.host('monitor-layout').props.style);
    assert.ok(initial.paddingTop >= 47);
    assert.ok(initial.paddingBottom >= 34);
    await f.update({ window: { width: 844, height: 390 }, safeArea: { top: 0, bottom: 21, left: 47, right: 47 } });
    const rotated = flattenStyle(f.host('monitor-layout').props.style);
    assert.ok(rotated.paddingLeft >= 47);
    assert.ok(rotated.paddingRight >= 47);
    assert.ok(rotated.paddingBottom >= 21);
  } finally { await f.unmount(); }
});

test('short windows and large text reserve more space for controls and scrolling guidance', async () => {
  const f = createMonitorLayoutFixture();
  await f.mount();
  try {
    const ordinaryCameraFlex = flattenStyle(f.host('monitor-camera-pane').props.style).flex;
    assert.ok(ordinaryCameraFlex > 0);
    await f.update({ window: { width: 320, height: 568 } });
    const compactCameraFlex = flattenStyle(f.host('monitor-camera-pane').props.style).flex;
    assert.ok(compactCameraFlex > 0 && compactCameraFlex < ordinaryCameraFlex);
    await f.update({ window: { width: 390, height: 844, fontScale: 2 } });
    const largeTextCameraFlex = flattenStyle(f.host('monitor-camera-pane').props.style).flex;
    assert.ok(largeTextCameraFlex > 0 && largeTextCameraFlex < ordinaryCameraFlex);
    assert.equal(flattenStyle(f.host('monitor-primary-action').props.style).flexShrink, 0);
    const detailsStyle = flattenStyle(f.host('monitor-details').props.style);
    assert.ok(detailsStyle.flex > 0);
    assert.equal(detailsStyle.minHeight, 0);
  } finally { await f.unmount(); }
});
