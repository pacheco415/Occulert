import { Platform } from 'react-native';
import type { AlertLevel } from '../components/AlertSystem';

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
  getIsPaired?: () => Promise<boolean>;
};

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
export async function sendAlertToWatch(payload: WatchAlertPayload): Promise<void> {
  const mod = loadWatchModule();
  if (!mod) return;
  const message = {
    type: 'occulert-alert',
    level: payload.level,
    perclos: Math.round(payload.perclos * 100) / 100,
    at: payload.at,
  };
  try {
    // Latest-state channel: survives app being backgrounded on the watch.
    mod.updateApplicationContext(message);
  } catch {
    // ignore
  }
  try {
    // Live channel for an immediate haptic when the watch app is reachable.
    mod.sendMessage(message);
  } catch {
    // ignore
  }
}

/**
 * Whether a paired, reachable Apple Watch is available. Returns false in
 * Expo Go, on Android, or before the watchOS companion is installed.
 */
export async function isWatchAvailable(): Promise<boolean> {
  const mod = loadWatchModule();
  if (!mod || !mod.getIsPaired) return false;
  try {
    return await mod.getIsPaired();
  } catch {
    return false;
  }
}
