import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const API_BASE = 'https://www.occulert.com';
const AUTH_KEY = 'occulert.cloud.auth.v1';
const CONSENT_KEY = 'occulert-cloud-sync-enabled';
const REQUEST_TIMEOUT_MS = 8_000;
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: 'com.occulert.app.cloud-auth',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

interface PublicConfig {
  configured: boolean;
  url: string;
  anonKey: string;
}

interface StoredAuth {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: {
    id: string;
    email: string;
  };
}

interface ApiResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  body: T & { error?: string; message?: string };
}

interface AuthResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: {
    id?: string;
    email?: string;
  };
  code?: string;
  error_code?: string;
  error?: string;
  msg?: string;
  message?: string;
}

export interface CloudState {
  available: boolean;
  signedIn: boolean;
  email: string | null;
  syncEnabled: boolean;
}

export interface CloudSessionStats {
  averageFatigue: number;
  maxFatigue: number;
  safetyScore: number;
  alertCount: number;
}

export interface CloudSignInResult {
  ok: boolean;
  message: string;
}

let configPromise: Promise<PublicConfig | null> | null = null;
let consentOverride: boolean | null = null;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return { error: 'invalid_json_response' } as T;
  }
}

async function loadConfig(): Promise<PublicConfig | null> {
  if (!configPromise) {
    configPromise = fetchWithTimeout(`${API_BASE}/api/public-config`, {
      headers: { Accept: 'application/json' },
    })
      .then(async response => {
        const body = await readJson<{
          supabase?: Partial<PublicConfig>;
        }>(response);
        const config = body.supabase;
        if (!response.ok || !config?.configured || !config.url || !config.anonKey) return null;
        return {
          configured: true,
          url: config.url,
          anonKey: config.anonKey,
        };
      })
      .catch(() => null);
  }
  const config = await configPromise;
  if (!config) configPromise = null;
  return config;
}

