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

export function ParkedReadinessCard() {
  const router = useRouter();
  const [{ snapshot, busy, now }, setState] = useState<ReadinessViewState>(() => ({ snapshot: null, busy: false, now: Date.now() }));
  const refreshRef = useRef<() => void>(() => {});

  useFocusEffect(useCallback(() => {
    const session = createReadinessSession(() => collectDeviceReadiness(deviceReadinessSources), setState);
    const refresh = () => {
      if (AppState.currentState === 'active') void session.refresh();
    };
    refreshRef.current = refresh;
    refresh();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
      else session.invalidate();
    });
    return () => {
      session.dispose();
      subscription.remove();
      refreshRef.current = () => {};
    };
  }, []));

  const rows = snapshot ? describeDeviceReadiness(snapshot, now) : [];
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
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ disabled: busy, busy }}
        disabled={busy}
        onPress={() => refreshRef.current()}
        style={[styles.button, busy && styles.disabled]}
      >
        <Text style={styles.buttonText}>{busy ? 'Checking…' : 'Refresh device check'}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityHint="Opens alert settings and parked audio and Watch tests"
        onPress={() => router.push('/settings')}
        style={styles.secondaryButton}
      >
        <Text style={styles.secondaryText}>Open settings and alert tests</Text>
      </TouchableOpacity>
      <Text style={styles.note}>This does not test fatigue or confirm that it is safe to drive. No sensors or alert tests start from this check.</Text>
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
  secondaryButton: { minHeight: 48, padding: 12, justifyContent: 'center', alignItems: 'center', marginTop: 4 },
  secondaryText: { color: colors.cyan, fontSize: 13, fontWeight: '700', textAlign: 'center' },
});
