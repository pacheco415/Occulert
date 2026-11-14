import { strings, formatString } from '../lib/strings.ts';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  clearStoredHealthReadiness,
  isAppleHealthAvailable,
  loadStoredHealthReadiness,
  refreshAppleHealthReadiness,
} from '../lib/appleHealth';
import type { HealthReadinessSnapshot } from '../lib/healthReadiness';
import { confirmPreDriveSafety } from '../lib/preDriveGate';
import { AmbientBackground, GlassSurface } from '../components/GlassSurface';
import { colors, radii } from '../constants/theme';
import { ParkedReadinessCard } from '../components/ParkedReadinessCard';

const CHECKS = [
  {
    title: strings.preDrive.confirmations.parked.title,
    detail: strings.preDrive.confirmations.parked.detail,
  },
  {
    title: strings.preDrive.confirmations.limits.title,
    detail: strings.preDrive.confirmations.limits.detail,
  },
  {
    title: strings.preDrive.confirmations.foreground.title,
    detail: strings.preDrive.confirmations.foreground.detail,
  },
  {
    title: strings.preDrive.confirmations.rest.title,
    detail: strings.preDrive.confirmations.rest.detail,
  },
] as const;

function formatSleep(minutes: number | null): string {
  if (minutes === null) return strings.preDrive.health.noRecentSample;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0 ? formatString(strings.preDrive.health.sleepHoursMinutes, { hours: String(hours), minutes: String(remainder) }) : formatString(strings.preDrive.health.sleepMinutes, { minutes: String(remainder) });
}

