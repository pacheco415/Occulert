import type { SessionRecord, SessionOperation, TestConditionKey, TestConditionValue, DeviceImpactKey, DeviceImpactValue, HistoryRecordedFilterKey } from '../lib/historyRecord';
import { CHECKPOINT_TARGET, ASSESSMENT_OPTIONS, TEST_CONDITION_GROUPS, DEVICE_IMPACT_GROUPS, HISTORY_FILTERS, HISTORY_PERIODS, HISTORY_RECORDED_FILTERS, HISTORY_SORTS, HISTORY_ASSESSMENTS, historyReviewInput, hasCompleteHistoryReview, matchesHistoryReviewFilter, historyReviewQueue, historyScopeLabel, sessionRecordKey } from '../lib/historyReviewModel';
import { fmtDate, fmtDuration, sessionHistoryDate, sensitivityLabel, headphoneMotionLabel } from '../lib/historyPresentation';
import { deriveHistoryView } from '../lib/historyViewModel';
import { buildHistoryShareMessage, buildHistoryPilotProgressMessage } from '../lib/historyShareMessage';
import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView, TouchableOpacity, Alert, Share, ActivityIndicator, TextInput,
  type LayoutChangeEvent,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  openFeedbackWithFallback,
  type AlertAssessment,
  type FeedbackSession,
  type SessionDeviceImpact,
  type SessionTestConditions,
} from '../lib/feedback';
import { loadSessionHistory, updateSessionHistory } from '../lib/sessionHistory';
import { getPendingCloudSummaryState, pendingCloudSummaryStateIsCurrent, retryPendingCloudSessions, type PendingCloudSummaryState } from '../lib/cloudSync';
import { cloudSummaryPresentation } from '../lib/cloudSummaryPresentation';
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
import type { SensorFusionObservationSnapshot } from '../lib/sensorFusionObservation';
import {
  planNextFusionValidationSession,
  summarizeFusionValidation,
} from '../lib/fusionValidationSummary';
import {
  filterIndexedSessionsByPeriod,
  filterIndexedSessionsByAssessment,
  filterIndexedSessionsByRecordedConditions,
  DEFAULT_HISTORY_VIEW,
  hasHistoryAlertAssessment,
  normalizeHistoryAssessmentFilter,
  normalizeHistoryFilter,
  normalizeHistoryPeriod,
  normalizeHistoryViewPreferences,
  sortIndexedSessions,
  validateHistoryDateRange,
  type HistoryFilter,
  type HistoryAssessmentFilter,
  type HistoryPeriod,
  type HistorySort,
  type HistoryViewPreferences,
} from '../lib/historyPreferences';
import { buildSessionHistoryExport } from '../lib/sessionHistoryExport';
import { formatSessionAlertCount } from '../lib/sessionAlertCount';
import { formatSessionDuration, formatSessionFatigue, sessionSavedAt } from '../lib/sessionSummaryValues';
import { buildPilotProgressExport } from '../lib/pilotProgressExport';
import { createSingleFlightActionRunner } from '../lib/singleFlightAction';
import {
  getSessionReviewProgress,
  hasCompleteSessionReview,
  incompleteSessionReviewQueue,
} from '../lib/sessionReviewProgress';

