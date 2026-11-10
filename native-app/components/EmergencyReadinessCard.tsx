import React, { useCallback, useRef, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { colors, radii } from '../constants/theme';
import { EMERGENCY_READINESS_COPY, EMERGENCY_READINESS_GUIDES, type EmergencyReadinessGuide } from '../lib/emergencyReadiness';

/** Apple reference links for preparation screens; no device-setting access. */
export function EmergencyReadinessCard() {
  const [expanded, setExpanded] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [failedGuide, setFailedGuide] = useState<EmergencyReadinessGuide | null>(null);
  const focusedRef = useRef(false);
  const revisionRef = useRef(0);
  const pendingRef = useRef(false);

  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    revisionRef.current += 1;
    pendingRef.current = false;
    setExpanded(false);
    setOpening(null);
    setFailedGuide(null);
    return () => {
      focusedRef.current = false;
      revisionRef.current += 1;
      pendingRef.current = false;
    };
  }, []));

  const openGuide = async (guide: EmergencyReadinessGuide) => {
    if (!focusedRef.current || AppState.currentState !== 'active' || pendingRef.current) return;
    const revision = revisionRef.current;
    const owned = () => focusedRef.current && revisionRef.current === revision;
    pendingRef.current = true;
    setOpening(guide.id);
    setFailedGuide(null);
    try {
      await Linking.openURL(guide.url);
    } catch {
      if (owned() && AppState.currentState === 'active') setFailedGuide(guide);
    } finally {
      // Clear owned UI state even when the browser has backgrounded Occulert.
      if (owned()) {
        pendingRef.current = false;
        setOpening(null);
      }
    }
  };

  if (Platform.OS !== 'ios') return null;
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.title}>{EMERGENCY_READINESS_COPY.title}</Text>
      <Text style={styles.copy}>{EMERGENCY_READINESS_COPY.parked}</Text>
      <Text style={styles.limit}>{EMERGENCY_READINESS_COPY.limits}</Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Hide Apple setup guides' : 'Review Apple setup guides'}
        accessibilityHint={expanded ? 'Collapses the optional Apple setup guides' : 'Expands optional guidance to review while safely parked'}
        accessibilityState={{ expanded, disabled: opening !== null }}
        disabled={opening !== null}
        style={styles.disclosure}
        onPress={() => {
          if (!focusedRef.current || AppState.currentState !== 'active' || pendingRef.current) return;
          setExpanded(value => !value);
          setFailedGuide(null);
        }}
      >
        <Text style={styles.linkTitle}>{expanded ? 'Hide Apple setup guides' : 'Review Apple setup guides'}</Text>
      </TouchableOpacity>
      {expanded && (
        <View>
          <Text style={styles.copy}>{EMERGENCY_READINESS_COPY.availability}</Text>
          <Text style={styles.copy}>{EMERGENCY_READINESS_COPY.privacy}</Text>
          {EMERGENCY_READINESS_GUIDES.map(guide => (
            <TouchableOpacity
              key={guide.id}
              accessibilityRole="link"
              accessibilityLabel={`Open Apple guide: ${guide.title}. ${guide.detail}`}
              accessibilityHint="Opens official Apple guidance in your browser. Review only while safely parked."
              accessibilityState={{ disabled: opening !== null, busy: opening === guide.id }}
              disabled={opening !== null}
              activeOpacity={0.8}
              style={[styles.guide, opening !== null && styles.disabled]}
              onPress={() => { void openGuide(guide); }}
            >
              <Text style={styles.linkTitle}>{guide.title}</Text>
              <Text style={styles.copy}>{guide.detail}</Text>
              <Text style={styles.linkNote}>{opening === guide.id ? 'Opening Apple guide…' : 'Open Apple guide ↗'}</Text>
            </TouchableOpacity>
          ))}
          {failedGuide && (
            <View accessibilityLiveRegion="polite" style={styles.failure}>
              <Text style={styles.copy}>Could not open Apple's guide. Copy this address into your browser while parked:</Text>
              <Text selectable style={styles.fallbackUrl}>{failedGuide.url}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, marginBottom: 20, borderRadius: radii.medium, backgroundColor: colors.material, borderWidth: 1, borderColor: colors.glassBorder },
  title: { color: colors.text, fontSize: 18, lineHeight: 25, fontWeight: '700', marginBottom: 8 },
  copy: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, flexShrink: 1, marginBottom: 8 },
  limit: { color: colors.amber, fontSize: 13, lineHeight: 20 },
  disclosure: { minHeight: 48, justifyContent: 'center', paddingVertical: 12 },
  guide: { minHeight: 48, paddingVertical: 14, borderTopWidth: 1, borderColor: colors.glassBorder },
  linkTitle: { color: colors.cyan, fontSize: 15, lineHeight: 22, fontWeight: '600', flexShrink: 1 },
  linkNote: { color: colors.blue, fontSize: 13, lineHeight: 20 },
  disabled: { opacity: 0.65 },
  failure: { paddingTop: 12 },
  fallbackUrl: { color: colors.cyan, fontSize: 13, lineHeight: 20, flexShrink: 1 },
});
