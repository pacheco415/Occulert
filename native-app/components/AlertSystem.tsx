import React, { useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useAudioPlayer } from 'expo-audio';
import { sendAlertToWatch, sendMonitoringStatusToWatch } from '../lib/watchBridge';
import { configureAlertAudioMode } from '../lib/audioSession';
import { getWatchAlertsEnabled } from '../lib/watchPreferences';
import {
  nextAlertAudioChannel,
  type AlertAudioChannel,
} from '../lib/inEarAlerts';
import {
  currentAlertPreferences,
  loadAlertPreferences,
} from '../lib/alertPreferences';
import {
  ALERT_COOLDOWN_MS,
  CRITICAL_CLOSED_ALERT_MS,
  PERCLOS_ALERT_THRESHOLD,
} from '../constants/thresholds';
import {
  deriveAlertLevel,
  SENSOR_LOSS_GRACE_MS,
  shouldDeliverAlert,
  type AlertLevel,
} from '../lib/alertPolicy';
import { alertDeliveryPlan, deliverCueIfCurrent } from '../lib/alertDelivery';
import type { EyeMetrics } from '../hooks/useEyeTracking';

export type { AlertLevel } from '../lib/alertPolicy';

const ALERT_SOUND = require('../assets/alert.wav');
const ALERT_SOUND_LEFT = require('../assets/alert-left.wav');
const ALERT_SOUND_RIGHT = require('../assets/alert-right.wav');
const WATCH_STATUS_SYNC_INTERVAL_MS = 2_000;

interface AlertSystemProps {
  metrics: EyeMetrics;
  isRunning: boolean;
  sessionStartedAt: number | null;
  sessionEndedAt: number | null;
  onTimingEvent?: (event: AlertTimingEvent) => void;
}

export type AlertTimingEvent =
  | { kind: 'decision'; at: number }
  | { kind: 'phone-dispatch'; decisionAt: number; dispatchedAt: number }
  | {
      kind: 'watch-result';
      decisionAt: number;
      accepted: boolean;
      acknowledged: boolean;
      roundTripMs: number | null;
    };

/**
 * AlertSystem — Week 2
 * Renders the alert banner and triggers:
 *   - expo-haptics vibration (impact/notification style per severity)
 *   - expo-audio alert tone (with cooldown so it doesn't spam)
 */
