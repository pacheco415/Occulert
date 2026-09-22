import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView, TouchableOpacity, Alert, Share, ActivityIndicator,
  type LayoutChangeEvent,
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
import { loadSessionHistory, updateSessionHistory } from '../lib/sessionHistory';
import {
  commitSessionHistoryEdit,
  removeMatchingSessionRecord,
  updateMatchingSessionRecord,
  type SessionRecordMutation,
} from '../lib/sessionHistoryEdits';
import { formatPilotCounts, summarizePilotCoverage, summarizePilotIssues } from '../lib/pilotInsights';
import type { SensitivityLevel } from '../constants/thresholds';
import { AmbientBackground } from '../components/GlassSurface';
import { colors, radii } from '../constants/theme';
import type { MonitorPerformanceSnapshot } from '../lib/monitorPerformance';
import {
  groupIndexedSessionsByDate,
  normalizeHistoryFilter,
  sortIndexedSessionsNewest,
  type HistoryFilter,
} from '../lib/historyPreferences';
import { buildSessionHistoryExport } from '../lib/sessionHistoryExport';
import { buildPilotProgressExport } from '../lib/pilotProgressExport';
import { createSingleFlightActionRunner } from '../lib/singleFlightAction';
import {
  getSessionReviewProgress,
  hasCompleteSessionReview,
  incompleteSessionReviewQueue,
} from '../lib/sessionReviewProgress';

const HISTORY_FILTER_KEY = 'occulert-session-history-filter';
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
  { value: 'false_alert', label: 'Unnecessary', icon: 'alert-circle-outline' },
  { value: 'missed_alert', label: 'Missed alert', icon: 'eye-off-outline' },
  { value: 'late_alert', label: 'Too late', icon: 'time-outline' },
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

const HISTORY_FILTERS: Array<{ value: HistoryFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'needs-review', label: 'Needs review' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'recovered', label: 'Recovered' },
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

function sessionRecordKey(item: SessionRecord, index: number): string {
  return item.sessionId || `${item.savedAt || item.updatedAt || 'session'}-${index}`;
}

type SessionOperation = 'saving' | 'deleting';

