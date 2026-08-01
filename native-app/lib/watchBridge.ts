import { Platform } from 'react-native';
import type { AlertLevel } from './alertPolicy';

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
}

let watch: WatchModule | null = null;
let triedLoad = false;

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
  if (!mod) return { accepted: false, reachable: false };
  const status = await getWatchStatus();
  if (!status.paired || !status.appInstalled) {
    return { accepted: false, reachable: false };
  }
  const message = {
    type: 'occulert-alert',
    level: payload.level,
    perclos: Math.round(payload.perclos * 100) / 100,
    at: payload.at,
  };
  let accepted = false;
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
  if (status.reachable) {
    try {
      // Live channel for an immediate haptic when the watch app is reachable.
      mod.sendMessage(message);
      accepted = true;
    } catch {
      // ignore
    }
  }
  return { accepted, reachable: status.reachable };
}

/**
 * Whether a paired Apple Watch with the Occulert companion installed is
 * available. Pairing alone is not enough to promise wrist alerts.
 */
export async function getWatchStatus(): Promise<WatchStatus> {
  const mod = loadWatchModule();
  if (!mod) {
    return { moduleAvailable: false, paired: false, appInstalled: false, reachable: false };
  }
  try {
    const [paired, appInstalled, reachable] = await Promise.all([
      mod.getIsPaired?.() ?? Promise.resolve(false),
      mod.getIsWatchAppInstalled?.() ?? Promise.resolve(false),
      mod.getReachability?.() ?? Promise.resolve(false),
    ]);
    return { moduleAvailable: true, paired, appInstalled, reachable };
  } catch {
    return { moduleAvailable: true, paired: false, appInstalled: false, reachable: false };
  }
}

export async function isWatchAvailable(): Promise<boolean> {
  const status = await getWatchStatus();
  return status.paired && status.appInstalled;
}
