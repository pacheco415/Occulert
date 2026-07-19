// Browser client for Supabase Auth and Occulert's authenticated /api routes.
// Runtime configuration comes from /api/public-config so no deploy-specific
// values or server secrets are committed to this file.

window.OcculertBackend = (function () {
  var STORAGE_KEY = "occulert-auth";
  var configPromise = null;

  function loadAuth() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }
    catch (e) { return null; }
  }

  function saveAuth(data) {
    try {
      if (data) localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      else localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  }

  function readJson(response) {
    return response.text().then(function (text) {
      if (!text) return {};
      try { return JSON.parse(text); }
      catch (e) { return { error: "invalid_json_response" }; }
    });
  }

  function loadConfig() {
    if (!configPromise) {
      configPromise = fetch("/api/public-config", { headers: { Accept: "application/json" }, cache: "no-store" })
        .then(function (response) { return readJson(response); })
        .then(function (body) {
          var config = body && body.supabase;
          return config && config.configured && config.url && config.anonKey ? config : null;
        })
        .catch(function () { return null; });
    }
    return configPromise;
  }

  function isConfigured() {
    return loadConfig().then(function (config) { return Boolean(config); });
  }

  function authFetch(path, body) {
    return loadConfig().then(function (config) {
      if (!config) return { status: 503, ok: false, body: { error: "cloud_not_configured" } };
      return fetch(config.url + "/auth/v1" + path, {
        method: "POST",
        headers: { apikey: config.anonKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(function (response) {
        return readJson(response).then(function (result) {
          return { status: response.status, ok: response.ok, body: result };
        });
      }).catch(function () {
        return { status: 503, ok: false, body: { error: "cloud_unavailable" } };
      });
    });
  }

  function persistFrom(body) {
    saveAuth({
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (body.expires_in || 3600) - 60,
      user: body.user ? { id: body.user.id, email: body.user.email } : null,
    });
  }

  function signUp(email, password) {
    return authFetch("/signup", { email: email, password: password }).then(function (result) {
      if (result.ok && result.body.access_token) persistFrom(result.body);
      return result;
    });
  }

  function signIn(email, password) {
    return authFetch("/token?grant_type=password", { email: email, password: password }).then(function (result) {
      if (result.ok && result.body.access_token) persistFrom(result.body);
      return result;
    });
  }

  function signOut() { saveAuth(null); }

  function refreshIfNeeded() {
    var auth = loadAuth();
    if (!auth) return Promise.resolve(null);
    if (auth.expires_at > Math.floor(Date.now() / 1000)) return Promise.resolve(auth);
    if (!auth.refresh_token) { saveAuth(null); return Promise.resolve(null); }
    return authFetch("/token?grant_type=refresh_token", { refresh_token: auth.refresh_token }).then(function (result) {
      if (result.ok && result.body.access_token) { persistFrom(result.body); return loadAuth(); }
      saveAuth(null);
      return null;
    });
  }

  function currentUser() {
    var auth = loadAuth();
    return auth ? auth.user : null;
  }

  function api(method, path, body) {
    return refreshIfNeeded().then(function (auth) {
      if (!auth || !auth.access_token) {
        return { status: 401, ok: false, body: { error: "sign_in_required" } };
      }
      var headers = { Accept: "application/json", "Content-Type": "application/json", Authorization: "Bearer " + auth.access_token };
      return fetch(path, {
        method: method,
        headers: headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }).then(function (response) {
        return readJson(response).then(function (result) {
          return { status: response.status, ok: response.ok, body: result };
        });
      }).catch(function () {
        return { status: 503, ok: false, body: { error: "cloud_unavailable" } };
      });
    });
  }

  function ensureDriverProfile(profile) {
    return api("POST", "/api/profile", {
      name: profile && profile.name,
      vehicle: profile && profile.vehicle,
    });
  }

  function startSession() {
    return api("POST", "/api/sessions", {
      device: navigator.platform || "unknown",
      browser: String(navigator.userAgent || "unknown").slice(0, 120),
    });
  }

  function endSession(sessionId, stats) {
    return api("PATCH", "/api/sessions", Object.assign({ session_id: sessionId }, stats || {}));
  }

  function logEvent(sessionId, type, extra) {
    return api("POST", "/api/events", Object.assign({ session_id: sessionId, type: type }, extra || {}));
  }

  function getFleetSummary() { return api("GET", "/api/fleet-summary"); }

  return {
    isConfigured: isConfigured,
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    currentUser: currentUser,
    ensureDriverProfile: ensureDriverProfile,
    startSession: startSession,
    endSession: endSession,
    logEvent: logEvent,
    getFleetSummary: getFleetSummary,
  };
})();