export function AlertSystem({
  metrics,
  isRunning,
  sessionStartedAt,
  sessionEndedAt,
  onTimingEvent,
}: AlertSystemProps) {
  const sessionTime = sessionStartedAt === null
    ? 0
    : Math.max(0, Math.floor(((sessionEndedAt ?? Date.now()) - sessionStartedAt) / 1_000));
  const lastAlert = useRef<{ level: AlertLevel; at: number }>({ level: 'none', at: 0 });
  const lastDirectionalChannel = useRef<Exclude<AlertAudioChannel, 'balanced'> | null>(null);
  const watchLiveSession = useRef(false);
  const pendingCueTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const cueSequenceVersion = useRef(0);
  const lastWatchStatusAt = useRef(0);
  const watchStatusSnapshot = useRef({
    state: metrics.state,
    fatigueScore: metrics.fatigueScore,
    perclos: metrics.perclos,
    sessionTime,
  });
  const [trackingLost, setTrackingLost] = React.useState(false);

  const cancelPendingCues = useCallback(() => {
    cueSequenceVersion.current += 1;
    pendingCueTimers.current.forEach(timer => clearTimeout(timer));
    pendingCueTimers.current = [];
  }, []);

  const scheduleCue = useCallback((
    offsetMs: number,
    sequenceVersion: number,
    cue: (isCurrent: () => boolean) => void | Promise<void>,
  ) => {
    const isCurrent = () => sequenceVersion === cueSequenceVersion.current;
    const runCue = () => {
      if (!isCurrent()) return;
      void cue(isCurrent);
    };
    if (offsetMs === 0) {
      runCue();
      return;
    }
    const timer = setTimeout(runCue, offsetMs);
    pendingCueTimers.current.push(timer);
  }, []);

  React.useEffect(() => cancelPendingCues, [cancelPendingCues]);

  // Preload output preferences before Start. handleStart also awaits this same
  // deduplicated read so an alert never waits for the native storage bridge.
  React.useEffect(() => {
    void loadAlertPreferences();
    // iOS routes playback through the active output (speaker, AirPods, or car
    // audio). This is automatic rather than a capability Occulert can toggle.
    configureAlertAudioMode().catch(() => {});
  }, []);
  React.useEffect(() => {
    if (!isRunning || metrics.state !== 'noFace') {
      setTrackingLost(false);
      return;
    }
    const timer = setTimeout(() => setTrackingLost(true), SENSOR_LOSS_GRACE_MS);
    return () => clearTimeout(timer);
  }, [isRunning, metrics.state]);
  React.useEffect(() => {
    if (!isRunning) {
      lastAlert.current = { level: 'none', at: 0 };
      lastDirectionalChannel.current = null;
      cancelPendingCues();
    }
  }, [cancelPendingCues, isRunning]);
  React.useEffect(() => {
    watchStatusSnapshot.current = {
      state: metrics.state,
      fatigueScore: metrics.fatigueScore,
      perclos: metrics.perclos,
      sessionTime,
    };
  }, [metrics.fatigueScore, metrics.perclos, metrics.state, sessionTime]);
  React.useEffect(() => {
    if (!isRunning) return;

    const nextWatchStatusAt = () => {
      const at = Math.max(Date.now(), lastWatchStatusAt.current + 1);
      lastWatchStatusAt.current = at;
      return at;
    };
    let cancelled = false;
    let syncing = false;
    let statusEnabled = false;

    const sendCurrentStatus = async () => {
      if (syncing) return;
      syncing = true;
      try {
        const enabled = await getWatchAlertsEnabled();
        if (cancelled) return;
        const snapshot = watchStatusSnapshot.current;
        if (!enabled) {
          if (statusEnabled || watchLiveSession.current) {
            statusEnabled = false;
            watchLiveSession.current = false;
            void sendMonitoringStatusToWatch({
              running: false,
              ...snapshot,
              at: nextWatchStatusAt(),
            }).catch(() => {});
          }
          return;
        }

        statusEnabled = true;
        watchLiveSession.current = true;
        void sendMonitoringStatusToWatch({
          running: true,
          ...snapshot,
          at: nextWatchStatusAt(),
        }).catch(() => {});
      } finally {
        syncing = false;
      }
    };

    void sendCurrentStatus();
    // The Watch status is informational; alert delivery uses a separate,
    // immediate path. A two-second heartbeat keeps the UI fresh while cutting
    // bridge traffic and preference reads in half.
    const interval = setInterval(() => { void sendCurrentStatus(); }, WATCH_STATUS_SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (!statusEnabled && !watchLiveSession.current) return;
      const snapshot = watchStatusSnapshot.current;
      statusEnabled = false;
      watchLiveSession.current = false;
      void sendMonitoringStatusToWatch({
        running: false,
        ...snapshot,
        at: nextWatchStatusAt(),
      }).catch(() => {});
    };
  }, [isRunning]);
  const pulse = useRef(new Animated.Value(1)).current;
  const balancedPlayer = useAudioPlayer(ALERT_SOUND, { keepAudioSessionActive: true });
  const leftPlayer = useAudioPlayer(ALERT_SOUND_LEFT, { keepAudioSessionActive: true });
  const rightPlayer = useAudioPlayer(ALERT_SOUND_RIGHT, { keepAudioSessionActive: true });

  // PERCLOS is a rolling history. Never keep a red alert on screen after
  // the driver's eyes are visibly open again. Sustained tracking loss is a
  // separate warning because zeroed metrics must never look reassuring.
  const level = deriveAlertLevel({
    isRunning,
    metrics,
    sessionTime,
    trackingLostForMs: trackingLost ? SENSOR_LOSS_GRACE_MS : 0,
    criticalPerclosThreshold: PERCLOS_ALERT_THRESHOLD,
    criticalClosedDurationMs: CRITICAL_CLOSED_ALERT_MS,
  });

  const fire = useCallback((lv: AlertLevel) => {
    const now = Date.now();
    const previous = lastAlert.current;
    if (!shouldDeliverAlert(previous.level, previous.at, lv, now, ALERT_COOLDOWN_MS)) return;
    lastAlert.current = { level: lv, at: now };
    onTimingEvent?.({ kind: 'decision', at: now });
    cancelPendingCues();
    const sequenceVersion = cueSequenceVersion.current;
    const preferences = currentAlertPreferences();

    Animated.sequence([
      Animated.timing(pulse, { toValue: 1.04, duration: 110, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1,    duration: 110, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1.04, duration: 110, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1,    duration: 110, useNativeDriver: true }),
    ]).start();

    const deliveryPlan = alertDeliveryPlan(lv);
    if (preferences.hapticEnabled || preferences.audioEnabled) {
      onTimingEvent?.({ kind: 'phone-dispatch', decisionAt: now, dispatchedAt: Date.now() });
    }
    if (preferences.hapticEnabled) {
      deliveryPlan.hapticOffsetsMs.forEach(offsetMs => scheduleCue(offsetMs, sequenceVersion, async () => {
        try {
          if (lv === 'critical') {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          } else if (lv === 'alert' || lv === 'tracking') {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          } else {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          }
        } catch {}
      }));
    }

    // Settings writes through the shared Watch preference cache, so the alert
    // path can stay storage-free while still seeing confirmed changes.
    getWatchAlertsEnabled()
      .then((enabled) => {
        if (enabled) {
          return sendAlertToWatch({ level: lv, perclos: metrics.perclos, at: now })
            .then((result) => {
              onTimingEvent?.({
                kind: 'watch-result',
                decisionAt: now,
                accepted: result.accepted,
                acknowledged: result.acknowledged,
                roundTripMs: result.roundTripMs,
              });
            });
        }
      })
      .catch(() => {});

    try {
      if (!preferences.audioEnabled) return;
      const channel = nextAlertAudioChannel(
        preferences.inEarPattern,
        lv,
        lastDirectionalChannel.current,
      );
      if (channel !== 'balanced') lastDirectionalChannel.current = channel;
      const player = channel === 'left'
        ? leftPlayer
        : channel === 'right'
          ? rightPlayer
          : balancedPlayer;
      deliveryPlan.audioOffsetsMs.forEach(offsetMs => scheduleCue(offsetMs, sequenceVersion, async isCurrent => {
        try {
          balancedPlayer.pause();
          leftPlayer.pause();
          rightPlayer.pause();
          await deliverCueIfCurrent(
            () => player.seekTo(0),
            isCurrent,
            () => {
              player.volume = lv === 'critical' ? 1.0 : lv === 'alert' ? 0.88 : 0.75;
              player.play();
            },
          );
        } catch {}
      }));
    } catch {}
  }, [balancedPlayer, cancelPendingCues, leftPlayer, metrics.perclos, onTimingEvent, pulse, rightPlayer, scheduleCue]);

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
        <Text style={[s.sub,   { color: cfg.subColor }]}>{cfg.sub}</Text>
      </View>
    </Animated.View>
  );
}

