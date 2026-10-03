/** Session completion policy, independent of React and camera state. */
import type { CloudSessionStats } from './cloudSync';
import type { MonitorPerformanceSnapshot } from './monitorPerformance';

type HistoryUpdate = (update: (sessions: Record<string, unknown>[]) => Record<string, unknown>[]) => Promise<void>;

type SavedSnapshot = {
  sessionId: string;
  durationSec: number;
  alerts: number;
  fatigueSum: number;
  fatigueSamples: number;
  headNodObservations: number;
  headphoneHeadNodObservations: number;
  headphoneMotionSamples: number;
  headphoneMotionStatus: string;
  monitorPerformance: MonitorPerformanceSnapshot;
  sensorFusion: unknown;
  sensitivity: string;
  extra: object;
};

export async function saveCompletedNativeSession(snapshot: SavedSnapshot, update: HistoryUpdate): Promise<string | null> {
  if (snapshot.durationSec <= 0) return null;
  const record = {
    sessionId: snapshot.sessionId,
    savedAt: new Date().toISOString(),
    durationSec: snapshot.durationSec,
    alertCount: snapshot.alerts,
    avgFatigue: snapshot.fatigueSamples ? Math.round(snapshot.fatigueSum / snapshot.fatigueSamples) : 0,
    headNodObservations: snapshot.headNodObservations,
    cameraHeadNodObservations: snapshot.headNodObservations,
    headphoneHeadNodObservations: snapshot.headphoneHeadNodObservations,
    headphoneMotionSamples: snapshot.headphoneMotionSamples,
    headphoneMotionStatus: snapshot.headphoneMotionStatus,
    monitorPerformance: snapshot.monitorPerformance,
    sensorFusion: snapshot.sensorFusion,
    sensitivity: snapshot.sensitivity,
    ...snapshot.extra,
  };
  await update(sessions => [record, ...sessions.filter(item => item?.sessionId !== snapshot.sessionId)].slice(0, 50));
  return snapshot.sessionId;
}

export async function markCompletedNativeSessionSynced(update: HistoryUpdate, localSessionId: string, cloudSessionId: string): Promise<void> {
  try {
    await update(sessions => sessions.map(item => item?.sessionId === localSessionId
      ? { ...item, cloudSynced: true, cloudSessionId } : item));
  } catch {
    // A badge write must not erase or invalidate the completed local record.
  }
}

type CloudSnapshot = {
  cloudSession: Promise<string | null> | null;
  pendingEvents: Promise<unknown>;
  averageFatigue: number;
  maxFatigue: number;
  alerts: number;
  endedAt: string;
};

export async function finalizeCompletedNativeSession(snapshot: CloudSnapshot, localSessionId: string | null, services: {
  finish: (id: string, stats: CloudSessionStats, endedAt: string, localId?: string) => Promise<boolean>;
  markSynced: (localId: string, cloudId: string) => Promise<void>;
}): Promise<void> {
  const cloudId = snapshot.cloudSession ? await snapshot.cloudSession.catch(() => null) : null;
  if (!cloudId) return;
  await snapshot.pendingEvents.catch(() => {});
  const safetyScore = Math.max(0, 100 - Math.round(snapshot.maxFatigue * 0.65) - snapshot.alerts * 8);
  const synced = await services.finish(cloudId, {
    averageFatigue: snapshot.averageFatigue,
    maxFatigue: snapshot.maxFatigue,
    safetyScore,
    alertCount: snapshot.alerts,
  }, snapshot.endedAt, localSessionId || undefined);
  if (synced && localSessionId) await services.markSynced(localSessionId, cloudId);
}

/** Disarm sensors in the caller before invoking this persistence sequence. */
export async function completeNativeSessionStop(snapshot: {
  wasRunning: boolean; activeSessionId: string | null; deferCloudFinalization: boolean;
}, services: {
  save: (id: string) => Promise<string | null>;
  clearCheckpoint: (id: string) => Promise<void>;
  releaseIdentity: (id: string) => void;
  finalize: (localId: string | null) => Promise<void>;
}): Promise<void> {
  if (!snapshot.wasRunning) return;
  const localId = snapshot.activeSessionId ? await services.save(snapshot.activeSessionId) : null;
  if (snapshot.activeSessionId) {
    await services.clearCheckpoint(snapshot.activeSessionId).catch(() => {});
    services.releaseIdentity(snapshot.activeSessionId);
  }
  if (snapshot.deferCloudFinalization) {
    void services.finalize(localId).catch(() => {});
    return;
  }
  await services.finalize(localId);
}
