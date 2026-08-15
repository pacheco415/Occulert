import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Alert,
  AppState,
  BackHandler,
  Linking,
  Modal,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import {
  useFaceDetector,
  type FrameFaceDetectionOptions,
} from 'react-native-vision-camera-face-detector';
import { Worklets } from 'react-native-worklets-core';
import { useKeepAwake } from 'expo-keep-awake';
import { Ionicons } from '@expo/vector-icons';
import { useEyeTracking } from '../hooks/useEyeTracking';
import { AlertSystem } from '../components/AlertSystem';
import { GlassSurface } from '../components/GlassSurface';
import { loadSavedSensitivity } from '../components/SensitivitySlider';
import type { EyeMetrics } from '../hooks/useEyeTracking';
import type { SensitivityLevel } from '../constants/thresholds';
import { updateSessionHistory } from '../lib/sessionHistory';
import {
  beginCloudSession,
  finishCloudSession,
  logCloudAlert,
} from '../lib/cloudSync';
import { consumePreDriveSafety } from '../lib/preDriveGate';
import { currentAppBuildInfo } from '../lib/appBuildInfo';
import { HeadNodDetector } from '../lib/headNodDetector';
import {
  addHeadphoneMotionSampleListener,
  addHeadphoneMotionStatusListener,
  startHeadphoneMotion,
  stopHeadphoneMotion,
  type HeadphoneMotionState,
} from '../lib/headphoneMotion';
import {
  SAFE_STOP_OPTIONS,
  buildSafeStopSearchUrls,
  safeStopSearchQuery,
  type SafeStopKind,
} from '../lib/safeStopLinks';
import {
  shouldStopMonitoringForAppState,
  stopBeforeNavigation,
} from '../lib/monitorLifecycle';

/**
 * MonitorScreen — full-screen camera + real on-device eye tracking.
 *
 * All frame processing stays on-device. No camera frames are stored or
 * uploaded. VisionCamera requires a development/TestFlight build; this screen
 * does not run in Expo Go.
 */

const FACE_DETECTOR_OPTIONS: FrameFaceDetectionOptions = {
  performanceMode: 'fast',
  classificationMode: 'all',
  landmarkMode: 'none',
  contourMode: 'none',
  trackingEnabled: false,
  cameraFacing: 'front',
};

const CLOSED_CONFIRM_MS = 1_200;
const SENSOR_STARTUP_GRACE_MS = 10_000;
const SENSOR_STALL_MS = 5_000;

type StopOptions = { deferCloudFinalization?: boolean };

const SAFE_STOP_ICONS: Record<SafeStopKind, React.ComponentProps<typeof Ionicons>['name']> = {
  'rest-area': 'bed-outline',
  'gas-station': 'car-outline',
  'food-coffee': 'cafe-outline',
};

