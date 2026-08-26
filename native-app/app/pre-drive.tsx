import React, { useEffect, useMemo, useState } from 'react';
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

const CHECKS = [
  {
    title: 'I am safely parked',
    detail: 'I will mount and position the phone before the vehicle moves.',
  },
  {
    title: 'I understand the limits',
    detail: 'Occulert is a supplemental prototype. It can miss drowsiness or issue false alerts and is not a certified safety, medical, emergency, or compliance device.',
  },
  {
    title: 'I will not touch the app while driving',
    detail: 'I will keep the screen on and Occulert in the foreground, and will only make changes after pulling over safely.',
  },
  {
    title: 'I will stop if I feel drowsy or unsafe',
    detail: 'An Occulert alert never makes it safe to continue driving. I will pull over and rest or arrange other transportation.',
  },
] as const;

function formatSleep(minutes: number | null): string {
  if (minutes === null) return 'No recent sample';
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0 ? `${hours}h ${remainder}m` : `${remainder}m`;
}

function formatUpdated(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unknown';
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
  const ready = useMemo(() => checked.every(Boolean), [checked]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let active = true;
    Promise.all([loadStoredHealthReadiness(), isAppleHealthAvailable()])
      .then(([stored, available]) => {
        if (!active) return;
        setHealthSnapshot(stored);
        setHealthAvailable(available);
      });
    return () => { active = false; };
  }, []);

  const toggle = (index: number) => {
    setChecked(current => current.map((value, itemIndex) => (
      itemIndex === index ? !value : value
    )));
  };

  const refreshHealth = async () => {
    setHealthLoading(true);
    setHealthNotice(null);
    try {
      const result = await refreshAppleHealthReadiness();
      setHealthSnapshot(result.snapshot);
      setHealthNotice(result.status === 'no_data'
        ? 'Apple Health returned no recent sleep or HRV samples. This can mean no data or limited access.'
        : 'Apple Health context updated on this iPhone.');
    } catch {
      setHealthNotice('Apple Health could not be read. Check Health access for Occulert and try again.');
    } finally {
      setHealthLoading(false);
    }
  };

  const removeHealthSummary = async () => {
    try {
      await clearStoredHealthReadiness();
      setHealthSnapshot(null);
      setHealthNotice('The local Apple Health summary was removed. Manage future access in iOS Health settings.');
    } catch {
      setHealthNotice('The local Apple Health summary could not be removed. Try again.');
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
          <Text style={styles.title}>Confirm your safe setup</Text>
          <Text style={styles.subtitle}>
            Complete this check while parked before every monitoring session.
          </Text>
        </View>

        <View style={styles.warning} accessibilityRole="alert">
          <Ionicons name="warning" size={20} color="#fbbf24" />
          <Text style={styles.warningText}>
            Never begin or configure Occulert while operating a vehicle.
          </Text>
        </View>

        {Platform.OS === 'ios' && (
          <View style={styles.healthCard}>
            <View style={styles.healthHeading}>
              <View style={styles.healthIcon}>
                <Ionicons name="heart" size={18} color="#fb7185" />
              </View>
              <View style={styles.healthHeadingCopy}>
                <Text style={styles.healthEyebrow}>APPLE HEALTH · OPTIONAL</Text>
                <Text style={styles.healthTitle}>Pre-drive context</Text>
              </View>
            </View>

            <Text style={styles.healthDescription}>
              Read recent sleep and heart rate variability from Apple Health. Only a small summary is kept in this iPhone's protected storage.
            </Text>

            {healthSnapshot && (
              <View style={styles.healthMetrics}>
                <View style={styles.healthMetric}>
                  <Text style={styles.healthMetricLabel}>SLEEP · PAST 24H</Text>
                  <Text style={styles.healthMetricValue}>{formatSleep(healthSnapshot.sleepMinutes24h)}</Text>
                </View>
                <View style={styles.healthMetric}>
                  <Text style={styles.healthMetricLabel}>HRV (SDNN) · PAST 7D</Text>
                  <Text style={styles.healthMetricValue}>
                    {healthSnapshot.latestHrvMs === null ? 'No recent sample' : `${healthSnapshot.latestHrvMs} ms`}
                  </Text>
                  {healthSnapshot.latestHrvAt && (
                    <Text style={styles.healthMetricTime}>{formatUpdated(healthSnapshot.latestHrvAt)}</Text>
                  )}
                </View>
              </View>
            )}

            {healthSnapshot && (
              <Text style={styles.healthUpdated}>Updated {formatUpdated(healthSnapshot.capturedAt)}</Text>
            )}

            {healthAvailable === false ? (
              <Text style={styles.healthNotice}>Apple Health is unavailable on this device or build.</Text>
            ) : (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityState={{ disabled: healthAvailable !== true || healthLoading }}
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
                  {healthSnapshot ? 'REFRESH APPLE HEALTH' : 'CONNECT APPLE HEALTH'}
                </Text>
              </TouchableOpacity>
            )}

            {healthNotice && <Text style={styles.healthNotice}>{healthNotice}</Text>}
            {healthSnapshot && (
              <TouchableOpacity
                accessibilityRole="button"
                activeOpacity={0.75}
                onPress={removeHealthSummary}
                style={styles.healthRemoveButton}
              >
                <Text style={styles.healthRemoveText}>REMOVE LOCAL HEALTH SUMMARY</Text>
              </TouchableOpacity>
            )}
            <Text style={styles.healthLimit}>
              Informational only. These values do not calculate medical or driving fitness, change fatigue scoring, or affect alerts.
            </Text>
          </View>
        )}

        <View style={styles.checkList}>
          {CHECKS.map((item, index) => (
            <TouchableOpacity
              key={item.title}
              accessibilityRole="checkbox"
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
            <Text style={styles.continueText}>CONTINUE TO MONITORING</Text>
          </TouchableOpacity>
        </GlassSurface>

        <TouchableOpacity
          accessibilityRole="link"
          onPress={() => Linking.openURL('https://www.occulert.com/safety.html')}
          style={styles.safetyLink}
        >
          <Text style={styles.safetyLinkText}>Read full safety information</Text>
          <Ionicons name="open-outline" size={14} color="#60a5fa" />
        </TouchableOpacity>

        <Text style={styles.footer}>
          This confirmation is required before each monitoring session and is not a substitute for attentive driving or adequate rest.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  healthMetrics: { flexDirection: 'row', gap: 10, marginTop: 14 },
  healthMetric: {
    flex: 1,
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
  healthRemoveButton: { alignItems: 'center', paddingTop: 12 },
  healthRemoveText: { color: colors.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 0.45 },
  healthLimit: { color: colors.textMuted, fontSize: 10, lineHeight: 15, marginTop: 10 },
  checkList: { gap: 10 },
  checkCard: {
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 18,
  },
  safetyLinkText: { color: '#60a5fa', fontSize: 13, fontWeight: '700' },
  footer: { color: colors.textMuted, fontSize: 11, lineHeight: 17, textAlign: 'center' },
});
