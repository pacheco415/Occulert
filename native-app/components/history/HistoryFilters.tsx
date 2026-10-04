import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { HistoryAssessmentFilter, HistoryFilter, HistoryPeriod, HistorySort, HistoryViewPreferences } from '../../lib/historyPreferences';
import { fmtDate, sessionHistoryDate } from '../../lib/historyPresentation';
import type { HistoryRecordedFilterKey, SessionRecord } from '../../lib/historyRecord';
import { CHECKPOINT_TARGET, HISTORY_ASSESSMENTS, HISTORY_FILTERS, HISTORY_PERIODS, HISTORY_RECORDED_FILTERS, HISTORY_SORTS } from '../../lib/historyReviewModel';
import type { HistoryViewModel } from '../../lib/historyViewModel';
import { historyStyles as s } from './historyStyles';

interface HistoryFiltersProps {
  model: HistoryViewModel;
  sessionCount: number;
  historyPeriod: HistoryPeriod;
  historyFilter: HistoryFilter;
  historyAssessment: HistoryAssessmentFilter;
  historyView: HistoryViewPreferences;
  showCustomDates: boolean;
  customStart: string;
  customEnd: string;
  customDateError: string | null;
  showReviewProgress: boolean;
  showFusionValidation: boolean;
  setShowCustomDates: React.Dispatch<React.SetStateAction<boolean>>;
  setCustomDateError: React.Dispatch<React.SetStateAction<string | null>>;
  setShowReviewProgress: React.Dispatch<React.SetStateAction<boolean>>;
  setShowFusionValidation: React.Dispatch<React.SetStateAction<boolean>>;
  chooseHistoryPeriod: (period: HistoryPeriod) => void;
  chooseRecordedFilter: (key: HistoryRecordedFilterKey, value: string) => void;
  chooseHistorySort: (sort: HistorySort) => void;
  chooseHistoryFilter: (filter: HistoryFilter) => void;
  chooseHistoryAssessment: (assessment: HistoryAssessmentFilter) => void;
  changeCustomStart: (value: string) => void;
  changeCustomEnd: (value: string) => void;
  applyCustomDates: () => void;
  continueReviewing: () => void;
  shareSessions: (items: SessionRecord[]) => Promise<void>;
}

export function HistoryFilters({ model, sessionCount, historyPeriod, historyFilter, historyAssessment, historyView, showCustomDates, customStart, customEnd, customDateError, showReviewProgress, showFusionValidation, setShowCustomDates, setCustomDateError, setShowReviewProgress, setShowFusionValidation, chooseHistoryPeriod, chooseRecordedFilter, chooseHistorySort, chooseHistoryFilter, chooseHistoryAssessment, changeCustomStart, changeCustomEnd, applyCustomDates, continueReviewing, shareSessions }: HistoryFiltersProps) {
  const { needsReviewCount, reviewedCount, recoveredCount, nextReviewSession, selectedScope, checkpointProgress, filterCounts, assessmentCounts, filteredSessions, periodSessions, shownRecoveredCount, sessionOperationsBusy } = model;
  return (
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
                      onChangeText={changeCustomStart}
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
                      onChangeText={changeCustomEnd}
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
                    onPress={() => chooseHistorySort(option.value)}>
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
              {selectedScope} · Showing {filteredSessions.length} of {periodSessions.length} sessions in this period · {shownRecoveredCount} shown recovered partial sessions · {sessionCount} saved overall
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
  );
}