const CONFIGS: Record<Exclude<AlertLevel,'none'>, { bg:string;border:string;color:string;subColor:string;icon:string;title:string;sub:string }> = {
  tracking: { bg:'rgba(55,31,8,0.96)', border:'#f59e0b', color:'#fbbf24', subColor:'#fef3c7', icon:'📷', title:'TRACKING LOST', sub:'Pull over safely before adjusting the phone or camera.' },
  watch:    { bg:'rgba(45,35,4,0.92)', border:'#ca8a04', color:'#fde047', subColor:'#fef3c7', icon:'👁',  title:'Eyes drooping',       sub:'Drowsiness may be starting. Plan a safe stop.' },
  alert:    { bg:'rgba(55,8,12,0.94)', border:'#ef4444', color:'#fda4af', subColor:'#ffe4e6', icon:'⚠️', title:'DROWSINESS DETECTED', sub:'Pull over at the next safe place.' },
  critical: { bg:'rgba(55,8,12,0.96)', border:'#ff3344', color:'#ff8a91', subColor:'#fff1f2', icon:'🚨', title:'PULL OVER NOW',       sub:'High fatigue detected. Pull over safely and rest now.' },
};

const s = StyleSheet.create({
  banner: { position:'absolute', top:132, left:16, right:16, zIndex:2, flexDirection:'row', alignItems:'center', gap:14, borderWidth:1.5, borderRadius:16, padding:18 },
  icon: { fontSize:28 },
  txt:  { flex:1 },
  title:{ fontSize:16, fontWeight:'900', letterSpacing:0.5 },
  sub:  { fontSize:12, marginTop:2, opacity:0.85 },
});
