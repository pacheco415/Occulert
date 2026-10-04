import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { Text, TouchableOpacity, View } from 'react-native';
import { cloudSummaryPresentation } from '../../lib/cloudSummaryPresentation';
import type { PendingCloudSummaryState } from '../../lib/cloudSync';
import { hasHistoryAlertAssessment } from '../../lib/historyPreferences';
import { fmtDate, sensitivityLabel, sessionHistoryDate } from '../../lib/historyPresentation';
import type { SessionOperation, SessionRecord } from '../../lib/historyRecord';
import { historyReviewInput, sessionRecordKey } from '../../lib/historyReviewModel';
import { formatSessionAlertCount } from '../../lib/sessionAlertCount';
import { getSessionReviewProgress } from '../../lib/sessionReviewProgress';
import { formatSessionDuration, formatSessionFatigue } from '../../lib/sessionSummaryValues';
import { HistorySessionDiagnostics } from './HistorySessionDiagnostics';
import { HistorySessionReview, type HistoryReviewActions } from './HistorySessionReview';
import { historyStyles as s } from './historyStyles';

interface HistorySessionCardProps extends HistoryReviewActions {
  item: SessionRecord;
  index: number;
  sessionOperations: Record<string, SessionOperation>;
  expandedSessions: Record<string, boolean>;
  reviewQueueMessage: { key: string; text: string } | null;
  pendingCloud: PendingCloudSummaryState;
  pendingCloudSummaryStateIsCurrent: (state: PendingCloudSummaryState) => boolean;
  setExpandedSessions: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  scrollToPendingReview: (key: string, event: LayoutChangeEvent) => void;
  sendSessionFeedback: (target: SessionRecord, index: number) => Promise<void>;
  confirmDeleteSession: (target: SessionRecord, index: number) => void;
}

export function HistorySessionCard({ item, index: i, sessionOperations, expandedSessions, reviewQueueMessage, pendingCloud, pendingCloudSummaryStateIsCurrent, setExpandedSessions, scrollToPendingReview, saveAssessment, removeAssessment, saveTestCondition, saveDeviceImpact, sendSessionFeedback, confirmDeleteSession }: HistorySessionCardProps) {
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
            <HistorySessionDiagnostics item={item} isExpanded={isExpanded} />
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
            <HistorySessionReview item={item} index={i} isExpanded={isExpanded} sessionBusy={sessionBusy}
              saveAssessment={saveAssessment} removeAssessment={removeAssessment}
              saveTestCondition={saveTestCondition} saveDeviceImpact={saveDeviceImpact} />
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
}
