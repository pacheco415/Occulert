import React, { memo, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { EyeMetrics } from '../hooks/useEyeTracking';
import { elapsedSessionSeconds, formatSessionTime } from '../lib/monitorPerformance';

interface LiveMetricsProps {
  metrics: EyeMetrics;
  alertCount: number;
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

  const stateColor = {
    open: '#00ff88',
    watch: '#fbbf24',
    closed: '#ff3344',
    noFace: '#4a7a8a',
  }[metrics.state];

  return (
    <View style={styles.metrics}>
      <MetricCard label="EYE" value={metrics.ear.toFixed(3)} color={stateColor} />
      <MetricCard
        label="PERCLOS"
        value={`${(metrics.perclos * 100).toFixed(0)}%`}
        color={metrics.perclos > 0.15 ? '#f87171' : '#c8e8f0'}
      />
      <MetricCard
        label="SCORE"
        value={String(metrics.fatigueScore)}
        color={metrics.fatigueScore > 60 ? '#f87171' : '#00ff88'}
      />
      <MetricCard label="TIME" value={formatSessionTime(elapsedSeconds)} color="#c8e8f0" />
      <MetricCard
        label="ALERTS"
        value={String(alertCount)}
        color={alertCount > 0 ? '#fbbf24' : '#c8e8f0'}
      />
    </View>
  );
});

const styles = StyleSheet.create({
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
