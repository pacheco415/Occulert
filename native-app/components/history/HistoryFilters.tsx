import { strings, formatString } from '../../lib/strings';
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
            <Text style={s.scopeLabel}>{strings.history.filters.allHistory}</Text>
            <View style={s.historySummary}>
              <View style={s.historySummaryItem}>
                <Text style={s.historySummaryValue}>{needsReviewCount}</Text>
                <Text style={s.historySummaryLabel}>{strings.history.filters.needReview}</Text>
              </View>
              <View style={s.historySummaryDivider} />
              <View style={s.historySummaryItem}>
                <Text style={s.historySummaryValue}>{reviewedCount}</Text>
                <Text style={s.historySummaryLabel}>{strings.history.common.reviewed}</Text>
              </View>
              <View style={s.historySummaryDivider} />
              <View style={s.historySummaryItem}>
                <Text style={s.historySummaryValue}>{recoveredCount}</Text>
                <Text style={s.historySummaryLabel}>{strings.history.common.recovered}</Text>
              </View>
            </View>
            {nextReviewSession && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={formatString(strings.history.filters.continueAccessibilityLabel, { date: fmtDate(sessionHistoryDate(nextReviewSession.item)) })}
                accessibilityHint={strings.history.filters.continueReviewHint}
                accessibilityState={{ disabled: sessionOperationsBusy, busy: sessionOperationsBusy }}
                disabled={sessionOperationsBusy}
                onPress={continueReviewing}
                style={[s.continueReviewButton, sessionOperationsBusy && s.operationDisabled]}
              >
                <View style={s.continueReviewIcon}>
                  <Ionicons name="arrow-forward" size={17} color="#dbeafe" />
                </View>
                <View style={s.continueReviewCopy}>
                  <Text style={s.continueReviewTitle}>{strings.history.filters.continueReview}</Text>
                  <Text style={s.continueReviewDetail}>{formatString(strings.history.filters.continueDetail, { scope: selectedScope, count: checkpointProgress, target: CHECKPOINT_TARGET })}</Text>
                </View>
              </TouchableOpacity>
            )}
            <Text style={s.scopeLabel}>{strings.history.filters.datesHeading}</Text>
            <View accessibilityRole="tablist" accessibilityLabel={strings.history.filters.datesAccessibilityLabel} style={s.filterRow}>
              {HISTORY_PERIODS.map(period => {
                const selected = historyPeriod === period.value;
                return (
                  <TouchableOpacity
                    key={period.value}
                    accessibilityRole="tab"
                    accessibilityLabel={period.label}
                    accessibilityHint={period.value === 'all'
                      ? strings.history.filters.allDatesHint
                      : period.value === 'custom'
                        ? strings.history.filters.customDatesHint
                        : strings.history.filters.recentDatesHint}
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
                <Text style={s.conditionsTitle}>{strings.history.filters.customDatesTitle}</Text>
                <Text style={s.periodNote}>{strings.history.filters.customDatesDetail}</Text>
                <View style={s.customDateRow}>
                  <View style={s.customDateField}>
                    <Text style={s.conditionLabel}>{strings.history.filters.from}</Text>
                    <TextInput
                      accessibilityLabel={strings.history.filters.fromAccessibilityLabel}
                      value={customStart}
                      maxLength={10}
                      autoCorrect={false}
                      autoCapitalize="none"
                      placeholder={strings.history.filters.datePlaceholder}
                      placeholderTextColor="#6592a5"
                      style={s.customDateInput}
                      onChangeText={changeCustomStart}
                    />
                  </View>
                  <View style={s.customDateField}>
                    <Text style={s.conditionLabel}>{strings.history.filters.to}</Text>
                    <TextInput
                      accessibilityLabel={strings.history.filters.toAccessibilityLabel}
                      value={customEnd}
                      maxLength={10}
                      autoCorrect={false}
                      autoCapitalize="none"
                      placeholder={strings.history.filters.datePlaceholder}
                      placeholderTextColor="#6592a5"
                      style={s.customDateInput}
                      onChangeText={changeCustomEnd}
                    />
                  </View>
                </View>
                {customDateError && <Text accessibilityRole="alert" style={s.customDateError}>{customDateError}</Text>}
                <View style={s.filterRow}>
                  <TouchableOpacity accessibilityRole="button" style={[s.filterButton, s.filterButtonSelected]} onPress={applyCustomDates}>
                    <Text style={s.filterButtonTextSelected}>{strings.history.filters.applyDates}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity accessibilityRole="button" accessibilityHint={strings.history.filters.closeDatesHint} style={s.filterButton} onPress={() => { setShowCustomDates(false); setCustomDateError(null); }}>
                    <Text style={s.filterButtonText}>{strings.history.filters.closeDates}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            {historyPeriod !== 'all' && (
              <Text style={s.periodNote}>{formatString(strings.history.filters.periodNote, { period: historyPeriod === 'custom' && historyView.range ? formatString(strings.history.filters.appliedCustomDates, { start: historyView.range.start, end: historyView.range.end }) : formatString(strings.history.filters.appliedRecentDates, { days: historyPeriod === '7-days' ? 6 : 29 }) })}</Text>
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
                        accessibilityLabel={formatString(strings.history.common.labelValue, { label: group.label, value: option.label })}
                        accessibilityHint={option.value === 'unknown' ? strings.history.filters.unrecordedHint : strings.history.filters.combinedHint}
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
            <Text style={s.periodNote}>{strings.history.filters.recordedNote}</Text>
            <Text style={s.scopeLabel}>{strings.history.filters.sortHeading}</Text>
            <View accessibilityRole="tablist" accessibilityLabel={strings.history.filters.sortAccessibilityLabel} style={s.filterRow}>
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
            <Text style={s.periodNote}>{strings.history.filters.sortNote}</Text>
            <Text style={s.scopeLabel}>{strings.history.filters.reviewHeading}</Text>
            <View accessibilityRole="tablist" accessibilityLabel={strings.history.filters.reviewAccessibilityLabel} style={s.filterRow}>
              {HISTORY_FILTERS.map(filter => {
                const selected = historyFilter === filter.value;
                return (
                  <TouchableOpacity
                    key={filter.value}
                    accessibilityRole="tab"
                    accessibilityLabel={formatString(strings.history.filters.sessionsAccessibilityLabel, { label: filter.label, count: filterCounts[filter.value] })}
                    accessibilityHint={strings.history.filters.reviewHint}
                    accessibilityState={{ selected }}
                    style={[s.filterButton, selected && s.filterButtonSelected]}
                    onPress={() => chooseHistoryFilter(filter.value)}
                  >
                    <Text style={[s.filterButtonText, selected && s.filterButtonTextSelected]}>{formatString(strings.history.filters.labelCount, { label: filter.label, count: filterCounts[filter.value] })}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={s.scopeLabel}>{strings.history.filters.assessmentHeading}</Text>
            <View accessibilityRole="tablist" accessibilityLabel={strings.history.filters.assessmentAccessibilityLabel} style={s.filterRow}>
              {HISTORY_ASSESSMENTS.map(assessment => {
                const selected = historyAssessment === assessment.value;
                return (
                  <TouchableOpacity
                    key={assessment.value}
                    accessibilityRole="tab"
                    accessibilityLabel={formatString(strings.history.filters.sessionsAccessibilityLabel, { label: assessment.label, count: assessmentCounts[assessment.value] })}
                    accessibilityHint={assessment.value === 'not-assessed'
                      ? strings.history.filters.unassessedHint
                      : strings.history.filters.assessmentHint}
                    accessibilityState={{ selected }}
                    style={[s.filterButton, selected && s.filterButtonSelected]}
                    onPress={() => chooseHistoryAssessment(assessment.value)}
                  >
                    <Text style={[s.filterButtonText, selected && s.filterButtonTextSelected]}>{formatString(strings.history.filters.labelCount, { label: assessment.label, count: assessmentCounts[assessment.value] })}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={s.periodNote}>{strings.history.filters.assessmentNote}</Text>
            <Text accessibilityLiveRegion="polite" style={s.filterResult}>{formatString(strings.history.filters.results, { scope: selectedScope, shown: filteredSessions.length, period: periodSessions.length, recovered: shownRecoveredCount, saved: sessionCount })}</Text>
            {filteredSessions.length > 0 && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={sessionOperationsBusy
                  ? strings.history.filters.shareBusy
                  : formatString(strings.history.filters.shareAccessibilityLabel, { count: filteredSessions.length })}
                accessibilityHint={strings.history.filters.shareHint}
                accessibilityState={{ disabled: sessionOperationsBusy, busy: sessionOperationsBusy }}
                disabled={sessionOperationsBusy}
                style={[s.exportButton, sessionOperationsBusy && s.operationDisabled]}
                onPress={() => { void shareSessions(filteredSessions.map(({ item }) => item)); }}
              >
                <Ionicons name="share-outline" size={16} color="#93c5fd" />
                <Text style={s.exportButtonText}>{strings.history.filters.share}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityHint={strings.history.filters.progressHint}
              accessibilityState={{ expanded: showReviewProgress }}
              style={s.reviewToggle}
              onPress={() => setShowReviewProgress(current => !current)}
            >
              <Text style={s.reviewToggleText}>
                {showReviewProgress ? strings.history.filters.hideProgress : strings.history.filters.showProgress}
              </Text>
              <Ionicons name={showReviewProgress ? 'chevron-up' : 'chevron-down'} size={15} color="#93c5fd" />
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityHint={strings.history.filters.fusionHint}
              accessibilityState={{ expanded: showFusionValidation }}
              style={s.reviewToggle}
              onPress={() => setShowFusionValidation(current => !current)}
            >
              <Text style={s.reviewToggleText}>
                {showFusionValidation ? strings.history.filters.hideFusion : strings.history.filters.showFusion}
              </Text>
              <Ionicons name={showFusionValidation ? 'chevron-up' : 'chevron-down'} size={15} color="#93c5fd" />
            </TouchableOpacity>
          </>
  );
}
