import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Linking, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  Camera, useCameraDevice, useCameraPermission, useFrameProcessor,
} from 'react-native-vision-camera';
import { useFaceDetector, type FrameFaceDetectionOptions } from 'react-native-vision-camera-face-detector';
import { Worklets } from 'react-native-worklets-core';
import { useKeepAwake } from 'expo-keep-awake';
import { Ionicons } from '@expo/vector-icons';
import { useEyeTracking } from '../hooks/useEyeTracking';
import { AlertSystem } from '../components/AlertSystem';
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

/**
 * MonitorScreen — full-screen camera + real on-device eye tracking
 *
 * Detection pipeline:
 *   react-native-vision-camera frame processor
 *     -> ML Kit face detection (classificationMode: 'all')
 *     -> leftEyeOpenProbability / rightEyeOpenProbability
 *     -> useEyeTracking.processEyeOpenness() (PERCLOS + fatigue score)
 *
 * All processing is on-device. No frames are stored or uploaded.
 *
 * NOTE: vision-camera requires a development build (`eas build --profile
 * development`) — the monitor screen will NOT run in Expo Go.
 */

const FACE_DETECTOR_OPTIONS: FrameFaceDetectionOptions = {
  performanceMode: 'fast',      // prioritize frame rate for real-time alerts
  classificationMode: 'all',    // REQUIRED: enables eye-open probabilities
  landmarkMode: 'none',
  contourMode: 'none',
  trackingEnabled: false,
  cameraFacing: 'front',
};

const CLOSED_CONFIRM_MS = 1_200;
const SENSOR_STALL_MS = 3_000;