export default function HistoryScreen() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [historyLoadError, setHistoryLoadError] = useState(false);
  const [historyLoadBusy, setHistoryLoadBusy] = useState(true);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const [showReviewProgress, setShowReviewProgress] = useState(false);
  const [expandedSessions, setExpandedSessions] = useState<Record<string, boolean>>({});
  const [sessionOperations, setSessionOperations] = useState<Record<string, SessionOperation>>({});
  const [reviewQueueMessage, setReviewQueueMessage] = useState<{ key: string; text: string } | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const pendingReviewScrollRef = useRef<string | null>(null);
  const historyRevisionRef = useRef(0);
  const filterRevisionRef = useRef(0);
  const historyLoadAttemptRef = useRef(0);
  const sessionOperationRunnersRef = useRef(new Map<string, ReturnType<typeof createSingleFlightActionRunner>>());

  const runSessionOperation = async (
    operationKey: string,
    operation: SessionOperation,
    action: () => Promise<void>,
    onError: () => void,
  ): Promise<boolean> => {
    let runner = sessionOperationRunnersRef.current.get(operationKey);
    if (!runner) {
      runner = createSingleFlightActionRunner();
      sessionOperationRunnersRef.current.set(operationKey, runner);
    }
    return runner.run({
      action,
      onBusyChange: busy => setSessionOperations(current => {
        if (busy) return { ...current, [operationKey]: operation };
        const next = { ...current };
        delete next[operationKey];
        return next;
      }),
      onError,
    });
  };

  const load = useCallback(async () => {
    const loadAttempt = historyLoadAttemptRef.current + 1;
    historyLoadAttemptRef.current = loadAttempt;
    const revision = historyRevisionRef.current;
    const filterRevision = filterRevisionRef.current;
    setHistoryLoadBusy(true);
    try {
      const [storedSessions, savedFilter] = await Promise.all([
        loadSessionHistory<SessionRecord>(),
        AsyncStorage.getItem(HISTORY_FILTER_KEY).catch(() => null),
      ]);
      if (historyLoadAttemptRef.current === loadAttempt && historyRevisionRef.current === revision) {
        setSessions(storedSessions);
        setHistoryLoadError(false);
        if (filterRevisionRef.current === filterRevision) {
          setHistoryFilter(normalizeHistoryFilter(savedFilter));
        }
      }
    } catch {
      if (
        historyLoadAttemptRef.current === loadAttempt
        && historyRevisionRef.current === revision
      ) setHistoryLoadError(true);
    } finally {
      if (historyLoadAttemptRef.current === loadAttempt) {
        setLoaded(true);
        setHistoryLoadBusy(false);
      }
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
    return () => { historyLoadAttemptRef.current += 1; };
  }, [load]));

  const chooseHistoryFilter = (filter: HistoryFilter) => {
    filterRevisionRef.current += 1;
    setHistoryFilter(filter);
    setReviewQueueMessage(null);
    AsyncStorage.setItem(HISTORY_FILTER_KEY, filter).catch(() => {
      Alert.alert('Could not remember this view', 'The filter still works now, but it may reset next time.');
    });
  };

  const saveSessionChanges = async (
    index: number,
    update: SessionRecordMutation<SessionRecord>,
    errorTitle: string,
    errorMessage: string,
  ) => {
    const target = sessions[index];
    if (!target) return;

    const completesReview = !hasCompleteSessionReview(target) && hasCompleteSessionReview(update(target));

    let commitSucceeded = false;
    const operationCompleted = await runSessionOperation(
      sessionRecordKey(target, index),
      'saving',
      async () => {
        historyRevisionRef.current += 1;
        commitSucceeded = await commitSessionHistoryEdit({
          update,
          persist: mutation => updateSessionHistory<SessionRecord>(stored => (
            updateMatchingSessionRecord(stored, target, index, mutation)
          )),
          apply: mutation => setSessions(current => (
            updateMatchingSessionRecord(current, target, index, mutation)
          )),
          onError: () => Alert.alert(errorTitle, errorMessage),
        });
      },
      () => Alert.alert(errorTitle, errorMessage),
    );

    if (operationCompleted && commitSucceeded && completesReview && !target.recoveredFromInterruption) {
      setReviewQueueMessage(null);
      const queue = incompleteSessionReviewQueue(sortIndexedSessionsNewest(sessions), index);
      if (queue.length === 0) {
        Alert.alert(
          'Review queue complete',
          'Every completed session has a full review. Your ratings remain saved on this iPhone.',
        );
        return;
      }

      const next = queue[0];
      Alert.alert(
        'Review complete',
        `${queue.length} unfinished ${queue.length === 1 ? 'session remains' : 'sessions remain'}.`,
        [
          { text: 'Done', style: 'cancel' },
          {
            text: 'Review Next',
            onPress: () => {
              const key = sessionRecordKey(next.item, next.index);
              pendingReviewScrollRef.current = key;
              chooseHistoryFilter('needs-review');
              setExpandedSessions(current => ({ ...current, [key]: true }));
              setReviewQueueMessage({
                key,
                text: `Next unfinished review · ${queue.length} ${queue.length === 1 ? 'session' : 'sessions'} remaining`,
              });
            },
          },
        ],
      );
    }
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

  const shareSessions = async (items: SessionRecord[]) => {
    if (items.length === 0) return;
    try {
      await Share.share({
        title: 'Occulert session summaries',
        message: buildSessionHistoryExport(items),
      });
    } catch {
      Alert.alert('Could not share summaries', 'Please try exporting the session summaries again.');
    }
  };

  const sharePilotProgress = async () => {
    try {
      await Share.share({
        title: 'Occulert pilot progress',
        message: buildPilotProgressExport(sessions, CHECKPOINT_TARGET),
      });
    } catch {
      Alert.alert('Could not share pilot progress', 'Please try exporting the aggregate pilot report again.');
    }
  };

  const deleteSession = async (target: SessionRecord, index: number) => {
    await runSessionOperation(
      sessionRecordKey(target, index),
      'deleting',
      async () => {
        historyRevisionRef.current += 1;
        await updateSessionHistory<SessionRecord>(stored => (
          removeMatchingSessionRecord(stored, target, index)
        ));
        setSessions(current => removeMatchingSessionRecord(current, target, index));
      },
      () => Alert.alert('Could not delete session', 'The session remains saved. Please try again.'),
    );
  };

  const confirmDeleteSession = (target: SessionRecord, index: number) => {
    Alert.alert(
      'Delete this session?',
      'This permanently removes the local session summary from this iPhone. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { void deleteSession(target, index); } },
      ],
    );
  };

  const evidenceSessions = sessions.filter(item => !item.recoveredFromInterruption);
  const reviewedMedium = evidenceSessions.filter(
    item => item.sensitivity === 'medium' && hasCompleteSessionReview(item),
  );
  const checkpointProgress = Math.min(reviewedMedium.length, CHECKPOINT_TARGET);
  const accurateCount = reviewedMedium.filter(item => item.alertAssessment === 'accurate').length;
  const falseAlertCount = reviewedMedium.filter(item => item.alertAssessment === 'false_alert').length;
  const missedAlertCount = reviewedMedium.filter(item => item.alertAssessment === 'missed_alert').length;
  const lateAlertCount = reviewedMedium.filter(item => item.alertAssessment === 'late_alert').length;
  const completeConditionCount = reviewedMedium.filter(item => (
    Boolean(item.testConditions?.lighting)
    && Boolean(item.testConditions?.eyewear)
    && Boolean(item.testConditions?.phonePosition)
  )).length;
  const completeDeviceImpactCount = reviewedMedium.filter(item => (
    Boolean(item.deviceImpact?.batteryImpact) && Boolean(item.deviceImpact?.phoneHeat)
  )).length;
  const pilotCoverage = summarizePilotCoverage(reviewedMedium);
  const issueInsights = summarizePilotIssues(evidenceSessions);
  const issueSessionCount = issueInsights.reduce((total, insight) => total + insight.total, 0);
  const reviewedCount = sessions.filter(item => !item.recoveredFromInterruption && hasCompleteSessionReview(item)).length;
  const needsReviewCount = sessions.filter(item => !item.recoveredFromInterruption && !hasCompleteSessionReview(item)).length;
  const recoveredCount = sessions.filter(item => item.recoveredFromInterruption).length;
  const filterCounts: Record<HistoryFilter, number> = {
    all: sessions.length,
    'needs-review': needsReviewCount,
    reviewed: reviewedCount,
    recovered: recoveredCount,
  };
  const sortedSessions = sortIndexedSessionsNewest(sessions);
  const nextReviewSession = sortedSessions.find(({ item }) => (
    !item.recoveredFromInterruption && !hasCompleteSessionReview(item)
  ));
  const filteredSessions = sortedSessions
    .filter(({ item }) => {
      if (historyFilter === 'recovered') return Boolean(item.recoveredFromInterruption);
      if (historyFilter === 'reviewed') return !item.recoveredFromInterruption && hasCompleteSessionReview(item);
      if (historyFilter === 'needs-review') return !item.recoveredFromInterruption && !hasCompleteSessionReview(item);
      return true;
    });
  const groupedFilteredSessions = groupIndexedSessionsByDate(filteredSessions);
  const sessionOperationsBusy = Object.keys(sessionOperations).length > 0;
  const filteredEmptyCopy: Record<Exclude<HistoryFilter, 'all'>, { title: string; detail: string }> = {
    'needs-review': {
      title: 'All caught up',
      detail: 'Every completed session has a full review.',
    },
    reviewed: {
      title: 'No completed reviews yet',
      detail: 'Finish the alert rating, test conditions, and device-impact notes on a session to see it here.',
    },
    recovered: {
      title: 'No recovered sessions',
      detail: 'Sessions restored after an unexpected interruption will appear here.',
    },
  };

  const continueReviewing = () => {
    if (!nextReviewSession || sessionOperationsBusy) return;
    const key = sessionRecordKey(nextReviewSession.item, nextReviewSession.index);
    pendingReviewScrollRef.current = key;
    chooseHistoryFilter('needs-review');
    setExpandedSessions(current => ({ ...current, [key]: true }));
    setReviewQueueMessage({
      key,
      text: `${needsReviewCount} unfinished ${needsReviewCount === 1 ? 'session' : 'sessions'} in this review queue`,
    });
  };

  const scrollToPendingReview = (key: string, event: LayoutChangeEvent) => {
    if (pendingReviewScrollRef.current !== key) return;
    pendingReviewScrollRef.current = null;
    scrollRef.current?.scrollTo({
      y: Math.max(0, event.nativeEvent.layout.y - 12),
      animated: true,
    });
  };

  return (
    <SafeAreaView style={s.bg}>
      <AmbientBackground />
      <ScrollView ref={scrollRef} contentContainerStyle={s.scroll}>
        <Text style={s.title}>Session History</Text>

        {!loaded && historyLoadBusy && (
          <View
            accessibilityLabel="Checking local session history"
            accessibilityLiveRegion="polite"
            style={s.loadingBox}
          >
            <ActivityIndicator size="small" color={colors.cyan} />
            <View style={s.loadErrorCopy}>
              <Text style={s.loadingTitle}>Checking local history</Text>
              <Text style={s.loadErrorDetail}>Reading session summaries saved on this iPhone.</Text>
            </View>
          </View>
        )}

        {loaded && historyLoadError && (
          <View accessibilityRole="alert" style={s.loadError}>
            <Ionicons name="warning-outline" size={21} color="#fbbf24" />
            <View style={s.loadErrorCopy}>
              <Text style={s.loadErrorTitle}>Couldn’t load local history</Text>
              <Text style={s.loadErrorDetail}>
                {sessions.length > 0
                  ? 'The last loaded sessions remain visible below. Retry to confirm they are current.'
                  : 'Your saved sessions were not deleted. Try reading them from this iPhone again.'}
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={historyLoadBusy ? 'Retrying local session history' : 'Retry local session history'}
                accessibilityState={{ disabled: historyLoadBusy, busy: historyLoadBusy }}
                disabled={historyLoadBusy}
                onPress={() => { void load(); }}
                style={s.loadRetry}
              >
                <Text style={s.loadRetryText}>{historyLoadBusy ? 'Retrying…' : 'Try again'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {loaded && sessions.length > 0 && (
          <>
            <View style={s.historySummary}>
              <View style={s.historySummaryItem}>
                <Text style={s.historySummaryValue}>{needsReviewCount}</Text>
                <Text style={s.historySummaryLabel}>Need review</Text>
              </View>
              <View style={s.historySummaryDivider} />
              <View style={s.historySummaryItem}>
                <Text style={s.historySummaryValue}>{reviewedCount}</Text>
                <Text style={s.historySummaryLabel}>Reviewed</Text>
              </View>
              <View style={s.historySummaryDivider} />
              <View style={s.historySummaryItem}>
                <Text style={s.historySummaryValue}>{recoveredCount}</Text>
                <Text style={s.historySummaryLabel}>Recovered</Text>
              </View>
            </View>
            {nextReviewSession && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Continue reviewing the newest unfinished session from ${fmtDate(nextReviewSession.item.savedAt || nextReviewSession.item.updatedAt)}`}
                accessibilityHint="Shows the Needs Review queue and expands the newest unfinished session"
                accessibilityState={{ disabled: sessionOperationsBusy, busy: sessionOperationsBusy }}
                disabled={sessionOperationsBusy}
                onPress={continueReviewing}
                style={[s.continueReviewButton, sessionOperationsBusy && s.operationDisabled]}
              >
                <View style={s.continueReviewIcon}>
                  <Ionicons name="arrow-forward" size={17} color="#dbeafe" />
                </View>
                <View style={s.continueReviewCopy}>
                  <Text style={s.continueReviewTitle}>Continue reviewing</Text>
                  <Text style={s.continueReviewDetail}>
                    Open the newest unfinished session · {checkpointProgress} of {CHECKPOINT_TARGET} Medium reviews complete
                  </Text>
                </View>
              </TouchableOpacity>
            )}
            <View accessibilityRole="tablist" style={s.filterRow}>
              {HISTORY_FILTERS.map(filter => {
                const selected = historyFilter === filter.value;
                return (
                  <TouchableOpacity
                    key={filter.value}
                    accessibilityRole="tab"
                    accessibilityLabel={`${filter.label}, ${filterCounts[filter.value]} sessions`}
                    accessibilityHint="Filters the saved session list"
                    accessibilityState={{ selected }}
                    style={[s.filterButton, selected && s.filterButtonSelected]}
                    onPress={() => chooseHistoryFilter(filter.value)}
                  >
                    <Text style={[s.filterButtonText, selected && s.filterButtonTextSelected]}>
                      {filter.label} · {filterCounts[filter.value]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text accessibilityLiveRegion="polite" style={s.filterResult}>
              Showing {filteredSessions.length} of {sessions.length} sessions
            </Text>
            {filteredSessions.length > 0 && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={sessionOperationsBusy
                  ? 'Wait for session changes before sharing summaries'
                  : `Share ${filteredSessions.length} visible session summaries`}
                accessibilityHint="Opens the iPhone share sheet with a privacy-limited text export"
                accessibilityState={{ disabled: sessionOperationsBusy, busy: sessionOperationsBusy }}
                disabled={sessionOperationsBusy}
                style={[s.exportButton, sessionOperationsBusy && s.operationDisabled]}
                onPress={() => { void shareSessions(filteredSessions.map(({ item }) => item)); }}
              >
                <Ionicons name="share-outline" size={16} color="#93c5fd" />
                <Text style={s.exportButtonText}>SHARE SHOWN SUMMARIES</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityHint="Shows aggregate progress and test-condition coverage"
              accessibilityState={{ expanded: showReviewProgress }}
              style={s.reviewToggle}
              onPress={() => setShowReviewProgress(current => !current)}
            >
              <Text style={s.reviewToggleText}>
                {showReviewProgress ? 'Hide review progress' : 'Show review progress'}
              </Text>
              <Ionicons name={showReviewProgress ? 'chevron-up' : 'chevron-down'} size={15} color="#93c5fd" />
            </TouchableOpacity>
          </>
        )}

        {loaded && sessions.length > 0 && showReviewProgress && (
          <View style={s.checkpoint}>
            <View style={s.checkpointHeader}>
              <View style={s.checkpointHeaderCopy}>
                <Text style={s.checkpointEyebrow}>DRIVE REVIEW PROGRESS</Text>
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
              <Text style={s.checkpointStat}>{lateAlertCount} late</Text>
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
                {pilotCoverage.coveredCount} of {pilotCoverage.totalCount} planned condition variants represented
              </Text>
              <View style={s.coverageGrid}>
                {pilotCoverage.items.map(item => (
                  <View
                    accessible
                    accessibilityLabel={`${item.label}, ${item.count} reviewed ${item.count === 1 ? 'session' : 'sessions'}`}
                    key={item.id}
                    style={[s.coverageItem, item.count > 0 && s.coverageItemCovered]}
                  >
                    <Ionicons
                      name={item.count > 0 ? 'checkmark-circle' : 'ellipse-outline'}
                      size={14}
                      color={item.count > 0 ? '#86efac' : '#fbbf24'}
                    />
                    <Text style={[s.coverageItemText, item.count > 0 && s.coverageItemTextCovered]}>
                      {item.label} · {item.count}
                    </Text>
                  </View>
                ))}
              </View>
              <Text
                accessibilityLiveRegion="polite"
                style={pilotCoverage.missingLabels.length > 0 ? s.coverageMissing : s.coverageComplete}
              >
                {pilotCoverage.missingLabels.length > 0
                  ? `Still needed: ${pilotCoverage.missingLabels.join(', ')}`
                  : 'Every planned lighting, eyewear, and phone-position variant is represented.'}
              </Text>
              <Text style={s.coverageStats}>
                {completeDeviceImpactCount} include battery-use and phone-heat observations
              </Text>
              <Text style={s.coverageCaution}>
                Coverage prevents obvious gaps; one session in a condition is not enough to establish accuracy.
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
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={sessionOperationsBusy
                ? 'Wait for session changes before sharing pilot progress'
                : 'Share aggregate pilot progress'}
              accessibilityHint="Opens the iPhone share sheet with condition coverage and aggregate review counts"
              accessibilityState={{ disabled: sessionOperationsBusy, busy: sessionOperationsBusy }}
              disabled={sessionOperationsBusy}
              onPress={() => { void sharePilotProgress(); }}
              style={[s.pilotExportButton, sessionOperationsBusy && s.operationDisabled]}
            >
              <Ionicons name="document-text-outline" size={17} color="#bfdbfe" />
              <View style={s.pilotExportCopy}>
                <Text style={s.pilotExportTitle}>Share pilot progress</Text>
                <Text style={s.pilotExportDetail}>Aggregate counts only · no session or driver identifiers</Text>
              </View>
              <Ionicons name="share-outline" size={16} color="#93c5fd" />
            </TouchableOpacity>
          </View>
        )}

        {loaded && !historyLoadError && sessions.length === 0 && (
          <View style={s.empty}>
            <Ionicons name="time-outline" size={40} color="#4a7a8a" />
            <Text style={s.emptyTitle}>No sessions yet</Text>
            <Text style={s.emptySub}>
              Completed monitoring sessions will appear here.
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Start a new monitoring session"
              style={s.cta}
              onPress={() => router.push('/pre-drive')}
            >
              <Text style={s.ctaTxt}>Start Monitoring</Text>
            </TouchableOpacity>
          </View>
        )}

        {loaded && sessions.length > 0 && filteredSessions.length === 0 && historyFilter !== 'all' && (
          <View style={s.filteredEmpty}>
            <Ionicons name="checkmark-circle-outline" size={32} color="#4a7a8a" />
            <Text style={s.emptyTitle}>{filteredEmptyCopy[historyFilter].title}</Text>
            <Text style={s.emptySub}>{filteredEmptyCopy[historyFilter].detail}</Text>
            <TouchableOpacity
              accessibilityRole="button"
              style={s.clearFilterButton}
              onPress={() => chooseHistoryFilter('all')}
            >
              <Text style={s.clearFilterText}>Show all sessions</Text>
            </TouchableOpacity>
          </View>
        )}

        {groupedFilteredSessions.map(group => (
          <React.Fragment key={group.key}>
            <View
              accessible
              accessibilityRole="header"
              accessibilityLabel={`${group.label}, ${group.sessions.length} ${group.sessions.length === 1 ? 'session' : 'sessions'}`}
              style={s.dateGroupHeader}
            >
              <Text style={s.dateGroupTitle}>{group.label}</Text>
              <Text style={s.dateGroupCount}>{group.sessions.length}</Text>
            </View>
        {group.sessions.map(({ item, index: i }) => {
          const sessionKey = sessionRecordKey(item, i);
          const sessionOperation = sessionOperations[sessionKey];
          const sessionBusy = Boolean(sessionOperation);
          const reviewProgress = getSessionReviewProgress(item);
          const reviewComplete = reviewProgress.complete;
          const isExpanded = expandedSessions[sessionKey] ?? false;
          return (
          <View
            key={sessionKey}
            onLayout={event => scrollToPendingReview(sessionKey, event)}
            style={[
              s.card,
              item.recoveredFromInterruption
                ? s.cardRecovered
                : !reviewComplete && s.cardNeedsReview,
            ]}
          >
            {reviewQueueMessage?.key === sessionKey && (
              <View accessibilityRole="alert" style={s.reviewQueueMessage}>
                <Ionicons name="arrow-forward-circle-outline" size={17} color="#93c5fd" />
                <Text style={s.reviewQueueMessageText}>{reviewQueueMessage.text}</Text>
              </View>
            )}
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
            {isExpanded && item.monitorPerformance && (
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
                {item.monitorPerformance.alertTiming?.alertsTriggered > 0 && (
                  <>
                    <Text style={s.performanceInfo}>
                      Phone software dispatch: {item.monitorPerformance.alertTiming.averagePhoneDispatchMs} ms average · {item.monitorPerformance.alertTiming.maxPhoneDispatchMs} ms max
                    </Text>
                    <Text style={s.performanceInfo}>
                      Watch live acknowledgements: {item.monitorPerformance.alertTiming.watchLiveAcknowledgements}/{item.monitorPerformance.alertTiming.watchResults}
                      {item.monitorPerformance.alertTiming.watchLiveAcknowledgements > 0
                        ? ` · ${item.monitorPerformance.alertTiming.averageWatchRoundTripMs} ms average round trip`
                        : ''}
                      {item.monitorPerformance.alertTiming.watchQueuedFallbacks > 0
                        ? ` · ${item.monitorPerformance.alertTiming.watchQueuedFallbacks} queued backup`
                        : ''}
                    </Text>
                  </>
                )}
                <Text style={s.performanceCaution}>
                  Aggregate camera and alert timings stay in this session record on this iPhone. Phone dispatch is measured before hardware sound begins; Watch timing is message acknowledgement, not haptic onset. No camera frames are saved.
                </Text>
              </View>
            )}
            {isExpanded && (item.headNodObservations != null || item.headphoneMotionStatus != null) && (
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
              <View style={[
                s.reviewBadge,
                sessionBusy ? s.reviewBadgeBusy : reviewComplete ? s.reviewBadgeComplete : s.reviewBadgeNeeded,
              ]}>
                <Ionicons
                  name={sessionBusy ? 'sync-outline' : reviewComplete ? 'checkmark-circle' : 'ellipse-outline'}
                  size={14}
                  color={sessionBusy ? '#93c5fd' : reviewComplete ? '#86efac' : '#fbbf24'}
                />
                <Text
                  accessibilityLiveRegion="polite"
                  style={[
                    s.reviewBadgeText,
                    sessionBusy ? s.reviewBadgeTextBusy : reviewComplete ? s.reviewBadgeTextComplete : s.reviewBadgeTextNeeded,
                  ]}
                >
                  {sessionOperation === 'saving'
                    ? 'Saving changes…'
                    : sessionOperation === 'deleting'
                      ? 'Deleting session…'
                      : reviewComplete ? 'Review complete' : item.alertAssessment ? 'Rating saved' : 'Needs review'}
                </Text>
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={isExpanded ? 'Hide session review details' : 'Show session review details'}
                accessibilityHint="Shows test conditions, device impact, and local diagnostics"
                accessibilityState={{ expanded: isExpanded }}
                style={s.reviewToggle}
                onPress={() => setExpandedSessions(current => ({
                  ...current,
                  [sessionKey]: !(current[sessionKey] ?? false),
                }))}
              >
                <Text style={s.reviewToggleText}>{isExpanded ? 'Hide details' : 'Show details'}</Text>
                <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={15} color="#93c5fd" />
              </TouchableOpacity>
            </View>
            <View
              accessible
              accessibilityLabel={reviewComplete
                ? 'Review complete, 3 of 3 steps complete'
                : `Review incomplete, ${reviewProgress.completedSteps} of ${reviewProgress.totalSteps} steps complete. ${reviewProgress.missingSummary}`}
              accessibilityLiveRegion="polite"
              style={[s.reviewProgress, reviewComplete && s.reviewProgressComplete]}
            >
              <View style={s.reviewProgressHeader}>
                <Text style={[s.reviewProgressTitle, reviewComplete && s.reviewProgressTitleComplete]}>
                  {reviewComplete ? 'Review checklist complete' : 'Finish this review'}
                </Text>
                <Text style={s.reviewProgressCount}>
                  {reviewProgress.completedSteps}/{reviewProgress.totalSteps}
                </Text>
              </View>
              {!reviewComplete && (
                <Text style={s.reviewProgressMissing}>{reviewProgress.missingSummary}</Text>
              )}
              {isExpanded && (
                <View style={s.reviewChecklist}>
                  {reviewProgress.steps.map(step => (
                    <View key={step.id} style={s.reviewChecklistRow}>
                      <Ionicons
                        name={step.complete ? 'checkmark-circle' : 'ellipse-outline'}
                        size={16}
                        color={step.complete ? '#86efac' : '#fbbf24'}
                      />
                      <View style={s.reviewChecklistCopy}>
                        <Text style={s.reviewChecklistLabel}>{step.label}</Text>
                        {!step.complete && (
                          <Text style={s.reviewChecklistMissing}>Add {step.missing.join(', ')}</Text>
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
            <View style={s.review}>
              <Text style={s.reviewTitle}>How did the alerts feel?</Text>
              {item.alertAssessment && (
                <Text accessibilityLiveRegion="polite" style={s.reviewPrivacy}>
                  Saved: {ASSESSMENT_OPTIONS.find(option => option.value === item.alertAssessment)?.label || 'Reviewed'}
                </Text>
              )}
              <View style={s.reviewOptions}>
                {ASSESSMENT_OPTIONS.map((option) => {
                  const selected = item.alertAssessment === option.value;
                  return (
                    <TouchableOpacity
                      key={option.value}
                      accessibilityRole="button"
                      accessibilityLabel={option.label}
                      accessibilityState={{ selected, disabled: sessionBusy, busy: sessionBusy }}
                      disabled={sessionBusy}
                      style={[s.reviewOption, selected && s.reviewOptionSelected, sessionBusy && s.operationDisabled]}
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
                This alert rating stays only on this iPhone. Choose the best match after parking. It is included only if you choose to send feedback.
              </Text>
            </View>
            {isExpanded && (
              <>
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
                          accessibilityState={{ selected, disabled: sessionBusy, busy: sessionBusy }}
                          disabled={sessionBusy}
                          style={[s.conditionOption, selected && s.conditionOptionSelected, sessionBusy && s.operationDisabled]}
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
                          accessibilityState={{ selected, disabled: sessionBusy, busy: sessionBusy }}
                          disabled={sessionBusy}
                          style={[s.conditionOption, selected && s.conditionOptionSelected, sessionBusy && s.operationDisabled]}
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
              </>
            )}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Send feedback about this session"
              accessibilityState={{ disabled: sessionBusy, busy: sessionBusy }}
              disabled={sessionBusy}
              style={[s.feedbackBtn, sessionBusy && s.operationDisabled]}
              onPress={async () => {
                if (!await openFeedback(item)) {
                  Alert.alert('Mail is unavailable', 'Email hello@occulert.com to share pilot feedback.');
                }
              }}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={16} color="#93c5fd" />
              <Text style={s.feedbackTxt}>Send session feedback</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Delete session from ${fmtDate(item.savedAt || item.updatedAt)}`}
              accessibilityHint="Permanently removes this local session after confirmation"
              accessibilityState={{ disabled: sessionBusy, busy: sessionBusy }}
              disabled={sessionBusy}
              style={[s.deleteBtn, sessionBusy && s.operationDisabled]}
              onPress={() => confirmDeleteSession(item, i)}
            >
              <Ionicons name="trash-outline" size={16} color="#fca5a5" />
              <Text style={s.deleteTxt}>Delete local session</Text>
            </TouchableOpacity>
          </View>
          );
        })}
          </React.Fragment>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 20, paddingBottom: 48 },
  title: { color: colors.text, fontSize: 32, fontWeight: '800', letterSpacing: -0.8, marginBottom: 20 },
  loadError: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: 'rgba(251,191,36,0.08)', borderWidth: 1, borderColor: 'rgba(251,191,36,0.28)', borderRadius: radii.large, padding: 14, marginBottom: 16 },
  loadingBox: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(56,189,248,0.07)', borderWidth: 1, borderColor: 'rgba(56,189,248,0.2)', borderRadius: radii.large, padding: 14, marginBottom: 16 },
  loadingTitle: { color: '#bae6fd', fontSize: 13, fontWeight: '900' },
  loadErrorCopy: { minWidth: 0, flex: 1 },
  loadErrorTitle: { color: '#fde68a', fontSize: 13, fontWeight: '900' },
  loadErrorDetail: { color: colors.textSecondary, fontSize: 11, lineHeight: 17, marginTop: 3 },
  loadRetry: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingRight: 18 },
  loadRetryText: { color: '#93c5fd', fontSize: 12, fontWeight: '900' },
  historySummary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', backgroundColor: colors.materialStrong, borderWidth: 1, borderColor: colors.glassBorder, borderRadius: radii.large, paddingVertical: 13, marginBottom: 12 },
  historySummaryItem: { flexGrow: 1, flexBasis: 90, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  historySummaryValue: { color: '#e0f2fe', fontSize: 19, fontWeight: '900' },
  historySummaryLabel: { color: '#6592a5', fontSize: 9, fontWeight: '800', marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.4 },
  historySummaryDivider: { width: 1, backgroundColor: '#1a3a4a' },
  continueReviewButton: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: 'rgba(37,99,235,0.14)', borderWidth: 1, borderColor: 'rgba(96,165,250,0.35)', borderRadius: radii.large, paddingHorizontal: 13, paddingVertical: 10, marginBottom: 12 },
  continueReviewIcon: { flexShrink: 0, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(37,99,235,0.5)' },
  continueReviewCopy: { minWidth: 0, flex: 1 },
  continueReviewTitle: { color: '#dbeafe', fontSize: 13, fontWeight: '900' },
  continueReviewDetail: { color: '#93c5fd', fontSize: 10, lineHeight: 15, marginTop: 2 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 7 },
  filterButton: { minHeight: 44, justifyContent: 'center', borderRadius: 999, borderWidth: 1, borderColor: '#1a3a4a', backgroundColor: 'rgba(5,10,15,0.35)', paddingHorizontal: 11, paddingVertical: 7 },
  filterButtonSelected: { borderColor: '#3b82f6', backgroundColor: 'rgba(37,99,235,0.22)' },
  filterButtonText: { color: '#6592a5', fontSize: 10, fontWeight: '800' },
  filterButtonTextSelected: { color: '#dbeafe' },
  filterResult: { color: '#4a7a8a', fontSize: 10, marginBottom: 2 },
  exportButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderColor: '#1a3a4a', borderRadius: 10, marginTop: 8, paddingHorizontal: 12 },
  exportButtonText: { color: '#93c5fd', fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
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
  coverageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 9 },
  coverageItem: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: 'rgba(251,191,36,0.25)', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6 },
  coverageItemCovered: { borderColor: 'rgba(134,239,172,0.24)', backgroundColor: 'rgba(22,163,74,0.08)' },
  coverageItemText: { color: '#fbbf24', fontSize: 9, fontWeight: '800' },
  coverageItemTextCovered: { color: '#bbf7d0' },
  coverageMissing: { color: '#fbbf24', fontSize: 10, lineHeight: 15, marginTop: 9 },
  coverageComplete: { color: '#86efac', fontSize: 10, lineHeight: 15, marginTop: 9 },
  coverageCaution: { color: '#6592a5', fontSize: 9, lineHeight: 14, marginTop: 7 },
  pilotExportButton: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 9, borderTopWidth: 1, borderTopColor: '#1d4f68', marginTop: 14, paddingTop: 12 },
  pilotExportCopy: { minWidth: 0, flex: 1 },
  pilotExportTitle: { color: '#dbeafe', fontSize: 11, fontWeight: '900' },
  pilotExportDetail: { color: '#6592a5', fontSize: 9, lineHeight: 14, marginTop: 2 },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  filteredEmpty: { alignItems: 'center', backgroundColor: colors.material, borderWidth: 1, borderColor: colors.glassBorder, borderRadius: radii.large, paddingVertical: 34, paddingHorizontal: 16, gap: 8, marginTop: 12 },
  emptyTitle: { color: '#c8e8f0', fontSize: 17, fontWeight: '800', marginTop: 8 },
  emptySub: { color: '#4a7a8a', fontSize: 13, textAlign: 'center', lineHeight: 19, paddingHorizontal: 20 },
  cta: { marginTop: 16, backgroundColor: '#2563eb', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
  ctaTxt: { color: '#fff', fontSize: 14, fontWeight: '800' },
  clearFilterButton: { minHeight: 44, justifyContent: 'center', marginTop: 8, paddingHorizontal: 14 },
  clearFilterText: { color: '#93c5fd', fontSize: 12, fontWeight: '800' },
  dateGroupHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 8, paddingHorizontal: 4 },
  dateGroupTitle: { flex: 1, color: '#bae6fd', fontSize: 12, fontWeight: '900', letterSpacing: 0.6, textTransform: 'uppercase' },
  dateGroupCount: { flexShrink: 0, minWidth: 28, color: '#6592a5', fontSize: 11, fontWeight: '900', textAlign: 'right' },
  card: { backgroundColor: colors.material, borderWidth: 1, borderColor: colors.glassBorder, borderRadius: radii.large, padding: 18, marginBottom: 12 },
  cardNeedsReview: { borderColor: 'rgba(251,191,36,0.35)' },
  cardRecovered: { borderColor: 'rgba(74,222,128,0.35)' },
  reviewQueueMessage: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(37,99,235,0.12)', borderWidth: 1, borderColor: 'rgba(96,165,250,0.28)', borderRadius: 9, padding: 10, marginBottom: 12 },
  reviewQueueMessageText: { minWidth: 0, flex: 1, color: '#bfdbfe', fontSize: 10, lineHeight: 15, fontWeight: '800' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  date: { flex: 1, color: '#c8e8f0', fontSize: 13, fontWeight: '700' },
  dur: { flexShrink: 0, color: '#60a5fa', fontSize: 13, fontWeight: '800' },
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
  reviewProgress: { backgroundColor: 'rgba(251,191,36,0.06)', borderWidth: 1, borderColor: 'rgba(251,191,36,0.24)', borderRadius: 10, marginTop: 10, padding: 11 },
  reviewProgressComplete: { backgroundColor: 'rgba(134,239,172,0.05)', borderColor: 'rgba(134,239,172,0.22)' },
  reviewProgressHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  reviewProgressTitle: { flex: 1, color: '#fde68a', fontSize: 11, fontWeight: '900' },
  reviewProgressTitleComplete: { color: '#bbf7d0' },
  reviewProgressCount: { flexShrink: 0, color: '#93c5fd', fontSize: 11, fontWeight: '900' },
  reviewProgressMissing: { color: '#fbbf24', fontSize: 10, lineHeight: 15, marginTop: 4 },
  reviewChecklist: { borderTopWidth: 1, borderTopColor: '#1d4f68', marginTop: 9, paddingTop: 7, gap: 7 },
  reviewChecklistRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  reviewChecklistCopy: { minWidth: 0, flex: 1 },
  reviewChecklistLabel: { color: '#dbeafe', fontSize: 10, fontWeight: '800' },
  reviewChecklistMissing: { color: '#6592a5', fontSize: 9, lineHeight: 14, marginTop: 1 },
  observationCaution: { color: '#4a7a8a', fontSize: 9, lineHeight: 14, marginTop: 6 },
  reviewSummary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderTopWidth: 1, borderTopColor: '#1a3a4a', marginTop: 14, paddingTop: 14 },
  reviewBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 6 },
  reviewBadgeComplete: { backgroundColor: 'rgba(22,163,74,0.12)', borderColor: 'rgba(74,222,128,0.35)' },
  reviewBadgeNeeded: { backgroundColor: 'rgba(217,119,6,0.10)', borderColor: 'rgba(251,191,36,0.35)' },
  reviewBadgeBusy: { backgroundColor: 'rgba(37,99,235,0.14)', borderColor: 'rgba(96,165,250,0.38)' },
  reviewBadgeText: { fontSize: 10, fontWeight: '900' },
  reviewBadgeTextComplete: { color: '#86efac' },
  reviewBadgeTextNeeded: { color: '#fbbf24' },
  reviewBadgeTextBusy: { color: '#93c5fd' },
  reviewToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 8 },
  reviewToggleText: { color: '#93c5fd', fontSize: 11, fontWeight: '800' },
  review: { borderTopWidth: 1, borderTopColor: '#1a3a4a', marginTop: 14, paddingTop: 14 },
  reviewTitle: { color: '#c8e8f0', fontSize: 12, fontWeight: '800', marginBottom: 10 },
  reviewOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  reviewOption: { flexGrow: 1, flexBasis: '45%', minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: '#1a3a4a', backgroundColor: 'rgba(5,10,15,0.35)', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 4, paddingVertical: 7 },
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
  conditionOption: { flex: 1, minHeight: 44, borderRadius: 9, borderWidth: 1, borderColor: '#1a3a4a', backgroundColor: 'rgba(5,10,15,0.35)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, paddingVertical: 7 },
  conditionOptionSelected: { borderColor: '#3b82f6', backgroundColor: 'rgba(37,99,235,0.22)' },
  conditionOptionText: { color: '#4a7a8a', fontSize: 10, fontWeight: '800', textAlign: 'center' },
  conditionOptionTextSelected: { color: '#dbeafe' },
  conditionsPrivacy: { color: '#4a7a8a', fontSize: 10, lineHeight: 14, marginTop: 10 },
  deviceImpact: { borderTopWidth: 1, borderTopColor: '#1a3a4a', marginTop: 14, paddingTop: 14 },
  deviceImpactNote: { color: '#6592a5', fontSize: 10, lineHeight: 14, marginTop: 4, marginBottom: 4 },
  deviceWarning: { color: '#fbbf24', fontSize: 10, fontWeight: '700', lineHeight: 14, marginTop: 10 },
  feedbackBtn: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderTopWidth: 1, borderTopColor: '#1a3a4a', marginTop: 14, paddingTop: 8 },
  feedbackTxt: { color: '#93c5fd', fontSize: 13, fontWeight: '800' },
  deleteBtn: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  operationDisabled: { opacity: 0.5 },
  deleteTxt: { color: '#fca5a5', fontSize: 12, fontWeight: '800' },
});