async function secureStoreAvailable(): Promise<boolean> {
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

function validStoredAuth(value: unknown): value is StoredAuth {
  if (!value || typeof value !== 'object') return false;
  const auth = value as Partial<StoredAuth>;
  return typeof auth.access_token === 'string'
    && typeof auth.refresh_token === 'string'
    && typeof auth.expires_at === 'number'
    && typeof auth.user?.id === 'string'
    && typeof auth.user?.email === 'string';
}

async function loadAuth(): Promise<StoredAuth | null> {
  try {
    const raw = await SecureStore.getItemAsync(AUTH_KEY, SECURE_OPTIONS);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return validStoredAuth(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function saveAuth(body: AuthResponse, previous?: StoredAuth | null): Promise<StoredAuth | null> {
  const accessToken = body.access_token;
  const refreshToken = body.refresh_token || previous?.refresh_token;
  const user = body.user || previous?.user;
  if (!accessToken || !refreshToken || !user?.id || !user.email) return null;
  const auth: StoredAuth = {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: Math.floor(Date.now() / 1000) + (body.expires_in || 3_600) - 60,
    user: { id: user.id, email: user.email },
  };
  await SecureStore.setItemAsync(AUTH_KEY, JSON.stringify(auth), SECURE_OPTIONS);
  return auth;
}

async function clearAuth(): Promise<void> {
  consentOverride = false;
  await Promise.allSettled([
    SecureStore.deleteItemAsync(AUTH_KEY, SECURE_OPTIONS),
    AsyncStorage.setItem(CONSENT_KEY, 'false'),
  ]);
}

async function authFetch(path: string, body: Record<string, unknown>): Promise<ApiResult<AuthResponse>> {
  const config = await loadConfig();
  if (!config) {
    return { ok: false, status: 503, body: { error: 'cloud_not_configured' } };
  }
  try {
    const response = await fetchWithTimeout(`${config.url}/auth/v1${path}`, {
      method: 'POST',
      headers: {
        apikey: config.anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await readJson<AuthResponse>(response),
    };
  } catch {
    return { ok: false, status: 503, body: { error: 'cloud_unavailable' } };
  }
}

function authErrorText(result: ApiResult<AuthResponse>): string {
  const body = result.body;
  return [body.code, body.error_code, body.error, body.msg, body.message]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function authMessage(result: ApiResult<AuthResponse>): string {
  const text = authErrorText(result);
  if (text.includes('invalid_credentials') || text.includes('invalid login credentials')) {
    return 'Email or password is incorrect.';
  }
  if (text.includes('email_not_confirmed') || text.includes('email not confirmed')) {
    return 'Confirm your email, then return and sign in.';
  }
  if (text.includes('cloud_not_configured')) {
    return 'Cloud sign-in is not configured yet. Monitoring still works locally.';
  }
  if (text.includes('cloud_unavailable')) {
    return 'Occulert could not reach the sign-in service. Check your connection and try again.';
  }
  return 'Sign-in failed. Check your email and password, then try again.';
}

async function refreshAuth(previous: StoredAuth): Promise<StoredAuth | null> {
  const result = await authFetch('/token?grant_type=refresh_token', {
    refresh_token: previous.refresh_token,
  });
  if (result.ok) return saveAuth(result.body, previous);
  if (result.status === 400 || result.status === 401) await clearAuth();
  return null;
}

async function refreshIfNeeded(force = false): Promise<StoredAuth | null> {
  const auth = await loadAuth();
  if (!auth) return null;
  if (!force && auth.expires_at > Math.floor(Date.now() / 1000)) return auth;
  return refreshAuth(auth);
}

async function backendApi<T>(
  method: 'POST' | 'PATCH',
  path: string,
  body: Record<string, unknown>,
  retry = true,
): Promise<ApiResult<T>> {
  const auth = await refreshIfNeeded();
  if (!auth) return { ok: false, status: 401, body: { error: 'sign_in_required' } as T & { error: string } };
  try {
    const response = await fetchWithTimeout(`${API_BASE}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${auth.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (response.status === 401 && retry) {
      const refreshed = await refreshIfNeeded(true);
      if (!refreshed) {
        return { ok: false, status: 401, body: { error: 'sign_in_required' } as T & { error: string } };
      }
      return backendApi<T>(method, path, body, false);
    }
    return {
      ok: response.ok,
      status: response.status,
      body: await readJson<T & { error?: string; message?: string }>(response),
    };
  } catch {
    return { ok: false, status: 503, body: { error: 'cloud_unavailable' } as T & { error: string } };
  }
}

async function ensureDriverProfile(): Promise<boolean> {
  const result = await backendApi<{ driver?: { id?: string } }>('POST', '/api/profile', {});
  return result.ok && Boolean(result.body.driver?.id);
}

async function consentEnabled(): Promise<boolean> {
  if (consentOverride !== null) return consentOverride;
  try {
    consentOverride = await AsyncStorage.getItem(CONSENT_KEY) === 'true';
    return consentOverride;
  } catch {
    return false;
  }
}

export async function getCloudState(): Promise<CloudState> {
  const available = await secureStoreAvailable();
  if (!available) {
    return { available: false, signedIn: false, email: null, syncEnabled: false };
  }
  const auth = await loadAuth();
  return {
    available: true,
    signedIn: Boolean(auth),
    email: auth?.user.email || null,
    syncEnabled: Boolean(auth) && await consentEnabled(),
  };
}

export async function signInToCloud(email: string, password: string): Promise<CloudSignInResult> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!await secureStoreAvailable()) {
    return { ok: false, message: 'Secure sign-in storage is unavailable on this device.' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || password.length < 6) {
    return { ok: false, message: 'Enter a valid email and password.' };
  }
  const result = await authFetch('/token?grant_type=password', {
    email: normalizedEmail,
    password,
  });
  if (!result.ok || !await saveAuth(result.body)) {
    return { ok: false, message: authMessage(result) };
  }
  const profileReady = await ensureDriverProfile();
  return {
    ok: true,
    message: profileReady
      ? 'Signed in. Cloud sync stays off until you enable it.'
      : 'Signed in. Driver profile setup will retry when you start a synced session.',
  };
}

export async function signOutOfCloud(): Promise<void> {
  const auth = await loadAuth();
  await clearAuth();
  if (!auth) return;
  loadConfig().then(config => {
    if (!config) return;
    return fetchWithTimeout(`${config.url}/auth/v1/logout`, {
      method: 'POST',
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${auth.access_token}`,
      },
    });
  }).catch(() => {
    // Local tokens and consent are already cleared even if revocation is offline.
  });
}

export async function setCloudSyncEnabled(enabled: boolean): Promise<boolean> {
  if (!enabled) consentOverride = false;
  if (enabled && !await refreshIfNeeded()) return false;
  try {
    await AsyncStorage.setItem(CONSENT_KEY, String(enabled));
    consentOverride = enabled;
    return true;
  } catch {
    if (enabled) consentOverride = false;
    return false;
  }
}

export async function beginCloudSession(): Promise<string | null> {
  if (!await consentEnabled() || !await ensureDriverProfile()) return null;
  if (!await consentEnabled()) return null;
  const result = await backendApi<{ session?: { id?: string } }>('POST', '/api/sessions', {
    device: `${Platform.OS} ${String(Platform.Version)}`.slice(0, 120),
    browser: `Occulert native app (${Platform.OS})`,
  });
  return result.ok ? result.body.session?.id || null : null;
}

export async function logCloudAlert(sessionId: string, fatigueScore: number): Promise<boolean> {
  if (!await consentEnabled()) return false;
  const result = await backendApi('POST', '/api/events', {
    session_id: sessionId,
    type: 'drowsy',
    fatigue_score: Math.max(0, Math.min(100, Math.round(fatigueScore))),
  });
  return result.ok;
}

export async function finishCloudSession(
  sessionId: string,
  stats: CloudSessionStats,
): Promise<boolean> {
  if (!await consentEnabled()) return false;
  const result = await backendApi('PATCH', '/api/sessions', {
    session_id: sessionId,
    average_fatigue: stats.averageFatigue,
    max_fatigue: stats.maxFatigue,
    safety_score: stats.safetyScore,
    alert_count: stats.alertCount,
    // Candidate head-nod observations remain local until device validation.
    head_nod_count: 0,
  });
  return result.ok;
}
