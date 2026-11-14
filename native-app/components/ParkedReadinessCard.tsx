import { strings, formatString } from '../lib/strings.ts';
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
  const measurements = formatString(strings.preDrive.readiness.stability.measurements, { driverFrames: String(result.frontFrames), roadFrames: String(result.roadFrames), seconds, pressure: String(result.maxPressureLevel), thermalState: String(result.thermalState) });
  switch (result.state) {
  case 'passed':
    return { status: strings.preDrive.readiness.stability.passedStatus, detail: measurements, attention: false };
  case 'driverOnlyFallback':
    return { status: strings.preDrive.readiness.stability.driverProtectedStatus, detail: formatString(strings.preDrive.readiness.stability.driverProtectedDetail, { measurements }), attention: true };
  case 'driverStreamFailed':
    return { status: strings.preDrive.readiness.stability.driverFailedStatus, detail: formatString(strings.preDrive.readiness.stability.driverFailedDetail, { measurements }), attention: true };
  case 'overBudget':
    return { status: strings.preDrive.readiness.stability.blockedStatus, detail: strings.preDrive.readiness.stability.blockedDetail, attention: true };
  case 'permissionRequired':
    return { status: strings.preDrive.readiness.stability.accessNeededStatus, detail: strings.preDrive.readiness.stability.accessNeededDetail, attention: true };
  case 'unsupported':
    return { status: strings.preDrive.readiness.stability.unsupportedStatus, detail: strings.preDrive.readiness.stability.unsupportedDetail, attention: true };
  default:
    return { status: strings.preDrive.readiness.stability.errorStatus, detail: strings.preDrive.readiness.stability.errorDetail, attention: true };
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
      <Text style={styles.title}>{strings.preDrive.readiness.title}</Text>
      <Text style={styles.description}>{strings.preDrive.readiness.detail}</Text>
      <View accessibilityLiveRegion="polite">
        {busy ? <Text style={styles.description}>{strings.preDrive.readiness.checking}</Text> : null}
        {!busy && !snapshot ? <Text style={styles.description}>{strings.preDrive.readiness.empty}</Text> : null}
        {rows.map(row => (
          <View key={row.id} style={styles.row}>
            <Text style={styles.rowTitle}>{row.title}</Text>
            <Text style={[styles.status, row.attention && styles.attention]}>{row.status}</Text>
            <Text style={styles.detail}>{row.detail}</Text>
          </View>
        ))}
        {snapshot ? <Text style={styles.note}>{strings.preDrive.readiness.snapshotLimit}</Text> : null}
      </View>
      {stabilityEligible ? (
        <View style={styles.row} accessibilityLiveRegion="polite">
          <Text style={styles.rowTitle}>{strings.preDrive.readiness.stability.title}</Text>
          <Text style={styles.detail}>{strings.preDrive.readiness.stability.detail}</Text>
          {stabilityBusy ? <Text style={styles.status}>{strings.preDrive.readiness.stability.testing}</Text> : null}
          {stabilityDescription ? (
            <>
              <Text style={[styles.status, stabilityDescription.attention && styles.attention]}>{stabilityDescription.status}</Text>
              <Text style={styles.detail}>{stabilityDescription.detail}</Text>
            </>
          ) : null}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={stabilityBusy ? strings.preDrive.readiness.stability.busyAccessibility : strings.preDrive.readiness.stability.accessibility}
            accessibilityHint={strings.preDrive.readiness.stability.hint}
            accessibilityState={{ disabled: controlsBusy, busy: stabilityBusy }}
            disabled={controlsBusy}
            onPress={() => { void runStabilityTest(); }}
            style={[styles.testButton, controlsBusy && styles.disabled]}
          >
            <Text style={styles.buttonText}>{stabilityBusy ? strings.preDrive.readiness.stability.busyAction : strings.preDrive.readiness.stability.action}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={busy ? strings.preDrive.readiness.refreshBusyAccessibility : strings.preDrive.readiness.refreshAccessibility}
        accessibilityHint={strings.preDrive.readiness.refreshHint}
        accessibilityState={{ disabled: controlsBusy, busy }}
        disabled={controlsBusy}
        onPress={() => refreshRef.current()}
        style={[styles.button, controlsBusy && styles.disabled]}
      >
        <Text style={styles.buttonText}>{busy ? strings.preDrive.readiness.refreshBusy : strings.preDrive.readiness.refreshAction}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={strings.preDrive.readiness.alertCheckAccessibility}
        accessibilityHint={strings.preDrive.readiness.alertCheckHint}
        onPress={() => router.push('/settings')}
        style={styles.secondaryButton}
      >
        <Text style={styles.secondaryText}>{strings.preDrive.readiness.alertCheckAction}</Text>
      </TouchableOpacity>
      <Text style={styles.note}>{strings.preDrive.readiness.alertCheckLimits}</Text>
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
