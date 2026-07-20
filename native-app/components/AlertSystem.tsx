import React, { useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useAudioPlayer } from 'expo-audio';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { sendAlertToWatch } from '../lib/watchBridge';
import { configureAlertAudioMode } from '../lib/audioSession';
import { ALERT_COOLDOWN_MS, PERCLOS_ALERT_THRESHOLD } from '../constants/thresholds';
import type { EyeMetrics } from '../hooks/useEyeTracking';

export type AlertLevel = 'none' | 'watch' | 'alert' | 'critical';

const ALERT_SOUND = require('../assets/alert.wav');

interface AlertSystemProps { metrics: EyeMetrics; isRunning: boolean; }

/**
 * AlertSystem — Week 2
 * Renders the alert banner and triggers:
 *   - expo-haptics vibration (impact/notification style per severity)
 *   - expo-audio alert tone (with cooldown so it doesn't spam)
 */
export function AlertSystem({ metrics, isRunning }: AlertSystemProps) {
  const lastAlert = useRef(0);
  const hapticEnabled = useRef(true);
  const audioEnabled = useRef(true);
  const airpodsEnabled = useRef(true);   // route alerts to AirPods / Bluetooth output
  const watchEnabled = useRef(true);     // mirror alerts to a paired Apple Watch (dev/TestFlight build)

  // Load persisted alert preferences (set on the Settings screen).
  React.useEffect(() => {
    AsyncStorage.getItem('occulert-haptic').then(v => { if (v != null) hapticEnabled.current = v === 'true'; });
    AsyncStorage.getItem('occulert-audio').then(v => { if (v != null) audioEnabled.current = v === 'true'; });
  // Connected-device preferences (AirPods / Apple Watch)
    AsyncStorage.getItem('occulert-airpods').then((v) => {
      if (v !== null) airpodsEnabled.current = v === 'true';
      if (airpodsEnabled.current) configureAlertAudioMode().catch(() => {});
    });
    AsyncStorage.getItem('occulert-watch').then((v) => { if (v !== null) watchEnabled.current = v === 'true'; });
  }, []);
  const pulse = useRef(new Animated.Value(1)).current;
  const player = useAudioPlayer(ALERT_SOUND, { keepAudioSessionActive: true });

  const level: AlertLevel =
    !isRunning || metrics.state === 'noFace' ? 'none'
    : metrics.perclos >= PERCLOS_ALERT_THRESHOLD ? 'critical'
    : metrics.state === 'closed' ? 'alert'
    : metrics.state === 'watch'  ? 'watch'
    : 'none';

  const fire = useCallback(async (lv: AlertLevel) => {
    const now = Date.now();
    if (now - lastAlert.current < ALERT_COOLDOWN_MS) return;
    lastAlert.current = now;

    Animated.sequence([
      Animated.timing(pulse, { toValue: 1.04, duration: 110, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1,    duration: 110, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1.04, duration: 110, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1,    duration: 110, useNativeDriver: true }),
    ]).start();

    try {
      if (!hapticEnabled.current) {
        // haptics disabled in Settings
      } else if (lv === 'critical') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error), 350);
      } else if (lv === 'alert') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } else {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
    } catch {}

    // Mirror the alert to a paired Apple Watch (no-op unless a watchOS
    // companion is installed via a dev / TestFlight build).
    if (watchEnabled.current) {
      sendAlertToWatch({ level: lv, perclos: metrics.perclos, at: now }).catch(() => {});
    }

    try {
      if (!audioEnabled.current) return;
      player.pause();
      await player.seekTo(0);
      player.volume = lv === 'critical' ? 1.0 : 0.75;
      player.play();
    } catch {}
  }, [metrics.perclos, player, pulse]);

  React.useEffect(() => {
    if (level !== 'none') fire(level);
  }, [level, fire]);

  if (level === 'none') return null;

  const cfg = CONFIGS[level];
  return (
    <Animated.View style={[s.banner, { backgroundColor: cfg.bg, borderColor: cfg.border, transform: [{ scale: pulse }] }]}
      accessibilityRole="alert" accessibilityLabel={cfg.title}>
      <Text style={s.icon}>{cfg.icon}</Text>
      <View style={s.txt}>
        <Text style={[s.title, { color: cfg.color }]}>{cfg.title}</Text>
        <Text style={[s.sub,   { color: cfg.color }]}>{cfg.sub}</Text>
      </View>
    </Animated.View>
  );
}

const CONFIGS: Record<Exclude<AlertLevel,'none'>, { bg:string;border:string;color:string;icon:string;title:string;sub:string }> = {
  watch:    { bg:'rgba(234,179,8,0.12)',  border:'rgba(234,179,8,0.5)',  color:'#fbbf24', icon:'👁',  title:'Eyes Drooping',         sub:'Stay alert. Pull over soon if drowsy.' },
  alert:    { bg:'rgba(239,68,68,0.14)', border:'rgba(239,68,68,0.6)', color:'#f87171', icon:'⚠️', title:'DROWSINESS DETECTED',    sub:'Pull over safely when you can.' },
  critical: { bg:'rgba(239,68,68,0.22)', border:'#ef4444',              color:'#ff6b6b', icon:'🚨', title:'PULL OVER NOW',          sub:'High fatigue. Find a safe spot immediately.' },
};

const s = StyleSheet.create({
  banner: { position:'absolute', bottom:100, left:16, right:16, flexDirection:'row', alignItems:'center', gap:14, borderWidth:1.5, borderRadius:16, padding:18 },
  icon: { fontSize:28 },
  txt:  { flex:1 },
  title:{ fontSize:16, fontWeight:'900', letterSpacing:0.5 },
  sub:  { fontSize:12, marginTop:2, opacity:0.85 },
});
