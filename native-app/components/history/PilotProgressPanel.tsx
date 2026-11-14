import { strings, formatString } from '../../lib/strings';
import { Ionicons } from '@expo/vector-icons';
import { Text, TouchableOpacity, View } from 'react-native';
import { CHECKPOINT_TARGET } from '../../lib/historyReviewModel';
import type { HistoryViewModel } from '../../lib/historyViewModel';
import { formatPilotCounts } from '../../lib/pilotInsights';
import { historyStyles as s } from './historyStyles';

export function PilotProgressPanel({ model, sharePilotProgress }: { model: HistoryViewModel; sharePilotProgress: () => Promise<void> }) {
  const { checkpointProgress, reviewedMedium, accurateCount, falseAlertCount, missedAlertCount, lateAlertCount, completeConditionCount, completeDeviceImpactCount, pilotCoverage, issueInsights, issueSessionCount, sessionOperationsBusy } = model;
  return (
          <View style={s.checkpoint}>
            <View style={s.checkpointHeader}>
              <View style={s.checkpointHeaderCopy}>
                <Text style={s.checkpointEyebrow}>{strings.history.pilot.eyebrow}</Text>
                <Text style={s.checkpointTitle}>{formatString(strings.history.pilot.checkpointTitle, { count: checkpointProgress, target: CHECKPOINT_TARGET })}</Text>
              </View>
              <Text style={s.checkpointPercent}>
                {Math.round((checkpointProgress / CHECKPOINT_TARGET) * 100)}%
              </Text>
            </View>
            <View
              accessibilityLabel={formatString(strings.history.pilot.progressAccessibilityLabel, { count: checkpointProgress, target: CHECKPOINT_TARGET })}
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
              <Text style={s.checkpointStat}>{formatString(strings.history.pilot.feltRight, { count: accurateCount })}</Text>
              <Text style={s.checkpointStat}>{formatString(strings.history.pilot.falseAlerts, { count: falseAlertCount })}</Text>
              <Text style={s.checkpointStat}>{formatString(strings.history.pilot.missedAlerts, { count: missedAlertCount })}</Text>
              <Text style={s.checkpointStat}>{formatString(strings.history.pilot.lateAlerts, { count: lateAlertCount })}</Text>
            </View>
            <Text style={s.checkpointNote}>{strings.history.pilot.checkpointNote}</Text>
            <View style={s.coverageSummary}>
              <Text style={s.coverageTitle}>{strings.history.pilot.coverageTitle}</Text>
              <Text style={s.coverageCopy}>{formatString(strings.history.pilot.conditionsRecorded, { count: completeConditionCount, total: reviewedMedium.length })}</Text>
              <Text style={s.coverageStats}>{formatString(strings.history.pilot.conditionCoverage, { count: pilotCoverage.coveredCount, total: pilotCoverage.totalCount })}</Text>
              <View style={s.coverageGrid}>
                {pilotCoverage.items.map(item => (
                  <View
                    accessible
                    accessibilityLabel={formatString(strings.history.pilot.conditionAccessibilityLabel, { label: item.label, count: item.count, sessions: item.count === 1 ? strings.history.common.session : strings.history.common.sessions })}
                    key={item.id}
                    style={[s.coverageItem, item.count > 0 && s.coverageItemCovered]}
                  >
                    <Ionicons
                      name={item.count > 0 ? 'checkmark-circle' : 'ellipse-outline'}
                      size={14}
                      color={item.count > 0 ? '#86efac' : '#fbbf24'}
                    />
                    <Text style={[s.coverageItemText, item.count > 0 && s.coverageItemTextCovered]}>{formatString(strings.history.filters.labelCount, { label: item.label, count: item.count })}</Text>
                  </View>
                ))}
              </View>
              <Text
                accessibilityLiveRegion="polite"
                style={pilotCoverage.missingLabels.length > 0 ? s.coverageMissing : s.coverageComplete}
              >
                {pilotCoverage.missingLabels.length > 0
                  ? formatString(strings.history.progress.stillNeeded, { items: pilotCoverage.missingLabels.join(', ') })
                  : strings.history.pilot.coverageComplete}
              </Text>
              <Text style={s.coverageStats}>{formatString(strings.history.pilot.deviceCoverage, { count: completeDeviceImpactCount })}</Text>
              <Text style={s.coverageCaution}>{strings.history.pilot.coverageCaution}</Text>
            </View>
            {issueSessionCount > 0 && (
              <View style={s.patternSummary}>
                <Text style={s.coverageTitle}>{strings.history.pilot.patternsTitle}</Text>
                <Text style={s.patternIntro}>{strings.history.pilot.patternsIntro}</Text>
                {issueInsights.map(insight => (
                  <View key={insight.assessment} style={s.patternGroup}>
                    <Text style={s.patternTitle}>{formatString(strings.history.pilot.issueCount, { count: insight.total, label: insight.label.toLowerCase() })}</Text>
                    {insight.total === 0 ? (
                      <Text style={s.patternCopy}>{strings.history.pilot.noPatterns}</Text>
                    ) : (
                      <>
                        <Text style={s.patternCopy}>{formatString(strings.history.pilot.sensitivities, { counts: formatPilotCounts(insight.sensitivities) || strings.history.common.notRecordedLower })}</Text>
                        <Text style={s.patternCopy}>{formatString(strings.history.pilot.conditions, { counts: formatPilotCounts(insight.conditions) || strings.history.common.notRecordedLower })}</Text>
                        {insight.completeConditionCount < insight.total && (
                          <Text style={s.patternMissing}>{formatString(strings.history.pilot.incompleteConditions, { count: insight.total - insight.completeConditionCount })}</Text>
                        )}
                      </>
                    )}
                  </View>
                ))}
                <Text style={s.patternCaution}>{strings.history.pilot.patternsCaution}</Text>
              </View>
            )}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={sessionOperationsBusy
                ? strings.history.pilot.shareBusy
                : strings.history.pilot.shareAccessibilityLabel}
              accessibilityHint={strings.history.pilot.shareHint}
              accessibilityState={{ disabled: sessionOperationsBusy, busy: sessionOperationsBusy }}
              disabled={sessionOperationsBusy}
              onPress={() => { void sharePilotProgress(); }}
              style={[s.pilotExportButton, sessionOperationsBusy && s.operationDisabled]}
            >
              <Ionicons name="document-text-outline" size={17} color="#bfdbfe" />
              <View style={s.pilotExportCopy}>
                <Text style={s.pilotExportTitle}>{strings.history.pilot.shareTitle}</Text>
                <Text style={s.pilotExportDetail}>{strings.history.pilot.shareDetail}</Text>
              </View>
              <Ionicons name="share-outline" size={16} color="#93c5fd" />
            </TouchableOpacity>
          </View>
  );
}