const HISTORY_FILTER_KEY = 'occulert-session-history-filter';
const HISTORY_PERIOD_KEY = 'occulert-session-history-period';
const HISTORY_ASSESSMENT_KEY = 'occulert-session-history-assessment';
const HISTORY_VIEW_KEY = 'occulert-session-history-recorded-view';
export default function HistoryScreen() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [pendingCloud, setPendingCloud] = useState<PendingCloudSummaryState>({scope:null,count:0,localIds:[]});
  const [retryCloudBusy, setRetryCloudBusy] = useState(false);
  const retryCloudBusyRef = useRef(false);
  const retryCloudRunnerRef = useRef(createSingleFlightActionRunner());
  const [loaded, setLoaded] = useState(false);
  const [historyLoadError, setHistoryLoadError] = useState(false);
  const [historyLoadBusy, setHistoryLoadBusy] = useState(true);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>('all');
  const [historyAssessment, setHistoryAssessment] = useState<HistoryAssessmentFilter>('all');
  const [historyView, setHistoryView] = useState<HistoryViewPreferences>({ ...DEFAULT_HISTORY_VIEW });
  const [showCustomDates, setShowCustomDates] = useState(false);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [customDateError, setCustomDateError] = useState<string | null>(null);
  const [showReviewProgress, setShowReviewProgress] = useState(false);
  const [showFusionValidation, setShowFusionValidation] = useState(false);
  const [expandedSessions, setExpandedSessions] = useState<Record<string, boolean>>({});
  const [sessionOperations, setSessionOperations] = useState<Record<string, SessionOperation>>({});
  const [reviewQueueMessage, setReviewQueueMessage] = useState<{ key: string; text: string } | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const pendingReviewScrollRef = useRef<string | null>(null);
  const historyRevisionRef = useRef(0);
  const filterRevisionRef = useRef(0);
  const periodRevisionRef = useRef(0);
  const assessmentRevisionRef = useRef(0);
  const recordedViewRevisionRef = useRef(0);
  const customDraftRevisionRef = useRef(0);
  const viewRevisionRef = useRef(0);
  const historyFilterRef = useRef<HistoryFilter>('all');
  const historyPeriodRef = useRef<HistoryPeriod>('all');
  const historyAssessmentRef = useRef<HistoryAssessmentFilter>('all');
  const historyViewRef = useRef<HistoryViewPreferences>({ ...DEFAULT_HISTORY_VIEW });
  const focusedRef = useRef(false);
  const sessionsRef = useRef<SessionRecord[]>([]);
  const periodWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const assessmentWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const filterWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const recordedViewWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
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

  const load = useCallback(async (preserveView = false) => {
    viewRevisionRef.current += 1;
    pendingReviewScrollRef.current = null;
    setReviewQueueMessage(null);
    const loadAttempt = historyLoadAttemptRef.current + 1;
    historyLoadAttemptRef.current = loadAttempt;
    const revision = historyRevisionRef.current;
    const filterRevision = filterRevisionRef.current;
    const periodRevision = periodRevisionRef.current;
    const assessmentRevision = assessmentRevisionRef.current;
    const recordedViewRevision = recordedViewRevisionRef.current;
    const customDraftRevision = customDraftRevisionRef.current;
    setHistoryLoadBusy(true);
    setPendingCloud({scope:null,count:0,localIds:[]});
    try {
      const [storedSessions, savedFilter, savedPeriod, savedAssessment, savedView, pendingSummaries] = await Promise.all([
        loadSessionHistory<SessionRecord>(),
        filterWriteQueueRef.current
          .then(() => AsyncStorage.getItem(HISTORY_FILTER_KEY))
          .catch(() => undefined),
        periodWriteQueueRef.current
          .then(() => AsyncStorage.getItem(HISTORY_PERIOD_KEY))
          .catch(() => undefined),
        assessmentWriteQueueRef.current
          .then(() => AsyncStorage.getItem(HISTORY_ASSESSMENT_KEY))
          .catch(() => undefined),
        recordedViewWriteQueueRef.current
          .then(() => AsyncStorage.getItem(HISTORY_VIEW_KEY))
          .catch(() => undefined),
        getPendingCloudSummaryState(),
      ]);
      if (historyLoadAttemptRef.current === loadAttempt && historyRevisionRef.current === revision) {
        sessionsRef.current = storedSessions;
        setSessions(storedSessions);
        setPendingCloud(pendingCloudSummaryStateIsCurrent(pendingSummaries) ? pendingSummaries : {scope:null,count:0,localIds:[]});
        setHistoryLoadError(false);
        let restoredView = historyViewRef.current;
        if (!preserveView && recordedViewRevisionRef.current === recordedViewRevision && savedView !== undefined) {
          restoredView = normalizeHistoryViewPreferences(savedView);
          historyViewRef.current = restoredView;
          setHistoryView(restoredView);
          if (customDraftRevisionRef.current === customDraftRevision) {
            setCustomStart(restoredView.range?.start || '');
            setCustomEnd(restoredView.range?.end || '');
            setCustomDateError(null);
          }
        }
        if (!preserveView && filterRevisionRef.current === filterRevision && savedFilter !== undefined) {
          const filter = normalizeHistoryFilter(savedFilter);
          historyFilterRef.current = filter;
          setHistoryFilter(filter);
        }
        if (!preserveView && periodRevisionRef.current === periodRevision && savedPeriod !== undefined) {
          const normalizedPeriod = normalizeHistoryPeriod(savedPeriod);
          const period = normalizedPeriod === 'custom' && !restoredView.range ? 'all' : normalizedPeriod;
          historyPeriodRef.current = period;
          setHistoryPeriod(period);
        }
        if (!preserveView && assessmentRevisionRef.current === assessmentRevision && savedAssessment !== undefined) {
          const assessment = normalizeHistoryAssessmentFilter(savedAssessment);
          historyAssessmentRef.current = assessment;
          setHistoryAssessment(assessment);
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
    focusedRef.current = true;
    setRetryCloudBusy(retryCloudBusyRef.current);
    void load();
    return () => {
      focusedRef.current = false;
      historyLoadAttemptRef.current += 1;
      viewRevisionRef.current += 1;
      pendingReviewScrollRef.current = null;
    };
  }, [load]));

  const retrySavedCloudSummaries = async () => {
    const pending = pendingCloud;
    if (!pending.scope || !pendingCloudSummaryStateIsCurrent(pending)) { await load(true); return; }
    const attempt = historyLoadAttemptRef.current;
    await retryCloudRunnerRef.current.run({
      action: async () => {
        await retryPendingCloudSessions(pending.scope!);
        if (focusedRef.current && historyLoadAttemptRef.current === attempt) await load(true);
      },
      onBusyChange: busy => { retryCloudBusyRef.current=busy; if (focusedRef.current) setRetryCloudBusy(busy); },
      onError: () => { if (focusedRef.current) Alert.alert('Cloud completion not confirmed', 'Your local summaries remain saved. Refresh and try again when connected.'); },
    });
  };

  const chooseHistoryFilter = (filter: HistoryFilter) => {
    viewRevisionRef.current += 1;
    const revision = filterRevisionRef.current + 1;
    filterRevisionRef.current = revision;
    historyFilterRef.current = filter;
    setHistoryFilter(filter);
    setReviewQueueMessage(null);
    pendingReviewScrollRef.current = null;
    filterWriteQueueRef.current = filterWriteQueueRef.current
      .then(() => AsyncStorage.setItem(HISTORY_FILTER_KEY, filter))
      .catch(() => {
        if (filterRevisionRef.current === revision) {
          Alert.alert('Could not remember this view', 'The filter still works now, but it may reset next time.');
        }
      });
  };

  const chooseHistoryPeriod = (period: HistoryPeriod) => {
    viewRevisionRef.current += 1;
    const revision = periodRevisionRef.current + 1;
    periodRevisionRef.current = revision;
    historyPeriodRef.current = period;
    setHistoryPeriod(period);
    setReviewQueueMessage(null);
    pendingReviewScrollRef.current = null;
    periodWriteQueueRef.current = periodWriteQueueRef.current
      .then(() => AsyncStorage.setItem(HISTORY_PERIOD_KEY, period))
      .catch(() => {
        if (periodRevisionRef.current === revision) {
          Alert.alert('Could not remember this period', 'The date view still works now, but it may reset next time.');
        }
      });
  };

  const chooseHistoryAssessment = (assessment: HistoryAssessmentFilter) => {
    viewRevisionRef.current += 1;
    const revision = assessmentRevisionRef.current + 1;
    assessmentRevisionRef.current = revision;
    historyAssessmentRef.current = assessment;
    setHistoryAssessment(assessment);
    setReviewQueueMessage(null);
    pendingReviewScrollRef.current = null;
    assessmentWriteQueueRef.current = assessmentWriteQueueRef.current
      .then(() => AsyncStorage.setItem(HISTORY_ASSESSMENT_KEY, assessment))
      .catch(() => {
        if (assessmentRevisionRef.current === revision) {
          Alert.alert('Could not remember this feedback view', 'The feedback filter still works now, but it may reset next time.');
        }
      });
  };

  const saveHistoryView = (view: HistoryViewPreferences) => {
    viewRevisionRef.current += 1;
    const revision = recordedViewRevisionRef.current + 1;
    recordedViewRevisionRef.current = revision;
    historyViewRef.current = view;
    setHistoryView(view);
    setReviewQueueMessage(null);
    pendingReviewScrollRef.current = null;
    recordedViewWriteQueueRef.current = recordedViewWriteQueueRef.current
      .then(() => AsyncStorage.setItem(HISTORY_VIEW_KEY, JSON.stringify(view)))
      .catch(() => {
        if (recordedViewRevisionRef.current === revision) {
          Alert.alert('Could not remember this view', 'These filters and sorting still work now, but may reset next time.');
        }
      });
  };

  const chooseRecordedFilter = (key: HistoryRecordedFilterKey, value: string) => {
    // Only the recognized saved choices become preferences; legacy record values stay untouched.
    saveHistoryView(normalizeHistoryViewPreferences(JSON.stringify({ ...historyViewRef.current, [key]: value })));
  };

  const applyCustomDates = () => {
    const result = validateHistoryDateRange(customStart, customEnd);
    setCustomDateError(result.error);
    if (!result.range) return;
    saveHistoryView({ ...historyViewRef.current, range: result.range });
    chooseHistoryPeriod('custom');
    setShowCustomDates(false);
  };

  const currentReviewQueue = (excludedIndex?: number) => historyReviewQueue(
    filterIndexedSessionsByAssessment(
      filterIndexedSessionsByRecordedConditions(
        filterIndexedSessionsByPeriod(
          sortIndexedSessions(sessionsRef.current, historyViewRef.current.sort),
          historyPeriodRef.current, Date.now(), historyViewRef.current.range,
        ),
        historyViewRef.current,
      ),
      historyAssessmentRef.current,
    ).filter(({ item }) => matchesHistoryReviewFilter(item, historyFilterRef.current)),
    excludedIndex,
  );

  const saveSessionChanges = async (
    index: number,
    update: SessionRecordMutation<SessionRecord>,
    errorTitle: string,
    errorMessage: string,
  ) => {
    const target = sessions[index];
    if (!target) return;

    const completesReview = !hasCompleteHistoryReview(target) && hasCompleteHistoryReview(update(target));
    const saveViewRevision = viewRevisionRef.current;
    let operationRevision = 0;

    let commitSucceeded = false;
    const operationCompleted = await runSessionOperation(
      sessionRecordKey(target, index),
      'saving',
      async () => {
        historyRevisionRef.current += 1;
        operationRevision = historyRevisionRef.current;
        commitSucceeded = await commitSessionHistoryEdit({
          update,
          persist: mutation => updateSessionHistory<SessionRecord>(stored => (
            updateMatchingSessionRecord(stored, target, index, mutation)
          )),
          apply: mutation => {
            const updated = updateMatchingSessionRecord(sessionsRef.current, target, index, mutation);
            sessionsRef.current = updated;
            setSessions(updated);
          },
          onError: () => Alert.alert(errorTitle, errorMessage),
        });
      },
      () => Alert.alert(errorTitle, errorMessage),
    );

    if (
      operationCompleted && commitSucceeded && completesReview && !target.recoveredFromInterruption
      && saveViewRevision === viewRevisionRef.current
      && operationRevision === historyRevisionRef.current
    ) {
      setReviewQueueMessage(null);
      const queue = currentReviewQueue(index);
      const selectedScope = historyScopeLabel(historyPeriodRef.current, historyFilterRef.current, historyAssessmentRef.current, historyViewRef.current);
      if (queue.length === 0) {
        Alert.alert(
          'Review queue complete',
          `No unfinished completed-session reviews remain in the selected view: ${selectedScope}. Your saved ratings remain on this iPhone. Other views may have unfinished reviews.`,
        );
        return;
      }

      const next = queue[0];
      const nextKey = sessionRecordKey(next.item, next.index);
      const queueViewRevision = viewRevisionRef.current;
      const queueHistoryRevision = historyRevisionRef.current;
      Alert.alert(
        'Review complete',
        `${queue.length} unfinished ${queue.length === 1 ? 'session remains' : 'sessions remain'} in the selected view: ${selectedScope}.`,
        [
          { text: 'Done', style: 'cancel' },
          {
            text: 'Review Next',
            onPress: () => {
              if (queueViewRevision !== viewRevisionRef.current || queueHistoryRevision !== historyRevisionRef.current) return;
              const currentQueue = currentReviewQueue(index);
              const currentNext = currentQueue.find(({ item, index: storedIndex }) => sessionRecordKey(item, storedIndex) === nextKey);
              if (!currentNext) return;
              const key = sessionRecordKey(currentNext.item, currentNext.index);
              chooseHistoryFilter('needs-review');
              pendingReviewScrollRef.current = key;
              setExpandedSessions(current => ({ ...current, [key]: true }));
              setReviewQueueMessage({
                key,
                text: `Next unfinished review · ${currentQueue.length} ${currentQueue.length === 1 ? 'session' : 'sessions'} remaining with all selected filters and sorting`,
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

  const removeAssessment = async (index: number) => {
    await saveSessionChanges(
      index,
      item => {
        const updated = { ...item };
        delete updated.alertAssessment;
        delete updated.assessmentUpdatedAt;
        return updated;
      },
      'Could not remove assessment',
      'The saved rating remains unchanged. Please try again.',
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
        message: buildHistoryShareMessage(items, historyPeriod, historyFilter, historyAssessment, historyView),
      });
    } catch {
      Alert.alert('Could not share summaries', 'Please try exporting the session summaries again.');
    }
  };

  const sharePilotProgress = async () => {
    try {
      await Share.share({
        title: 'Occulert pilot progress',
        message: buildHistoryPilotProgressMessage(sessions),
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
        const updated = removeMatchingSessionRecord(sessionsRef.current, target, index);
        sessionsRef.current = updated;
        setSessions(updated);
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

  const sendSessionFeedback = async (target: SessionRecord, index: number) => {
    const viewRevision = viewRevisionRef.current;
    const historyRevision = historyRevisionRef.current;
    const key = sessionRecordKey(target, index);
    await runSessionOperation(
      key,
      'feedback',
      () => openFeedbackWithFallback(target, () => (
        focusedRef.current && viewRevisionRef.current === viewRevision
        && historyRevisionRef.current === historyRevision
        && sessionsRef.current.some((item, storedIndex) => sessionRecordKey(item, storedIndex) === key)
      )),
      () => {
        if (focusedRef.current) Alert.alert('Could not open feedback', 'Please try opening the session draft again.');
      },
    );
  };

  const { evidenceSessions, reviewedMedium, checkpointProgress, accurateCount, falseAlertCount, missedAlertCount, lateAlertCount, completeConditionCount, completeDeviceImpactCount, pilotCoverage, issueInsights, issueSessionCount, fusionValidation, fusionSessionPlan, reviewedCount, needsReviewCount, recoveredCount, sortedSessions, periodSessions, recordedSessions, assessmentSessions, filterCounts, reviewStatusSessions, assessmentCounts, filteredSessions, selectedScope, visibleReviewQueue, nextReviewSession, shownRecoveredCount, groupedFilteredSessions, sessionOperationsBusy } = deriveHistoryView({ sessions, historyFilter, historyPeriod, historyAssessment, historyView, sessionOperations });

  const continueReviewing = () => {
    if (!nextReviewSession || sessionOperationsBusy) return;
    const currentQueue = currentReviewQueue();
    const currentNext = currentQueue.find(({ item, index }) => (
      sessionRecordKey(item, index) === sessionRecordKey(nextReviewSession.item, nextReviewSession.index)
    ));
    if (!currentNext) return;
    const key = sessionRecordKey(currentNext.item, currentNext.index);
    chooseHistoryFilter('needs-review');
    pendingReviewScrollRef.current = key;
    setExpandedSessions(current => ({ ...current, [key]: true }));
    setReviewQueueMessage({
      key,
      text: `${currentQueue.length} unfinished ${currentQueue.length === 1 ? 'session' : 'sessions'} with all selected filters and sorting`,
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
      <ScrollView ref={scrollRef} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Text style={s.title}>Session History</Text>
        <Text style={s.periodNote}>
          This iPhone keeps up to 50 recent local session summaries. Choose Share shown summaries to keep a copy elsewhere. Cloud sharing remains your separate account choice.
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={historyLoadBusy ? 'Refreshing local history' : 'Refresh local history'}
          accessibilityHint="Rereads summaries and saved sync badges on this iPhone while preserving current filters, sorting, and date drafts"
          accessibilityState={{ disabled: historyLoadBusy || sessionOperationsBusy, busy: historyLoadBusy }}
          disabled={historyLoadBusy || sessionOperationsBusy}
          style={[s.refreshButton, (historyLoadBusy || sessionOperationsBusy) && s.operationDisabled]}
          onPress={() => { void load(true); }}
        >
          {historyLoadBusy ? <ActivityIndicator size="small" color="#93c5fd" /> : <Ionicons name="refresh-outline" size={17} color="#93c5fd" />}
          <Text style={s.refreshText}>{historyLoadBusy ? 'Reading local history…' : 'Refresh local history'}</Text>
        </TouchableOpacity>

        {pendingCloud.count > 0 && pendingCloudSummaryStateIsCurrent(pendingCloud) && (
          <TouchableOpacity accessibilityRole="button"
            accessibilityLabel={`Retry ${pendingCloud.count} pending cloud summaries`}
            accessibilityHint="Retries only saved session endings for the current signed-in owner with cloud sharing enabled"
            accessibilityState={{disabled:retryCloudBusy||historyLoadBusy,busy:retryCloudBusy}}
            disabled={retryCloudBusy||historyLoadBusy}
            style={[s.refreshButton,(retryCloudBusy||historyLoadBusy)&&s.operationDisabled]}
            onPress={()=>{void retrySavedCloudSummaries();}}>
            <Text style={s.refreshText}>{retryCloudBusy?'Checking saved cloud summaries…':`Retry ${pendingCloud.count} pending cloud summaries`}</Text>
          </TouchableOpacity>
        )}

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
                accessibilityState={{ disabled: historyLoadBusy || sessionOperationsBusy, busy: historyLoadBusy }}
                disabled={historyLoadBusy || sessionOperationsBusy}
                onPress={() => { void load(true); }}
                style={s.loadRetry}
              >
                <Text style={s.loadRetryText}>{historyLoadBusy ? 'Retrying…' : 'Try again'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {loaded && sessions.length > 0 && (
          <>
            <Text style={s.scopeLabel}>ALL HISTORY</Text>
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
                accessibilityLabel={`Continue reviewing the next shown unfinished session from ${fmtDate(sessionHistoryDate(nextReviewSession.item))}`}
                accessibilityHint="Expands the first unfinished session matching all selected filters in the selected sort order"
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
                    Next shown unfinished session · {selectedScope} · All history: {checkpointProgress} of {CHECKPOINT_TARGET} Medium reviews complete
                  </Text>
                </View>
              </TouchableOpacity>
            )}
            <Text style={s.scopeLabel}>SESSION DATES</Text>
            <View accessibilityRole="tablist" accessibilityLabel="Session dates" style={s.filterRow}>
              {HISTORY_PERIODS.map(period => {
                const selected = historyPeriod === period.value;
                return (
                  <TouchableOpacity
                    key={period.value}
                    accessibilityRole="tab"
                    accessibilityLabel={period.label}
                    accessibilityHint={period.value === 'all'
                      ? 'Shows saved sessions from every date'
                      : period.value === 'custom'
                        ? 'Enter and apply inclusive From and To local calendar dates'
                        : 'Includes today and the preceding local calendar days; excludes unrecorded and future dates'}
                    accessibilityState={{ selected }}
                    style={[s.filterButton, selected && s.filterButtonSelected]}
                    onPress={() => {
                      if (period.value === 'custom') {
                        setShowCustomDates(true);
                        setCustomDateError(null);
                      } else {
                        chooseHistoryPeriod(period.value);
                        setShowCustomDates(false);
                      }
                    }}
                  >
                    <Text style={[s.filterButtonText, selected && s.filterButtonTextSelected]}>
                      {period.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {showCustomDates && (
              <View style={s.customDateBox}>
                <Text style={s.conditionsTitle}>Custom local dates</Text>
                <Text style={s.periodNote}>Enter YYYY-MM-DD. Both dates are included, from 1900 through today. Apply to change the shown view; typing leaves the applied filters unchanged.</Text>
                <View style={s.customDateRow}>
                  <View style={s.customDateField}>
                    <Text style={s.conditionLabel}>From</Text>
                    <TextInput
                      accessibilityLabel="From date, YYYY-MM-DD"
                      value={customStart}
                      maxLength={10}
                      autoCorrect={false}
                      autoCapitalize="none"
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor="#6592a5"
                      style={s.customDateInput}
                      onChangeText={value => { customDraftRevisionRef.current += 1; setCustomStart(value); setCustomDateError(null); }}
                    />
                  </View>
                  <View style={s.customDateField}>
                    <Text style={s.conditionLabel}>To</Text>
                    <TextInput
                      accessibilityLabel="To date, YYYY-MM-DD"
                      value={customEnd}
                      maxLength={10}
                      autoCorrect={false}
                      autoCapitalize="none"
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor="#6592a5"
                      style={s.customDateInput}
                      onChangeText={value => { customDraftRevisionRef.current += 1; setCustomEnd(value); setCustomDateError(null); }}
                    />
                  </View>
                </View>
                {customDateError && <Text accessibilityRole="alert" style={s.customDateError}>{customDateError}</Text>}
                <View style={s.filterRow}>
                  <TouchableOpacity accessibilityRole="button" style={[s.filterButton, s.filterButtonSelected]} onPress={applyCustomDates}>
                    <Text style={s.filterButtonTextSelected}>Apply dates</Text>
                  </TouchableOpacity>
                  <TouchableOpacity accessibilityRole="button" accessibilityHint="Keeps the applied filters unchanged" style={s.filterButton} onPress={() => { setShowCustomDates(false); setCustomDateError(null); }}>
                    <Text style={s.filterButtonText}>Close date editor</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            {historyPeriod !== 'all' && (
              <Text style={s.periodNote}>
                {historyPeriod === 'custom' && historyView.range
                  ? `Applied ${historyView.range.start} through ${historyView.range.end}, including both local calendar dates.`
                  : `Includes today and the previous ${historyPeriod === '7-days' ? 6 : 29} days.`} Unrecorded and future dates stay in All time.
              </Text>
            )}
            {HISTORY_RECORDED_FILTERS.map(group => (
              <React.Fragment key={group.key}>
                <Text style={s.scopeLabel}>{group.label.toUpperCase()}</Text>
                <View accessibilityRole="tablist" accessibilityLabel={group.label} style={s.filterRow}>
                  {group.options.map(option => {
                    const selected = historyView[group.key] === option.value;
                    return (
                      <TouchableOpacity
                        key={option.value}
                        accessibilityRole="tab"
                        accessibilityLabel={`${group.label}: ${option.label}`}
                        accessibilityHint={option.value === 'unknown' ? 'Includes missing or unrecognized saved values' : 'Combines with all other selected filters'}
                        accessibilityState={{ selected }}
                        style={[s.filterButton, selected && s.filterButtonSelected]}
                        onPress={() => chooseRecordedFilter(group.key, option.value)}
                      >
                        <Text style={[s.filterButtonText, selected && s.filterButtonTextSelected]}>{option.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </React.Fragment>
            ))}
            <Text style={s.periodNote}>Not recorded includes missing or unrecognized saved values. Lighting and eyewear are saved tester observations.</Text>
            <Text style={s.scopeLabel}>SORT SHOWN SESSIONS</Text>
            <View accessibilityRole="tablist" accessibilityLabel="Session sort order" style={s.filterRow}>
              {HISTORY_SORTS.map(option => {
                const selected = historyView.sort === option.value;
                return (
                  <TouchableOpacity key={option.value} accessibilityRole="tab" accessibilityLabel={option.label}
                    accessibilityState={{ selected }} style={[s.filterButton, selected && s.filterButtonSelected]}
                    onPress={() => saveHistoryView({ ...historyViewRef.current, sort: option.value })}>
                    <Text style={[s.filterButtonText, selected && s.filterButtonTextSelected]}>{option.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={s.periodNote}>Missing sort values appear last. Equal durations or alert counts use newest date first. Recovered sessions remain partial summaries.</Text>
            <Text style={s.scopeLabel}>REVIEW STATUS</Text>
            <View accessibilityRole="tablist" accessibilityLabel="Session review status" style={s.filterRow}>
              {HISTORY_FILTERS.map(filter => {
                const selected = historyFilter === filter.value;
                return (
                  <TouchableOpacity
                    key={filter.value}
                    accessibilityRole="tab"
                    accessibilityLabel={`${filter.label}, ${filterCounts[filter.value]} sessions`}
                    accessibilityHint="Combines with the selected date, recorded conditions, and alert feedback filters"
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
            <Text style={s.scopeLabel}>ALERT FEEDBACK · USER OBSERVATIONS</Text>
            <View accessibilityRole="tablist" accessibilityLabel="Saved alert feedback" style={s.filterRow}>
              {HISTORY_ASSESSMENTS.map(assessment => {
                const selected = historyAssessment === assessment.value;
                return (
                  <TouchableOpacity
                    key={assessment.value}
                    accessibilityRole="tab"
                    accessibilityLabel={`${assessment.label}, ${assessmentCounts[assessment.value]} sessions`}
                    accessibilityHint={assessment.value === 'not-assessed'
                      ? 'Shows sessions without a recognized saved alert rating, within the selected date and review status'
                      : 'Shows matching saved user observations within the selected date and review status; this is not measured accuracy'}
                    accessibilityState={{ selected }}
                    style={[s.filterButton, selected && s.filterButtonSelected]}
                    onPress={() => chooseHistoryAssessment(assessment.value)}
                  >
                    <Text style={[s.filterButtonText, selected && s.filterButtonTextSelected]}>
                      {assessment.label} · {assessmentCounts[assessment.value]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={s.periodNote}>
              Saved alert feedback reflects user observations, not measured detection accuracy. Not assessed includes missing or unrecognized ratings. Recovered checkpoints remain partial sessions.
            </Text>
            <Text accessibilityLiveRegion="polite" style={s.filterResult}>
              {selectedScope} · Showing {filteredSessions.length} of {periodSessions.length} sessions in this period · {shownRecoveredCount} shown recovered partial sessions · {sessions.length} saved overall
            </Text>
            {filteredSessions.length > 0 && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={sessionOperationsBusy
                  ? 'Wait for session changes before sharing summaries'
                  : `Share ${filteredSessions.length} visible session summaries`}
                accessibilityHint="Shares only the shown sessions in their displayed order and identifies all selected filters"
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
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityHint="Shows local aggregate camera, headphone, and Apple Watch observation coverage"
              accessibilityState={{ expanded: showFusionValidation }}
              style={s.reviewToggle}
              onPress={() => setShowFusionValidation(current => !current)}
            >
              <Text style={s.reviewToggleText}>
                {showFusionValidation ? 'Hide fusion observations' : 'Show fusion observations'}
              </Text>
              <Ionicons name={showFusionValidation ? 'chevron-up' : 'chevron-down'} size={15} color="#93c5fd" />
            </TouchableOpacity>
          </>
        )}

        {loaded && sessions.length > 0 && showFusionValidation && (
          <View style={s.fusionDashboard}>
            <Text style={s.fusionEyebrow}>ALL HISTORY · LOCAL FUSION VALIDATION</Text>
            <Text style={s.fusionTitle}>Observation coverage across all saved sessions</Text>
            <View style={s.fusionStats}>
              <View style={s.fusionStat}>
                <Text style={s.fusionStatValue}>{fusionValidation.observedSessions}/{fusionValidation.sessionTarget}</Text>
                <Text style={s.fusionStatLabel}>Sessions</Text>
              </View>
              <View style={s.fusionStat}>
                <Text style={s.fusionStatValue}>{fusionValidation.cameraSessions}</Text>
                <Text style={s.fusionStatLabel}>Camera</Text>
              </View>
              <View style={s.fusionStat}>
                <Text style={s.fusionStatValue}>{fusionValidation.headphoneSessions}</Text>
                <Text style={s.fusionStatLabel}>Headphone</Text>
              </View>
              <View style={s.fusionStat}>
                <Text style={s.fusionStatValue}>{fusionValidation.watchCheckedSessions}</Text>
                <Text style={s.fusionStatLabel}>Watch checked</Text>
              </View>
            </View>
            <Text style={s.fusionDetail}>
              Aggregate observation time: {fmtDuration(fusionValidation.observationDurationSec)}
            </Text>
            <Text style={s.fusionDetail}>
              Apple Watch context: {fusionValidation.watchPairedSessions} paired · {fusionValidation.watchInstalledSessions} app installed · {fusionValidation.watchReachableSessions} reachable
            </Text>
            <Text style={s.fusionDetail}>
              Camera + headphone head-nod overlap: {fusionValidation.cameraHeadphoneNodOverlaps} across {fusionValidation.overlapSessions} sessions · {fusionValidation.elevatedCameraHeadphoneNodOverlaps} during elevated camera observations
            </Text>
            <View style={fusionSessionPlan.complete ? s.fusionPlanComplete : s.fusionPlan}>
              <View style={s.fusionPlanHeader}>
                <View style={s.fusionPlanCopy}>
                  <Text style={s.fusionPlanEyebrow}>NEXT VALIDATION SESSION</Text>
                  <Text style={s.fusionPlanTitle}>{fusionSessionPlan.title}</Text>
                </View>
                <Text style={s.fusionPlanProgress}>
                  {fusionSessionPlan.completedSetups}/{fusionSessionPlan.totalSetups} setups
                </Text>
              </View>
              <Text style={s.fusionPlanDetail}>{fusionSessionPlan.detail}</Text>
              {fusionSessionPlan.checklist.length > 0 && (
                <View style={s.fusionPlanChecklist}>
                  {fusionSessionPlan.checklist.map(item => (
                    <View key={item} style={s.fusionPlanChecklistRow}>
                      <Ionicons name="checkmark-circle-outline" size={14} color="#93c5fd" />
                      <Text style={s.fusionPlanChecklistText}>{item}</Text>
                    </View>
                  ))}
                </View>
              )}
              <Text style={s.fusionPlanOptional}>
                Optional accessories are never required to use Occulert or complete a safe trip.
              </Text>
            </View>
            {fusionValidation.recoveredSessionsExcluded > 0 && (
              <Text style={s.fusionExcluded}>
                {fusionValidation.recoveredSessionsExcluded} recovered partial {fusionValidation.recoveredSessionsExcluded === 1 ? 'session was' : 'sessions were'} excluded.
              </Text>
            )}
            <View style={fusionValidation.insufficientData ? s.fusionCoverageMissing : s.fusionCoverageComplete}>
              <Ionicons
                name={fusionValidation.insufficientData ? 'information-circle-outline' : 'checkmark-circle-outline'}
                size={16}
                color={fusionValidation.insufficientData ? '#fbbf24' : '#86efac'}
              />
              <Text style={fusionValidation.insufficientData ? s.fusionCoverageMissingText : s.fusionCoverageCompleteText}>
                {fusionValidation.insufficientData
                  ? `More observation coverage needed: ${fusionValidation.missingCoverage.join(', ')}.`
                  : 'Planned observation coverage is represented. This does not establish detection accuracy.'}
              </Text>
            </View>
            <Text style={s.fusionCaution}>
              Aggregate planning context only. No accuracy rate or safety score is produced, and these observations do not change alerts. Fusion diagnostics remain on this iPhone and are excluded from sync, exports, and feedback.
            </Text>
          </View>
        )}

        {loaded && sessions.length > 0 && showReviewProgress && (
          <View style={s.checkpoint}>
            <View style={s.checkpointHeader}>
              <View style={s.checkpointHeaderCopy}>
                <Text style={s.checkpointEyebrow}>ALL HISTORY · DRIVE REVIEW PROGRESS</Text>
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
                <Text style={s.pilotExportDetail}>All history · aggregate counts only · no session or driver identifiers</Text>
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

        {loaded && sessions.length > 0 && filteredSessions.length === 0 && (
          historyFilter !== 'all' || historyPeriod !== 'all' || historyAssessment !== 'all'
          || historyView.sensitivity !== 'all' || historyView.lighting !== 'all' || historyView.eyewear !== 'all'
        ) && (
          <View style={s.filteredEmpty}>
            <Ionicons name="filter-outline" size={32} color="#4a7a8a" />
            <Text style={s.emptyTitle}>
              {periodSessions.length === 0 ? 'No sessions in this period' : 'No sessions match these filters'}
            </Text>
            <Text style={s.emptySub}>
              {periodSessions.length === 0
                ? 'Your saved history is unchanged. Choose All time to see older sessions and sessions with unrecorded or future dates.'
                : `No saved sessions match ${selectedScope}. Your saved history is unchanged. Change a filter or choose Show all sessions.`}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Show all saved sessions"
              accessibilityHint="Clears all applied filters while keeping the selected sort order"
              style={s.clearFilterButton}
              onPress={() => {
                chooseHistoryFilter('all'); chooseHistoryPeriod('all'); chooseHistoryAssessment('all');
                saveHistoryView({ ...historyViewRef.current, sensitivity: 'all', lighting: 'all', eyewear: 'all' });
                setShowCustomDates(false);
                setCustomDateError(null);
              }}
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
          const reviewProgress = getSessionReviewProgress(historyReviewInput(item));
          const reviewComplete = reviewProgress.complete;
          const isExpanded = expandedSessions[sessionKey] ?? false;
          const alertCountLabel = formatSessionAlertCount(item.alertCount);
          const fatigueLabel = formatSessionFatigue(item.avgFatigue);
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
              <Text style={s.date}>{fmtDate(sessionHistoryDate(item))}</Text>
              <Text style={s.dur}>{formatSessionDuration(item.durationSec)}</Text>
            </View>
            <View style={s.stats}>
              <View style={s.stat}>
                <Text style={alertCountLabel === 'Not recorded' ? s.statValSmall : s.statVal}>{alertCountLabel}</Text>
                <Text style={s.statLbl}>Alerts</Text>
              </View>
              <View style={s.stat}>
                <Text style={fatigueLabel === 'Not recorded' ? s.statValSmall : s.statVal}>{fatigueLabel}</Text>
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
                name={cloudSummaryPresentation(item,pendingCloudSummaryStateIsCurrent(pendingCloud)?pendingCloud.localIds:[]).icon}
                size={14}
                color={cloudSummaryPresentation(item,pendingCloud.localIds).confirmed ? '#34d399' : '#4a7a8a'}
              />
              <Text style={[s.storageText, cloudSummaryPresentation(item,pendingCloud.localIds).confirmed && s.storageTextSynced]}>
                {cloudSummaryPresentation(item,pendingCloudSummaryStateIsCurrent(pendingCloud)?pendingCloud.localIds:[]).label}
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
            {isExpanded && item.sensorFusion?.mode === 'observation-only' && (
              <View style={s.observationBox}>
                <Text style={s.observationTitle}>OBSERVATION-ONLY SENSOR FUSION</Text>
                <Text style={s.observationInfo}>
                  Camera: {item.sensorFusion.camera?.trackedSamples ?? 0}/{item.sensorFusion.camera?.samples ?? 0} tracked samples · {item.sensorFusion.camera?.watchSamples ?? 0} watch · {item.sensorFusion.camera?.closedSamples ?? 0} closed
                </Text>
                <Text style={s.observationInfo}>
                  Head-nod overlap: {item.sensorFusion.coincidences?.cameraHeadphoneNods ?? 0} camera + headphone · {item.sensorFusion.coincidences?.elevatedCameraHeadphoneNods ?? 0} during elevated camera observations
                </Text>
                <Text style={s.observationStatus}>
                  Apple Watch: {item.sensorFusion.watch?.checked
                    ? item.sensorFusion.watch.reachable ? 'reachable' : item.sensorFusion.watch.appInstalled ? 'app installed' : item.sensorFusion.watch.paired ? 'paired' : 'not available'
                    : 'not checked'}
                </Text>
                <Text style={s.observationCaution}>
                  Local aggregate context only. It does not change fatigue scores or alerts and is not included in cloud sync, exports, or session feedback.
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
                      : sessionOperation === 'feedback'
                        ? 'Opening feedback…'
                        : reviewComplete ? 'Review complete' : hasHistoryAlertAssessment(item.alertAssessment) ? 'Rating saved' : 'Needs review'}
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
              {hasHistoryAlertAssessment(item.alertAssessment) && (
                <Text accessibilityLiveRegion="polite" style={s.reviewPrivacy}>
                  Saved: {ASSESSMENT_OPTIONS.find(option => option.value === item.alertAssessment)?.label}
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
              {hasHistoryAlertAssessment(item.alertAssessment) && (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Remove this session's alert assessment"
                  accessibilityHint="Returns the rating to Not assessed while keeping the session summary, test conditions, and device observations"
                  accessibilityState={{ disabled: sessionBusy, busy: sessionBusy }}
                  disabled={sessionBusy}
                  style={[s.removeAssessmentButton, sessionBusy && s.operationDisabled]}
                  onPress={() => { void removeAssessment(i); }}
                >
                  <Ionicons name="remove-circle-outline" size={16} color="#93c5fd" />
                  <Text style={s.removeAssessmentText}>Remove assessment · keep session</Text>
                </TouchableOpacity>
              )}
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
                  <Text style={s.reviewPrivacy}>Saved: {group.options.find(option => option.value === item.testConditions?.[group.key])?.label || 'Not recorded'}</Text>
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
                  <Text style={s.reviewPrivacy}>Saved: {group.options.find(option => option.value === item.deviceImpact?.[group.key])?.label || 'Not recorded'}</Text>
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
              onPress={() => { void sendSessionFeedback(item, i); }}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={16} color="#93c5fd" />
              <Text style={s.feedbackTxt}>Send session feedback</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Delete session from ${fmtDate(sessionHistoryDate(item))}`}
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
  refreshButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', marginBottom: 16, paddingHorizontal: 12, borderWidth: 1, borderColor: '#1a3a4a', borderRadius: 10 },
  refreshText: { flexShrink: 1, color: '#93c5fd', fontSize: 12, fontWeight: '800' },
  customDateBox: { padding: 12, borderWidth: 1, borderColor: '#1a3a4a', borderRadius: 10, marginBottom: 10 },
  customDateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  customDateField: { flexGrow: 1, flexBasis: 120, minWidth: 0 },
  customDateInput: { minHeight: 44, color: '#e0f2fe', fontSize: 14, borderWidth: 1, borderColor: '#1a3a4a', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginTop: 5 },
  customDateError: { color: '#fbbf24', fontSize: 11, lineHeight: 17, marginBottom: 9 },
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
  scopeLabel: { color: '#6592a5', fontSize: 9, fontWeight: '800', letterSpacing: 0.6, marginBottom: 7 },
  periodNote: { color: '#6592a5', fontSize: 10, lineHeight: 15, marginBottom: 10 },
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
  fusionDashboard: { backgroundColor: colors.materialStrong, borderWidth: 1, borderColor: 'rgba(96,165,250,0.30)', borderRadius: radii.large, padding: 18, marginBottom: 16 },
  fusionEyebrow: { color: '#60a5fa', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  fusionTitle: { color: '#e0f2fe', fontSize: 15, fontWeight: '800', marginTop: 4 },
  fusionStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 13 },
  fusionStat: { flexGrow: 1, flexBasis: 70, minHeight: 58, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5,10,15,0.28)', borderRadius: 9, paddingHorizontal: 6, paddingVertical: 8 },
  fusionStatValue: { color: '#dbeafe', fontSize: 16, fontWeight: '900' },
  fusionStatLabel: { color: '#6592a5', fontSize: 8, fontWeight: '800', letterSpacing: 0.35, marginTop: 3, textTransform: 'uppercase', textAlign: 'center' },
  fusionDetail: { color: '#bae6fd', fontSize: 10, lineHeight: 15, marginTop: 7 },
  fusionPlan: { backgroundColor: 'rgba(37,99,235,0.08)', borderWidth: 1, borderColor: 'rgba(96,165,250,0.30)', borderRadius: 10, padding: 12, marginTop: 13 },
  fusionPlanComplete: { backgroundColor: 'rgba(22,163,74,0.08)', borderWidth: 1, borderColor: 'rgba(134,239,172,0.24)', borderRadius: 10, padding: 12, marginTop: 13 },
  fusionPlanHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  fusionPlanCopy: { flex: 1, minWidth: 0 },
  fusionPlanEyebrow: { color: '#93c5fd', fontSize: 8, fontWeight: '900', letterSpacing: 0.65 },
  fusionPlanTitle: { color: '#dbeafe', fontSize: 12, fontWeight: '900', lineHeight: 17, marginTop: 3 },
  fusionPlanProgress: { color: '#93c5fd', fontSize: 9, fontWeight: '900' },
  fusionPlanDetail: { color: '#bae6fd', fontSize: 10, lineHeight: 15, marginTop: 7 },
  fusionPlanChecklist: { borderTopWidth: 1, borderTopColor: 'rgba(96,165,250,0.20)', gap: 7, marginTop: 10, paddingTop: 9 },
  fusionPlanChecklistRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  fusionPlanChecklistText: { flex: 1, minWidth: 0, color: '#c8e8f0', fontSize: 9, lineHeight: 14 },
  fusionPlanOptional: { color: '#6592a5', fontSize: 9, lineHeight: 14, marginTop: 9 },
  fusionExcluded: { color: '#6592a5', fontSize: 9, lineHeight: 14, marginTop: 7 },
  fusionCoverageMissing: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, backgroundColor: 'rgba(217,119,6,0.08)', borderWidth: 1, borderColor: 'rgba(251,191,36,0.25)', borderRadius: 9, padding: 10, marginTop: 12 },
  fusionCoverageComplete: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, backgroundColor: 'rgba(22,163,74,0.08)', borderWidth: 1, borderColor: 'rgba(134,239,172,0.24)', borderRadius: 9, padding: 10, marginTop: 12 },
  fusionCoverageMissingText: { minWidth: 0, flex: 1, color: '#fde68a', fontSize: 10, lineHeight: 15, fontWeight: '700' },
  fusionCoverageCompleteText: { minWidth: 0, flex: 1, color: '#bbf7d0', fontSize: 10, lineHeight: 15, fontWeight: '700' },
  fusionCaution: { color: '#4a7a8a', fontSize: 9, lineHeight: 14, marginTop: 10 },
  review: { borderTopWidth: 1, borderTopColor: '#1a3a4a', marginTop: 14, paddingTop: 14 },
  reviewTitle: { color: '#c8e8f0', fontSize: 12, fontWeight: '800', marginBottom: 10 },
  reviewOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  reviewOption: { flexGrow: 1, flexBasis: '45%', minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: '#1a3a4a', backgroundColor: 'rgba(5,10,15,0.35)', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 4, paddingVertical: 7 },
  reviewOptionSelected: { borderColor: '#3b82f6', backgroundColor: 'rgba(37,99,235,0.22)' },
  reviewOptionText: { color: '#4a7a8a', fontSize: 10, fontWeight: '800', textAlign: 'center' },
  reviewOptionTextSelected: { color: '#dbeafe' },
  reviewPrivacy: { color: '#4a7a8a', fontSize: 10, lineHeight: 14, marginTop: 8 },
  removeAssessmentButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 6 },
  removeAssessmentText: { flexShrink: 1, color: '#93c5fd', fontSize: 11, fontWeight: '800' },
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
