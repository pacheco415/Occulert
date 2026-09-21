import type { HeadphoneMotionStatus } from './headphoneMotion';
import type { WatchStatus } from './watchBridge';

export const READINESS_MAX_AGE_MS = 30_000;
export const READINESS_TIMEOUT_MS = 3_000;

export interface CameraReadiness {
  permission: string;
  frontAvailable: boolean;
  backAvailable: boolean;
  backPhysicalDevices: string[];
  multiCamSupported: boolean | null;
  frontBackMultiCamSupported: boolean | null;
}

export interface OutputReadiness {
  audio: boolean;
  haptic: boolean;
  watch: boolean;
}

export interface DeviceReadinessSnapshot {
  checkedAt: number;
  camera: CameraReadiness | null;
  outputs: OutputReadiness | null;
  watch: WatchStatus | null;
  motion: HeadphoneMotionStatus | null;
}

export interface ReadinessSources {
  camera(): Promise<CameraReadiness>;
  outputs(): Promise<OutputReadiness>;
  watch(): Promise<WatchStatus>;
  motion(): Promise<HeadphoneMotionStatus>;
}

export interface ReadinessRow {
  id: 'camera' | 'roadCamera' | 'outputs' | 'watch' | 'motion';
  title: string;
  status: string;
  detail: string;
  attention: boolean;
}

// An unavailable optional bridge must not hold the entire setup screen open.
// Late results are consumed but cannot change the snapshot after the deadline.
async function readWithDeadline<T>(read: () => Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(read).catch(() => null),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function collectDeviceReadiness(
  sources: ReadinessSources,
  now: () => number = Date.now,
  timeoutMs = READINESS_TIMEOUT_MS,
): Promise<DeviceReadinessSnapshot> {
  const checkedAt = now();
  const [camera, outputs, watch, motion] = await Promise.all([
    readWithDeadline(sources.camera, timeoutMs),
    readWithDeadline(sources.outputs, timeoutMs),
    readWithDeadline(sources.watch, timeoutMs),
    readWithDeadline(sources.motion, timeoutMs),
  ]);
  return { checkedAt, camera, outputs, watch, motion };
}

export function isReadinessStale(snapshot: DeviceReadinessSnapshot, now: number): boolean {
  const age = now - snapshot.checkedAt;
  return !Number.isFinite(age) || age < 0 || age >= READINESS_MAX_AGE_MS;
}

export function describeDeviceReadiness(snapshot: DeviceReadinessSnapshot, now: number): ReadinessRow[] {
  const titles = {
    camera: 'Front camera',
    roadCamera: 'Road camera · planned',
    outputs: 'Phone alerts',
    watch: 'Apple Watch · optional',
    motion: 'Headphone motion · optional',
  };
  if (isReadinessStale(snapshot, now)) {
    return (Object.keys(titles) as ReadinessRow['id'][]).map(id => ({
      id, title: titles[id], status: 'Check again',
      detail: 'Connections or settings may have changed. Refresh while parked.', attention: true,
    }));
  }
  const { camera, outputs, watch, motion } = snapshot;
  const row = (id: ReadinessRow['id'], status: string, detail: string, attention = false): ReadinessRow => ({
    id, title: titles[id], status, detail, attention,
  });
  const cameraRow = !camera
    ? row('camera', 'Not confirmed', 'Camera status could not be read. Refresh or check camera setup.', true)
    : !camera.frontAvailable
      ? row('camera', 'Not found', 'A front camera is required. Check again on a supported phone.', true)
      : camera.permission !== 'granted'
        ? row('camera', 'Access needed', 'Camera access is not granted. Continue to camera setup to review access.', true)
        : row('camera', 'Access granted', 'Check framing and eye visibility in the camera preview before starting.');
  const roadCameraRow = !camera
    ? row('roadCamera', 'Not confirmed', 'Road-camera compatibility could not be read. Driver monitoring remains independent.')
    : !camera.backAvailable
      ? row('roadCamera', 'Unavailable', 'No rear camera was reported. Front-camera driver monitoring remains available.')
      : camera.frontBackMultiCamSupported === true
        ? row(
            'roadCamera',
            'Hardware capable',
            `${camera.backPhysicalDevices.length || 1} rear camera type${camera.backPhysicalDevices.length === 1 ? '' : 's'} reported. This confirms Apple multi-camera support only; road monitoring is not active yet.`,
          )
        : camera.multiCamSupported === false || camera.frontBackMultiCamSupported === false
          ? row('roadCamera', 'Single camera only', 'This iPhone does not report Apple simultaneous multi-camera support. Driver monitoring keeps priority.')
          : row('roadCamera', 'Support unknown', 'A rear camera is available, but simultaneous Apple multi-camera support was not confirmed.');
  const outputRow = !outputs
    ? row('outputs', 'Not confirmed', 'Saved alert settings could not be read. Check Settings before starting.', true)
    : !outputs.audio && !outputs.haptic
      ? row('outputs', 'Both off', 'Phone sound and vibration are disabled. Review alert settings; the Watch is optional.', true)
      : row('outputs', outputs.audio && outputs.haptic ? 'Sound + vibration' : outputs.audio ? 'Sound only' : 'Vibration only',
        'Saved settings only. Test the current audio output in Settings while parked.');
  const watchRow = !outputs
    ? row('watch', 'Not confirmed', 'The saved Watch alert setting could not be read.', true)
    : !outputs.watch
      ? row('watch', 'Alerts off', 'Optional wrist alerts are off. You can enable and test them in Settings.')
      : !watch || !watch.moduleAvailable
        ? row('watch', 'Not confirmed', 'The Watch connection could not be checked in this build. Phone alerts remain available.', true)
        : !watch.paired || !watch.appInstalled
          ? row('watch', 'Open Watch app', 'Open Occulert on your Watch, then refresh this check. If it is still not found, verify the companion installation.', true)
        : !watch.reachable
          ? row('watch', 'Not reachable', 'Open Occulert on your Watch and test it. Background delivery can be delayed.', true)
          : row('watch', 'Reachable', 'Wrist alerts are enabled. A connection does not confirm that you felt an alert; test while parked.');
  const motionRow = !motion || motion.state === 'error'
    ? row('motion', 'Not confirmed', 'Motion status could not be read. Phone camera monitoring remains independent.')
    : motion.state === 'denied' || motion.authorization === 'denied' || motion.authorization === 'restricted'
      ? row('motion', 'Access off', 'Motion access is unavailable. Headphone audio can still work independently.')
      : !motion.isAvailable || motion.state === 'not-built' || motion.state === 'unavailable'
        ? row('motion', 'Unavailable', 'Compatible motion support is not available here. This does not test the audio connection.')
        : motion.authorization !== 'authorized'
          ? row('motion', 'Permission pending', 'Motion access may be requested when monitoring starts. This check does not request it.')
          : row('motion', 'Available', 'Experimental head-motion observations only; they do not change fatigue scores or alerts.');
  return [cameraRow, roadCameraRow, outputRow, watchRow, motionRow];
}
