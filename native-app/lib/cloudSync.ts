import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createAsyncMutationQueue } from './asyncMutationQueue';
import { createCachedBooleanPreference } from './cachedBooleanPreference';
import { currentAppBuildInfo, formatAppBuildLabel } from './appBuildInfo';
import { updateSessionHistory } from './sessionHistory';
import { createSessionSummaryOutbox, type PendingSessionSummary, type SummaryScope } from './sessionSummaryOutbox';

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
  readStatus: 'confirmed' | 'unavailable';
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
let consentRuntimeOverride: boolean | null = null;
let consentMutationVersion = 0;
let authCache: StoredAuth | null | undefined;
let authLoadPromise: Promise<StoredAuth | null> | null = null;
let authRefreshPromise: Promise<StoredAuth | null> | null = null;
let authMutationVersion = 0;
const authStorageQueue = createAsyncMutationQueue();
const cloudSessionScopes = new Map<string, SummaryScope>();
const sessionOutbox = createSessionSummaryOutbox(AsyncStorage, scope =>
  authCache?.user.id === scope.ownerId && consentRuntimeOverride !== false
  && consentMutationVersion === scope.consentVersion, async (scope, entry) => {
    if (!entry.local_session_id) return;
    await updateSessionHistory<Record<string, unknown>>(records => records.map(record =>
      record.sessionId === entry.local_session_id
        ? { ...record, cloudSynced: true, cloudSessionId: entry.session_id, cloudOwnerId: scope.ownerId }
        : record));
  });
const cloudSyncPreference = createCachedBooleanPreference(
  AsyncStorage,
  CONSENT_KEY,
  false,
);

