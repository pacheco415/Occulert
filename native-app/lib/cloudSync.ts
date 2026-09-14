import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import { createSessionOutbox, type SessionUploadOutcome } from './sessionOutbox';
import { updateSessionHistory } from './sessionHistory';
import { Platform } from 'react-native';
import { createAsyncMutationQueue } from './asyncMutationQueue';
import { createCachedBooleanPreference } from './cachedBooleanPreference';

const API_BASE = 'https://www.occulert.com';
const AUTH_KEY = 'occulert.cloud.auth.v1';
const CONSENT_KEY = 'occulert-cloud-sync-enabled';
const REQUEST_TIMEOUT_MS = 8_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSIONED_SYNC_PATHS: Record<string, string> = {
  '/api/sessions': '/api/session-sync-v1',
  '/api/events': '/api/event-sync-v1',
};
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: 'com.occulert.app.cloud-auth',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

interface PublicConfig {
  sessionSyncVersion: number;
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
  fleet_sync_token?: string;
  session_cleanup_token?: string;
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

interface DriverProfileBody {
  driver?: {
    id?: string;
    fleet_sync_token?: string;
    session_cleanup_token?: string;
  };
}

interface ClearedAuth {
  auth: StoredAuth | null;
  cleanup: Promise<void>;
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
let consentRuntimeOverride: boolean | null = null;
let authCache: StoredAuth | null | undefined;
let authLoadPromise: Promise<StoredAuth | null> | null = null;
let authRefreshPromise: Promise<StoredAuth | null> | null = null;
let authMutationVersion = 0;
let fleetGrantRequestGeneration = 0;
const sessionOutbox = createSessionOutbox(AsyncStorage);
const sessionsWithUploadGaps = new Set<string>();
let sharingEpoch = 0;
let nextUploadAttempt = 0;
let uploadBackoff = 15_000;
const authStorageQueue = createAsyncMutationQueue();
const cloudSyncPreference = createCachedBooleanPreference(
  AsyncStorage,
  CONSENT_KEY,
  false,
);

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

async function loadConfig(forceRefresh = false): Promise<PublicConfig | null> {
  if (forceRefresh) configPromise = null;
  if (!configPromise) {
    configPromise = fetchWithTimeout(`${API_BASE}/api/public-config`, {
      headers: { Accept: 'application/json' },
    })
      .then(async response => {
        const body = await readJson<{
          supabase?: Partial<PublicConfig>;
          session_sync_version?: number;
        }>(response);
        const config = body.supabase;
        if (!response.ok || !config?.configured || !config.url || !config.anonKey) return null;
        return {
          configured: true,
          sessionSyncVersion: body.session_sync_version || 0,
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
    && typeof auth.user?.email === 'string'
    && (auth.fleet_sync_token === undefined
      || (typeof auth.fleet_sync_token === 'string' && UUID_PATTERN.test(auth.fleet_sync_token)))
    && (auth.session_cleanup_token === undefined
      || (typeof auth.session_cleanup_token === 'string' && UUID_PATTERN.test(auth.session_cleanup_token)));
}

async function loadAuth(): Promise<StoredAuth | null> {
  if (authCache !== undefined) return authCache;
  if (!authLoadPromise) {
    const readVersion = authMutationVersion;
    const pending = SecureStore.getItemAsync(AUTH_KEY, SECURE_OPTIONS)
      .then(raw => {
        if (readVersion !== authMutationVersion) return authCache ?? null;
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        authCache = validStoredAuth(parsed) ? parsed : null;
        return authCache;
      })
      .catch(() => {
        if (readVersion !== authMutationVersion) return authCache ?? null;
        // A transient keychain or JSON read failure must remain retryable.
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
    ...(previous?.fleet_sync_token ? { fleet_sync_token: previous.fleet_sync_token } : {}),
    ...(previous?.session_cleanup_token ? { session_cleanup_token: previous.session_cleanup_token } : {}),
  };
  return authStorageQueue.run(async () => {
    if (expectedVersion !== authMutationVersion) return null;
    await SecureStore.setItemAsync(AUTH_KEY, JSON.stringify(auth), SECURE_OPTIONS);
    if (expectedVersion !== authMutationVersion) return null;
    authMutationVersion += 1;
    authCache = auth;
    return auth;
  });
}

async function cancelPendingCloudSession(
  auth: StoredAuth | null,
  owner: string,
  sessionId: string,
  retry = true,
): Promise<boolean> {
  if (!auth || auth.user.id !== owner || !UUID_PATTERN.test(sessionId)) return false;
  try {
    const response = await fetchWithTimeout(`${API_BASE}/api/session-sync-v1`, {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${auth.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ session_id: sessionId }),
    });
    if (response.status === 401 && retry) {
      const refreshed = await authFetch('/token?grant_type=refresh_token', {
        refresh_token: auth.refresh_token,
      });
      if (refreshed.ok && refreshed.body.access_token) {
        return cancelPendingCloudSession({
          ...auth,
          access_token: refreshed.body.access_token,
          refresh_token: refreshed.body.refresh_token || auth.refresh_token,
        }, owner, sessionId, false);
      }
    }
    const body = await readJson<{ cancellation_recorded?: boolean }>(response);
    return response.ok && body.cancellation_recorded === true;
  } catch {
    return false;
  }
}

async function cancelPendingCloudSessionByToken(
  sessionId: string,
  cancelToken: string,
  cleanupToken: string,
): Promise<SessionUploadOutcome> {
  if (
    !UUID_PATTERN.test(sessionId)
    || !UUID_PATTERN.test(cancelToken)
    || !UUID_PATTERN.test(cleanupToken)
  ) return 'retry';
  try {
    const response = await fetchWithTimeout(`${API_BASE}/api/session-cancel-v1`, {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session_id: sessionId,
        cancel_token: cancelToken,
        cleanup_token: cleanupToken,
      }),
    });
    const body = await readJson<{ settled?: boolean; error?: string }>(response);
    if (response.ok && body.settled === true) return 'sent';
    if (response.status === 410 && body.error === 'cleanup_capability_expired') return 'discard';
    return 'retry';
  } catch {
    return 'retry';
  }
}

async function clearAuth(): Promise<ClearedAuth> {
  // Revoke the runtime before the first storage or network await. Durable
  // tombstones make any already accepted start cleanup retryable offline.
  consentRuntimeOverride = false;
  authMutationVersion += 1;
  fleetGrantRequestGeneration += 1;
  sharingEpoch += 1;
  sessionsWithUploadGaps.clear();
  const auth = await loadAuth();
  try {
    // Persist revocation first, then reduce pending payloads to cleanup-only
    // tombstones before erasing the active credential.
    await cloudSyncPreference.set(false);
    await sessionOutbox.clear();
    const cleanup = flushCloudUploads(auth).then(() => flushCloudUploads(auth));
    void cleanup.catch(() => {});
    await authStorageQueue.run(() => SecureStore.deleteItemAsync(AUTH_KEY, SECURE_OPTIONS));
    authCache = null;
    nextUploadAttempt = 0;
    uploadBackoff = 15_000;
    return { auth, cleanup };
  } catch {
    throw new Error('cloud_account_clear_not_persisted');
  }
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

async function refreshAuth(previous: StoredAuth, expectedVersion: number): Promise<StoredAuth | null> {
  const result = await authFetch('/token?grant_type=refresh_token', {
    refresh_token: previous.refresh_token,
  });
  if (result.ok) return saveAuth(result.body, previous, expectedVersion);
  if ((result.status === 400 || result.status === 401) && expectedVersion === authMutationVersion) {
    // Runtime access is revoked before durable storage is cleared. A failed
    // durable clear can retry on the next explicit account action.
    await clearAuth().catch(() => {});
  }
  return null;
}

async function refreshIfNeeded(force = false): Promise<StoredAuth | null> {
  const auth = await loadAuth();
  if (!auth) return null;
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
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body: Record<string, unknown>,
  retry = true,
  expectedOwner?: string,
  expectedSharingEpoch = sharingEpoch,
  requireSharing = Boolean(expectedOwner),
  markDispatched?: (cleanupToken?: string) => Promise<boolean>,
): Promise<ApiResult<T>> {
  const auth = await refreshIfNeeded();
  if (!auth) return { ok: false, status: 401, body: { error: 'sign_in_required' } as T & { error: string } };
  if (expectedOwner && auth.user.id !== expectedOwner) {
    return { ok: false, status: 409, body: { error: 'request_superseded' } as T & { error: string } };
  }
  if (requireSharing && (!await consentEnabled() || expectedSharingEpoch !== sharingEpoch)) {
    return { ok: false, status: 403, body: { error: 'sharing_stopped' } as T & { error: string } };
  }
  const requestAuthVersion = authMutationVersion;
  try {
    if (markDispatched && !await markDispatched()) {
      return { ok: false, status: 409, body: { error: 'request_superseded' } as T & { error: string } };
    }
    const response = await fetchWithTimeout(`${API_BASE}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${auth.access_token}`,
        'Content-Type': 'application/json',
      },
      body: method === 'GET' ? undefined : JSON.stringify(body),
    });
    if (response.status === 401 && retry) {
      const current = await loadAuth();
      if (
        requestAuthVersion !== authMutationVersion
        || current?.user.id !== auth.user.id
        || (expectedOwner && current.user.id !== expectedOwner)
        || (requireSharing && (!await consentEnabled() || expectedSharingEpoch !== sharingEpoch))
      ) {
        return { ok: false, status: 409, body: { error: 'request_superseded' } as T & { error: string } };
      }
      const refreshed = await refreshIfNeeded(true);
      if (!refreshed) {
        return { ok: false, status: 401, body: { error: 'sign_in_required' } as T & { error: string } };
      }
      return backendApi<T>(method, path, body, false, expectedOwner, expectedSharingEpoch, requireSharing, markDispatched);
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

function uploadOutcome(result: ApiResult<unknown>): SessionUploadOutcome {
  if (result.ok) return 'sent';
  // Same-owner retries return the existing row. This explicit conflict means
  // the stable ID belongs outside the authenticated driver's scope and can
  // never succeed on retry.
  if (result.status === 409 && (
    result.body.error === 'session_id_conflict'
    || result.body.error === 'event_id_conflict'
  )) return 'discard';
  if (
    result.status === 0
    || result.status === 401
    || result.status === 408
    || result.status === 409
    || result.status === 425
    || result.status === 429
    || result.status >= 500
  ) return 'retry';
  return 'discard';
}

async function storeDriverSyncTokens(
  owner: string,
  values: { fleet_sync_token?: unknown; session_cleanup_token?: unknown },
  expectedGeneration: number,
  expectedSharingEpoch: number,
): Promise<boolean> {
  const fleetToken = typeof values.fleet_sync_token === 'string'
    && UUID_PATTERN.test(values.fleet_sync_token) ? values.fleet_sync_token : null;
  const cleanupToken = typeof values.session_cleanup_token === 'string'
    && UUID_PATTERN.test(values.session_cleanup_token) ? values.session_cleanup_token : null;
  return authStorageQueue.run(async () => {
    if (expectedGeneration !== fleetGrantRequestGeneration || expectedSharingEpoch !== sharingEpoch) return false;
    const current = authCache;
    if (!current || current.user.id !== owner) return false;
    const updated: StoredAuth = { ...current };
    if (fleetToken) updated.fleet_sync_token = fleetToken;
    else delete updated.fleet_sync_token;
    // This capability is stable for the driver's lifetime. Preserve an
    // already stored value if an older profile route temporarily omits it.
    if (cleanupToken) updated.session_cleanup_token = cleanupToken;
    await SecureStore.setItemAsync(AUTH_KEY, JSON.stringify(updated), SECURE_OPTIONS);
    if (
      expectedGeneration !== fleetGrantRequestGeneration
      || expectedSharingEpoch !== sharingEpoch
      || authCache?.user.id !== owner
    ) return false;
    authMutationVersion += 1;
    authCache = updated;
    return true;
  });
}

async function requestDriverProfile(
  method: 'GET' | 'POST',
  owner: string,
  expectedEpoch = sharingEpoch,
  requireSharing = true,
): Promise<ApiResult<DriverProfileBody>> {
  const requestGeneration = ++fleetGrantRequestGeneration;
  const result = await backendApi<DriverProfileBody>(
    method, '/api/profile', {}, true, owner, expectedEpoch, requireSharing,
  );
  if (result.ok && !await storeDriverSyncTokens(
    owner,
    {
      fleet_sync_token: result.body.driver?.fleet_sync_token,
      session_cleanup_token: result.body.driver?.session_cleanup_token,
    },
    requestGeneration,
    expectedEpoch,
  )) {
    return {
      ok: false,
      status: 409,
      body: { ...result.body, error: 'profile_refresh_superseded' },
    };
  }
  return result;
}

async function ensureDriverProfile(): Promise<boolean> {
  const owner = (await loadAuth())?.user.id;
  if (!owner) return false;
  let result = await requestDriverProfile('GET', owner, sharingEpoch, false);
  if (result.status === 404 && result.body.error === 'driver_profile_not_found') {
    result = await requestDriverProfile('POST', owner, sharingEpoch, false);
  }
  return result.ok && Boolean(result.body.driver?.id);
}

export async function refreshCloudFleetGrant(): Promise<boolean> {
  const owner = (await loadAuth())?.user.id;
  if (!owner || !await consentEnabled()) return true;
  const result = await requestDriverProfile('GET', owner);
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
  // Account replacement always revokes the previous account's upload consent.
  try {
    await clearAuth();
  } catch {
    return {
      ok: false,
      message: 'Occulert could not finish clearing the previous cloud account. Try again before signing in.',
    };
  }
  const signInVersion = authMutationVersion;
  const result = await authFetch('/token?grant_type=password', {
    email: normalizedEmail,
    password,
  });
  if (!result.ok || !await saveAuth(result.body, null, signInVersion)) {
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
  const { auth, cleanup } = await clearAuth();
  if (auth) {
    cleanup.catch(() => {}).then(() => loadConfig()).then(config => {
      if (!config) return;
      return fetchWithTimeout(`${config.url}/auth/v1/logout`, {
        method: 'POST',
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${auth.access_token}`,
        },
      });
    }).catch(() => {
      // Local account removal remains the sign-out source of truth when
      // server-side token revocation is temporarily offline.
    });
  }
}

export async function setCloudSyncEnabled(enabled: boolean): Promise<boolean> {
  if (!enabled) {
    consentRuntimeOverride = false;
    fleetGrantRequestGeneration += 1;
    sharingEpoch += 1;
    sessionsWithUploadGaps.clear();
    const auth = await loadAuth();
    try {
      await cloudSyncPreference.set(false);
      await sessionOutbox.clear();
      const cleanup = flushCloudUploads(auth).then(() => flushCloudUploads(auth));
      void cleanup.catch(() => {});
      nextUploadAttempt = 0;
      uploadBackoff = 15_000;
    } catch {
      // If consent revocation cannot be persisted, remove the local sign-in as
      // a privacy-preserving fallback so a later launch cannot resume uploads.
      await clearAuth().catch(() => {});
      return false;
    }
    return true;
  }
  if (!await refreshIfNeeded()) return false;
  try {
    await cloudSyncPreference.set(true);
    consentRuntimeOverride = true;
    // Refresh the server-issued fleet membership token before the next drive.
    // A failure keeps owner-only sync available and cannot broaden sharing.
    await ensureDriverProfile().catch(() => false);
    return true;
  } catch {
    consentRuntimeOverride = false;
    return false;
  }
}

async function sendOutboxRequest(
  owner: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body: Record<string, unknown>,
  cleanupAuth?: StoredAuth | null,
  markDispatched?: (cleanupToken?: string) => Promise<boolean>,
): Promise<SessionUploadOutcome> {
    if (method === 'DELETE' && path === '/api/session-cancel-v1') {
      return cancelPendingCloudSessionByToken(
        String(body.session_id || ''),
        String(body.cancel_token || ''),
        String(body.cleanup_token || ''),
      );
    }
    if (method === 'DELETE' && path === '/api/sessions') {
      const auth = cleanupAuth === undefined ? await loadAuth() : cleanupAuth;
      return await cancelPendingCloudSession(auth, owner, String(body.session_id || ''))
        ? 'sent'
        : 'retry';
    }
    const version = sharingEpoch;
    const auth = await loadAuth();
    if (auth?.user.id !== owner || !await consentEnabled() || version !== sharingEpoch) return 'retry';
    const sessionCreate = method === 'POST' && path === '/api/sessions';
    let cleanupToken: string | undefined;
    // Recheck the server capability immediately before each create. A web
    // rollback must stop old endpoints from replacing the client session ID.
    const config = await loadConfig(sessionCreate);
    // Older APIs ignore client IDs; wait for the compatible backend instead of duplicating sessions.
    if (config?.sessionSyncVersion !== 1) {
      configPromise = null;
      nextUploadAttempt = Date.now() + 60_000;
      return 'retry';
    }
    if (sessionCreate) {
      let profile = await requestDriverProfile('GET', owner, version);
      if (profile.status === 404 && profile.body.error === 'driver_profile_not_found') {
        profile = await requestDriverProfile('POST', owner, version);
      }
      if (!profile.ok) {
        if (profile.status === 405 && profile.body.error === 'method_not_allowed') {
          configPromise = null;
          nextUploadAttempt = Date.now() + 60_000;
          return 'retry';
        }
        const outcome = uploadOutcome(profile);
        if (outcome === 'retry') nextUploadAttempt = Date.now() + 60_000;
        return outcome;
      }
      const currentAuth = await loadAuth();
      if (
        currentAuth?.user.id !== owner
        || !currentAuth.session_cleanup_token
        || version !== sharingEpoch
      ) {
        configPromise = null;
        nextUploadAttempt = Date.now() + 60_000;
        return 'retry';
      }
      cleanupToken = currentAuth.session_cleanup_token;
    }
    // Versioned routes make the compatibility check atomic with deployment:
    // after a rollback these routes disappear instead of accepting unstable IDs.
    const uploadPath = VERSIONED_SYNC_PATHS[path] || path;
    const result = await backendApi<{
      session?: { id?: string };
      event?: { id?: string };
      deleted?: boolean;
      cancellation_recorded?: boolean;
    }>(
      method,
      uploadPath,
      body,
      true,
      owner,
      version,
      true,
      sessionCreate && markDispatched ? () => markDispatched(cleanupToken) : undefined,
    );
    const versionedPath = uploadPath !== path;
    if (versionedPath && result.status === 404 && result.body.error !== 'session_not_found') {
      nextUploadAttempt = Date.now() + 60_000;
      return 'retry';
    }
    if (result.ok && method === 'DELETE' && path === '/api/sessions' && result.body.cancellation_recorded !== true) {
      nextUploadAttempt = Date.now() + 60_000;
      return 'retry';
    }
    if (result.ok && method === 'POST') {
      const expectedId = sessionCreate ? body.client_session_id : body.client_event_id;
      const returnedId = sessionCreate ? result.body.session?.id : result.body.event?.id;
      if (typeof expectedId === 'string' && returnedId !== expectedId) {
        if (sessionCreate) {
          if (typeof returnedId !== 'string') {
            nextUploadAttempt = Date.now() + 60_000;
            return 'retry';
          }
          return { cleanupIds: [...new Set([String(expectedId), returnedId])] };
        }
        if (typeof returnedId !== 'string') {
          nextUploadAttempt = Date.now() + 60_000;
          return 'retry';
        }
        return 'discard';
      }
    }
    const outcome = uploadOutcome(result);
    if (outcome === 'retry') {
      nextUploadAttempt = Date.now() + uploadBackoff;
      uploadBackoff = Math.min(300_000, uploadBackoff * 2);
    } else {
      nextUploadAttempt = 0;
      uploadBackoff = 15_000;
    }
    return outcome;
}

async function flushCloudUploads(cleanupAuth?: StoredAuth | null): Promise<void> {
  await sessionOutbox.flush((owner, method, path, body, markDispatched) => (
    sendOutboxRequest(owner, method, path, body, cleanupAuth, markDispatched)
  ), async (localId, cloudId, partial) => {
    await updateSessionHistory<Record<string, unknown>>(rows => rows.map(row =>
      row.sessionId === localId ? {
        ...row,
        cloudSynced: !partial,
        cloudSyncNeedsReview: partial,
        cloudSessionId: cloudId,
      } : row));
  }, async (localId, cloudId) => {
    await updateSessionHistory<Record<string, unknown>>(rows => rows.map(row =>
      row.sessionId === localId ? {
        ...row,
        cloudSynced: false,
        cloudSyncNeedsReview: true,
        cloudSessionId: cloudId,
      } : row));
  });
}

export async function retryCloudUploads(force = false): Promise<void> {
  if (!force && Date.now() < nextUploadAttempt) return;
  if (force) configPromise = null;
  await flushCloudUploads();
}

export async function pendingCloudSessionIds(): Promise<string[]> {
  return (await sessionOutbox.list()).flatMap(row => (
    !row.abandoned && !row.cleanupId && !row.cleanupIds?.length && row.localSessionId
      ? [row.localSessionId]
      : []
  ));
}

export async function beginCloudSession(): Promise<string | null> {
  const startedAt = new Date().toISOString();
  const version = sharingEpoch;
  const auth = await loadAuth();
  if (!auth || !await consentEnabled() || version !== sharingEpoch) return null;
  const id = randomUUID();
  const cancelToken = randomUUID();
  try {
    const saved = await sessionOutbox.add({
      id,
      owner: auth.user.id,
      cancelToken,
      cleanupToken: auth.session_cleanup_token,
      created: false,
      events: [],
      start: {
        client_session_id: id,
        cancel_token: cancelToken,
        started_at: startedAt,
        fleet_sync_token: auth.fleet_sync_token || null,
        device: `${Platform.OS} ${String(Platform.Version)}`.slice(0, 120),
        browser: `Occulert native app (${Platform.OS})`,
      },
    }, async () => version === sharingEpoch && await consentEnabled() && (await loadAuth())?.user.id === auth.user.id);
    if (!saved) return null;
    // This token is captured before monitoring begins and never changes for
    // the queued session. Foreground and pre-drive refreshes prepare it; a
    // stale token fails closed to owner-only history.
    void retryCloudUploads().catch(() => {});
    return id;
  } catch { return null; }
}

export async function logCloudAlert(sessionId: string, fatigueScore: number): Promise<boolean> {
  const createdAt = new Date().toISOString();
  if (!await consentEnabled()) return false;
  const id = randomUUID();
  try {
    const saved = await sessionOutbox.event(sessionId, { id, body: {
      client_event_id: id,
      session_id: sessionId,
      type: 'drowsy',
      fatigue_score: Math.max(0, Math.min(100, Math.round(fatigueScore))),
      created_at: createdAt,
    } });
    if (!saved) {
      sessionsWithUploadGaps.add(sessionId);
      await sessionOutbox.markPartial(sessionId);
    }
    void retryCloudUploads().catch(() => {});
    return saved;
  } catch {
    sessionsWithUploadGaps.add(sessionId);
    await sessionOutbox.markPartial(sessionId).catch(() => {});
    return false;
  }
}

export async function finishCloudSession(
  sessionId: string,
  stats: CloudSessionStats,
  localSessionId?: string,
  endedAt = new Date().toISOString(),
): Promise<boolean> {
  if (!await consentEnabled()) return false;
  try {
    const queued = await sessionOutbox.finish(sessionId, {
      session_id: sessionId,
      ended_at: endedAt,
      average_fatigue: stats.averageFatigue,
      max_fatigue: stats.maxFatigue,
      safety_score: stats.safetyScore,
      alert_count: stats.alertCount,
      // Candidate head-nod observations remain local until device validation.
      head_nod_count: 0,
    }, localSessionId, sessionsWithUploadGaps.has(sessionId));
    if (queued) sessionsWithUploadGaps.delete(sessionId);
    if (queued) void retryCloudUploads().catch(() => {});
    return queued;
  } catch { return false; }
}