function formatUpdated(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return strings.preDrive.health.unknownUpdated;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function PreDriveScreen() {
  const router = useRouter();
  const [checked, setChecked] = useState<boolean[]>(() => CHECKS.map(() => false));
  const [healthAvailable, setHealthAvailable] = useState<boolean | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthNotice, setHealthNotice] = useState<string | null>(null);
  const [healthSnapshot, setHealthSnapshot] = useState<HealthReadinessSnapshot | null>(null);
  const healthRequestRef = useRef(0);
  const healthMountedRef = useRef(true);
  const ready = useMemo(() => checked.every(Boolean), [checked]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let active = true;
    healthMountedRef.current = true;
    const request = healthRequestRef.current;
    Promise.all([loadStoredHealthReadiness(), isAppleHealthAvailable()])
      .then(([stored, available]) => {
        if (!active || request !== healthRequestRef.current) return;
        setHealthSnapshot(stored);
        setHealthAvailable(available);
      });
    return () => {
      active = false;
      healthMountedRef.current = false;
      healthRequestRef.current += 1;
    };
  }, []);

  const toggle = (index: number) => {
    setChecked(current => current.map((value, itemIndex) => (
      itemIndex === index ? !value : value
    )));
  };

  const refreshHealth = async () => {
    const request = ++healthRequestRef.current;
    setHealthLoading(true);
    setHealthNotice(null);
    try {
      const result = await refreshAppleHealthReadiness();
      if (!healthMountedRef.current || request !== healthRequestRef.current) return;
      setHealthSnapshot(result.snapshot);
      setHealthNotice(result.status === 'no_data'
        ? strings.preDrive.health.noDataNotice
        : strings.preDrive.health.updatedNotice);
    } catch {
      if (!healthMountedRef.current || request !== healthRequestRef.current) return;
      setHealthNotice(strings.preDrive.health.readError);
    } finally {
      if (healthMountedRef.current && request === healthRequestRef.current) setHealthLoading(false);
    }
  };

  const removeHealthSummary = async () => {
    const request = ++healthRequestRef.current;
    try {
      await clearStoredHealthReadiness();
      if (!healthMountedRef.current || request !== healthRequestRef.current) return;
      setHealthSnapshot(null);
      setHealthNotice(strings.preDrive.health.removedNotice);
    } catch {
      if (!healthMountedRef.current || request !== healthRequestRef.current) return;
      setHealthNotice(strings.preDrive.health.removeError);
    } finally {
      if (healthMountedRef.current && request === healthRequestRef.current) setHealthLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <AmbientBackground />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <GlassSurface style={styles.iconWrap} tintColor="rgba(251, 191, 36, 0.18)">
            <Ionicons name="shield-checkmark" size={34} color="#fbbf24" />
          </GlassSurface>
          <Text style={styles.title}>{strings.preDrive.screen.title}</Text>
          <Text style={styles.subtitle}>{strings.preDrive.screen.subtitle}</Text>
        </View>

        <View style={styles.warning} accessibilityRole="alert">
          <Ionicons name="warning" size={20} color="#fbbf24" />
          <Text style={styles.warningText}>{strings.preDrive.screen.warning}</Text>
        </View>

        <ParkedReadinessCard />

        {Platform.OS === 'ios' && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={strings.preDrive.emergency.accessibility}
            accessibilityHint={strings.preDrive.emergency.hint}
            style={styles.emergencyGuidanceLink}
            onPress={() => router.push('/settings')}
          >
            <Text style={styles.emergencyGuidanceTitle}>{strings.preDrive.emergency.title}</Text>
            <Text style={styles.emergencyGuidanceDetail}>{strings.preDrive.emergency.detail}</Text>
          </TouchableOpacity>
        )}

        {Platform.OS === 'ios' && (
          <View style={styles.healthCard}>
            <View style={styles.healthHeading}>
              <View style={styles.healthIcon}>
                <Ionicons name="heart" size={18} color="#fb7185" />
              </View>
              <View style={styles.healthHeadingCopy}>
                <Text style={styles.healthEyebrow}>{strings.preDrive.health.eyebrow}</Text>
                <Text style={styles.healthTitle}>{strings.preDrive.health.title}</Text>
              </View>
            </View>

            <Text style={styles.healthDescription}>{strings.preDrive.health.description}</Text>

            {healthSnapshot && (
              <View style={styles.healthMetrics}>
                <View style={styles.healthMetric}>
                  <Text style={styles.healthMetricLabel}>{strings.preDrive.health.sleepLabel}</Text>
                  <Text style={styles.healthMetricValue}>{formatSleep(healthSnapshot.sleepMinutes24h)}</Text>
                </View>
                <View style={styles.healthMetric}>
                  <Text style={styles.healthMetricLabel}>{strings.preDrive.health.hrvLabel}</Text>
                  <Text style={styles.healthMetricValue}>
                    {healthSnapshot.latestHrvMs === null ? strings.preDrive.health.noRecentSample : formatString(strings.preDrive.health.hrvMilliseconds, { milliseconds: String(healthSnapshot.latestHrvMs) })}
                  </Text>
                  {healthSnapshot.latestHrvAt && (
                    <Text style={styles.healthMetricTime}>{formatUpdated(healthSnapshot.latestHrvAt)}</Text>
                  )}
                </View>
              </View>
            )}

            {healthSnapshot && (
              <Text style={styles.healthUpdated}>{formatString(strings.preDrive.health.updated, { time: formatUpdated(healthSnapshot.capturedAt) })}</Text>
            )}

            {healthAvailable === false ? (
              <Text style={styles.healthNotice}>{strings.preDrive.health.unavailable}</Text>
            ) : (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={healthSnapshot ? strings.preDrive.health.refreshAccessibility : strings.preDrive.health.connectAccessibility}
                accessibilityHint={strings.preDrive.health.readHint}
                accessibilityState={{ disabled: healthAvailable !== true || healthLoading, busy: healthLoading }}
                disabled={healthAvailable !== true || healthLoading}
                activeOpacity={0.8}
                onPress={refreshHealth}
                style={[
                  styles.healthButton,
                  (healthAvailable !== true || healthLoading) && styles.healthButtonDisabled,
                ]}
              >
                {healthLoading
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Ionicons name="refresh" size={16} color="#fff" />}
                <Text style={styles.healthButtonText}>
                  {healthSnapshot ? strings.preDrive.health.refreshAction : strings.preDrive.health.connectAction}
                </Text>
              </TouchableOpacity>
            )}

            {healthNotice && <Text accessibilityLiveRegion="polite" style={styles.healthNotice}>{healthNotice}</Text>}
            {healthSnapshot && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={strings.preDrive.health.removeAccessibility}
                accessibilityHint={strings.preDrive.health.removeHint}
                activeOpacity={0.75}
                onPress={removeHealthSummary}
                style={styles.healthRemoveButton}
              >
                <Text style={styles.healthRemoveText}>{strings.preDrive.health.removeAction}</Text>
              </TouchableOpacity>
            )}
            <Text style={styles.healthLimit}>{strings.preDrive.health.limits}</Text>
          </View>
        )}

        <View style={styles.confirmationHeader}>
          <View style={styles.confirmationCopy}>
            <Text style={styles.confirmationEyebrow}>{strings.preDrive.confirmations.eyebrow}</Text>
            <Text style={styles.confirmationTitle}>{strings.preDrive.confirmations.title}</Text>
          </View>
          <Text accessibilityLiveRegion="polite" style={styles.confirmationCount}>
            {formatString(strings.preDrive.confirmations.progress, { checked: checked.filter(Boolean).length, total: CHECKS.length })}
          </Text>
        </View>

        <View style={styles.checkList}>
          {CHECKS.map((item, index) => (
            <TouchableOpacity
              key={item.title}
              accessibilityRole="checkbox"
              accessibilityLabel={item.title}
              accessibilityHint={item.detail}
              accessibilityState={{ checked: checked[index] }}
              activeOpacity={0.8}
              onPress={() => toggle(index)}
              style={[styles.checkCard, checked[index] && styles.checkCardSelected]}
            >
              <Ionicons
                name={checked[index] ? 'checkbox' : 'square-outline'}
                size={26}
                color={checked[index] ? '#00ff88' : '#64748b'}
              />
              <View style={styles.checkCopy}>
                <Text style={styles.checkTitle}>{item.title}</Text>
                <Text style={styles.checkDetail}>{item.detail}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <GlassSurface
          interactive={ready}
          style={[styles.continueSurface, !ready && styles.continueButtonDisabled]}
          tintColor="rgba(42, 105, 244, 0.58)"
        >
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={strings.preDrive.continueAction.accessibility}
            accessibilityHint={ready ? strings.preDrive.continueAction.readyHint : strings.preDrive.continueAction.incompleteHint}
            accessibilityState={{ disabled: !ready }}
            disabled={!ready}
            activeOpacity={0.85}
            onPress={() => {
              confirmPreDriveSafety();
              router.replace('/monitor');
            }}
            style={styles.continueButton}
          >
            <Ionicons name="eye" size={22} color="#fff" />
            <Text style={styles.continueText}>{strings.preDrive.continueAction.label}</Text>
          </TouchableOpacity>
        </GlassSurface>

        <TouchableOpacity
          accessibilityRole="link"
          accessibilityHint={strings.preDrive.safety.fullInformationHint}
          onPress={() => Linking.openURL('https://www.occulert.com/safety.html')}
          style={styles.safetyLink}
        >
          <Text style={styles.safetyLinkText}>{strings.preDrive.safety.fullInformation}</Text>
          <Ionicons name="open-outline" size={14} color="#60a5fa" />
        </TouchableOpacity>

        <Text style={styles.footer}>{strings.preDrive.safety.limit}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  emergencyGuidanceLink: { minHeight: 48, padding: 16, marginBottom: 20, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.glassBorder, backgroundColor: colors.material },
  emergencyGuidanceTitle: { color: colors.cyan, fontSize: 15, lineHeight: 22, fontWeight: '600' },
  emergencyGuidanceDetail: { color: colors.textSecondary, fontSize: 13, lineHeight: 20, marginTop: 4 },
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 40 },
  hero: { alignItems: 'center', paddingTop: 12, marginBottom: 22 },
  iconWrap: {
    width: 66,
    height: 66,
    borderRadius: radii.medium,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 14,
  },
  title: { color: colors.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.6, textAlign: 'center' },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 330,
  },
  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(251,191,36,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.3)',
    borderRadius: radii.medium,
    padding: 14,
    marginBottom: 16,
  },
  warningText: { flex: 1, color: '#fde68a', fontSize: 13, lineHeight: 19, fontWeight: '700' },
  confirmationHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 6,
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  confirmationCopy: { flex: 1 },
  confirmationEyebrow: { color: colors.cyan, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  confirmationTitle: { color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 3 },
  confirmationCount: { color: colors.textSecondary, fontSize: 13, fontWeight: '800' },
  healthCard: {
    backgroundColor: colors.material,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: radii.large,
    padding: 18,
    marginBottom: 16,
  },
  healthHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  healthIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: 'rgba(251,113,133,0.12)',
  },
  healthHeadingCopy: { flex: 1 },
  healthEyebrow: { color: '#fb7185', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  healthTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginTop: 2 },
  healthDescription: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 12 },
  healthMetrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  healthMetric: {
    flexGrow: 1,
    flexBasis: 130,
    borderRadius: 12,
    backgroundColor: colors.backgroundRaised,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    padding: 11,
  },
  healthMetricLabel: { color: colors.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  healthMetricValue: { color: colors.text, fontSize: 15, fontWeight: '900', marginTop: 5 },
  healthMetricTime: { color: colors.textMuted, fontSize: 9, marginTop: 4 },
  healthUpdated: { color: colors.textMuted, fontSize: 10, marginTop: 8 },
  healthButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#3979ee',
    borderRadius: radii.small,
    paddingVertical: 12,
    marginTop: 14,
  },
  healthButtonDisabled: { backgroundColor: '#26374a', opacity: 0.65 },
  healthButtonText: { color: '#fff', fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  healthNotice: { color: colors.textSecondary, fontSize: 11, lineHeight: 17, marginTop: 10 },
  healthRemoveButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingTop: 8 },
  healthRemoveText: { color: colors.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 0.45 },
  healthLimit: { color: colors.textMuted, fontSize: 10, lineHeight: 15, marginTop: 10 },
  checkList: { gap: 10 },
  checkCard: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: colors.material,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: radii.medium,
    padding: 15,
  },
  checkCardSelected: {
    backgroundColor: 'rgba(0,255,136,0.06)',
    borderColor: 'rgba(0,255,136,0.45)',
  },
  checkCopy: { flex: 1 },
  checkTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  checkDetail: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 4 },
  continueSurface: {
    borderRadius: radii.large,
    overflow: 'hidden',
    marginTop: 22,
  },
  continueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 19,
  },
  continueButtonDisabled: { opacity: 0.5 },
  continueText: { color: '#fff', fontSize: 15, fontWeight: '900', letterSpacing: 0.7 },
  safetyLink: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 18,
  },
  safetyLinkText: { color: '#60a5fa', fontSize: 13, fontWeight: '700' },
  footer: { color: colors.textMuted, fontSize: 11, lineHeight: 17, textAlign: 'center' },
});