export default function MonitorScreen() {
  useKeepAwake(); // screen never dims while monitoring

  const router = useRouter();
  const device = useCameraDevice('front');
  const { hasPermission, requestPermission } = useCameraPermission();
  const [isRunning, setIsRunning] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [sensitivity, setSensitivity] = useState<SensitivityLevel>('medium');
  const [sensitivityLoaded, setSensitivityLoaded] = useState(false);
  const [sensorFault, setSensorFault] = useState<string | null>(null);
  const [sessionTime, setSessionTime] = useState(0);
  const [alertCount, setAlertCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevAlertingRef = useRef(false);
  const fatigueSumRef = useRef(0);
  const fatigueSamplesRef = useRef(0);
  const maxFatigueRef = useRef(0);
  const closedSinceRef = useRef<number | null>(null);
  const sessionSensitivityRef = useRef<SensitivityLevel>('medium');
  const stoppingRef = useRef(false);
  const cloudSessionRef = useRef<Promise<string | null> | null>(null);
  const cloudEventQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastSampleAtRef = useRef(0);
  const headNodDetectorRef = useRef(new HeadNodDetector());
  const headNodObservationsRef = useRef(0);

  const [metrics, setMetrics] = useState<EyeMetrics>({
    ear: 0.3, perclos: 0, fatigueScore: 0, state: 'noFace',
  });

  const { processEyeOpenness, processNoFace, reset } = useEyeTracking(sensitivity);
  const { detectFaces } = useFaceDetector(FACE_DETECTOR_OPTIONS);

  useEffect(() => {
    loadSavedSensitivity()
      .then(setSensitivity)
      .finally(() => setSensitivityLoaded(true));
  }, []);

  useEffect(() => {
    if (isRunning) {
      timerRef.current = setInterval(() => setSessionTime((t) => t + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setSessionTime(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isRunning]);

  const fmt = (s: number) =>
    String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');

  const handleStart = async () => {
    if (isStopping || !sensitivityLoaded) return;
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
    lastSampleAtRef.current = Date.now();
    setSensorFault(null);
    sessionSensitivityRef.current = sensitivity;
    cloudEventQueueRef.current = Promise.resolve();
    cloudSessionRef.current = beginCloudSession();
    setAlertCount(0);
    setIsRunning(true);
  };

  const saveSession = useCallback(async (durationSec: number, alerts: number): Promise<string | null> => {
    if (durationSec <= 0) return null;
    const avgFatigue = fatigueSamplesRef.current
      ? Math.round(fatigueSumRef.current / fatigueSamplesRef.current)
      : 0;
    const sessionId = 'session-' + Date.now();
    const record = {
      sessionId,
      savedAt: new Date().toISOString(),
      durationSec,
      alertCount: alerts,
      avgFatigue,
      headNodObservations: headNodObservationsRef.current,
      sensitivity: sessionSensitivityRef.current,
      ...currentAppBuildInfo(),
    };
    await updateSessionHistory<Record<string, unknown>>(sessions => [record, ...sessions].slice(0, 50));
    return sessionId;
  }, []);

  const markSessionSynced = useCallback(async (localSessionId: string, cloudSessionId: string) => {
    try {
      await updateSessionHistory<Record<string, unknown>>(sessions => sessions.map(item => item?.sessionId === localSessionId
        ? { ...item, cloudSynced: true, cloudSessionId }
        : item));
    } catch {
      // The local session remains intact even if its cloud badge cannot update.
    }
  }, []);

  const handleStop = useCallback(async () => {
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
    cloudSessionRef.current = null;
    cloudEventQueueRef.current = Promise.resolve();
    setIsRunning(false);
    reset();
    try {
      if (!wasRunning) return;
      const localSessionId = await saveSession(durationSec, alerts);
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
      if (synced && localSessionId) await markSessionSynced(localSessionId, cloudSessionId);
    } finally {
      stoppingRef.current = false;
      setIsStopping(false);
    }
  }, [alertCount, isRunning, markSessionSynced, reset, saveSession, sessionTime]);

  useEffect(() => {
    if (!isRunning) return;
    const watchdog = setInterval(() => {
      if (stoppingRef.current || Date.now() - lastSampleAtRef.current <= SENSOR_STALL_MS) return;
      const message = 'Monitoring stopped: camera analysis stalled. Pull over safely before checking the phone or restarting.';
      setSensorFault(message);
      Alert.alert('Monitoring stopped', message);
      void handleStop();
    }, 500);
    return () => clearInterval(watchdog);
  }, [handleStop, isRunning]);

  /**
   * onEyeState — receives eye-open probabilities from the frame processor
   * worklet (already throttled). Runs the PERCLOS/fatigue scoring on the JS
   * thread and drives the UI + AlertSystem.
   */
  const onEyeState = useCallback((
    leftProb: number,
    rightProb: number,
    faceFound: boolean,
    pitchAngle: number,
    yawAngle: number,
    rollAngle: number,
  ) => {
    lastSampleAtRef.current = Date.now();
    const now = Date.now();
    const headNodResult = headNodDetectorRef.current.update({
      at: now,
      faceFound,
      pitchAngle,
      yawAngle,
      rollAngle,
    });
    // Observation only: this does not change fatigue scoring or alert delivery.
    if (headNodResult.observed) headNodObservationsRef.current += 1;
    const rawResult = faceFound ? processEyeOpenness(leftProb, rightProb) : processNoFace();
    if (rawResult.state === 'closed') {
      closedSinceRef.current ??= now;
    } else {
      closedSinceRef.current = null;
    }
    // A blink or one noisy camera frame must not create a driver alert. Keep
    // showing the caution state until eye closure has been continuous long
    // enough to be meaningful.
    const confirmedClosed = rawResult.state === 'closed'
      && closedSinceRef.current !== null
      && now - closedSinceRef.current >= CLOSED_CONFIRM_MS;
    const result: EyeMetrics = confirmedClosed
      ? rawResult
      : rawResult.state === 'closed' ? { ...rawResult, state: 'watch' } : rawResult;
    setMetrics(result);
    if (faceFound) {
      fatigueSumRef.current += result.fatigueScore;
      fatigueSamplesRef.current += 1;
      maxFatigueRef.current = Math.max(maxFatigueRef.current, result.fatigueScore);
    }
    // Count discrete alert events only: increment once on transition INTO an
    // alerting state (closed), not on every frame while eyes stay closed.
    const alerting = result.state === 'closed';
    if (alerting && !prevAlertingRef.current) {
      setAlertCount((c) => c + 1);
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

  // Bridge from the frame-processor worklet thread to the JS thread.
  const onEyeStateJS = Worklets.createRunOnJS(onEyeState);

  // Throttle UI/scoring updates to ~10 Hz regardless of camera FPS.
  const lastSample = Worklets.createSharedValue(0);

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    const now = Date.now();
    if (now - lastSample.value < 100) return; // ~10 Hz
    lastSample.value = now;

    const faces = detectFaces(frame);
    if (faces.length === 0) {
      onEyeStateJS(-1, -1, false, 0, 0, 0);
      return;
    }
    // Largest face = the driver.
    let face = faces[0];
    for (let i = 1; i < faces.length; i++) {
      const a = faces[i].bounds, b = face.bounds;
      if (a.width * a.height > b.width * b.height) face = faces[i];
    }
    onEyeStateJS(
      face.leftEyeOpenProbability ?? -1,
      face.rightEyeOpenProbability ?? -1,
      true,
      face.pitchAngle,
      face.yawAngle,
      face.rollAngle,
    );
  }, [detectFaces, onEyeStateJS, lastSample]);

  const stateColor = { open: '#00ff88', watch: '#fbbf24', closed: '#ff3344', noFace: '#4a7a8a' }[metrics.state];

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

      <SafeAreaView style={s.overlay} pointerEvents="box-none">
        {/* Top bar */}
        <View style={s.topBar}>
          <TouchableOpacity style={s.backBtn} onPress={async () => { await handleStop(); router.back(); }}>
            <Ionicons name="chevron-back" size={20} color="#c8e8f0" />
            <Text style={s.backLbl}>Home</Text>
          </TouchableOpacity>
          <View style={s.pill}>
            <View style={[s.dot, { backgroundColor: isRunning ? stateColor : '#4a7a8a' }]} />
            <Text style={s.pillTxt}>{isRunning ? metrics.state.toUpperCase() : 'STOPPED'}</Text>
          </View>
          <TouchableOpacity onPress={() => router.push('/settings')}>
            <Ionicons name="settings-outline" size={20} color="#c8e8f0" />
          </TouchableOpacity>
        </View>

        {/* Metrics stay below the driver's face instead of covering it. */}
        {sensorFault && (
          <View style={s.sensorFault} accessibilityRole="alert">
            <Text style={s.sensorFaultTitle}>CAMERA ANALYSIS STOPPED</Text>
            <Text style={s.sensorFaultText}>{sensorFault}</Text>
          </View>
        )}
        {isRunning && (
          <View style={s.metrics}>
            {[
              { l: 'EYE', v: metrics.ear.toFixed(3), c: stateColor },
              { l: 'PERCLOS', v: (metrics.perclos * 100).toFixed(0) + '%', c: metrics.perclos > 0.15 ? '#f87171' : '#c8e8f0' },
              { l: 'SCORE', v: String(metrics.fatigueScore), c: metrics.fatigueScore > 60 ? '#f87171' : '#00ff88' },
              { l: 'TIME', v: fmt(sessionTime), c: '#c8e8f0' },
              { l: 'ALERTS', v: String(alertCount), c: alertCount > 0 ? '#fbbf24' : '#c8e8f0' },
            ].map(({ l, v, c }) => (
              <View key={l} style={s.card}>
                <Text style={s.cardLbl}>{l}</Text>
                <Text style={[s.cardVal, { color: c }]}>{v}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Alert system — renders banner + triggers haptics + audio */}
        <AlertSystem metrics={metrics} isRunning={isRunning} sessionTime={sessionTime} />

        {/* Controls */}
        <View style={s.ctrl}>
          {!isRunning ? (
            <TouchableOpacity
              disabled={isStopping || !sensitivityLoaded}
              style={[s.startBtn, (isStopping || !sensitivityLoaded) && s.disabledBtn]}
              onPress={handleStart}
            >
              <Ionicons name="eye" size={22} color="#fff" />
              <Text style={s.startTxt}>{isStopping ? 'SAVING SESSION...' : sensitivityLoaded ? 'START MONITORING' : 'LOADING SETTINGS...'}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={s.stopBtn} onPress={handleStop}>
              <Ionicons name="stop-circle" size={22} color="#fff" />
              <Text style={s.stopTxt}>STOP</Text>
            </TouchableOpacity>
          )}
          {isRunning && <Text style={s.awakeNote}>Screen kept on · Keep app in foreground</Text>}
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
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: 'rgba(5,10,15,0.75)' },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backLbl: { color: '#c8e8f0', fontSize: 15 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(15,30,46,0.85)', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: '#1a3a4a' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pillTxt: { color: '#c8e8f0', fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
  sensorFault: { position: 'absolute', top: 88, left: 16, right: 16, zIndex: 4, backgroundColor: 'rgba(69,10,10,0.96)', borderWidth: 1.5, borderColor: '#ef4444', borderRadius: 14, padding: 14 },
  sensorFaultTitle: { color: '#fecaca', fontSize: 14, fontWeight: '900', letterSpacing: 0.6 },
  sensorFaultText: { color: '#fff1f2', fontSize: 12, lineHeight: 18, marginTop: 4 },
  metrics: { position: 'absolute', left: 14, right: 14, bottom: 200, flexDirection: 'row', gap: 6, justifyContent: 'center' },
  card: { flex: 1, backgroundColor: 'rgba(15,30,46,0.9)', borderWidth: 1, borderColor: '#1a3a4a', borderRadius: 10, paddingHorizontal: 5, paddingVertical: 7, alignItems: 'center' },
  cardLbl: { color: '#4a7a8a', fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  cardVal: { color: '#c8e8f0', fontSize: 16, fontWeight: '900', marginTop: 2 },
  ctrl: { padding: 20 },
  startBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#2563eb', borderRadius: 16, paddingVertical: 20, shadowColor: '#2563eb', shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } },
  disabledBtn: { opacity: 0.55 },
  startTxt: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: 1 },
  stopBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#dc2626', borderRadius: 16, paddingVertical: 20 },
  stopTxt: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: 1 },
  awakeNote: { textAlign: 'center', color: '#4a7a8a', fontSize: 11, paddingTop: 8 },
  permBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  permIcon: { fontSize: 48, marginBottom: 16 },
  permTitle: { color: '#fff', fontSize: 22, fontWeight: '900', marginBottom: 12, textAlign: 'center' },
  permSub: { color: '#94a3b8', fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 28 },
  permBtn: { backgroundColor: '#2563eb', borderRadius: 14, paddingVertical: 16, paddingHorizontal: 32 },
  permBtnText: { color: '#fff', fontSize: 16, fontWeight: '900' },
});
