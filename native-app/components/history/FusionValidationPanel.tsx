import { strings, formatString } from '../../lib/strings';
import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';
import { fmtDuration, historyTextValue } from '../../lib/historyPresentation';
import type { HistoryViewModel } from '../../lib/historyViewModel';
import { historyStyles as s } from './historyStyles';

export function FusionValidationPanel({ model }: { model: HistoryViewModel }) {
  const { fusionValidation, fusionSessionPlan } = model;
  return (
          <View style={s.fusionDashboard}>
            <Text style={s.fusionEyebrow}>{strings.history.fusion.eyebrow}</Text>
            <Text style={s.fusionTitle}>{strings.history.fusion.title}</Text>
            <View style={s.fusionStats}>
              <View style={s.fusionStat}>
                <Text style={s.fusionStatValue}>{fusionValidation.observedSessions}/{fusionValidation.sessionTarget}</Text>
                <Text style={s.fusionStatLabel}>{strings.history.fusion.sessions}</Text>
              </View>
              <View style={s.fusionStat}>
                <Text style={s.fusionStatValue}>{fusionValidation.cameraSessions}</Text>
                <Text style={s.fusionStatLabel}>{strings.history.fusion.camera}</Text>
              </View>
              <View style={s.fusionStat}>
                <Text style={s.fusionStatValue}>{fusionValidation.headphoneSessions}</Text>
                <Text style={s.fusionStatLabel}>{strings.history.fusion.headphone}</Text>
              </View>
              <View style={s.fusionStat}>
                <Text style={s.fusionStatValue}>{fusionValidation.watchCheckedSessions}</Text>
                <Text style={s.fusionStatLabel}>{strings.history.fusion.watchChecked}</Text>
              </View>
            </View>
            <Text style={s.fusionDetail}>{formatString(strings.history.fusion.observationTime, { duration: fmtDuration(fusionValidation.observationDurationSec) })}</Text>
            <Text style={s.fusionDetail}>{formatString(strings.history.fusion.watchContext, { paired: fusionValidation.watchPairedSessions, installed: fusionValidation.watchInstalledSessions, reachable: fusionValidation.watchReachableSessions })}</Text>
            <Text style={s.fusionDetail}>{formatString(strings.history.fusion.headNodOverlap, {
              overlap: historyTextValue(fusionValidation.cameraHeadphoneNodOverlaps),
              sessions: fusionValidation.overlapSessions,
              elevated: historyTextValue(fusionValidation.elevatedCameraHeadphoneNodOverlaps),
            })}</Text>
            <View style={fusionSessionPlan.complete ? s.fusionPlanComplete : s.fusionPlan}>
              <View style={s.fusionPlanHeader}>
                <View style={s.fusionPlanCopy}>
                  <Text style={s.fusionPlanEyebrow}>{strings.history.fusion.nextHeading}</Text>
                  <Text style={s.fusionPlanTitle}>{fusionSessionPlan.title}</Text>
                </View>
                <Text style={s.fusionPlanProgress}>{formatString(strings.history.fusion.setupProgress, { completed: fusionSessionPlan.completedSetups, total: fusionSessionPlan.totalSetups })}</Text>
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
              <Text style={s.fusionPlanOptional}>{strings.history.fusion.accessoriesOptional}</Text>
            </View>
            {fusionValidation.recoveredSessionsExcluded > 0 && (
              <Text style={s.fusionExcluded}>{formatString(strings.history.fusion.recoveredExcluded, { count: fusionValidation.recoveredSessionsExcluded, description: fusionValidation.recoveredSessionsExcluded === 1 ? strings.history.fusion.recoveredSingular : strings.history.fusion.recoveredPlural })}</Text>
            )}
            <View style={fusionValidation.insufficientData ? s.fusionCoverageMissing : s.fusionCoverageComplete}>
              <Ionicons
                name={fusionValidation.insufficientData ? 'information-circle-outline' : 'checkmark-circle-outline'}
                size={16}
                color={fusionValidation.insufficientData ? '#fbbf24' : '#86efac'}
              />
              <Text style={fusionValidation.insufficientData ? s.fusionCoverageMissingText : s.fusionCoverageCompleteText}>
                {fusionValidation.insufficientData
                  ? formatString(strings.history.fusion.missingCoverage, { coverage: fusionValidation.missingCoverage.join(', ') })
                  : strings.history.fusion.coverageComplete}
              </Text>
            </View>
            <Text style={s.fusionCaution}>{strings.history.fusion.caution}</Text>
          </View>
  );
}
