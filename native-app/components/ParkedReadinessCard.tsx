import React, { useCallback, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { colors, radii } from '../constants/theme';
import {
  collectDeviceReadiness,
  describeDeviceReadiness,
} from '../lib/deviceReadiness';
import { deviceReadinessSources } from '../lib/deviceReadinessSources';
import { createReadinessSession, type ReadinessViewState } from '../lib/deviceReadinessSession';
import {
  runMultiCamStabilityTest,
  type MultiCamStabilityResult,
} from '../lib/deviceCondition';

function describeStabilityResult(result: MultiCamStabilityResult) {
  const seconds = (result.elapsedMs / 1_000).toFixed(1);
  const measurements = `${result.frontFrames} driver frames and ${result.roadFrames} road frames in ${seconds}s. Peak camera pressure ${result.maxPressureLevel}; phone heat ${result.thermalState}.`;
  switch (result.state) {
  case 'passed':
    return { status: 'Live streams passed', detail: measurements, attention: false };
  case 'driverOnlyFallback':
    return { status: 'Driver camera protected', detail: `Occulert disabled or withheld the road stream while preserving driver frames. ${measurements}`, attention: true };
  case 'driverStreamFailed':
    return { status: 'Driver stream failed', detail: `The protected driver stream produced no frames. Road monitoring remains disabled. ${measurements}`, attention: true };
  case 'overBudget':
    return { status: 'Test blocked', detail: 'Apple’s resource budget was exceeded before live capture. Road monitoring remains disabled.', attention: true };
  case 'permissionRequired':
    return { status: 'Camera access needed', detail: 'Grant camera access before running the parked stability test.', attention: true };
  case 'unsupported':
    return { status: 'Not supported', detail: 'This phone does not expose a supported front-and-rear camera pair.', attention: true };
  default:
    return { status: 'Test could not finish', detail: 'Both camera streams were stopped. Close other camera apps and try again while parked.', attention: true };
  }
}

export function ParkedReadinessCard() {
  const router = useRouter();
  const [{ snapshot, busy, now }, setState] = useState<ReadinessViewState>(() => ({ snapshot: null, busy: false, now: Date.now() }));
  const [stabilityBusy, setStabilityBusy] = useState(false);
  const [stabilityResult, setStabilityResult] = useState<MultiCamStabilityResult | null>(null);
  const refreshRef = useRef<() => void>(() => {});
  const mountedRef = useRef(true);
  const stabilityRequestRef = useRef(0);
  const stabilityPendingRef = useRef(false);

  useFocusEffect(useCallback(() => {
    mountedRef.current = true;
    stabilityRequestRef.current += 1;
    stabilityPendingRef.current = false;
    setStabilityBusy(false);
    setStabilityResult(null);
    const session = createReadinessSession(() => collectDeviceReadiness(deviceReadinessSources), setState);
    const refresh = () => {
      if (AppState.currentState === 'active') void session.refresh();
    };
    refreshRef.current = refresh;
    refresh();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
      else {
        stabilityRequestRef.current += 1;
        stabilityPendingRef.current = false;
        setStabilityBusy(false);
        setStabilityResult(null);
        session.invalidate();
      }
    });
    return () => {
      mountedRef.current = false;
      stabilityRequestRef.current += 1;
      stabilityPendingRef.current = false;
      session.dispose();
      subscription.remove();
      refreshRef.current = () => {};
    };
  }, []));

  const rows = snapshot ? describeDeviceReadiness(snapshot, now) : [];
  const stabilityEligible = snapshot?.camera?.multiCamProbe.state === 'withinBudget';
  const stabilityDescription = stabilityResult ? describeStabilityResult(stabilityResult) : null;
  const controlsBusy = busy || stabilityBusy;
  const runStabilityTest = async () => {
    if (!mountedRef.current || !stabilityEligible || stabilityPendingRef.current || AppState.currentState !== 'active') return;
    const request = ++stabilityRequestRef.current;
    stabilityPendingRef.current = true;
    setStabilityResult(null);
    setStabilityBusy(true);
    try {
      const result = await runMultiCamStabilityTest();
      if (!mountedRef.current || request !== stabilityRequestRef.current) return;
      setStabilityResult(result);
      refreshRef.current();
    } finally {
      if (mountedRef.current && request === stabilityRequestRef.current) {
        stabilityPendingRef.current = false;
        setStabilityBusy(false);
      }
    }
  };
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Your devices before this drive</Text>
      <Text style={styles.description}>Check while parked. Optional accessories are not required for camera monitoring.</Text>
      <View accessibilityLiveRegion="polite">
        {busy ? <Text style={styles.description}>Checking saved settings and connections…</Text> : null}
        {!busy && !snapshot ? <Text style={styles.description}>Refresh while parked to check your devices.</Text> : null}
        {rows.map(row => (
          <View key={row.id} style={styles.row}>
            <Text style={styles.rowTitle}>{row.title}</Text>
            <Text style={[styles.status, row.attention && styles.attention]}>{row.status}</Text>
            <Text style={styles.detail}>{row.detail}</Text>
          </View>
        ))}
        {snapshot ? <Text style={styles.note}>Snapshot only; refresh if you change devices or settings.</Text> : null}
      </View>
      {stabilityEligible ? (
        <View style={styles.row} accessibilityLiveRegion="polite">
          <Text style={styles.rowTitle}>Live dual-camera test · parked</Text>
          <Text style={styles.detail}>Runs both cameras for five seconds, counts frames, then stops. No images or video are saved.</Text>
          {stabilityBusy ? <Text style={styles.status}>Testing both camera streams…</Text> : null}
          {stabilityDescription ? (
            <>
              <Text style={[styles.status, stabilityDescription.attention && styles.attention]}>{stabilityDescription.status}</Text>
              <Text style={styles.detail}>{stabilityDescription.detail}</Text>
            </>
          ) : null}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={stabilityBusy ? 'Testing both camera streams' : 'Run parked dual-camera test'}
            accessibilityHint="Starts both cameras for five seconds and stops automatically"
            accessibilityState={{ disabled: controlsBusy, busy: stabilityBusy }}
            disabled={controlsBusy}
            onPress={() => { void runStabilityTest(); }}
            style={[styles.testButton, controlsBusy && styles.disabled]}
          >
            <Text style={styles.buttonText}>{stabilityBusy ? 'Testing for 5 seconds…' : 'Run parked camera test'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={busy ? 'Checking connected devices' : 'Refresh connected device check'}
        accessibilityHint="Checks saved settings and current optional device connections while parked"
        accessibilityState={{ disabled: controlsBusy, busy }}
        disabled={controlsBusy}
        onPress={() => refreshRef.current()}
        style={[styles.button, controlsBusy && styles.disabled]}
      >
        <Text style={styles.buttonText}>{busy ? 'Checking…' : 'Refresh device check'}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Open settings and alert tests"
        accessibilityHint="Opens alert settings and parked audio and Watch tests"
        onPress={() => router.push('/settings')}
        style={styles.secondaryButton}
      >
        <Text style={styles.secondaryText}>Open settings and alert tests</Text>
      </TouchableOpacity>
      <Text style={styles.note}>This does not test fatigue or confirm that it is safe to drive. Cameras start only if you run the parked live test.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.material, borderColor: colors.glassBorder, borderWidth: 1, borderRadius: radii.large, padding: 18, marginBottom: 16 },
  title: { color: colors.text, fontSize: 18, fontWeight: '800' },
  description: { color: colors.textSecondary, fontSize: 13, lineHeight: 20, marginTop: 8 },
  row: { borderTopWidth: 1, borderTopColor: colors.glassBorder, marginTop: 14, paddingTop: 12 },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  status: { color: colors.cyan, fontSize: 13, fontWeight: '700', marginTop: 5 },
  attention: { color: colors.amber },
  detail: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 4 },
  note: { color: colors.textSecondary, fontSize: 11, lineHeight: 17, marginTop: 12 },
  button: { backgroundColor: colors.blueStrong, borderRadius: radii.small, minHeight: 48, justifyContent: 'center', alignItems: 'center', padding: 12, marginTop: 16 },
  disabled: { opacity: 0.6 },
  buttonText: { color: colors.text, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  testButton: { backgroundColor: colors.blueStrong, borderRadius: radii.small, minHeight: 48, justifyContent: 'center', alignItems: 'center', padding: 12, marginTop: 12 },
  secondaryButton: { minHeight: 48, padding: 12, justifyContent: 'center', alignItems: 'center', marginTop: 4 },
  secondaryText: { color: colors.cyan, fontSize: 13, fontWeight: '700', textAlign: 'center' },
});
