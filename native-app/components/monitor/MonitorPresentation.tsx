import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import type { CameraRuntimeError } from 'react-native-vision-camera';
import { AlertSystem, type AlertTimingEvent } from '../AlertSystem';
import { CameraSetupGuide } from '../CameraSetupGuide';
import { MonitorCaptureCamera, type CaptureConfigurationChange } from '../MonitorCaptureCamera';
import { LiveMetrics } from '../LiveMetrics';
import { GlassSurface } from '../GlassSurface';
import { MonitorLayout } from '../MonitorLayout';
import type { EyeMetrics } from '../../hooks/useEyeTracking';
import type { AlertLevel } from '../../lib/alertPolicy';
import type { CameraSetupAssessment } from '../../lib/cameraSetup';
import type { FrontCameraIdentity } from '../../lib/deviceCondition';
import { INNER_CAMERA_SETUP_MESSAGE, INNER_CAMERA_MONITOR_MESSAGE } from '../../lib/frontCameraSwitch';
import { EYE_BASELINE_EXPERIMENT } from '../../lib/eyeBaselineModel';
import { SIMULATOR_TRACE } from '../../lib/simulatorTrace';
import { SAFE_STOP_OPTIONS, type SafeStopKind } from '../../lib/safeStopLinks';
import { modalAnimationType } from '../../lib/accessibilityPreferencesModel';
import { deriveMonitorPresentation } from '../../lib/monitorPresentationModel';
import type { deriveCameraLoadPolicy } from '../../lib/cameraResilience';
import { monitorStyles as s } from './monitorStyles';

type CaptureProps = React.ComponentProps<typeof MonitorCaptureCamera>;
interface Props {
  device: CaptureProps['device'] | undefined; frameProcessor: CaptureProps['frameProcessor'];
  simulatorPhase: string;
  cameraLoadPolicy: ReturnType<typeof deriveCameraLoadPolicy>; cameraEpoch: number; cameraCallbackOwner: number;
  handleCaptureConfiguration(change: CaptureConfigurationChange): void;
  handleCameraError(error: CameraRuntimeError, epoch: number, owner: number): Promise<void>;
  metrics: EyeMetrics; alertCount: number; frontCameraIdentity: FrontCameraIdentity | null;
  isRunning: boolean; isStarting: boolean; isStopping: boolean; sensitivityLoaded: boolean; baselineLoaded: boolean; baselineBusy: boolean;
  cameraRecovering: boolean; setupPreviewActive: boolean; cameraSetup: CameraSetupAssessment; sensorFault: string | null;
  sessionStartedAt: number | null; sessionEndedAt: number | null; baselineMessage: string; reduceMotion: boolean;
  visibleAlertLevel: AlertLevel; setVisibleAlertLevel(level: AlertLevel): void; recordAlertTiming(event: AlertTimingEvent): void;
  safeStopOpen: boolean; safeStopBusy: boolean; setSafeStopOpen(open: boolean): void;
  handleSafeStopChoice(kind: SafeStopKind): Promise<void>;
  handleStart(): Promise<void>; handleStop(): Promise<void>; toggleSetupPreview(): void;
  onHome(): void; onSettings(): void; onRecoveryHome(): void;
}

const SAFE_STOP_ICONS: Record<SafeStopKind, React.ComponentProps<typeof Ionicons>['name']> = {
  'rest-area': 'bed-outline', 'gas-station': 'car-outline', 'food-coffee': 'cafe-outline',
};
function MonitoringWakeLock() {
  useKeepAwake('occulert-active-monitoring');
  return null;
}

export function MonitorPermissionState({ onRequestAccess }: { onRequestAccess(): Promise<void> }) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.permBox}>
          <Text style={s.permIcon}>📷</Text>
          <Text style={s.permTitle}>Camera Access Required</Text>
          <Text style={s.permSub}>
            Occulert uses your front camera to detect fatigue. No video is stored or uploaded.
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Grant camera access"
            style={s.permBtn}
            onPress={onRequestAccess}
          >
            <Text style={s.permBtnText}>Grant Camera Access</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
}

export function MonitorCameraUnavailable() {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.permBox}>
          <Text style={s.permIcon}>📷</Text>
          <Text style={s.permTitle}>No Front Camera Found</Text>
          <Text style={s.permSub}>Occulert needs a front-facing camera to monitor fatigue.</Text>
        </View>
      </SafeAreaView>
    );
}

