import { Text, View } from 'react-native';
import { headphoneMotionLabel } from '../../lib/historyPresentation';
import type { SessionRecord } from '../../lib/historyRecord';
import { historyStyles as s } from './historyStyles';

export function HistorySessionDiagnostics({ item, isExpanded }: { item: SessionRecord; isExpanded: boolean }) {
  return <>
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

  </>;
}
