import React, { memo, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { EyeMetrics } from '../hooks/useEyeTracking';
import { elapsedSessionSeconds, formatSessionTime } from '../lib/monitorPerformance';

interface LiveMetricsProps {
  metrics: EyeMetrics;
  alertCount: number;
  cameraRecovering: boolean;
  isRunning: boolean;
  sessionStartedAt: number | null;
  sessionEndedAt: number | null;
}

interface MetricCardProps {
  label: string;
  value: string;
  color: string;
}

const MetricCard = memo(function MetricCard({ label, value, color }: MetricCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{label}</Text>
      <Text style={[styles.cardValue, { color }]}>{value}</Text>
    </View>
  );
});

export const LiveMetrics = memo(function LiveMetrics({
  metrics,
  alertCount,
  cameraRecovering,
  isRunning,
  sessionStartedAt,
  sessionEndedAt,
}: LiveMetricsProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(() =>
    elapsedSessionSeconds(sessionStartedAt, sessionEndedAt));

  useEffect(() => {
    const updateElapsed = () => {
      setElapsedSeconds(elapsedSessionSeconds(sessionStartedAt, sessionEndedAt));
    };
    updateElapsed();
    if (!isRunning || sessionStartedAt === null) return;
    const timer = setInterval(updateElapsed, 1_000);
    return () => clearInterval(timer);
  }, [isRunning, sessionEndedAt, sessionStartedAt]);

  const trackingMessage = cameraRecovering
    ? 'Camera reconnecting. Fatigue alerts may be missed until tracking resumes.'
    : metrics.state === 'noFace'
      ? 'Camera tracking unavailable. Alerts may be missed. Pull over before adjusting the phone.'
      : metrics.state === 'closed'
        ? 'Drowsiness alert. Pull over safely and rest.'
        : metrics.state === 'watch'
          ? 'Eye closure is being checked. Prepare to stop if you feel tired.'
          : 'Camera tracking active. Alerts can still miss drowsiness.';
  const needsAttention = cameraRecovering || metrics.state !== 'open';

  return (
    <View>
      <Text
        accessibilityLiveRegion="polite"
        style={[styles.trackingMessage, needsAttention && styles.trackingAttention]}
      >
        {trackingMessage}
      </Text>
      <View style={styles.metrics}>
        <MetricCard label="TIME" value={formatSessionTime(elapsedSeconds)} color="#c8e8f0" />
        <MetricCard
          label="ALERTS"
          value={String(alertCount)}
          color={alertCount > 0 ? '#fbbf24' : '#c8e8f0'}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  trackingMessage: {
    backgroundColor: 'rgba(21,26,35,0.9)',
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 10,
    borderWidth: 1,
    color: '#c8e8f0',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 8,
    padding: 10,
    textAlign: 'center',
  },
  trackingAttention: { borderColor: '#fbbf24', color: '#f8d98b' },
  metrics: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
  },
  card: {
    alignItems: 'center',
    backgroundColor: 'rgba(21,26,35,0.9)',
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    paddingHorizontal: 5,
    paddingVertical: 7,
  },
  cardLabel: { color: '#4a7a8a', fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  cardValue: { color: '#c8e8f0', fontSize: 16, fontWeight: '900', marginTop: 2 },
});
