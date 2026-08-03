import React from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { AmbientBackground, GlassSurface } from '../components/GlassSurface';
import { colors, radii } from '../constants/theme';

interface QuickLinkProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  detail: string;
  href: Href;
}

function QuickLink({ icon, label, detail, href }: QuickLinkProps) {
  const router = useRouter();

  return (
    <GlassSurface interactive style={styles.linkCard}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${detail}`}
        activeOpacity={0.78}
        onPress={() => router.push(href)}
        style={styles.linkButton}
      >
        <View style={styles.linkIcon}>
          <Ionicons name={icon} size={20} color={colors.cyan} />
        </View>
        <View style={styles.linkCopy}>
          <Text style={styles.linkLabel}>{label}</Text>
          <Text style={styles.linkDetail}>{detail}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </TouchableOpacity>
    </GlassSurface>
  );
}

export default function HomeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <AmbientBackground />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <GlassSurface style={styles.brandMark} tintColor="rgba(58, 124, 255, 0.38)">
            <Ionicons name="eye-outline" size={28} color={colors.text} />
          </GlassSurface>
          <View style={styles.privacyPill}>
            <View style={styles.privacyDot} />
            <Text style={styles.privacyPillText}>ON-DEVICE · PRIVATE</Text>
          </View>
        </View>

        <View style={styles.hero}>
          <Text style={styles.eyebrow}>DRIVER AWARENESS</Text>
          <Text style={styles.title}>Stay alert.{`\n`}Arrive safe.</Text>
          <Text style={styles.subtitle}>
            Supplemental fatigue alerts, designed to stay clear and calm when the road needs your attention.
          </Text>
        </View>

        <View style={styles.safetyBox} accessibilityRole="alert">
          <View style={styles.safetyIcon}>
            <Ionicons name="warning" size={18} color={colors.amber} />
          </View>
          <Text style={styles.safetyText}>
            Set up only while parked. Mount the phone facing you, then keep Occulert in the foreground.
          </Text>
        </View>

        <GlassSurface
          interactive
          style={styles.startSurface}
          tintColor="rgba(42, 105, 244, 0.58)"
        >
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Begin pre-drive safety check"
            onPress={() => router.push('/pre-drive')}
            activeOpacity={0.82}
            style={styles.startButton}
          >
            <View style={styles.startIcon}>
              <Ionicons name="shield-checkmark" size={22} color={colors.text} />
            </View>
            <View style={styles.startCopy}>
              <Text style={styles.startLabel}>Begin safely</Text>
              <Text style={styles.startDetail}>Pre-drive check</Text>
            </View>
            <Ionicons name="arrow-forward" size={20} color={colors.text} />
          </TouchableOpacity>
        </GlassSurface>

        <Text style={styles.sectionLabel}>YOUR OCCULERT</Text>
        <View style={styles.quickLinks}>
          <QuickLink icon="time-outline" label="Session history" detail="Review test sessions" href="/history" />
          <QuickLink icon="options-outline" label="Settings" detail="Tune alerts and sync" href="/settings" />
        </View>

        <Text style={styles.footer}>
          Supplemental prototype only. Pull over whenever you feel drowsy or unsafe.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: 22, paddingTop: 14, paddingBottom: 42 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandMark: {
    width: 58,
    height: 58,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  privacyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(53, 227, 154, 0.09)',
    borderWidth: 1,
    borderColor: 'rgba(53, 227, 154, 0.22)',
  },
  privacyDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.green },
  privacyPillText: { color: '#8ff0c5', fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  hero: { paddingTop: 48, paddingBottom: 30 },
  eyebrow: { color: colors.cyan, fontSize: 11, fontWeight: '800', letterSpacing: 1.6 },
  title: {
    color: colors.text,
    fontSize: 44,
    lineHeight: 47,
    fontWeight: '800',
    letterSpacing: -1.7,
    marginTop: 10,
  },
  subtitle: { color: colors.textSecondary, fontSize: 16, lineHeight: 24, marginTop: 16, maxWidth: 350 },
  safetyBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: 'rgba(251, 191, 36, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.24)',
    borderRadius: radii.medium,
    padding: 15,
    marginBottom: 16,
  },
  safetyIcon: {
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(251, 191, 36, 0.1)',
  },
  safetyText: { flex: 1, color: '#f8d98b', fontSize: 13, lineHeight: 19, paddingTop: 1 },
  startSurface: {
    borderRadius: radii.large,
    overflow: 'hidden',
    marginBottom: 30,
    shadowColor: '#3175f5',
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  },
  startButton: {
    minHeight: 86,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    gap: 13,
  },
  startIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  startCopy: { flex: 1 },
  startLabel: { color: colors.text, fontSize: 18, fontWeight: '800' },
  startDetail: { color: 'rgba(237, 246, 255, 0.72)', fontSize: 12, marginTop: 3 },
  sectionLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1.4, marginBottom: 10 },
  quickLinks: { gap: 10, marginBottom: 30 },
  linkCard: { borderRadius: radii.medium, overflow: 'hidden' },
  linkButton: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14 },
  linkIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(76, 215, 246, 0.1)',
  },
  linkCopy: { flex: 1 },
  linkLabel: { color: colors.text, fontSize: 14, fontWeight: '700' },
  linkDetail: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  footer: { textAlign: 'center', color: colors.textMuted, fontSize: 11, lineHeight: 17, paddingHorizontal: 18 },
});
