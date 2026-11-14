import { strings, formatString } from './strings.ts';
import type { HeadphoneMotionStatus } from './headphoneMotion';
import type { WatchStatus } from './watchBridge';
import type { FrontPhysicalCamera, MultiCamConfigurationProbe } from './deviceCondition';

export const READINESS_MAX_AGE_MS = 30_000;
export const READINESS_TIMEOUT_MS = 3_000;

export interface CameraReadiness {
  permission: string;
  frontAvailable: boolean;
  backAvailable: boolean;
  backPhysicalDevices: string[];
  frontPhysicalDevices: FrontPhysicalCamera[];
  multiCamSupported: boolean | null;
  frontBackMultiCamSupported: boolean | null;
  multiCamProbe: MultiCamConfigurationProbe;
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
    camera: strings.preDrive.devices.title.camera,
    roadCamera: strings.preDrive.devices.title.roadCamera,
    outputs: strings.preDrive.devices.title.outputs,
    watch: strings.preDrive.devices.title.watch,
    motion: strings.preDrive.devices.title.motion,
  };
  if (isReadinessStale(snapshot, now)) {
    return (Object.keys(titles) as ReadinessRow['id'][]).map(id => ({
      id, title: titles[id], status: strings.preDrive.devices.stale.status,
      detail: strings.preDrive.devices.stale.detail, attention: true,
    }));
  }
  const { camera, outputs, watch, motion } = snapshot;
  const row = (id: ReadinessRow['id'], status: string, detail: string, attention = false): ReadinessRow => ({
    id, title: titles[id], status, detail, attention,
  });
  const cameraRow = !camera
    ? row('camera', strings.preDrive.devices.status.unconfirmed, strings.preDrive.devices.camera.unconfirmed, true)
    : !camera.frontAvailable
      ? row('camera', strings.preDrive.devices.camera.notFoundStatus, strings.preDrive.devices.camera.notFoundDetail, true)
      : camera.permission !== 'granted'
        ? row('camera', strings.preDrive.devices.camera.accessNeededStatus, strings.preDrive.devices.camera.accessNeededDetail, true)
        : row('camera', strings.preDrive.devices.camera.accessGrantedStatus, strings.preDrive.devices.camera.accessGrantedDetail);
  const multiCamCostDetail = camera
    && camera.multiCamProbe.hardwareCost != null
    && camera.multiCamProbe.systemPressureCost != null
    ? formatString(strings.preDrive.devices.roadCamera.costDetail, { hardwarePercent: String(Math.round(camera.multiCamProbe.hardwareCost * 100)), pressurePercent: String(Math.round(camera.multiCamProbe.systemPressureCost * 100)) })
    : '';
  const roadCameraRow = !camera
    ? row('roadCamera', strings.preDrive.devices.status.unconfirmed, strings.preDrive.devices.roadCamera.unconfirmed)
    : !camera.backAvailable
      ? row('roadCamera', strings.preDrive.devices.status.unavailable, strings.preDrive.devices.roadCamera.unavailable)
      : camera.frontBackMultiCamSupported === true
        ? camera.multiCamProbe.state === 'withinBudget'
          ? row(
              'roadCamera',
              strings.preDrive.devices.roadCamera.passedStatus,
              formatString(strings.preDrive.devices.roadCamera.passedDetail, { costDetail: multiCamCostDetail }),
            )
          : camera.multiCamProbe.state === 'overBudget'
            ? row('roadCamera', strings.preDrive.devices.roadCamera.overBudgetStatus, strings.preDrive.devices.roadCamera.overBudgetDetail, true)
            : camera.multiCamProbe.state === 'configurationFailed'
              ? row('roadCamera', strings.preDrive.devices.roadCamera.failedStatus, strings.preDrive.devices.roadCamera.failedDetail, true)
              : row(
                  'roadCamera',
                  strings.preDrive.devices.roadCamera.hardwareCapableStatus,
                  formatString(camera.backPhysicalDevices.length === 1 ? strings.preDrive.devices.roadCamera.hardwareCapableOne : strings.preDrive.devices.roadCamera.hardwareCapableMany, { count: camera.backPhysicalDevices.length || 1 }),
                )
        : camera.multiCamSupported === false || camera.frontBackMultiCamSupported === false
          ? row('roadCamera', strings.preDrive.devices.roadCamera.singleCameraStatus, strings.preDrive.devices.roadCamera.singleCameraDetail)
          : row('roadCamera', strings.preDrive.devices.roadCamera.unknownStatus, strings.preDrive.devices.roadCamera.unknownDetail);
  const outputRow = !outputs
    ? row('outputs', strings.preDrive.devices.status.unconfirmed, strings.preDrive.devices.outputs.unconfirmed, true)
    : !outputs.audio && !outputs.haptic
      ? row('outputs', strings.preDrive.devices.outputs.offStatus, strings.preDrive.devices.outputs.offDetail, true)
      : row('outputs', outputs.audio && outputs.haptic ? strings.preDrive.devices.outputs.soundAndVibration : outputs.audio ? strings.preDrive.devices.outputs.soundOnly : strings.preDrive.devices.outputs.vibrationOnly,
        strings.preDrive.devices.outputs.testDetail);
  const watchRow = !outputs
    ? row('watch', strings.preDrive.devices.status.unconfirmed, strings.preDrive.devices.watch.settingUnconfirmed, true)
    : !outputs.watch
      ? row('watch', strings.preDrive.devices.watch.offStatus, strings.preDrive.devices.watch.offDetail)
      : !watch || !watch.moduleAvailable
        ? row('watch', strings.preDrive.devices.status.unconfirmed, strings.preDrive.devices.watch.connectionUnconfirmed, true)
        : !watch.paired || !watch.appInstalled
          ? row('watch', strings.preDrive.devices.watch.openStatus, strings.preDrive.devices.watch.openDetail, true)
        : !watch.reachable
          ? row('watch', strings.preDrive.devices.watch.unreachableStatus, strings.preDrive.devices.watch.unreachableDetail, true)
          : row('watch', strings.preDrive.devices.watch.reachableStatus, strings.preDrive.devices.watch.reachableDetail);
  const motionRow = !motion || motion.state === 'error'
    ? row('motion', strings.preDrive.devices.status.unconfirmed, strings.preDrive.devices.motion.unconfirmed)
    : motion.state === 'denied' || motion.authorization === 'denied' || motion.authorization === 'restricted'
      ? row('motion', strings.preDrive.devices.motion.accessOffStatus, strings.preDrive.devices.motion.accessOffDetail)
      : !motion.isAvailable || motion.state === 'not-built' || motion.state === 'unavailable'
        ? row('motion', strings.preDrive.devices.status.unavailable, strings.preDrive.devices.motion.unavailable)
        : motion.authorization !== 'authorized'
          ? row('motion', strings.preDrive.devices.motion.permissionPendingStatus, strings.preDrive.devices.motion.permissionPendingDetail)
          : row('motion', strings.preDrive.devices.motion.availableStatus, strings.preDrive.devices.motion.availableDetail);
  return [cameraRow, roadCameraRow, outputRow, watchRow, motionRow];
}
