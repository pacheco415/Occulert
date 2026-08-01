import React, { useMemo, useState } from 'react';
import {
  Linking,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { confirmPreDriveSafety } from '../lib/preDriveGate';

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

export default function PreDriveScreen() {
  const router = useRouter();
  const [checked, setChecked] = useState<boolean[]>(() => CHECKS.map(() => false));
  const ready = useMemo(() => checked.every(Boolean), [checked]);

  const toggle = (index: number) => {
    setChecked(current => current.map((value, itemIndex) => (
      itemIndex === index ? !value : value
    )));
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.iconWrap}>
            <Ionicons name="shield-checkmark" size={34} color="#fbbf24" />
          </View>
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

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ disabled: !ready }}
          disabled={!ready}
          activeOpacity={0.85}
          onPress={() => {
            confirmPreDriveSafety();
            router.replace('/monitor');
          }}
          style={[styles.continueButton, !ready && styles.continueButtonDisabled]}
        >
          <Ionicons name="eye" size={22} color="#fff" />
          <Text style={styles.continueText}>CONTINUE TO MONITORING</Text>
        </TouchableOpacity>

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
  container: { flex: 1, backgroundColor: '#050a0f' },
  scroll: { padding: 20, paddingBottom: 40 },
  hero: { alignItems: 'center', paddingTop: 12, marginBottom: 22 },
  iconWrap: {
    width: 66,
    height: 66,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(251,191,36,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.35)',
    marginBottom: 14,
  },
  title: { color: '#fff', fontSize: 24, fontWeight: '900', textAlign: 'center' },
  subtitle: {
    color: '#94a3b8',
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
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  warningText: { flex: 1, color: '#fde68a', fontSize: 13, lineHeight: 19, fontWeight: '700' },
  checkList: { gap: 10 },
  checkCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#0f1e2e',
    borderWidth: 1,
    borderColor: '#1a3a4a',
    borderRadius: 14,
    padding: 15,
  },
  checkCardSelected: {
    backgroundColor: 'rgba(0,255,136,0.06)',
    borderColor: 'rgba(0,255,136,0.45)',
  },
  checkCopy: { flex: 1 },
  checkTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '800' },
  checkDetail: { color: '#94a3b8', fontSize: 12, lineHeight: 18, marginTop: 4 },
  continueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#2563eb',
    borderRadius: 16,
    paddingVertical: 19,
    marginTop: 22,
  },
  continueButtonDisabled: { backgroundColor: '#26374a', opacity: 0.6 },
  continueText: { color: '#fff', fontSize: 15, fontWeight: '900', letterSpacing: 0.7 },
  safetyLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 18,
  },
  safetyLinkText: { color: '#60a5fa', fontSize: 13, fontWeight: '700' },
  footer: { color: '#4a7a8a', fontSize: 11, lineHeight: 17, textAlign: 'center' },
});
