import { Platform } from 'react-native';
import type { AlertLevel } from './alertPolicy';
import {
  createWatchMonitoringMessage,
  type WatchMonitoringPayload,
} from './watchMessages';

export type { WatchMonitoringPayload, WatchMonitoringState } from './watchMessages';

/**
 * Payload sent to the Apple Watch companion on each alert.
 */
export interface WatchAlertPayload {
  level: AlertLevel;
  perclos: number;
  at: number;
}

// react-native-watch-connectivity is an optional native dependency. It only
// exists in a development / TestFlight build that includes a watchOS target.
// We load it defensively so the JS bundle still runs in Expo Go and on Android.
type WatchModule = {
  sendMessage: (message: Record<string, unknown>, reply?: (r: unknown) => void, err?: (e: unknown) => void) => void;
  updateApplicationContext: (context: Record<string, unknown>) => void;
  transferUserInfo?: (userInfo: Record<string, unknown>) => void;
  getIsPaired?: () => Promise<boolean>;
  getIsWatchAppInstalled?: () => Promise<boolean>;
  getReachability?: () => Promise<boolean>;
};

export interface WatchStatus {
  moduleAvailable: boolean;
  paired: boolean;
  appInstalled: boolean;
  reachable: boolean;
}

export interface WatchDeliveryResult {
  accepted: boolean;
  reachable: boolean;
  acknowledged: boolean;
  roundTripMs: number | null;
}

let watch: WatchModule | null = null;
let triedLoad = false;
const WATCH_STATUS_CACHE_MS = 5_000;
let cachedWatchStatus: { value: WatchStatus; checkedAt: number } | null = null;
const WATCH_LIVE_ACK_TIMEOUT_MS = 1_500;

function loadWatchModule(): WatchModule | null {
  if (triedLoad) return watch;
  triedLoad = true;
  if (Platform.OS !== 'ios') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    watch = require('react-native-watch-connectivity') as WatchModule;
  } catch {
    // Module not linked (Expo Go or no watchOS companion yet) - no-op.
    watch = null;
  }
  return watch;
}

/**
 * Mirror an alert to a paired Apple Watch.
 *
 * Uses updateApplicationContext (delivered even if the watch app is not in the
 * foreground) plus a live sendMessage best-effort. Silently no-ops when no
 * Watch connectivity module or companion app is available.
 */
export async function sendAlertToWatch(payload: WatchAlertPayload): Promise<WatchDeliveryResult> {
  const mod = loadWatchModule();
  if (!mod) {
    return { accepted: false, reachable: false, acknowledged: false, roundTripMs: null };
  }
  const message = {
    type: 'occulert-alert',
    level: payload.level,
    perclos: Math.round(payload.perclos * 100) / 100,
    at: payload.at,
  };
  let accepted = false;
  // Queue the durable fallbacks before any asynchronous reachability query.
  // These calls are best-effort and never sit in front of the iPhone cue.
  try {
    // Latest-state channel: survives app being backgrounded on the watch.
    mod.updateApplicationContext(message);
    accepted = true;
  } catch {
    // ignore
  }
  try {
    // Reliable queued delivery if the Watch app is not reachable at the exact
    // moment of the alert. The Watch receiver deduplicates by timestamp.
    if (mod.transferUserInfo) {
      mod.transferUserInfo(message);
      accepted = true;
    }
  } catch {
    // ignore
  }

  // Attempt the live channel immediately. Waiting for three native status
  // queries before sendMessage added avoidable latency to the wrist path.
  const liveStartedAt = Date.now();
  const liveAcknowledgement = new Promise<{ acknowledged: boolean; roundTripMs: number | null }>((resolve) => {
    let settled = false;
    const settle = (acknowledged: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        acknowledged,
        roundTripMs: acknowledged ? Math.max(0, Date.now() - liveStartedAt) : null,
      });
    };
    const timeout = setTimeout(() => settle(false), WATCH_LIVE_ACK_TIMEOUT_MS);
    try {
      mod.sendMessage(
        message,
        () => settle(true),
        () => settle(false),
      );
    } catch {
      settle(false);
    }
  });

  const [status, live] = await Promise.all([
    getWatchStatus(),
    liveAcknowledgement,
  ]);
  const available = status.paired && status.appInstalled;
  return {
    accepted: available && (accepted || live.acknowledged),
    reachable: status.reachable,
    acknowledged: live.acknowledged,
    roundTripMs: live.roundTripMs,
  };
}

/**
 * Mirror the latest monitoring state to the Watch companion.
 *
 * Status is intentionally latest-state only: it uses application context plus
 * a live message when reachable and never queues every one-second update.
 */
export async function sendMonitoringStatusToWatch(
  payload: WatchMonitoringPayload,
): Promise<WatchDeliveryResult> {
  const mod = loadWatchModule();
  if (!mod) {
    return { accepted: false, reachable: false, acknowledged: false, roundTripMs: null };
  }
  // Live metrics are informational and frequent, so briefly reuse the paired /
  // installed / reachable snapshot instead of crossing the native bridge three
  // times for every status update. Alert delivery above always checks fresh.
  const status = await getWatchStatus(WATCH_STATUS_CACHE_MS);
  if (!status.paired || !status.appInstalled) {
    return { accepted: false, reachable: false, acknowledged: false, roundTripMs: null };
  }

  const message: Record<string, unknown> = {
    ...createWatchMonitoringMessage(payload),
  };
  let accepted = false;
  try {
    mod.updateApplicationContext(message);
    accepted = true;
  } catch {
    // ignore
  }
  if (status.reachable) {
    try {
      mod.sendMessage(message);
      accepted = true;
    } catch {
      // ignore
    }
  }
  return {
    accepted,
    reachable: status.reachable,
    acknowledged: false,
    roundTripMs: null,
  };
}

/**
 * Whether a paired Apple Watch with the Occulert companion installed is
 * available. Pairing alone is not enough to promise wrist alerts.
 */
export async function getWatchStatus(maxAgeMs = 0): Promise<WatchStatus> {
  const mod = loadWatchModule();
  if (!mod) {
    return { moduleAvailable: false, paired: false, appInstalled: false, reachable: false };
  }
  const now = Date.now();
  if (
    maxAgeMs > 0 &&
    cachedWatchStatus &&
    now - cachedWatchStatus.checkedAt < maxAgeMs
  ) {
    return cachedWatchStatus.value;
  }
  try {
    const [paired, appInstalled, reachable] = await Promise.all([
      mod.getIsPaired?.() ?? Promise.resolve(false),
      mod.getIsWatchAppInstalled?.() ?? Promise.resolve(false),
      mod.getReachability?.() ?? Promise.resolve(false),
    ]);
    const value = { moduleAvailable: true, paired, appInstalled, reachable };
    cachedWatchStatus = { value, checkedAt: now };
    return value;
  } catch {
    const value = { moduleAvailable: true, paired: false, appInstalled: false, reachable: false };
    cachedWatchStatus = { value, checkedAt: now };
    return value;
  }
}

export async function isWatchAvailable(): Promise<boolean> {
  const status = await getWatchStatus();
  return status.paired && status.appInstalled;
}
