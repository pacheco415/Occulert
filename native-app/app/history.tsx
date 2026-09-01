import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView, TouchableOpacity, Alert,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  openFeedback,
  type AlertAssessment,
  type FeedbackSession,
  type SessionDeviceImpact,
  type SessionTestConditions,
} from '../lib/feedback';
import { updateSessionHistory } from '../lib/sessionHistory';
import {
  commitSessionHistoryEdit,
  updateMatchingSessionRecord,
  type SessionRecordMutation,
} from '../lib/sessionHistoryEdits';
import { formatPilotCounts, summarizePilotIssues } from '../lib/pilotInsights';
import type { SensitivityLevel } from '../constants/thresholds';
import { AmbientBackground } from '../components/GlassSurface';
import { colors, radii } from '../constants/theme';
import type { MonitorPerformanceSnapshot } from '../lib/monitorPerformance';

const HISTORY_KEY = 'occulert-session-history';
const CHECKPOINT_TARGET = 10;

interface SessionRecord extends FeedbackSession {
  driverId?: string;
  cloudSynced?: boolean;
  cloudSessionId?: string;
  assessmentUpdatedAt?: string;
  conditionsUpdatedAt?: string;
  deviceImpactUpdatedAt?: string;
  monitorPerformance?: MonitorPerformanceSnapshot;
  recoveredFromInterruption?: boolean;
  recoveryNote?: string;
}

type TestConditionKey = keyof SessionTestConditions;
type TestConditionValue = NonNullable<SessionTestConditions[TestConditionKey]>;

interface TestConditionGroup {
  key: TestConditionKey;
  label: string;
  options: Array<{ value: TestConditionValue; label: string }>;
}

type DeviceImpactKey = keyof SessionDeviceImpact;
type DeviceImpactValue = NonNullable<SessionDeviceImpact[DeviceImpactKey]>;

interface DeviceImpactGroup {
  key: DeviceImpactKey;
  label: string;
  options: Array<{ value: DeviceImpactValue; label: string }>;
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

const TEST_CONDITION_GROUPS: TestConditionGroup[] = [
  {
    key: 'lighting',
    label: 'Lighting',
    options: [
      { value: 'daylight', label: 'Daylight' },
      { value: 'low_light', label: 'Low light' },
    ],
  },
  {
    key: 'eyewear',
    label: 'Eyewear',
    options: [
      { value: 'none', label: 'None' },
      { value: 'glasses', label: 'Glasses' },
      { value: 'sunglasses', label: 'Sunglasses' },
    ],
  },
  {
    key: 'phonePosition',
    label: 'Phone position',
    options: [
      { value: 'high', label: 'High' },
      { value: 'center', label: 'Center' },
      { value: 'low', label: 'Low' },
    ],
  },
];

const DEVICE_IMPACT_GROUPS: DeviceImpactGroup[] = [
  {
    key: 'batteryImpact',
    label: 'Battery use',
    options: [
      { value: 'low', label: 'Low' },
      { value: 'noticeable', label: 'Noticeable' },
      { value: 'high', label: 'High' },
    ],
  },
  {
    key: 'phoneHeat',
    label: 'Phone heat',
    options: [
      { value: 'cool', label: 'Cool' },
      { value: 'warm', label: 'Warm' },
      { value: 'hot', label: 'Hot' },
    ],
  },
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

function sensitivityLabel(value?: SensitivityLevel): string {
  if (value === 'low') return 'Low';
  if (value === 'medium') return 'Medium';
  if (value === 'high') return 'High';
  return 'Not recorded';
}

function headphoneMotionLabel(value?: string): string {
  if (value === 'active') return 'Compatible headphones provided motion';
  if (value === 'starting') return 'No motion sample arrived before the session ended';
  if (value === 'unavailable') return 'No compatible headphone motion was available';
  if (value === 'denied') return 'Motion access was not allowed';
  if (value === 'error') return 'Headphone motion stopped with an error';
  if (value === 'not-built') return 'This build does not include headphone motion';
  if (value === 'stopped') return 'Headphone motion was stopped';
  return 'Headphone motion status was not recorded';
}

function hasCompleteReview(item: SessionRecord): boolean {
  return Boolean(
    item.alertAssessment
    && item.testConditions?.lighting
    && item.testConditions?.eyewear
    && item.testConditions?.phonePosition
    && item.deviceImpact?.batteryImpact
    && item.deviceImpact?.phoneHeat,
  );
}

export default function HistoryScreen() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expandedSessions, setExpandedSessions] = useState<Record<string, boolean>>({});
  const historyRevisionRef = useRef(0);

