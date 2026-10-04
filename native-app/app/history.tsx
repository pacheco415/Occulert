import React, { useState, useCallback, useRef } from 'react';
import { View, Text, ScrollView, SafeAreaView, TouchableOpacity, Alert, Share, type LayoutChangeEvent } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { openFeedbackWithFallback, type AlertAssessment, type SessionDeviceImpact, type SessionTestConditions } from '../lib/feedback';
import { loadSessionHistory, updateSessionHistory } from '../lib/sessionHistory';
import { getPendingCloudSummaryState, pendingCloudSummaryStateIsCurrent, retryPendingCloudSessions, type PendingCloudSummaryState } from '../lib/cloudSync';
import { commitSessionHistoryEdit, removeMatchingSessionRecord, updateMatchingSessionRecord, type SessionRecordMutation } from '../lib/sessionHistoryEdits';
import { AmbientBackground } from '../components/GlassSurface';
import { filterIndexedSessionsByPeriod, filterIndexedSessionsByAssessment, filterIndexedSessionsByRecordedConditions, DEFAULT_HISTORY_VIEW, normalizeHistoryAssessmentFilter, normalizeHistoryFilter, normalizeHistoryPeriod, normalizeHistoryViewPreferences, sortIndexedSessions, validateHistoryDateRange, type HistoryFilter, type HistoryAssessmentFilter, type HistoryPeriod, type HistorySort, type HistoryViewPreferences } from '../lib/historyPreferences';
import { createSingleFlightActionRunner } from '../lib/singleFlightAction';
import { FusionValidationPanel } from '../components/history/FusionValidationPanel';
import { HistoryFilters } from '../components/history/HistoryFilters';
import { HistoryLoadState } from '../components/history/HistoryLoadState';
import { HistorySessionCard } from '../components/history/HistorySessionCard';
import { historyStyles as s } from '../components/history/historyStyles';
import { PilotProgressPanel } from '../components/history/PilotProgressPanel';
import type { SessionRecord, SessionOperation, TestConditionKey, TestConditionValue, DeviceImpactKey, DeviceImpactValue, HistoryRecordedFilterKey } from '../lib/historyRecord';
import { hasCompleteHistoryReview, matchesHistoryReviewFilter, historyReviewQueue, historyScopeLabel, sessionRecordKey } from '../lib/historyReviewModel';
import { buildHistoryShareMessage, buildHistoryPilotProgressMessage } from '../lib/historyShareMessage';
import { deriveHistoryView } from '../lib/historyViewModel';

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

  const model = deriveHistoryView({ sessions, historyFilter, historyPeriod, historyAssessment, historyView, sessionOperations });
  const { filteredSessions, periodSessions, selectedScope, groupedFilteredSessions, sessionOperationsBusy, nextReviewSession } = model;

  const chooseHistorySort = (sort: HistorySort) => saveHistoryView({ ...historyViewRef.current, sort });
  const changeCustomStart = (value: string) => { customDraftRevisionRef.current += 1; setCustomStart(value); setCustomDateError(null); };
  const changeCustomEnd = (value: string) => { customDraftRevisionRef.current += 1; setCustomEnd(value); setCustomDateError(null); };

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
        <HistoryLoadState sessionCount={sessions.length} loaded={loaded} historyLoadError={historyLoadError}
          historyLoadBusy={historyLoadBusy} sessionOperationsBusy={sessionOperationsBusy} retryCloudBusy={retryCloudBusy}
          pendingCloud={pendingCloud} pendingCloudSummaryStateIsCurrent={pendingCloudSummaryStateIsCurrent}
          load={load} retrySavedCloudSummaries={retrySavedCloudSummaries} />

        {loaded && sessions.length > 0 && (
          <HistoryFilters model={model} sessionCount={sessions.length} historyPeriod={historyPeriod} historyFilter={historyFilter}
            historyAssessment={historyAssessment} historyView={historyView} showCustomDates={showCustomDates}
            customStart={customStart} customEnd={customEnd} customDateError={customDateError}
            showReviewProgress={showReviewProgress} showFusionValidation={showFusionValidation}
            setShowCustomDates={setShowCustomDates} setCustomDateError={setCustomDateError}
            setShowReviewProgress={setShowReviewProgress} setShowFusionValidation={setShowFusionValidation}
            chooseHistoryPeriod={chooseHistoryPeriod} chooseRecordedFilter={chooseRecordedFilter} chooseHistorySort={chooseHistorySort}
            chooseHistoryFilter={chooseHistoryFilter} chooseHistoryAssessment={chooseHistoryAssessment}
            changeCustomStart={changeCustomStart} changeCustomEnd={changeCustomEnd} applyCustomDates={applyCustomDates}
            continueReviewing={continueReviewing} shareSessions={shareSessions} />
        )}

        {loaded && sessions.length > 0 && showFusionValidation && (
          <FusionValidationPanel model={model} />
        )}

        {loaded && sessions.length > 0 && showReviewProgress && (
          <PilotProgressPanel model={model} sharePilotProgress={sharePilotProgress} />
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
            {group.sessions.map(({ item, index: i }) => (
              <HistorySessionCard key={sessionRecordKey(item, i)} item={item} index={i}
                sessionOperations={sessionOperations} expandedSessions={expandedSessions} reviewQueueMessage={reviewQueueMessage}
                pendingCloud={pendingCloud} pendingCloudSummaryStateIsCurrent={pendingCloudSummaryStateIsCurrent}
                setExpandedSessions={setExpandedSessions} scrollToPendingReview={scrollToPendingReview}
                saveAssessment={saveAssessment} removeAssessment={removeAssessment} saveTestCondition={saveTestCondition}
                saveDeviceImpact={saveDeviceImpact} sendSessionFeedback={sendSessionFeedback} confirmDeleteSession={confirmDeleteSession} />
            ))}
          </React.Fragment>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