export default function MonitorScreen() {
  useKeepAwake();

  const router = useRouter();
  const device = useCameraDevice('front');
  const { hasPermission, requestPermission } = useCameraPermission();
  const [isRunning, setIsRunning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [sensitivity, setSensitivity] = useState<SensitivityLevel>('medium');
  const [sensitivityLoaded, setSensitivityLoaded] = useState(false);
  const [sensorFault, setSensorFault] = useState<string | null>(null);
  const [sessionTime, setSessionTime] = useState(0);
  const [alertCount, setAlertCount] = useState(0);
  const [safeStopOpen, setSafeStopOpen] = useState(false);
  const [safeStopBusy, setSafeStopBusy] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevAlertingRef = useRef(false);
  const fatigueSumRef = useRef(0);
  const fatigueSamplesRef = useRef(0);
  const maxFatigueRef = useRef(0);
  const closedSinceRef = useRef<number | null>(null);
  const sessionSensitivityRef = useRef<SensitivityLevel>('medium');
  const startingRef = useRef(false);
  const stoppingRef = useRef(false);
  const isRunningRef = useRef(false);
  const handleStopRef = useRef<(options?: StopOptions) => Promise<void>>(async () => {});
  const cloudSessionRef = useRef<Promise<string | null> | null>(null);
  const cloudEventQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastSampleAtRef = useRef(0);
  const hasCameraSampleRef = useRef(false);
  const headNodDetectorRef = useRef(new HeadNodDetector());
  const headNodObservationsRef = useRef(0);
  const monitoringActiveRef = useRef(false);
  const headphoneHeadNodDetectorRef = useRef(new HeadNodDetector());
  const headphoneHeadNodObservationsRef = useRef(0);
  const headphoneMotionSamplesRef = useRef(0);
  const headphoneMotionStatusRef = useRef<HeadphoneMotionState>('not-built');

  const [metrics, setMetrics] = useState<EyeMetrics>({
    ear: 0.3,
    perclos: 0,
    fatigueScore: 0,
    state: 'noFace',
  });

  const { processEyeOpenness, processNoFace, reset } = useEyeTracking(sensitivity);
  const { detectFaces } = useFaceDetector(FACE_DETECTOR_OPTIONS);

  useEffect(() => {
    loadSavedSensitivity()
      .then(setSensitivity)
      .finally(() => setSensitivityLoaded(true));
  }, []);

  useEffect(() => {
    const sampleSubscription = addHeadphoneMotionSampleListener((sample) => {
      if (!monitoringActiveRef.current) return;
      headphoneMotionSamplesRef.current += 1;
      const result = headphoneHeadNodDetectorRef.current.update({
        at: sample.timestampMs,
        faceFound: true,
        pitchAngle: sample.pitchAngle,
        yawAngle: sample.yawAngle,
        rollAngle: sample.rollAngle,
      });
      // Observation only: headphone motion never changes the fatigue score or alerts.
      if (result.observed) headphoneHeadNodObservationsRef.current += 1;
    });
    const statusSubscription = addHeadphoneMotionStatusListener((status) => {
      if (monitoringActiveRef.current) headphoneMotionStatusRef.current = status.state;
    });

    return () => {
      monitoringActiveRef.current = false;
      sampleSubscription.remove();
      statusSubscription.remove();
      void stopHeadphoneMotion();
    };
  }, []);

  useEffect(() => {
    if (isRunning) {
      timerRef.current = setInterval(() => setSessionTime((time) => time + 1), 1_000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setSessionTime(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRunning]);

  useEffect(() => {
    if (!isRunning && !safeStopBusy) setSafeStopOpen(false);
  }, [isRunning, safeStopBusy]);

  const fmt = (seconds: number) =>
    `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  const handleStart = async () => {
    if (startingRef.current || isStopping || !sensitivityLoaded) return;
    startingRef.current = true;
    setIsStarting(true);
    try {
      if (!hasPermission) {
        const granted = await requestPermission();
        if (!granted) return;
      }
      if (!consumePreDriveSafety()) {
        router.replace('/pre-drive');
        return;
      }

      reset();
      prevAlertingRef.current = false;
      fatigueSumRef.current = 0;
      fatigueSamplesRef.current = 0;
      maxFatigueRef.current = 0;
      closedSinceRef.current = null;
      headNodDetectorRef.current.reset();
      headNodObservationsRef.current = 0;
      headphoneHeadNodDetectorRef.current.reset();
      headphoneHeadNodObservationsRef.current = 0;
      headphoneMotionSamplesRef.current = 0;
      headphoneMotionStatusRef.current = 'starting';
      monitoringActiveRef.current = true;
      setSensorFault(null);
      setSafeStopOpen(false);
      setSafeStopBusy(false);
      sessionSensitivityRef.current = sensitivity;
      cloudEventQueueRef.current = Promise.resolve();

      const headphoneStatus = await startHeadphoneMotion();
      if (headphoneMotionStatusRef.current === 'starting') {
        headphoneMotionStatusRef.current = headphoneStatus.state;
      }
      cloudSessionRef.current = beginCloudSession();
      setAlertCount(0);
      hasCameraSampleRef.current = false;
      lastSampleAtRef.current = Date.now();
      setIsRunning(true);
    } finally {
      startingRef.current = false;
      setIsStarting(false);
    }
  };

  const saveSession = useCallback(async (
    durationSec: number,
    alerts: number,
  ): Promise<string | null> => {
    if (durationSec <= 0) return null;
    const avgFatigue = fatigueSamplesRef.current
      ? Math.round(fatigueSumRef.current / fatigueSamplesRef.current)
      : 0;
    const sessionId = `session-${Date.now()}`;
    const record = {
      sessionId,
      savedAt: new Date().toISOString(),
      durationSec,
      alertCount: alerts,
      avgFatigue,
      headNodObservations: headNodObservationsRef.current,
      cameraHeadNodObservations: headNodObservationsRef.current,
      headphoneHeadNodObservations: headphoneHeadNodObservationsRef.current,
      headphoneMotionSamples: headphoneMotionSamplesRef.current,
      headphoneMotionStatus: headphoneMotionStatusRef.current,
      sensitivity: sessionSensitivityRef.current,
      ...currentAppBuildInfo(),
    };
    await updateSessionHistory<Record<string, unknown>>((sessions) =>
      [record, ...sessions].slice(0, 50));
    return sessionId;
  }, []);

  const markSessionSynced = useCallback(async (
    localSessionId: string,
    cloudSessionId: string,
  ) => {
    try {
      await updateSessionHistory<Record<string, unknown>>((sessions) => sessions.map((item) =>
        item?.sessionId === localSessionId
          ? { ...item, cloudSynced: true, cloudSessionId }
          : item));
    } catch {
      // Keep the local session intact if its cloud badge cannot update.
    }
  }, []);

  const handleStop = useCallback(async (
    options: StopOptions = {},
  ) => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    setIsStopping(true);

    const wasRunning = isRunning;
    const durationSec = sessionTime;
    const alerts = alertCount;
    const averageFatigue = fatigueSamplesRef.current
      ? Math.round(fatigueSumRef.current / fatigueSamplesRef.current)
      : 0;
    const maxFatigue = maxFatigueRef.current;
    const cloudSession = cloudSessionRef.current;
    const pendingEvents = cloudEventQueueRef.current;

    monitoringActiveRef.current = false;
    void stopHeadphoneMotion();
    cloudSessionRef.current = null;
    cloudEventQueueRef.current = Promise.resolve();
    setIsRunning(false);
    reset();

    const finalizeCloud = async (localSessionId: string | null) => {
      const cloudSessionId = cloudSession ? await cloudSession.catch(() => null) : null;
      if (!cloudSessionId) return;
      await pendingEvents.catch(() => {});
      const safetyScore = Math.max(0, 100 - Math.round(maxFatigue * 0.65) - alerts * 8);
      const synced = await finishCloudSession(cloudSessionId, {
        averageFatigue,
        maxFatigue,
        safetyScore,
        alertCount: alerts,
      });
      if (synced && localSessionId) {
        await markSessionSynced(localSessionId, cloudSessionId);
      }
    };

    try {
      if (!wasRunning) return;
      const localSessionId = await saveSession(durationSec, alerts);
      if (options.deferCloudFinalization) {
        // Optional cloud finalization never delays a safe-stop Maps handoff.
        void finalizeCloud(localSessionId).catch(() => {});
        return;
      }
      await finalizeCloud(localSessionId);
    } finally {
      stoppingRef.current = false;
      setIsStopping(false);
    }
  }, [alertCount, isRunning, markSessionSynced, reset, saveSession, sessionTime]);

  // App-state and hardware-back listeners stay registered across timer ticks,
  // while these refs always expose the latest session snapshot to them.
  isRunningRef.current = isRunning;
  handleStopRef.current = handleStop;

  const handleSafeStopChoice = useCallback(async (kind: SafeStopKind) => {
    if (safeStopBusy || stoppingRef.current) return;
    setSafeStopBusy(true);
    try {
      // Camera monitoring cannot continue reliably after Maps backgrounds the
      // app. End and save first so the UI never implies hidden protection.
      try {
        await handleStop({ deferCloudFinalization: true });
      } catch {
        // A local storage problem must not trap a fatigued driver inside
        // Occulert. Monitoring has already been disarmed before saving starts.
        Alert.alert(
          'Drive may not be fully saved',
          'Monitoring has stopped. Occulert will still open Maps so you can find a safer place to stop.',
        );
      }

      let opened = false;
      for (const url of buildSafeStopSearchUrls(Platform.OS, kind)) {
        try {
          await Linking.openURL(url);
          opened = true;
          break;
        } catch {
          // Try the portable web fallback next.
        }
      }
      if (!opened) {
        Alert.alert(
          'Unable to open Maps',
          `After you are safely parked, open your maps app and search for “${safeStopSearchQuery(kind)}”.`,
        );
      }
    } finally {
      setSafeStopOpen(false);
      setSafeStopBusy(false);
    }
  }, [handleStop, safeStopBusy]);

  const leaveMonitor = useCallback((navigate: () => void) => {
    if (stoppingRef.current) return Promise.resolve();
    return stopBeforeNavigation(
      () => handleStopRef.current(),
      navigate,
      () => {
        Alert.alert(
          'Drive may not be fully saved',
          'Monitoring has stopped, but Occulert could not finish saving this drive.',
        );
      },
    );
  }, []);

  useEffect(() => {
    if (!isRunning) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      void leaveMonitor(() => router.back());
      return true;
    });
    return () => subscription.remove();
  }, [isRunning, leaveMonitor, router]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (!shouldStopMonitoringForAppState(isRunningRef.current, nextState)) return;
      setSensorFault(
        'Monitoring stopped when Occulert left the foreground. Restart only after you are safely parked.',
      );
      void handleStopRef.current().catch(() => {});
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!isRunning) return;
    const watchdog = setInterval(() => {
      const timeoutMs = hasCameraSampleRef.current ? SENSOR_STALL_MS : SENSOR_STARTUP_GRACE_MS;
      if (stoppingRef.current || Date.now() - lastSampleAtRef.current <= timeoutMs) return;
      const message = 'Monitoring stopped: camera analysis stalled. Pull over safely before checking the phone or restarting.';
      setSensorFault(message);
      void handleStopRef.current();
    }, 500);
    return () => clearInterval(watchdog);
  }, [isRunning]);

  const onEyeState = useCallback((
    leftProb: number,
    rightProb: number,
    faceFound: boolean,
    pitchAngle: number,
    yawAngle: number,
    rollAngle: number,
  ) => {
    hasCameraSampleRef.current = true;
    lastSampleAtRef.current = Date.now();
    const now = Date.now();
    const headNodResult = headNodDetectorRef.current.update({
      at: now,
      faceFound,
      pitchAngle,
      yawAngle,
      rollAngle,
    });
    // Observation only: camera pose does not change scoring or alert delivery.
    if (headNodResult.observed) headNodObservationsRef.current += 1;

    const rawResult = faceFound
      ? processEyeOpenness(leftProb, rightProb)
      : processNoFace();

    if (rawResult.state === 'closed') {
      closedSinceRef.current ??= now;
    } else {
      closedSinceRef.current = null;
    }

    // Do not turn a blink or one noisy frame into a driver alert.
    const confirmedClosed = rawResult.state === 'closed'
      && closedSinceRef.current !== null
      && now - closedSinceRef.current >= CLOSED_CONFIRM_MS;
    const result: EyeMetrics = confirmedClosed
      ? rawResult
      : rawResult.state === 'closed'
        ? { ...rawResult, state: 'watch' }
        : rawResult;

    setMetrics(result);
    if (faceFound) {
      fatigueSumRef.current += result.fatigueScore;
      fatigueSamplesRef.current += 1;
      maxFatigueRef.current = Math.max(maxFatigueRef.current, result.fatigueScore);
    }

    const alerting = result.state === 'closed';
    if (alerting && !prevAlertingRef.current) {
      setAlertCount((count) => count + 1);
      const cloudSession = cloudSessionRef.current;
      if (cloudSession) {
        cloudEventQueueRef.current = cloudEventQueueRef.current
          .then(async () => {
            const sessionId = await cloudSession;
            if (sessionId) await logCloudAlert(sessionId, result.fatigueScore);
          })
          .catch(() => {});
      }
    }
    prevAlertingRef.current = alerting;
  }, [processEyeOpenness, processNoFace]);

  const onEyeStateJS = Worklets.createRunOnJS(onEyeState);
  const lastSample = Worklets.createSharedValue(0);

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    const now = Date.now();
    if (now - lastSample.value < 100) return;
    lastSample.value = now;

    const faces = detectFaces(frame);
    if (faces.length === 0) {
      onEyeStateJS(-1, -1, false, 0, 0, 0);
      return;
    }

    let face = faces[0];
    for (let i = 1; i < faces.length; i += 1) {
      const candidate = faces[i].bounds;
      const current = face.bounds;
      if (candidate.width * candidate.height > current.width * current.height) {
        face = faces[i];
      }
    }

    onEyeStateJS(
      face.leftEyeOpenProbability ?? -1,
      face.rightEyeOpenProbability ?? -1,
      true,
      face.pitchAngle,
      face.yawAngle,
      face.rollAngle,
    );
  }, [detectFaces, lastSample, onEyeStateJS]);

  const stateColor = {
    open: '#00ff88',
    watch: '#fbbf24',
    closed: '#ff3344',
    noFace: '#4a7a8a',
  }[metrics.state];

  if (!hasPermission) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.permBox}>
          <Text style={s.permIcon}>📷</Text>
          <Text style={s.permTitle}>Camera Access Required</Text>
          <Text style={s.permSub}>
            Occulert uses your front camera to detect fatigue. No video is stored or uploaded.
          </Text>
          <TouchableOpacity
            style={s.permBtn}
            onPress={async () => {
              const granted = await requestPermission();
              if (!granted) Linking.openSettings();
            }}
          >
            <Text style={s.permBtnText}>Grant Camera Access</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (device == null) {
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

  return (
    <View style={s.container}>
      {isRunning ? (
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={isRunning}
          frameProcessor={frameProcessor}
          pixelFormat="yuv"
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, s.camOff]}>
          <Ionicons name="eye-off" size={64} color="#1a3a4a" />
          <Text style={s.camOffTxt}>Tap Start to begin monitoring</Text>
        </View>
      )}

      <Modal
        animationType="fade"
        transparent
        visible={safeStopOpen}
        onRequestClose={() => {
          if (!safeStopBusy) setSafeStopOpen(false);
        }}
      >
        <View style={s.safeStopBackdrop}>
          <View style={s.safeStopSheet} accessibilityViewIsModal>
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

            <TouchableOpacity
              accessibilityRole="button"
              disabled={safeStopBusy}
              style={s.safeStopCancel}
              onPress={() => setSafeStopOpen(false)}
            >
              <Text style={s.safeStopCancelText}>
                {safeStopBusy ? 'ENDING AND SAVING DRIVE…' : 'CANCEL'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <SafeAreaView style={s.overlay} pointerEvents="box-none">
        <GlassSurface style={s.topBar} tintColor="rgba(5, 10, 18, 0.5)">
          <TouchableOpacity
            style={s.backBtn}
            onPress={() => {
              void leaveMonitor(() => router.back());
            }}
          >
            <Ionicons name="chevron-back" size={20} color="#c8e8f0" />
            <Text style={s.backLbl}>Home</Text>
          </TouchableOpacity>
          <View style={s.pill}>
            <View style={[s.dot, { backgroundColor: isRunning ? stateColor : '#4a7a8a' }]} />
            <Text style={s.pillTxt}>{isRunning ? metrics.state.toUpperCase() : 'STOPPED'}</Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Open settings and end monitoring"
            onPress={() => {
              void leaveMonitor(() => router.push('/settings'));
            }}
          >
            <Ionicons name="settings-outline" size={20} color="#c8e8f0" />
          </TouchableOpacity>
        </GlassSurface>

        {sensorFault && (
          <View style={s.sensorFault} accessibilityRole="alert">
            <Text style={s.sensorFaultTitle}>CAMERA ANALYSIS STOPPED</Text>
            <Text style={s.sensorFaultText}>{sensorFault}</Text>
          </View>
        )}

        <AlertSystem metrics={metrics} isRunning={isRunning} sessionTime={sessionTime} />

        <View style={s.ctrl}>
          {isRunning && (
            <View style={s.metrics}>
              {[
                { label: 'EYE', value: metrics.ear.toFixed(3), color: stateColor },
                {
                  label: 'PERCLOS',
                  value: `${(metrics.perclos * 100).toFixed(0)}%`,
                  color: metrics.perclos > 0.15 ? '#f87171' : '#c8e8f0',
                },
                {
                  label: 'SCORE',
                  value: String(metrics.fatigueScore),
                  color: metrics.fatigueScore > 60 ? '#f87171' : '#00ff88',
                },
                { label: 'TIME', value: fmt(sessionTime), color: '#c8e8f0' },
                {
                  label: 'ALERTS',
                  value: String(alertCount),
                  color: alertCount > 0 ? '#fbbf24' : '#c8e8f0',
                },
              ].map(({ label, value, color }) => (
                <View key={label} style={s.card}>
                  <Text style={s.cardLbl}>{label}</Text>
                  <Text style={[s.cardVal, { color }]}>{value}</Text>
                </View>
              ))}
            </View>
          )}

          {isRunning && alertCount > 0 && (
            <TouchableOpacity
              accessibilityRole="button"
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

          {!isRunning ? (
            <TouchableOpacity
              disabled={isStarting || isStopping || !sensitivityLoaded}
              style={[
                s.startBtn,
                (isStarting || isStopping || !sensitivityLoaded) && s.disabledBtn,
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
              style={s.stopBtn}
              onPress={() => {
                void handleStop();
              }}
            >
              <Ionicons name="stop-circle" size={22} color="#fff" />
              <Text style={s.stopTxt}>STOP</Text>
            </TouchableOpacity>
          )}
          {isRunning && (
            <Text style={s.awakeNote}>Screen kept on · Keep app in foreground</Text>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  overlay: { flex: 1, justifyContent: 'space-between' },
  camOff: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#050a0f' },
  camOffTxt: { color: '#1a3a4a', marginTop: 12, fontSize: 14 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 10,
    marginTop: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 22,
    overflow: 'hidden',
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backLbl: { color: '#c8e8f0', fontSize: 15 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(15,30,46,0.85)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1a3a4a',
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pillTxt: { color: '#c8e8f0', fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
  sensorFault: { position: 'absolute', top: 132, left: 16, right: 16, zIndex: 4, backgroundColor: 'rgba(69,10,10,0.96)', borderWidth: 1.5, borderColor: '#ef4444', borderRadius: 14, padding: 14 },
  sensorFaultTitle: { color: '#fecaca', fontSize: 14, fontWeight: '900', letterSpacing: 0.6 },
  sensorFaultText: { color: '#fff1f2', fontSize: 12, lineHeight: 18, marginTop: 4 },
  metrics: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
  },
  card: {
    flex: 1,
    backgroundColor: 'rgba(15,30,46,0.9)',
    borderWidth: 1,
    borderColor: '#1a3a4a',
    borderRadius: 10,
    paddingHorizontal: 5,
    paddingVertical: 7,
    alignItems: 'center',
  },
  cardLbl: { color: '#4a7a8a', fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  cardVal: { color: '#c8e8f0', fontSize: 16, fontWeight: '900', marginTop: 2 },
  ctrl: { padding: 20, gap: 10 },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#2563eb',
    borderRadius: 16,
    paddingVertical: 20,
    shadowColor: '#2563eb',
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  disabledBtn: { opacity: 0.55 },
  startTxt: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: 1 },
  stopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#dc2626',
    borderRadius: 16,
    paddingVertical: 20,
  },
  stopTxt: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: 1 },
  awakeNote: { textAlign: 'center', color: '#4a7a8a', fontSize: 11 },
  safeStopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#7dd3fc',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#bae6fd',
  },
  safeStopBtnTextWrap: { flex: 1 },
  safeStopBtnText: { color: '#082f49', fontSize: 14, fontWeight: '900', letterSpacing: 0.7 },
  safeStopBtnSub: { color: '#075985', fontSize: 11, marginTop: 1 },
  safeStopBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    padding: 14,
  },
  safeStopSheet: {
    backgroundColor: '#07131e',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#1a3a4a',
    padding: 20,
    paddingBottom: 24,
  },
  safeStopHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  safeStopIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0c4a6e',
  },
  safeStopHeadingText: { flex: 1 },
  safeStopTitle: { color: '#f0f9ff', fontSize: 20, fontWeight: '900' },
  safeStopKicker: { color: '#38bdf8', fontSize: 10, fontWeight: '900', letterSpacing: 1, marginTop: 3 },
  safeStopWarning: { color: '#fef3c7', fontSize: 14, lineHeight: 21, marginTop: 18 },
  safeStopPrivacy: { color: '#7c9eab', fontSize: 12, lineHeight: 18, marginTop: 8 },
  safeStopOptions: { gap: 9, marginTop: 18 },
  safeStopOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#0b1e2c',
    borderWidth: 1,
    borderColor: '#17384a',
    borderRadius: 14,
    padding: 14,
  },
  safeStopOptionIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#12354a',
  },
  safeStopOptionText: { flex: 1 },
  safeStopOptionTitle: { color: '#f0f9ff', fontSize: 15, fontWeight: '800' },
  safeStopOptionDetail: { color: '#7c9eab', fontSize: 11, lineHeight: 16, marginTop: 2 },
  safeStopCancel: { alignItems: 'center', paddingTop: 18, paddingBottom: 2 },
  safeStopCancelText: { color: '#7dd3fc', fontSize: 13, fontWeight: '900', letterSpacing: 0.8 },
  permBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  permIcon: { fontSize: 48, marginBottom: 16 },
  permTitle: { color: '#fff', fontSize: 22, fontWeight: '900', marginBottom: 12, textAlign: 'center' },
  permSub: { color: '#94a3b8', fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 28 },
  permBtn: { backgroundColor: '#2563eb', borderRadius: 14, paddingVertical: 16, paddingHorizontal: 32 },
  permBtnText: { color: '#fff', fontSize: 16, fontWeight: '900' },
});
