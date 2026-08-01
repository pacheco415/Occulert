import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, SafeAreaView, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function HomeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.brandMark}>
            <Text style={styles.eyeIcon}>👁</Text>
          </View>
          <Text style={styles.title}>Occulert</Text>
          <Text style={styles.subtitle}>AI Drowsiness Detection</Text>
        </View>

        {/* Safety notice */}
        <View style={styles.safetyBox}>
          <Ionicons name="warning" size={16} color="#fbbf24" />
          <Text style={styles.safetyText}>
            Mount your phone on the dash facing you. Keep screen on and app in foreground while driving.
          </Text>
        </View>

        {/* Start button */}
        <TouchableOpacity
          style={styles.startBtn}
          onPress={() => router.push('/pre-drive')}
          activeOpacity={0.85}
        >
          <Ionicons name="shield-checkmark" size={22} color="#fff" />
          <Text style={styles.startBtnText}>PRE-DRIVE CHECK</Text>
        </TouchableOpacity>

        {/* Quick links */}
        <View style={styles.quickLinks}>
          <TouchableOpacity style={styles.linkCard} onPress={() => router.push('/history')}>
            <Ionicons name="time-outline" size={22} color="#60a5fa" />
            <Text style={styles.linkLabel}>Session History</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.linkCard} onPress={() => router.push('/settings')}>
            <Ionicons name="settings-outline" size={22} color="#60a5fa" />
            <Text style={styles.linkLabel}>Settings</Text>
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <Text style={styles.footer}>
          Occulert is a supplemental alerting tool only. Always pull over if drowsy.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050a0f' },
  scroll: { padding: 24, paddingBottom: 40 },
  header: { alignItems: 'center', marginBottom: 28, marginTop: 16 },
  brandMark: {
    width: 72, height: 72, borderRadius: 20,
    backgroundColor: '#2563eb', alignItems: 'center',
    justifyContent: 'center', marginBottom: 12,
    shadowColor: '#2563eb', shadowOpacity: 0.4,
    shadowRadius: 16, shadowOffset: { width: 0, height: 6 },
  },
  eyeIcon: { fontSize: 36 },
  title: { fontSize: 32, fontWeight: '900', color: '#fff', letterSpacing: 1 },
  subtitle: { fontSize: 15, color: '#94a3b8', marginTop: 4 },
  safetyBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: 'rgba(251,191,36,0.08)', borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.3)', borderRadius: 12,
    padding: 14, marginBottom: 24,
  },
  safetyText: { flex: 1, color: '#fbbf24', fontSize: 13, lineHeight: 19 },
  startBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 12, backgroundColor: '#2563eb', borderRadius: 16,
    paddingVertical: 20, marginBottom: 20,
    shadowColor: '#2563eb', shadowOpacity: 0.4,
    shadowRadius: 20, shadowOffset: { width: 0, height: 8 },
  },
  startBtnText: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: 1 },
  quickLinks: { flexDirection: 'row', gap: 12, marginBottom: 28 },
  linkCard: {
    flex: 1, backgroundColor: '#0f1e2e', borderWidth: 1,
    borderColor: '#1a3a4a', borderRadius: 14, padding: 18,
    alignItems: 'center', gap: 8,
  },
  linkLabel: { color: '#c8e8f0', fontSize: 13, fontWeight: '700' },
  footer: { textAlign: 'center', color: '#4a7a8a', fontSize: 11, lineHeight: 17 },
});
