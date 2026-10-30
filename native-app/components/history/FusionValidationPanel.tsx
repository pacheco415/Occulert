import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';
import { fmtDuration } from '../../lib/historyPresentation';
import type { HistoryViewModel } from '../../lib/historyViewModel';
import { historyStyles as s } from './historyStyles';

export function FusionValidationPanel({ model }: { model: HistoryViewModel }) {
  const { fusionValidation, fusionSessionPlan } = model;
  return (
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
  );
}
