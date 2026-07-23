import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView, TouchableOpacity, Alert,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { openFeedback, type AlertAssessment } from '../lib/feedback';

const HISTORY_KEY = 'occulert-session-history';

interface SessionRecord {
  sessionId?: string;
  driverId?: string;
  savedAt?: string;
  updatedAt?: string;
  durationSec?: number;
  alertCount?: number;
  avgFatigue?: number;
  cloudSynced?: boolean;
  cloudSessionId?: string;
  alertAssessment?: AlertAssessment;
  assessmentUpdatedAt?: string;
}

const ASSESSMENT_OPTIONS: Array<{
  value: AlertAssessment;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}> = [
  { value: 'accurate', label: 'Felt right', icon: 'checkmark-circle-outline' },
  { value: 'false_alert', label: 'False alert', icon: 'alert-circle-outline' },
  { value: 'missed_alert', label: 'Missed alert', icon: 'eye-off-outline' },
];

function fmtDuration(sec?: number): string {
  if (!sec || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function fmtDate(iso?: string): string {
  if (!iso) return 'Unknown date';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Unknown date';
  return d.toLocaleDateString() + ' · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function HistoryScreen() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      setSessions(Array.isArray(parsed) ? parsed : []);
    } catch {
      setSessions([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const saveAssessment = async (index: number, value: AlertAssessment) => {
    const updated = sessions.map((item, itemIndex) => itemIndex === index
      ? { ...item, alertAssessment: value, assessmentUpdatedAt: new Date().toISOString() }
      : item);
    setSessions(updated);
    try {
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    } catch {
      await load();
      Alert.alert('Could not save review', 'Please try rating this session again.');
    }
  };

  return (
    <SafeAreaView style={s.bg}>
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.title}>Session History</Text>

        {loaded && sessions.length === 0 && (
          <View style={s.empty}>
            <Ionicons name="time-outline" size={40} color="#4a7a8a" />
            <Text style={s.emptyTitle}>No sessions yet</Text>
            <Text style={s.emptySub}>
              Completed monitoring sessions will appear here.
            </Text>
            <TouchableOpacity style={s.cta} onPress={() => router.push('/monitor')}>
              <Text style={s.ctaTxt}>Start Monitoring</Text>
            </TouchableOpacity>
          </View>
        )}

        {sessions.map((item, i) => (
          <View key={item.sessionId || String(i)} style={s.card}>
            <View style={s.rowBetween}>
              <Text style={s.date}>{fmtDate(item.savedAt || item.updatedAt)}</Text>
              <Text style={s.dur}>{fmtDuration(item.durationSec)}</Text>
            </View>
            <View style={s.stats}>
              <View style={s.stat}>
                <Text style={s.statVal}>{item.alertCount ?? 0}</Text>
                <Text style={s.statLbl}>Alerts</Text>
              </View>
              <View style={s.stat}>
                <Text style={s.statVal}>{item.avgFatigue != null ? Math.round(item.avgFatigue) : '-'}</Text>
                <Text style={s.statLbl}>Avg Fatigue</Text>
              </View>
              <View style={s.stat}>
                <Text style={s.statVal}>{item.driverId || '-'}</Text>
                <Text style={s.statLbl}>Driver</Text>
              </View>
            </View>
            <View style={s.storageRow}>
              <Ionicons
                name={item.cloudSynced ? 'cloud-done-outline' : 'phone-portrait-outline'}
                size={14}
                color={item.cloudSynced ? '#34d399' : '#4a7a8a'}
              />
              <Text style={[s.storageText, item.cloudSynced && s.storageTextSynced]}>
                {item.cloudSynced ? 'Summary synced to your protected account' : 'Saved only on this iPhone'}
              </Text>
            </View>
            <View style={s.review}>
              <Text style={s.reviewTitle}>How accurate were the alerts?</Text>
              <View style={s.reviewOptions}>
                {ASSESSMENT_OPTIONS.map((option) => {
                  const selected = item.alertAssessment === option.value;
                  return (
                    <TouchableOpacity
                      key={option.value}
                      accessibilityRole="button"
                      accessibilityLabel={option.label}
                      accessibilityState={{ selected }}
                      style={[s.reviewOption, selected && s.reviewOptionSelected]}
                      onPress={() => saveAssessment(i, option.value)}
                    >
                      <Ionicons name={option.icon} size={15} color={selected ? '#dbeafe' : '#4a7a8a'} />
                      <Text style={[s.reviewOptionText, selected && s.reviewOptionTextSelected]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={s.reviewPrivacy}>
                This alert rating stays only on this iPhone. It is included only if you choose to send feedback.
              </Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Send feedback about this session"
              style={s.feedbackBtn}
              onPress={async () => {
                if (!await openFeedback(item)) {
                  Alert.alert('Mail is unavailable', 'Email hello@occulert.com to share pilot feedback.');
                }
              }}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={16} color="#93c5fd" />
              <Text style={s.feedbackTxt}>Send session feedback</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#050a0f' },
  scroll: { padding: 20, paddingBottom: 48 },
  title: { color: '#fff', fontSize: 28, fontWeight: '900', marginBottom: 20 },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { color: '#c8e8f0', fontSize: 17, fontWeight: '800', marginTop: 8 },
  emptySub: { color: '#4a7a8a', fontSize: 13, textAlign: 'center', lineHeight: 19, paddingHorizontal: 20 },
  cta: { marginTop: 16, backgroundColor: '#2563eb', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
  ctaTxt: { color: '#fff', fontSize: 14, fontWeight: '800' },
  card: { backgroundColor: '#0f1e2e', borderWidth: 1, borderColor: '#1a3a4a', borderRadius: 14, padding: 16, marginBottom: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  date: { color: '#c8e8f0', fontSize: 13, fontWeight: '700' },
  dur: { color: '#60a5fa', fontSize: 13, fontWeight: '800' },
  stats: { flexDirection: 'row', gap: 12 },
  stat: { flex: 1, alignItems: 'center', backgroundColor: 'rgba(37,99,235,0.06)', borderRadius: 10, paddingVertical: 10 },
  statVal: { color: '#fff', fontSize: 16, fontWeight: '900' },
  statLbl: { color: '#4a7a8a', fontSize: 10, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  storageRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12 },
  storageText: { color: '#4a7a8a', fontSize: 10, fontWeight: '700' },
  storageTextSynced: { color: '#34d399' },
  review: { borderTopWidth: 1, borderTopColor: '#1a3a4a', marginTop: 14, paddingTop: 14 },
  reviewTitle: { color: '#c8e8f0', fontSize: 12, fontWeight: '800', marginBottom: 10 },
  reviewOptions: { flexDirection: 'row', gap: 7 },
  reviewOption: { flex: 1, minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: '#1a3a4a', backgroundColor: 'rgba(5,10,15,0.35)', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 4, paddingVertical: 7 },
  reviewOptionSelected: { borderColor: '#3b82f6', backgroundColor: 'rgba(37,99,235,0.22)' },
  reviewOptionText: { color: '#4a7a8a', fontSize: 10, fontWeight: '800', textAlign: 'center' },
  reviewOptionTextSelected: { color: '#dbeafe' },
  reviewPrivacy: { color: '#4a7a8a', fontSize: 10, lineHeight: 14, marginTop: 8 },
  feedbackBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderTopWidth: 1, borderTopColor: '#1a3a4a', marginTop: 14, paddingTop: 14 },
  feedbackTxt: { color: '#93c5fd', fontSize: 13, fontWeight: '800' },
});