async function withCloudReadDeadline<T>(read: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Cloud status read timed out.')), REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([read(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonWithTimeout<T>(
  url: string,
  init?: RequestInit,
): Promise<{ response: Response; body: T }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Cloud request timed out.'));
    }, REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { ...init, signal: controller.signal });
        return { response, body: await readJson<T>(response) };
      })(),
      deadline,
    ]);
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
    configPromise = fetchJsonWithTimeout<{ supabase?: Partial<PublicConfig> }>(`${API_BASE}/api/public-config`, {
      headers: { Accept: 'application/json' },
    })
      .then(({ response, body }) => {
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
    return await withCloudReadDeadline(() => SecureStore.isAvailableAsync());
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

function authIsCurrent(auth: StoredAuth, version: number): boolean {
  return version === authMutationVersion
    && authCache?.user.id === auth.user.id
    && authCache.access_token === auth.access_token
    && authCache.refresh_token === auth.refresh_token;
}

function sessionChanged<T>(): ApiResult<T> {
  return { ok: false, status: 409, body: { error: 'auth_session_changed' } as T & { error: string } };
}

async function loadAuth(): Promise<StoredAuth | null> {
  if (authCache !== undefined) return authCache;
  if (!authLoadPromise) {
    const readVersion = authMutationVersion;
    // Resolve the native read before parsing/caching, so a timed-out read
    // cannot later restore credentials or keep future retries waiting on it.
    const pending = withCloudReadDeadline(() => SecureStore.getItemAsync(AUTH_KEY, SECURE_OPTIONS))
      .then(raw => {
        if (readVersion !== authMutationVersion) return authCache ?? null;
        let parsed: unknown = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch {
          // The native read succeeded but these saved bytes cannot sign in.
          // Keep them untouched and allow an explicit new sign-in to replace
          // them, rather than trapping the user in a status-only Retry loop.
        }
        authCache = validStoredAuth(parsed) ? parsed : null;
        return authCache;
      })
      .catch(() => {
        if (readVersion !== authMutationVersion) return authCache ?? null;
        // A transient keychain read failure must remain retryable.
        // Cache null only after a successful read proves no valid auth exists.
        return null;
      })
      .finally(() => {
        if (authLoadPromise === pending) authLoadPromise = null;
      });
    authLoadPromise = pending;
  }
  return authLoadPromise;
}

async function saveAuth(
  body: AuthResponse,
  previous?: StoredAuth | null,
  expectedVersion = authMutationVersion,
): Promise<StoredAuth | null> {
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
  return authStorageQueue.run(async () => {
    if (expectedVersion !== authMutationVersion) return null;
    await SecureStore.setItemAsync(AUTH_KEY, JSON.stringify(auth), SECURE_OPTIONS);
    if (expectedVersion !== authMutationVersion) return null;
    authMutationVersion += 1;
    authCache = auth;
    authRefreshPromise = null;
    return auth;
  });
}

async function clearAuth(): Promise<void> {
  consentRuntimeOverride = false;
  consentMutationVersion += 1;
  authMutationVersion += 1;
  authCache = null;
  authRefreshPromise = null;
  await Promise.allSettled([
    authStorageQueue.run(() => SecureStore.deleteItemAsync(AUTH_KEY, SECURE_OPTIONS)),
    cloudSyncPreference.set(false),
    sessionOutbox.clear(),
  ]);
}

async function authFetch(path: string, body: Record<string, unknown>): Promise<ApiResult<AuthResponse>> {
  const config = await loadConfig();
  if (!config) {
    return { ok: false, status: 503, body: { error: 'cloud_not_configured' } };
  }
  try {
    const { response, body: resultBody } = await fetchJsonWithTimeout<AuthResponse>(`${config.url}/auth/v1${path}`, {
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
      body: resultBody,
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

async function refreshAuth(previous: StoredAuth, expectedVersion: number): Promise<StoredAuth | null> {
  const result = await authFetch('/token?grant_type=refresh_token', {
    refresh_token: previous.refresh_token,
  });
  if (!authIsCurrent(previous, expectedVersion)) return null;
  if (result.ok) return saveAuth(result.body, previous, expectedVersion);
  if (result.status === 400 || result.status === 401) await clearAuth();
  return null;
}

async function refreshIfNeeded(force = false): Promise<StoredAuth | null> {
  const auth = await loadAuth();
  if (!auth) return null;
  const readVersion = authMutationVersion;
  if (!authIsCurrent(auth, readVersion)) return null;
  if (!force && auth.expires_at > Math.floor(Date.now() / 1000)) return auth;
  if (!authRefreshPromise) {
    const refreshVersion = authMutationVersion;
    const pending = refreshAuth(auth, refreshVersion).finally(() => {
      if (authRefreshPromise === pending) authRefreshPromise = null;
    });
    authRefreshPromise = pending;
  }
  return authRefreshPromise;
}

async function backendApi<T>(
  method: 'POST' | 'PATCH',
  path: string,
  body: Record<string, unknown>,
  retry = true,
  syncContext?: { ownerId: string; consentVersion: number },
): Promise<ApiResult<T>> {
  const initialVersion = authMutationVersion;
  const initialAuth = await loadAuth();
  if (initialAuth && !authIsCurrent(initialAuth, initialVersion)) return sessionChanged<T>();
  const auth = await refreshIfNeeded();
  if (!auth) return { ok: false, status: 401, body: { error: 'sign_in_required' } as T & { error: string } };
  const requestVersion = authMutationVersion;
  if (!initialAuth || initialAuth.user.id !== auth.user.id || !authIsCurrent(auth, requestVersion)) return sessionChanged<T>();
  if (syncContext) {
    const enabled = await consentEnabled();
    if (!enabled || syncContext.consentVersion !== consentMutationVersion
      || syncContext.ownerId !== auth.user.id || !authIsCurrent(auth, requestVersion)) {
      return sessionChanged<T>();
    }
  }
  try {
    const { response, body: resultBody } = await fetchJsonWithTimeout<T & { error?: string; message?: string }>(`${API_BASE}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${auth.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!authIsCurrent(auth, requestVersion)) return sessionChanged<T>();
    if (response.status === 401 && retry) {
      const refreshed = await refreshIfNeeded(true);
      if (!refreshed) {
        return { ok: false, status: 401, body: { error: 'sign_in_required' } as T & { error: string } };
      }
      if (refreshed.user.id !== auth.user.id || !authIsCurrent(refreshed, authMutationVersion)) return sessionChanged<T>();
      return backendApi<T>(method, path, body, false, syncContext);
    }
    return {
      ok: response.ok,
      status: response.status,
      body: resultBody,
    };
  } catch {
    if (!authIsCurrent(auth, requestVersion)) return sessionChanged<T>();
    return { ok: false, status: 503, body: { error: 'cloud_unavailable' } as T & { error: string } };
  }
}

async function ensureDriverProfile(syncContext?: { ownerId: string; consentVersion: number }): Promise<boolean> {
  // Create if missing; omit display fields so onboarding preserves an existing profile.
  const result = await backendApi<{ driver?: { id?: string } }>('POST', '/api/profile', {}, true, syncContext);
  return result.ok && Boolean(result.body.driver?.id);
}

async function consentEnabled(): Promise<boolean> {
  if (consentRuntimeOverride !== null) return consentRuntimeOverride;
  try {
    return await cloudSyncPreference.get();
  } catch {
    return false;
  }
}

async function currentSyncContext(): Promise<{ ownerId: string; consentVersion: number } | null> {
  const consentVersion = consentMutationVersion;
  const readVersion = authMutationVersion;
  const auth = await loadAuth();
  if (!auth || !authIsCurrent(auth, readVersion) || !await consentEnabled()) return null;
  if (consentVersion !== consentMutationVersion || !authIsCurrent(auth, readVersion)) return null;
  return { ownerId: auth.user.id, consentVersion };
}

export async function getCloudState(): Promise<CloudState> {
  const unavailable = (): CloudState => ({
    readStatus: 'unavailable', available: false, signedIn: false, email: null, syncEnabled: false,
  });
  const stateVersion = authMutationVersion;
  const consentVersion = consentMutationVersion;
  let active = true;
  const current = () => active
    && stateVersion === authMutationVersion
    && consentVersion === consentMutationVersion;
  try {
    return await withCloudReadDeadline(async () => {
      const available = await secureStoreAvailable();
      if (!current() || !available) return unavailable();
      const auth = await loadAuth();
      // Undefined means the keychain read failed, rather than confirmed no
      // saved sign-in. Leave it retryable and never present it as signed out.
      if (!current() || authCache === undefined || (auth && !authIsCurrent(auth, stateVersion))) return unavailable();
      let syncEnabled = false;
      if (auth) {
        // The operational preference cache intentionally falls back to off.
        // A status check must distinguish a failed read from a confirmed off.
        syncEnabled = consentRuntimeOverride !== null
          ? consentRuntimeOverride
          : await withCloudReadDeadline(() => AsyncStorage.getItem(CONSENT_KEY)).then(value => value === 'true');
      }
      if (!current() || (auth && !authIsCurrent(auth, stateVersion))) return unavailable();
      return {
        readStatus: 'confirmed',
        available: true,
        signedIn: Boolean(auth),
        email: auth?.user.email || null,
        syncEnabled: Boolean(auth) && syncEnabled,
      };
    });
  } catch {
    return unavailable();
  } finally {
    active = false;
  }
}

export async function signInToCloud(email: string, password: string): Promise<CloudSignInResult> {
  const signInVersion = authMutationVersion;
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
  const changedMessage = 'Sign-in was cancelled because the account changed. Please sign in again.';
  if (signInVersion !== authMutationVersion) return { ok: false, message: changedMessage };
  if (result.ok) {
    // A new password login must not inherit another account's sharing choice.
    // Persist the opt-out before saving new tokens so it also holds on restart.
    consentRuntimeOverride = false;
    consentMutationVersion += 1;
    try {
      await cloudSyncPreference.set(false);
      await sessionOutbox.clear();
    } catch {
      return { ok: false, message: 'Cloud sharing could not be switched off. Sign-in was not saved. Please try again.' };
    }
    if (signInVersion !== authMutationVersion) return { ok: false, message: changedMessage };
  }
  const signedInAuth = result.ok ? await saveAuth(result.body, null, signInVersion) : null;
  if (!result.ok || !signedInAuth) {
    return { ok: false, message: authMessage(result) };
  }
  const signedInVersion = authMutationVersion;
  const profileReady = await ensureDriverProfile();
  if (!authIsCurrent(signedInAuth, signedInVersion)) return { ok: false, message: changedMessage };
  return {
    ok: true,
    message: profileReady
      ? 'Signed in. Cloud sync stays off until you enable it.'
      : 'Signed in. Driver profile setup will retry when you start a synced session.',
  };
}

export async function signOutOfCloud(): Promise<void> {
  // Invalidate pending login/refresh work before any native storage wait.
  const auth = authCache ?? null;
  await clearAuth();
  if (!auth) return;
  loadConfig().then(config => {
    if (!config) return;
    return fetchJsonWithTimeout(`${config.url}/auth/v1/logout`, {
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
  const consentRevision = ++consentMutationVersion;
  if (!enabled) consentRuntimeOverride = false;
  const auth = enabled ? await refreshIfNeeded() : null;
  if (consentRevision !== consentMutationVersion) return false;
  if (enabled && !auth) return false;
  const consentVersion = authMutationVersion;
  try {
    if (!enabled || !await consentEnabled()) await sessionOutbox.clear();
    await cloudSyncPreference.set(enabled);
    if (consentRevision !== consentMutationVersion) return false;
    if (enabled && (!auth || !authIsCurrent(auth, consentVersion))) return false;
    consentRuntimeOverride = enabled;
    if (enabled) void retryPendingCloudSessions();
    return true;
  } catch {
    if (enabled && consentRevision === consentMutationVersion) consentRuntimeOverride = false;
    return false;
  }
}

export async function beginCloudSession(): Promise<string | null> {
  void retryPendingCloudSessions();
  const syncContext = await currentSyncContext();
  if (!syncContext || !await ensureDriverProfile(syncContext)) return null;
  const platform = Platform.OS;
  const detectorPipeline = platform === 'ios'
    ? 'ios_mlkit_eye_probability'
    : platform === 'android' ? 'android_mlkit_eye_probability' : null;
  const result = await backendApi<{ session?: { id?: string } }>('POST', '/api/sessions', {
    device: `${platform} ${String(Platform.Version)}`.slice(0, 120),
    browser: `Occulert native app (${platform})`,
    detector_pipeline: detectorPipeline,
    detector_version: 'mlkit-probability-perclos-1',
    app_version: formatAppBuildLabel(currentAppBuildInfo()),
  }, true, syncContext);
  const sessionId = result.ok ? result.body.session?.id || null : null;
  if (sessionId) cloudSessionScopes.set(sessionId, syncContext);
  return sessionId;
}

export async function logCloudAlert(sessionId: string, fatigueScore: number): Promise<boolean> {
  const syncContext = await currentSyncContext();
  if (!syncContext) return false;
  const result = await backendApi('POST', '/api/events', {
    session_id: sessionId,
    type: 'drowsy',
    fatigue_score: Math.max(0, Math.min(100, Math.round(fatigueScore))),
  }, true, syncContext);
  return result.ok;
}

function sendPendingSummary(scope: SummaryScope, entry: PendingSessionSummary) {
  return backendApi('PATCH', '/api/sessions', {
    session_id: entry.session_id, ended_at: entry.ended_at,
    average_fatigue: entry.average_fatigue, max_fatigue: entry.max_fatigue,
    safety_score: entry.safety_score, alert_count: entry.alert_count,
    head_nod_count: entry.head_nod_count,
  }, true, scope);
}

export interface PendingCloudSummaryState {
  scope: SummaryScope | null;
  count: number;
  localIds: string[];
}

export function pendingCloudSummaryStateIsCurrent(state: PendingCloudSummaryState): boolean {
  return Boolean(state.scope && authCache?.user.id === state.scope.ownerId
    && consentRuntimeOverride !== false && consentMutationVersion === state.scope.consentVersion);
}

export async function getPendingCloudSummaryState(): Promise<PendingCloudSummaryState> {
  const unavailable = (): PendingCloudSummaryState => ({scope:null,count:0,localIds:[]});
  try {
    return await withCloudReadDeadline(async () => {
      const scope = await currentSyncContext();
      if (!scope) return unavailable();
      const entries = await sessionOutbox.pendingEntries(scope);
      const result = {scope,count:entries.length,localIds:entries.flatMap(entry=>entry.local_session_id?[entry.local_session_id]:[])};
      return pendingCloudSummaryStateIsCurrent(result) ? result : unavailable();
    });
  } catch { return unavailable(); }
}

export async function retryPendingCloudSessions(expectedScope?: SummaryScope): Promise<void> {
  try {
    const scope = await currentSyncContext();
    if (!scope || expectedScope && (scope.ownerId !== expectedScope.ownerId || scope.consentVersion !== expectedScope.consentVersion)) return;
    await sessionOutbox.flush(scope, entry => sendPendingSummary(scope, entry));
  }
  catch { /* Preserve unreadable or unavailable storage for local recovery. */ }
}

export async function finishCloudSession(
  sessionId: string,
  stats: CloudSessionStats,
  endedAt = new Date().toISOString(),
  localSessionId?: string,
): Promise<boolean> {
  const sessionScope = cloudSessionScopes.get(sessionId);
  if (!sessionScope) return false;
  const syncContext = await currentSyncContext();
  if (!syncContext || sessionScope.ownerId !== syncContext.ownerId
    || sessionScope.consentVersion !== syncContext.consentVersion) {
    cloudSessionScopes.delete(sessionId);
    return false;
  }
  const metric = (value: number, max = 100) => Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : null;
  const entry: PendingSessionSummary = {
    session_id: sessionId, ended_at: endedAt, local_session_id: localSessionId,
    average_fatigue: metric(stats.averageFatigue), max_fatigue: metric(stats.maxFatigue),
    safety_score: metric(stats.safetyScore), alert_count: metric(stats.alertCount, 10000),
    // Candidate head-nod observations remain local until device validation.
    head_nod_count: 0,
  };
  try {
    if (!await sessionOutbox.enqueue(syncContext, entry)) return false;
    return (await sessionOutbox.flush(syncContext, item => sendPendingSummary(syncContext, item))).has(sessionId);
  } catch { return false; }
  finally { cloudSessionScopes.delete(sessionId); }
}