  const load = useCallback(async () => {
    const revision = historyRevisionRef.current;
    try {
      const raw = await AsyncStorage.getItem(HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (historyRevisionRef.current === revision) {
        setSessions(Array.isArray(parsed) ? parsed : []);
      }
    } catch {
      if (historyRevisionRef.current === revision) setSessions([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const saveSessionChanges = async (
    index: number,
    update: SessionRecordMutation<SessionRecord>,
    errorTitle: string,
    errorMessage: string,
  ) => {
    const target = sessions[index];
    if (!target) return;

    historyRevisionRef.current += 1;
    await commitSessionHistoryEdit({
      update,
      persist: mutation => updateSessionHistory<SessionRecord>(stored => (
        updateMatchingSessionRecord(stored, target, index, mutation)
      )),
      apply: mutation => setSessions(current => (
        updateMatchingSessionRecord(current, target, index, mutation)
      )),
      onError: () => Alert.alert(errorTitle, errorMessage),
    });
  };

  const saveAssessment = async (index: number, value: AlertAssessment) => {
    const updatedAt = new Date().toISOString();
    await saveSessionChanges(
      index,
      item => ({ ...item, alertAssessment: value, assessmentUpdatedAt: updatedAt }),
      'Could not save review',
      'Please try rating this session again.',
    );
  };

  const saveTestCondition = async (index: number, key: TestConditionKey, value: TestConditionValue) => {
    const updatedAt = new Date().toISOString();
    await saveSessionChanges(
      index,
      item => ({
        ...item,
        testConditions: { ...item.testConditions, [key]: value } as SessionTestConditions,
        conditionsUpdatedAt: updatedAt,
      }),
      'Could not save conditions',
      'Please try recording these test conditions again.',
    );
  };

  const saveDeviceImpact = async (index: number, key: DeviceImpactKey, value: DeviceImpactValue) => {
    const updatedAt = new Date().toISOString();
    await saveSessionChanges(
      index,
      item => ({
        ...item,
        deviceImpact: { ...item.deviceImpact, [key]: value } as SessionDeviceImpact,
        deviceImpactUpdatedAt: updatedAt,
      }),
      'Could not save device impact',
      'Please try recording the device impact again.',
    );
  };

  const evidenceSessions = sessions.filter(item => !item.recoveredFromInterruption);
  const reviewedMedium = evidenceSessions.filter(
    item => item.sensitivity === 'medium' && Boolean(item.alertAssessment),
  );
  const checkpointProgress = Math.min(reviewedMedium.length, CHECKPOINT_TARGET);
  const accurateCount = reviewedMedium.filter(item => item.alertAssessment === 'accurate').length;
  const falseAlertCount = reviewedMedium.filter(item => item.alertAssessment === 'false_alert').length;
  const missedAlertCount = reviewedMedium.filter(item => item.alertAssessment === 'missed_alert').length;
  const completeConditionCount = reviewedMedium.filter(item => (
    Boolean(item.testConditions?.lighting)
    && Boolean(item.testConditions?.eyewear)
    && Boolean(item.testConditions?.phonePosition)
  )).length;
  const lowLightCount = reviewedMedium.filter(item => item.testConditions?.lighting === 'low_light').length;
  const eyewearCount = reviewedMedium.filter(item => (
    item.testConditions?.eyewear === 'glasses' || item.testConditions?.eyewear === 'sunglasses'
  )).length;
  const phonePositionCount = new Set(
    reviewedMedium.map(item => item.testConditions?.phonePosition).filter(Boolean),
  ).size;
  const completeDeviceImpactCount = reviewedMedium.filter(item => (
    Boolean(item.deviceImpact?.batteryImpact) && Boolean(item.deviceImpact?.phoneHeat)
  )).length;
  const issueInsights = summarizePilotIssues(evidenceSessions);
  const issueSessionCount = issueInsights.reduce((total, insight) => total + insight.total, 0);

  return (
    <SafeAreaView style={s.bg}>
      <AmbientBackground />
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.title}>Session History</Text>

        {loaded && sessions.length > 0 && (
          <View style={s.checkpoint}>
            <View style={s.checkpointHeader}>
              <View style={s.checkpointHeaderCopy}>
                <Text style={s.checkpointEyebrow}>FIRST ACCURACY CHECKPOINT</Text>
                <Text style={s.checkpointTitle}>
                  {checkpointProgress} of {CHECKPOINT_TARGET} Medium sessions reviewed
                </Text>
              </View>
              <Text style={s.checkpointPercent}>
                {Math.round((checkpointProgress / CHECKPOINT_TARGET) * 100)}%
              </Text>
            </View>
            <View
              accessibilityLabel={`${checkpointProgress} of ${CHECKPOINT_TARGET} Medium sensitivity sessions reviewed`}
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: CHECKPOINT_TARGET, now: checkpointProgress }}
              style={s.progressTrack}
            >
              <View
                style={[
                  s.progressFill,
                  { width: `${(checkpointProgress / CHECKPOINT_TARGET) * 100}%` },
                ]}
              />
            </View>
            <View style={s.checkpointStats}>
              <Text style={s.checkpointStat}>{accurateCount} felt right</Text>
              <Text style={s.checkpointStat}>{falseAlertCount} false</Text>
              <Text style={s.checkpointStat}>{missedAlertCount} missed</Text>
            </View>
            <Text style={s.checkpointNote}>
              Only complete reviewed sessions recorded on Medium count here. Recovered partial sessions are excluded. Ratings stay on this iPhone.
            </Text>
            <View style={s.coverageSummary}>
              <Text style={s.coverageTitle}>TEST CONDITION COVERAGE</Text>
              <Text style={s.coverageCopy}>
                {completeConditionCount} of {reviewedMedium.length} reviewed sessions include lighting, eyewear, and phone position.
              </Text>
              <Text style={s.coverageStats}>
                {lowLightCount} low light · {eyewearCount} with eyewear · {phonePositionCount} phone positions
              </Text>
              <Text style={s.coverageStats}>
                {completeDeviceImpactCount} include battery-use and phone-heat observations
              </Text>
            </View>
            {issueSessionCount > 0 && (
              <View style={s.patternSummary}>
                <Text style={s.coverageTitle}>ALERT PATTERNS</Text>
                <Text style={s.patternIntro}>
                  All reviewed sensitivities are included. Counts stay on this iPhone.
                </Text>
                {issueInsights.map(insight => (
                  <View key={insight.assessment} style={s.patternGroup}>
                    <Text style={s.patternTitle}>{insight.total} {insight.label.toLowerCase()}</Text>
                    {insight.total === 0 ? (
                      <Text style={s.patternCopy}>None in reviewed sessions.</Text>
                    ) : (
                      <>
                        <Text style={s.patternCopy}>
                          Sensitivity: {formatPilotCounts(insight.sensitivities) || 'not recorded'}
                        </Text>
                        <Text style={s.patternCopy}>
                          Conditions: {formatPilotCounts(insight.conditions) || 'not recorded'}
                        </Text>
                        {insight.completeConditionCount < insight.total && (
                          <Text style={s.patternMissing}>
                            {insight.total - insight.completeConditionCount} missing one or more test conditions
                          </Text>
                        )}
                      </>
                    )}
                  </View>
                ))}
                <Text style={s.patternCaution}>
                  These are observations, not error rates. Compare patterns only after each condition has enough reviewed sessions.
                </Text>
              </View>
            )}
          </View>
        )}

        {loaded && sessions.length === 0 && (
          <View style={s.empty}>
            <Ionicons name="time-outline" size={40} color="#4a7a8a" />
            <Text style={s.emptyTitle}>No sessions yet</Text>
            <Text style={s.emptySub}>
              Completed monitoring sessions will appear here.
            </Text>
            <TouchableOpacity style={s.cta} onPress={() => router.push('/pre-drive')}>
              <Text style={s.ctaTxt}>Start Monitoring</Text>
            </TouchableOpacity>
          </View>
        )}

        {sessions.map((item, i) => {
          const sessionKey = item.sessionId || `${item.savedAt || item.updatedAt || 'session'}-${i}`;
          const reviewComplete = hasCompleteReview(item);
          const isExpanded = expandedSessions[sessionKey] ?? !reviewComplete;
          return (
          <View key={sessionKey} style={s.card}>
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
                <Text style={s.statValSmall}>{sensitivityLabel(item.sensitivity)}</Text>
                <Text style={s.statLbl}>Sensitivity</Text>
              </View>
            </View>
            {item.recoveredFromInterruption && (
              <View accessibilityRole="alert" style={s.recoveryNote}>
                <Ionicons name="refresh-circle-outline" size={16} color="#86efac" />
                <View style={s.recoveryNoteCopy}>
                  <Text style={s.recoveryNoteTitle}>Recovered local checkpoint</Text>
                  <Text style={s.recoveryNoteText}>
                    Monitoring ended unexpectedly. This partial summary may not include the final moments of the drive.
                  </Text>
                </View>
              </View>
            )}
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
            <Text style={s.buildInfo}>
              App {item.appVersion || 'not recorded'} · Build {item.appBuildNumber || 'not recorded'}
            </Text>
            {item.monitorPerformance && (
              <View style={s.performanceBox}>
                <Text style={s.performanceTitle}>LOCAL PERFORMANCE DIAGNOSTICS</Text>
                <Text style={s.performanceInfo}>
                  First camera sample: {item.monitorPerformance.timeToFirstSampleMs == null
                    ? 'not observed'
                    : `${item.monitorPerformance.timeToFirstSampleMs} ms`}
                </Text>
                <Text style={s.performanceInfo}>
                  Inference p95: {item.monitorPerformance.p95InferenceMs} ms · Average sample interval: {item.monitorPerformance.averageSampleIntervalMs} ms
                </Text>
                <Text style={s.performanceInfo}>
                  Display updates: {item.monitorPerformance.uiUpdatesPerSecond}/sec · Camera stalls: {item.monitorPerformance.cameraStalls}
                </Text>
                <Text style={s.performanceCaution}>
                  Aggregate timings stay in this session record on this iPhone. No camera frames are saved.
                </Text>
              </View>
            )}
            {(item.headNodObservations != null || item.headphoneMotionStatus != null) && (
              <View style={s.observationBox}>
                <Text style={s.observationTitle}>EXPERIMENTAL HEAD-MOTION DIAGNOSTICS</Text>
                <Text style={s.observationInfo}>
                  Camera candidates: {item.cameraHeadNodObservations ?? item.headNodObservations ?? 0}
                </Text>
                <Text style={s.observationInfo}>
                  Headphone candidates: {item.headphoneHeadNodObservations ?? 0} from {item.headphoneMotionSamples ?? 0} transient samples
                </Text>
                <Text style={s.observationStatus}>{headphoneMotionLabel(item.headphoneMotionStatus)}</Text>
                <Text style={s.observationCaution}>
                  Saved locally as aggregate observations only and included only if you choose Send session feedback. Does not trigger alerts or change scores.
                </Text>
              </View>
            )}
            <View style={s.reviewSummary}>
              <View style={[s.reviewBadge, reviewComplete ? s.reviewBadgeComplete : s.reviewBadgeNeeded]}>
                <Ionicons
                  name={reviewComplete ? 'checkmark-circle' : 'ellipse-outline'}
                  size={14}
                  color={reviewComplete ? '#86efac' : '#fbbf24'}
                />
                <Text style={[s.reviewBadgeText, reviewComplete ? s.reviewBadgeTextComplete : s.reviewBadgeTextNeeded]}>
                  {reviewComplete ? 'Review complete' : 'Needs review'}
                </Text>
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={isExpanded ? 'Hide session review details' : 'Show session review details'}
                accessibilityState={{ expanded: isExpanded }}
                style={s.reviewToggle}
                onPress={() => setExpandedSessions(current => ({
                  ...current,
                  [sessionKey]: !(current[sessionKey] ?? !reviewComplete),
                }))}
              >
                <Text style={s.reviewToggleText}>{isExpanded ? 'Hide details' : 'Show details'}</Text>
                <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={15} color="#93c5fd" />
              </TouchableOpacity>
            </View>
            {isExpanded && (
              <>
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
            <View style={s.conditions}>
              <Text style={s.conditionsTitle}>Test conditions</Text>
              <Text style={s.conditionsSafety}>Record only after you are safely parked.</Text>
              {TEST_CONDITION_GROUPS.map(group => (
                <View key={group.key} style={s.conditionGroup}>
                  <Text style={s.conditionLabel}>{group.label}</Text>
                  <View style={s.conditionOptions}>
                    {group.options.map(option => {
                      const selected = item.testConditions?.[group.key] === option.value;
                      return (
                        <TouchableOpacity
                          key={option.value}
                          accessibilityRole="button"
                          accessibilityLabel={`${group.label}: ${option.label}`}
                          accessibilityState={{ selected }}
                          style={[s.conditionOption, selected && s.conditionOptionSelected]}
                          onPress={() => saveTestCondition(i, group.key, option.value)}
                        >
                          <Text style={[s.conditionOptionText, selected && s.conditionOptionTextSelected]}>
                            {option.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
              <Text style={s.conditionsPrivacy}>
                Conditions stay on this iPhone and are included only if you choose Send session feedback. No location or media is attached.
              </Text>
            </View>
            <View style={s.deviceImpact}>
              <Text style={s.conditionsTitle}>Device impact</Text>
              <Text style={s.deviceImpactNote}>
                Record after safely parking. These are tester observations, not device measurements.
              </Text>
              {DEVICE_IMPACT_GROUPS.map(group => (
                <View key={group.key} style={s.conditionGroup}>
                  <Text style={s.conditionLabel}>{group.label}</Text>
                  <View style={s.conditionOptions}>
                    {group.options.map(option => {
                      const selected = item.deviceImpact?.[group.key] === option.value;
                      return (
                        <TouchableOpacity
                          key={option.value}
                          accessibilityRole="button"
                          accessibilityLabel={`${group.label}: ${option.label}, tester-reported`}
                          accessibilityState={{ selected }}
                          style={[s.conditionOption, selected && s.conditionOptionSelected]}
                          onPress={() => saveDeviceImpact(i, group.key, option.value)}
                        >
                          <Text style={[s.conditionOptionText, selected && s.conditionOptionTextSelected]}>
                            {option.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
              <Text style={s.deviceWarning}>
                If iPhone shows a temperature warning, stop using Occulert and let the phone cool before another session.
              </Text>
              <Text style={s.conditionsPrivacy}>
                Device-impact observations stay on this iPhone unless you choose Send session feedback.
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
              </>
            )}
          </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 20, paddingBottom: 48 },
  title: { color: colors.text, fontSize: 32, fontWeight: '800', letterSpacing: -0.8, marginBottom: 20 },
  checkpoint: { backgroundColor: colors.materialStrong, borderWidth: 1, borderColor: 'rgba(94,156,255,0.28)', borderRadius: radii.large, padding: 18, marginBottom: 16 },
  checkpointHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  checkpointHeaderCopy: { flex: 1 },
  checkpointEyebrow: { color: '#60a5fa', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  checkpointTitle: { color: '#e0f2fe', fontSize: 15, fontWeight: '800', marginTop: 4 },
  checkpointPercent: { color: '#93c5fd', fontSize: 18, fontWeight: '900' },
  progressTrack: { height: 7, borderRadius: 999, backgroundColor: '#173647', overflow: 'hidden', marginTop: 14 },
  progressFill: { height: '100%', borderRadius: 999, backgroundColor: '#3b82f6' },
  checkpointStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 },
  checkpointStat: { color: '#bae6fd', fontSize: 11, fontWeight: '800' },
  checkpointNote: { color: '#6592a5', fontSize: 10, lineHeight: 15, marginTop: 10 },
  coverageSummary: { borderTopWidth: 1, borderTopColor: '#1d4f68', marginTop: 12, paddingTop: 12 },
  coverageTitle: { color: '#60a5fa', fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  coverageCopy: { color: '#bae6fd', fontSize: 10, lineHeight: 15, marginTop: 5 },
  coverageStats: { color: '#6592a5', fontSize: 10, lineHeight: 15, marginTop: 3 },
  patternSummary: { borderTopWidth: 1, borderTopColor: '#1d4f68', marginTop: 12, paddingTop: 12 },
  patternIntro: { color: '#6592a5', fontSize: 10, lineHeight: 15, marginTop: 5 },
  patternGroup: { backgroundColor: 'rgba(5,10,15,0.22)', borderRadius: 9, padding: 9, marginTop: 8 },
  patternTitle: { color: '#e0f2fe', fontSize: 11, fontWeight: '800' },
  patternCopy: { color: '#93c5fd', fontSize: 10, lineHeight: 15, marginTop: 3 },
  patternMissing: { color: '#fbbf24', fontSize: 10, lineHeight: 15, marginTop: 3 },
  patternCaution: { color: '#6592a5', fontSize: 9, lineHeight: 14, marginTop: 8 },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { color: '#c8e8f0', fontSize: 17, fontWeight: '800', marginTop: 8 },
  emptySub: { color: '#4a7a8a', fontSize: 13, textAlign: 'center', lineHeight: 19, paddingHorizontal: 20 },
  cta: { marginTop: 16, backgroundColor: '#2563eb', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
  ctaTxt: { color: '#fff', fontSize: 14, fontWeight: '800' },
  card: { backgroundColor: colors.material, borderWidth: 1, borderColor: colors.glassBorder, borderRadius: radii.large, padding: 18, marginBottom: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  date: { color: '#c8e8f0', fontSize: 13, fontWeight: '700' },
  dur: { color: '#60a5fa', fontSize: 13, fontWeight: '800' },
  stats: { flexDirection: 'row', gap: 12 },
  recoveryNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: 'rgba(48,209,88,0.08)', borderWidth: 1, borderColor: 'rgba(48,209,88,0.24)', borderRadius: 12, padding: 11, marginTop: 12 },
  recoveryNoteCopy: { flex: 1 },
  recoveryNoteTitle: { color: '#bbf7d0', fontSize: 11, fontWeight: '900' },
  recoveryNoteText: { color: colors.textSecondary, fontSize: 10, lineHeight: 15, marginTop: 2 },
  stat: { flex: 1, alignItems: 'center', backgroundColor: colors.backgroundRaised, borderRadius: radii.small, paddingVertical: 10 },
  statVal: { color: '#fff', fontSize: 16, fontWeight: '900' },
  statValSmall: { color: '#fff', fontSize: 12, fontWeight: '900' },
  statLbl: { color: '#4a7a8a', fontSize: 10, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  storageRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12 },
  storageText: { color: '#4a7a8a', fontSize: 10, fontWeight: '700' },
  storageTextSynced: { color: '#34d399' },
  buildInfo: { color: '#6592a5', fontSize: 10, fontWeight: '700', marginTop: 7 },
  performanceBox: { backgroundColor: 'rgba(14,165,233,0.06)', borderWidth: 1, borderColor: '#164e63', borderRadius: 9, marginTop: 9, padding: 10 },
  performanceTitle: { color: '#67e8f9', fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  performanceInfo: { color: '#bae6fd', fontSize: 10, lineHeight: 15, marginTop: 4 },
  performanceCaution: { color: '#6592a5', fontSize: 9, lineHeight: 14, marginTop: 6 },
  observationBox: { backgroundColor: 'rgba(37,99,235,0.06)', borderWidth: 1, borderColor: '#1a3a4a', borderRadius: 9, marginTop: 9, padding: 10 },
  observationTitle: { color: '#60a5fa', fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  observationInfo: { color: '#bae6fd', fontSize: 10, lineHeight: 15, marginTop: 4 },
  observationStatus: { color: '#6592a5', fontSize: 10, lineHeight: 15, marginTop: 3 },
  observationCaution: { color: '#4a7a8a', fontSize: 9, lineHeight: 14, marginTop: 6 },
  reviewSummary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderTopWidth: 1, borderTopColor: '#1a3a4a', marginTop: 14, paddingTop: 14 },
  reviewBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 6 },
  reviewBadgeComplete: { backgroundColor: 'rgba(22,163,74,0.12)', borderColor: 'rgba(74,222,128,0.35)' },
  reviewBadgeNeeded: { backgroundColor: 'rgba(217,119,6,0.10)', borderColor: 'rgba(251,191,36,0.35)' },
  reviewBadgeText: { fontSize: 10, fontWeight: '900' },
  reviewBadgeTextComplete: { color: '#86efac' },
  reviewBadgeTextNeeded: { color: '#fbbf24' },
  reviewToggle: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 8 },
  reviewToggleText: { color: '#93c5fd', fontSize: 11, fontWeight: '800' },
  review: { borderTopWidth: 1, borderTopColor: '#1a3a4a', marginTop: 14, paddingTop: 14 },
  reviewTitle: { color: '#c8e8f0', fontSize: 12, fontWeight: '800', marginBottom: 10 },
  reviewOptions: { flexDirection: 'row', gap: 7 },
  reviewOption: { flex: 1, minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: '#1a3a4a', backgroundColor: 'rgba(5,10,15,0.35)', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 4, paddingVertical: 7 },
  reviewOptionSelected: { borderColor: '#3b82f6', backgroundColor: 'rgba(37,99,235,0.22)' },
  reviewOptionText: { color: '#4a7a8a', fontSize: 10, fontWeight: '800', textAlign: 'center' },
  reviewOptionTextSelected: { color: '#dbeafe' },
  reviewPrivacy: { color: '#4a7a8a', fontSize: 10, lineHeight: 14, marginTop: 8 },
  conditions: { borderTopWidth: 1, borderTopColor: '#1a3a4a', marginTop: 14, paddingTop: 14 },
  conditionsTitle: { color: '#c8e8f0', fontSize: 12, fontWeight: '800' },
  conditionsSafety: { color: '#fbbf24', fontSize: 10, fontWeight: '700', marginTop: 4, marginBottom: 10 },
  conditionGroup: { marginTop: 9 },
  conditionLabel: { color: '#6592a5', fontSize: 10, fontWeight: '800', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  conditionOptions: { flexDirection: 'row', gap: 7 },
  conditionOption: { flex: 1, minHeight: 38, borderRadius: 9, borderWidth: 1, borderColor: '#1a3a4a', backgroundColor: 'rgba(5,10,15,0.35)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, paddingVertical: 7 },
  conditionOptionSelected: { borderColor: '#3b82f6', backgroundColor: 'rgba(37,99,235,0.22)' },
  conditionOptionText: { color: '#4a7a8a', fontSize: 10, fontWeight: '800', textAlign: 'center' },
  conditionOptionTextSelected: { color: '#dbeafe' },
  conditionsPrivacy: { color: '#4a7a8a', fontSize: 10, lineHeight: 14, marginTop: 10 },
  deviceImpact: { borderTopWidth: 1, borderTopColor: '#1a3a4a', marginTop: 14, paddingTop: 14 },
  deviceImpactNote: { color: '#6592a5', fontSize: 10, lineHeight: 14, marginTop: 4, marginBottom: 4 },
  deviceWarning: { color: '#fbbf24', fontSize: 10, fontWeight: '700', lineHeight: 14, marginTop: 10 },
  feedbackBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderTopWidth: 1, borderTopColor: '#1a3a4a', marginTop: 14, paddingTop: 14 },
  feedbackTxt: { color: '#93c5fd', fontSize: 13, fontWeight: '800' },
});
