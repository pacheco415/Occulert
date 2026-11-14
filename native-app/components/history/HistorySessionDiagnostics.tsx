import { strings, formatString } from '../../lib/strings';
import { Text, View } from 'react-native';
import { headphoneMotionLabel, historyTextValue } from '../../lib/historyPresentation';
import type { SessionRecord } from '../../lib/historyRecord';
import { historyStyles as s } from './historyStyles';

export function HistorySessionDiagnostics({ item, isExpanded }: { item: SessionRecord; isExpanded: boolean }) {
  return <>
            {isExpanded && item.monitorPerformance && (
              <View style={s.performanceBox}>
                <Text style={s.performanceTitle}>{strings.history.diagnostics.performanceTitle}</Text>
                <Text style={s.performanceInfo}>{formatString(strings.history.diagnostics.firstSample, { sample: item.monitorPerformance.timeToFirstSampleMs == null ? strings.history.diagnostics.notObserved : formatString(strings.history.diagnostics.milliseconds, { value: String(item.monitorPerformance.timeToFirstSampleMs) }) })}</Text>
                <Text style={s.performanceInfo}>{formatString(strings.history.diagnostics.inference, { p95: historyTextValue(item.monitorPerformance.p95InferenceMs ?? ''), interval: historyTextValue(item.monitorPerformance.averageSampleIntervalMs ?? '') })}</Text>
                <Text style={s.performanceInfo}>{formatString(strings.history.diagnostics.display, { updates: historyTextValue(item.monitorPerformance.uiUpdatesPerSecond ?? ''), stalls: historyTextValue(item.monitorPerformance.cameraStalls ?? '') })}</Text>
                {item.monitorPerformance.alertTiming?.alertsTriggered > 0 && (
                  <>
                    <Text style={s.performanceInfo}>{formatString(strings.history.diagnostics.phoneDispatch, { average: historyTextValue(item.monitorPerformance.alertTiming.averagePhoneDispatchMs ?? ''), maximum: historyTextValue(item.monitorPerformance.alertTiming.maxPhoneDispatchMs ?? '') })}</Text>
                    <Text style={s.performanceInfo}>{formatString(strings.history.diagnostics.watchAcknowledgements, { acknowledged: historyTextValue(item.monitorPerformance.alertTiming.watchLiveAcknowledgements ?? ''), results: historyTextValue(item.monitorPerformance.alertTiming.watchResults ?? ''), roundTrip: item.monitorPerformance.alertTiming.watchLiveAcknowledgements > 0 ? formatString(strings.history.diagnostics.watchRoundTrip, { average: String(item.monitorPerformance.alertTiming.averageWatchRoundTripMs) }) : '', queued: item.monitorPerformance.alertTiming.watchQueuedFallbacks > 0 ? formatString(strings.history.diagnostics.watchQueued, { count: String(item.monitorPerformance.alertTiming.watchQueuedFallbacks) }) : '' })}</Text>
                  </>
                )}
                <Text style={s.performanceCaution}>{strings.history.diagnostics.performanceCaution}</Text>
              </View>
            )}
            {isExpanded && (item.headNodObservations != null || item.headphoneMotionStatus != null) && (
              <View style={s.observationBox}>
                <Text style={s.observationTitle}>{strings.history.diagnostics.headMotionTitle}</Text>
                <Text style={s.observationInfo}>{formatString(strings.history.diagnostics.cameraCandidates, { count: historyTextValue(item.cameraHeadNodObservations ?? item.headNodObservations ?? 0) })}</Text>
                <Text style={s.observationInfo}>{formatString(strings.history.diagnostics.headphoneCandidates, { count: historyTextValue(item.headphoneHeadNodObservations ?? 0), samples: historyTextValue(item.headphoneMotionSamples ?? 0) })}</Text>
                <Text style={s.observationStatus}>{headphoneMotionLabel(item.headphoneMotionStatus)}</Text>
                <Text style={s.observationCaution}>{strings.history.diagnostics.headMotionCaution}</Text>
              </View>
            )}
            {isExpanded && item.sensorFusion?.mode === 'observation-only' && (
              <View style={s.observationBox}>
                <Text style={s.observationTitle}>{strings.history.diagnostics.fusionTitle}</Text>
                <Text style={s.observationInfo}>{formatString(strings.history.diagnostics.cameraSamples, { tracked: historyTextValue(item.sensorFusion.camera?.trackedSamples ?? 0), samples: historyTextValue(item.sensorFusion.camera?.samples ?? 0), watch: historyTextValue(item.sensorFusion.camera?.watchSamples ?? 0), closed: historyTextValue(item.sensorFusion.camera?.closedSamples ?? 0) })}</Text>
                <Text style={s.observationInfo}>{formatString(strings.history.diagnostics.headNodOverlap, { overlap: historyTextValue(item.sensorFusion.coincidences?.cameraHeadphoneNods ?? 0), elevated: historyTextValue(item.sensorFusion.coincidences?.elevatedCameraHeadphoneNods ?? 0) })}</Text>
                <Text style={s.observationStatus}>{formatString(strings.history.diagnostics.watchStatus, { status: item.sensorFusion.watch?.checked ? item.sensorFusion.watch.reachable ? strings.history.diagnostics.watchReachable : item.sensorFusion.watch.appInstalled ? strings.history.diagnostics.watchInstalled : item.sensorFusion.watch.paired ? strings.history.diagnostics.watchPaired : strings.history.diagnostics.watchUnavailable : strings.history.diagnostics.watchUnchecked })}</Text>
                <Text style={s.observationCaution}>{strings.history.diagnostics.fusionCaution}</Text>
              </View>
            )}
            {isExpanded && item.unansweredAlerts && (
              <View style={s.observationBox}>
                <Text style={s.observationTitle}>{strings.history.diagnostics.unansweredTitle}</Text>
                <Text style={s.observationInfo}>{formatString(strings.history.diagnostics.unansweredCount, { count: historyTextValue(item.unansweredAlerts.candidates ?? '') })}</Text>
                <Text style={s.observationInfo}>{formatString(strings.history.diagnostics.motionContext, { unknown: historyTextValue(item.unansweredAlerts.byMotion.unknown ?? ''), unavailable: historyTextValue(item.unansweredAlerts.byMotion.unavailable ?? ''), denied: historyTextValue(item.unansweredAlerts.byMotion.denied ?? ''), stale: historyTextValue(item.unansweredAlerts.byMotion.stale ?? '') })}</Text>
                <Text style={s.observationInfo}>{formatString(strings.history.diagnostics.reportedMotion, { stationary: historyTextValue(item.unansweredAlerts.byMotion['not-moving'] ?? ''), automotive: historyTextValue(item.unansweredAlerts.byMotion['reported-activity'] ?? '') })}</Text>
                <Text style={s.observationCaution}>{strings.history.diagnostics.unansweredCaution}</Text>
              </View>
            )}

  </>;
}
