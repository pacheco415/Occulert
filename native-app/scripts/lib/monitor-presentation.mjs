import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../app/monitor.tsx', import.meta.url), 'utf8');
const stylesStart = source.lastIndexOf('const s = StyleSheet.create(');
assert.ok(stylesStart > 0, 'read the actual monitor presentation styles');
const context = { StyleSheet: { create: styles => styles } };
vm.runInNewContext(source.slice(stylesStart) + '\nglobalThis.styles=s;', context, { timeout: 1000 });
export const monitorStyles = context.styles;

/** Keep the real status, camera notice and alert order in the measured fixture. */
export function monitorGuidanceSource() {
  const layoutStart = source.indexOf('      <MonitorLayout');
  const openingEnd = source.indexOf('\n      >\n', layoutStart);
  const end = source.indexOf('\n        {EYE_BASELINE_EXPERIMENT', openingEnd);
  assert.ok(layoutStart > 0 && openingEnd > layoutStart && end > openingEnd);
  let guidance = source.slice(openingEnd + '\n      >\n'.length, end);
  assert.ok(guidance.includes('style={s.pill}') && guidance.includes('INNER_CAMERA_MONITOR_MESSAGE'));
  assert.equal((guidance.match(/\n          inline\n/g) ?? []).length, 1, 'the current screen uses an inline alert');
  // The production screen remains inline. This single fixture parameter also
  // exercises the same mounted AlertSystem's optional floating presentation.
  guidance = guidance.replace('\n          inline\n', '\n          inline={alertProps.inline}\n');
  return `export function MonitorGuidance({alertProps}) {
    const {metrics,isRunning,sessionStartedAt,sessionEndedAt}=alertProps;
    const recordAlertTiming=alertProps.onTimingEvent,setVisibleAlertLevel=alertProps.onLevelChange;
    const monitorStatusLabel=isRunning?'DROWSINESS ALERT':'NOT MONITORING',monitorStatusColor='#ff3344';
    const frontCameraIdentity={streamingType:'inner'},setupPreviewActive=false,sensorFault=null,recoveryRequired=false;
    return <>${guidance}</>;
  }`;
}
