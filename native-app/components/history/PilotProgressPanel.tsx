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
  );
}