export function MonitorPresentation({
  device, frameProcessor, simulatorPhase, cameraLoadPolicy, cameraEpoch, cameraCallbackOwner, handleCaptureConfiguration, handleCameraError, metrics, alertCount, frontCameraIdentity, isRunning, isStarting, isStopping, sensitivityLoaded, baselineLoaded, baselineBusy, cameraRecovering, setupPreviewActive, cameraSetup, sensorFault, sessionStartedAt, sessionEndedAt, baselineMessage, reduceMotion, visibleAlertLevel, setVisibleAlertLevel, recordAlertTiming, safeStopOpen, safeStopBusy, setSafeStopOpen, handleSafeStopChoice, handleStart, handleStop, toggleSetupPreview, onHome, onSettings, onRecoveryHome
}: Props) {
  const { recoveryRequired, monitorStatusLabel, monitorStatusColor } = deriveMonitorPresentation({ metrics, sensorFault, isStopping, isStarting, cameraRecovering, isRunning, setupPreviewActive, cameraSetup });
  return (
    <View style={s.container}>
      {isRunning && <MonitoringWakeLock />}

      <Modal
        animationType={modalAnimationType(reduceMotion)}
        transparent
        visible={safeStopOpen}
        onRequestClose={() => {
          if (!safeStopBusy) setSafeStopOpen(false);
        }}
      >
        <SafeAreaView style={s.safeStopBackdrop}>
          <View
            accessibilityLabel="Safe stop options"
            accessibilityViewIsModal
            style={s.safeStopSheet}
          >
            <ScrollView style={s.safeStopScroll} contentContainerStyle={s.safeStopContent}>
              <View style={s.safeStopHeader}>
                <View style={s.safeStopIconWrap}>
                  <Ionicons name="navigate" size={24} color="#7dd3fc" />
                </View>
                <View style={s.safeStopHeadingText}>
                  <Text style={s.safeStopTitle}>Find a safe place to stop</Text>
                  <Text style={s.safeStopKicker}>DROWSINESS ALERT FOLLOW-UP</Text>
                </View>
              </View>

              <Text style={s.safeStopWarning}>
                Only use this after you are safely parked, or ask a passenger. Opening Maps ends monitoring and saves this drive first.
              </Text>
              <Text style={s.safeStopPrivacy}>
                Occulert sends only a search phrase to Maps and does not read, store, or upload your location.
              </Text>

              <View style={s.safeStopOptions}>
                {SAFE_STOP_OPTIONS.map((option) => (
                  <TouchableOpacity
                    key={option.kind}
                    accessibilityRole="button"
                    accessibilityLabel={`Find ${option.label.toLowerCase()}`}
                    accessibilityHint={`${option.detail}. Ends monitoring, saves this drive, then opens Maps.`}
                    accessibilityState={{ disabled: safeStopBusy, busy: safeStopBusy }}
                    disabled={safeStopBusy}
                    style={[s.safeStopOption, safeStopBusy && s.disabledBtn]}
                    onPress={() => {
                      void handleSafeStopChoice(option.kind);
                    }}
                  >
                    <View style={s.safeStopOptionIcon}>
                      <Ionicons name={SAFE_STOP_ICONS[option.kind]} size={22} color="#e0f2fe" />
                    </View>
                    <View style={s.safeStopOptionText}>
                      <Text style={s.safeStopOptionTitle}>{option.label}</Text>
                      <Text style={s.safeStopOptionDetail}>{option.detail}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#4a7a8a" />
                  </TouchableOpacity>
                ))}
              </View>

            </ScrollView>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={safeStopBusy ? 'Ending and saving drive' : 'Cancel safe stop search'}
              accessibilityState={{ disabled: safeStopBusy, busy: safeStopBusy }}
              disabled={safeStopBusy}
              style={s.safeStopCancel}
              onPress={() => setSafeStopOpen(false)}
            >
              <Text style={s.safeStopCancelText}>
                {safeStopBusy ? 'ENDING AND SAVING DRIVE…' : 'CANCEL'}
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      <MonitorLayout
        reduceMotion={reduceMotion}
        attentionKey={sensorFault || (cameraRecovering ? 'camera-recovering' : isRunning ? `${metrics.state}:${visibleAlertLevel}:${frontCameraIdentity?.streamingType ?? 'unknown'}` : `parked:${frontCameraIdentity?.streamingType ?? 'unknown'}`)}
        camera={
          SIMULATOR_TRACE ? (
            <View style={[StyleSheet.absoluteFill, s.camOff]}>
              <Text style={[s.camOffTxt, { color: '#fbbf24', fontSize: 20 }]}>SIMULATOR TRACE</Text>
              <Text style={s.camOffTxt}>{isRunning || setupPreviewActive ? simulatorPhase : 'Tap Start to run the scripted trace'}</Text>
            </View>
          ) : (isRunning || setupPreviewActive) && device ? (
            <MonitorCaptureCamera
              key={`front-camera-${cameraEpoch}`}
              loadMode={cameraLoadPolicy.mode}
              monitoring={isRunning}
              onCaptureConfiguration={handleCaptureConfiguration}
              style={StyleSheet.absoluteFill}
              device={device}
              isActive={isRunning || setupPreviewActive}
              frameProcessor={frameProcessor}
              pixelFormat="yuv"
              resizeMode="contain"
              onError={(error) => { void handleCameraError(error, cameraEpoch, cameraCallbackOwner); }}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, s.camOff]}>
              <Ionicons name="eye-off" size={64} color="#1a3a4a" />
              <Text style={s.camOffTxt}>Tap Start to begin monitoring</Text>
            </View>
          )
        }
        header={
          <GlassSurface style={s.topBar} tintColor="rgba(5, 10, 18, 0.5)">
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={isRunning ? 'Return home and end monitoring' : 'Return home'}
              style={s.backBtn}
              onPress={onHome}
            >
              <Ionicons name="chevron-back" size={20} color="#c8e8f0" />
              <Text style={s.backLbl}>Home</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={isRunning ? 'Open settings and end monitoring' : 'Open settings'}
              style={s.settingsBtn}
              onPress={onSettings}
            >
              <Ionicons name="settings-outline" size={20} color="#c8e8f0" />
            </TouchableOpacity>
          </GlassSurface>
        }
        primaryAction={
          !isRunning ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Start fatigue monitoring"
              accessibilityHint="Starts on-device camera monitoring using the current setup"
              accessibilityState={{ disabled: isStarting || isStopping || !sensitivityLoaded || !baselineLoaded || baselineBusy }}
              disabled={isStarting || isStopping || !sensitivityLoaded || !baselineLoaded || baselineBusy}
              style={[
                s.startBtn,
                (isStarting || isStopping || !sensitivityLoaded || !baselineLoaded || baselineBusy) && s.disabledBtn,
              ]}
              onPress={handleStart}
            >
              <Ionicons name="eye" size={22} color="#fff" />
              <Text style={s.startTxt}>
                {isStarting
                  ? 'PREPARING SENSORS...'
                  : isStopping
                    ? 'SAVING SESSION...'
                    : sensitivityLoaded
                      ? 'START MONITORING'
                      : 'LOADING SETTINGS...'}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Stop monitoring and save this drive"
              accessibilityHint="Ends camera monitoring and saves the local session summary"
              style={s.stopBtn}
              onPress={() => {
                void handleStop();
              }}
            >
              <Ionicons name="stop-circle" size={22} color="#fff" />
              <Text style={s.stopTxt}>STOP</Text>
            </TouchableOpacity>
          )
        }
      >
        <AlertSystem
          metrics={metrics}
          isRunning={isRunning}
          sessionStartedAt={sessionStartedAt}
          sessionEndedAt={sessionEndedAt}
          onTimingEvent={recordAlertTiming}
          onLevelChange={setVisibleAlertLevel}
          inline
        />

        <View
          accessibilityLiveRegion="polite"
          accessibilityRole="text"
          accessibilityLabel={`Monitoring status: ${monitorStatusLabel}`}
          style={s.pill}
        >
          <View style={[s.dot, { backgroundColor: monitorStatusColor }]} />
          <Text style={s.pillTxt}>{monitorStatusLabel}</Text>
        </View>
        {sensorFault && (
          <View style={s.sensorFault} accessibilityRole="alert">
            <Text style={s.sensorFaultTitle}>
              {recoveryRequired ? 'RECOVERY REQUIRED' : 'CAMERA ANALYSIS STOPPED'}
            </Text>
            <Text style={s.sensorFaultText}>{sensorFault}</Text>
            {recoveryRequired && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Return Home to recover the previous drive"
                accessibilityHint="Leaves monitoring and starts the interrupted-drive recovery check"
                onPress={onRecoveryHome}
                style={s.recoveryHomeButton}
              >
                <Ionicons name="arrow-back" size={16} color="#fee2e2" />
                <Text style={s.recoveryHomeButtonText}>RETURN HOME TO RECOVER</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {frontCameraIdentity?.streamingType === 'inner' && (isRunning || setupPreviewActive) && (
          <Text accessibilityLiveRegion="polite" style={s.cameraIdentityNote}>
            {isRunning ? INNER_CAMERA_MONITOR_MESSAGE : INNER_CAMERA_SETUP_MESSAGE}
          </Text>
        )}

        {EYE_BASELINE_EXPERIMENT && <Text accessibilityLiveRegion="polite" style={{color:'#22d3ee',padding:12}}>{baselineMessage}</Text>}
        {!isRunning && (
          <CameraSetupGuide
            active={setupPreviewActive}
            assessment={cameraSetup}
            disabled={isStarting || isStopping || baselineBusy}
            onTogglePreview={toggleSetupPreview}
          />
        )}

        {isRunning && (
          <LiveMetrics
            metrics={metrics}
            alertCount={alertCount}
            cameraRecovering={cameraRecovering}
            isRunning={isRunning}
            sessionStartedAt={sessionStartedAt}
            sessionEndedAt={sessionEndedAt}
          />
        )}

        {isRunning && alertCount > 0 && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Find a safe place to stop"
            accessibilityHint="Open parked-only rest area, gas, food, and coffee options"
            style={s.safeStopBtn}
            onPress={() => setSafeStopOpen(true)}
          >
            <Ionicons name="navigate-circle" size={23} color="#082f49" />
            <View style={s.safeStopBtnTextWrap}>
              <Text style={s.safeStopBtnText}>FIND A SAFE STOP</Text>
              <Text style={s.safeStopBtnSub}>Rest area · Gas · Food or coffee</Text>
            </View>
          </TouchableOpacity>
        )}

        {isRunning && (
          <Text style={s.awakeNote}>
            {cameraLoadPolicy.mode === 'reduced'
              ? 'Battery and heat saver active · Keep app in foreground'
              : 'Screen kept on · Keep app in foreground'}
          </Text>
        )}
      </MonitorLayout>
    </View>
  );
}
