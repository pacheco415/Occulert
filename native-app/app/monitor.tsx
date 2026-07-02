import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useKeepAwake } from 'expo-keep-awake';
import { Ionicons } from '@expo/vector-icons';
import { useEyeTracking } from '../hooks/useEyeTracking';
import { AlertSystem } from '../components/AlertSystem';
import { loadSavedSensitivity } from '../components/SensitivitySlider';
import type { EyeMetrics } from '../hooks/useEyeTracking';
import type { SensitivityLevel } from '../constants/thresholds';

/**
 * MonitorScreen — full-screen camera + EAR overlay
 *
 * useKeepAwake() keeps screen on (Week 3).
 * AlertSystem triggers haptics + audio (Week 2).
 * Simulation loop lets you test alerts without a real face.
 * Replace the simulation with a real MediaPipe frame processor when ready.
 */
export default function MonitorScreen() {
  useKeepAwake(); // Week 3: screen never dims while monitoring

  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [isRunning, setIsRunning] = useState(false);
  const [sensitivity, setSensitivity] = useState<SensitivityLevel>('medium');
  const [sessionTime, setSessionTime] = useState(0);
  const [alertCount, setAlertCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevAlertingRef = useRef(false);

  const [metrics, setMetrics] = useState<EyeMetrics>({
    ear: 0.3, perclos: 0, fatigueScore: 0, state: 'noFace',
  });

  const { processLandmarks, reset } = useEyeTracking(sensitivity);

  useEffect(() => {
    loadSavedSensitivity().then(setSensitivity);
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
    String(Math.floor(s / 60)).padStart(2,'0') + ':' + String(s % 60).padStart(2,'0');

  const handleStart = async () => {
    if (!permission?.granted) {
      const { granted } = await requestPermission();
      if (!granted) return;
    }
    reset(); prevAlertingRef.current = false; setAlertCount(0); setIsRunning(true);
  };

  const handleStop = () => { setIsRunning(false); reset(); };

  /**
   * onFrame — wire your MediaPipe landmarks here.
   * Option A: react-native-vision-camera frame processor plugin
   * Option B: hidden WebView running mediapipe, posting landmarks via postMessage
   */
  const onFrame = useCallback((landmarks: Array<{x:number;y:number}> | null) => {
    const result = processLandmarks(landmarks);
    setMetrics(result);
    // Count discrete alert events only: increment once on transition INTO an
    // alerting state (closed), not on every frame while eyes stay closed.
    const alerting = result.state === 'closed';
    if (alerting && !prevAlertingRef.current) {
      setAlertCount((c) => c + 1);
    }
    prevAlertingRef.current = alerting;
  }, [processLandmarks]);

  // ── DEV SIMULATION: slow blink wave (remove for production) ──────────────
  useEffect(() => {
    if (!isRunning) return;
    let t = 0;
    const id = setInterval(() => {
      t += 0.08;
      const ear = 0.22 + Math.sin(t) * 0.07;
      const fake = Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5 }));
      fake[385] = { x: 0.5, y: 0.5 - ear / 2 }; fake[380] = { x: 0.5, y: 0.5 + ear / 2 };
      fake[387] = { x: 0.5, y: 0.5 - ear / 2 }; fake[373] = { x: 0.5, y: 0.5 + ear / 2 };
      fake[362] = { x: 0.4, y: 0.5 }; fake[263] = { x: 0.6, y: 0.5 };
      fake[160] = { x: 0.5, y: 0.5 - ear / 2 }; fake[144] = { x: 0.5, y: 0.5 + ear / 2 };
      fake[158] = { x: 0.5, y: 0.5 - ear / 2 }; fake[153] = { x: 0.5, y: 0.5 + ear / 2 };
      fake[33]  = { x: 0.4, y: 0.5 }; fake[133] = { x: 0.6, y: 0.5 };
      onFrame(fake);
    }, 100);
    return () => clearInterval(id);
  }, [isRunning, onFrame]);
  // ─────────────────────────────────────────────────────────────────────────

  const stateColor = { open:'#00ff88', watch:'#fbbf24', closed:'#ff3344', noFace:'#4a7a8a' }[metrics.state];

  if (!permission?.granted) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.permBox}>
          <Text style={s.permIcon}>📷</Text>
          <Text style={s.permTitle}>Camera Access Required</Text>
          <Text style={s.permSub}>
            Occulert uses your front camera to detect fatigue. No video is stored or uploaded.
          </Text>
          <TouchableOpacity style={s.permBtn} onPress={requestPermission}>
            <Text style={s.permBtnText}>Grant Camera Access</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={s.container}>
      {isRunning ? (
        <CameraView style={StyleSheet.absoluteFillObject} facing="front" />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, s.camOff]}>
          <Ionicons name="eye-off" size={64} color="#1a3a4a" />
          <Text style={s.camOffTxt}>Tap Start to begin monitoring</Text>
        </View>
      )}

      <SafeAreaView style={s.overlay} pointerEvents="box-none">
        {/* Top bar */}
        <View style={s.topBar}>
          <TouchableOpacity style={s.backBtn} onPress={() => { handleStop(); router.back(); }}>
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

        {/* Metrics */}
        {isRunning && (
          <View style={s.metrics}>
            {[
              { l:'EAR',     v: metrics.ear.toFixed(3),               c: stateColor },
              { l:'PERCLOS', v: (metrics.perclos*100).toFixed(0)+'%', c: metrics.perclos>0.15?'#f87171':'#c8e8f0' },
              { l:'SCORE',   v: String(metrics.fatigueScore),         c: metrics.fatigueScore>60?'#f87171':'#00ff88' },
              { l:'TIME',    v: fmt(sessionTime),                     c: '#c8e8f0' },
              { l:'ALERTS',  v: String(alertCount),                   c: alertCount>0?'#fbbf24':'#c8e8f0' },
            ].map(({ l, v, c }) => (
              <View key={l} style={s.card}>
                <Text style={s.cardLbl}>{l}</Text>
                <Text style={[s.cardVal, { color: c }]}>{v}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Alert system — renders banner + triggers haptics + audio */}
        <AlertSystem metrics={metrics} isRunning={isRunning} />

        {/* Controls */}
        <View style={s.ctrl}>
          {!isRunning ? (
            <TouchableOpacity style={s.startBtn} onPress={handleStart}>
              <Ionicons name="eye" size={22} color="#fff" />
              <Text style={s.startTxt}>START MONITORING</Text>
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
  container: { flex:1, backgroundColor:'#000' },
  overlay:   { flex:1, justifyContent:'space-between' },
  camOff:    { alignItems:'center', justifyContent:'center', backgroundColor:'#050a0f' },
  camOffTxt: { color:'#1a3a4a', marginTop:12, fontSize:14 },
  topBar:    { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingVertical:12, backgroundColor:'rgba(5,10,15,0.75)' },
  backBtn:   { flexDirection:'row', alignItems:'center', gap:4 },
  backLbl:   { color:'#c8e8f0', fontSize:15 },
  pill:      { flexDirection:'row', alignItems:'center', gap:7, backgroundColor:'rgba(15,30,46,0.85)', paddingHorizontal:14, paddingVertical:7, borderRadius:999, borderWidth:1, borderColor:'#1a3a4a' },
  dot:       { width:8, height:8, borderRadius:4 },
  pillTxt:   { color:'#c8e8f0', fontSize:12, fontWeight:'800', letterSpacing:0.8 },
  metrics:   { flexDirection:'row', flexWrap:'wrap', gap:8, margin:14, alignSelf:'flex-start' },
  card:      { backgroundColor:'rgba(15,30,46,0.85)', borderWidth:1, borderColor:'#1a3a4a', borderRadius:10, paddingHorizontal:12, paddingVertical:8, minWidth:64, alignItems:'center' },
  cardLbl:   { color:'#4a7a8a', fontSize:9, fontWeight:'800', letterSpacing:0.8 },
  cardVal:   { color:'#c8e8f0', fontSize:16, fontWeight:'900', marginTop:2 },
  ctrl:      { padding:20 },
  startBtn:  { flexDirection:'row', alignItems:'center', justifyContent:'center', gap:12, backgroundColor:'#2563eb', borderRadius:16, paddingVertical:20, shadowColor:'#2563eb', shadowOpacity:0.4, shadowRadius:20, shadowOffset:{width:0,height:8} },
  startTxt:  { color:'#fff', fontSize:18, fontWeight:'900', letterSpacing:1 },
  stopBtn:   { flexDirection:'row', alignItems:'center', justifyContent:'center', gap:12, backgroundColor:'#dc2626', borderRadius:16, paddingVertical:20 },
  stopTxt:   { color:'#fff', fontSize:18, fontWeight:'900', letterSpacing:1 },
  awakeNote: { textAlign:'center', color:'#4a7a8a', fontSize:11, paddingTop:8 },
  permBox:   { flex:1, alignItems:'center', justifyContent:'center', padding:32 },
  permIcon:  { fontSize:48, marginBottom:16 },
  permTitle: { color:'#fff', fontSize:22, fontWeight:'900', marginBottom:12, textAlign:'center' },
  permSub:   { color:'#94a3b8', fontSize:14, lineHeight:21, textAlign:'center', marginBottom:28 },
  permBtn:   { backgroundColor:'#2563eb', borderRadius:14, paddingVertical:16, paddingHorizontal:32 },
  permBtnTxt:{ color:'#fff', fontSize:16, fontWeight:'900' },
  permBtnText:{ color:'#fff', fontSize:16, fontWeight:'900' },
});
