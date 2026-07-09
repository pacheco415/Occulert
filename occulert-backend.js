// occulert-backend.js — browser client for the Occulert backend.
// Zero dependencies, matching the style of api/_lib/supabase.js.
// Include on any page that needs auth or backend calls:
//   <script src="/occulert-backend.js"></script>
//
// ONE VALUE TO FILL IN: the anon (public) key from
// Supabase Dashboard -> Project Settings -> API Keys -> Legacy -> anon.
// The anon key is designed to be public — safe to ship in client code.
//
// Auth: talks directly to Supabase GoTrue (email/password).
// Data: talks to this site's own /api/* endpoints with a Bearer token.

window.OcculertBackend = (function () {
  var SUPABASE_URL = "https://wbsynfcjpwlgdzioqpoa.supabase.co";
  var SUPABASE_ANON_KEY = "PASTE_ANON_KEY_HERE";
  var STORAGE_KEY = "occulert-auth";

  // ---------- session persistence ----------
  function loadAuth() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }
    catch (e) { return null; }
  }
  function saveAuth(data) {
    if (data) localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    else localStorage.removeItem(STORAGE_KEY);
  }

  // ---------- GoTrue helpers ----------
  function authFetch(path, body) {
    return fetch(SUPABASE_URL + "/auth/v1" + path, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); });
  }

  function persistFrom(resBody) {
    saveAuth({
      access_token: resBody.access_token,
      refresh_token: resBody.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (resBody.expires_in || 3600) - 60,
      user: resBody.user ? { id: resBody.user.id, email: resBody.user.email } : null
    });
  }

  // Sign up a new driver / fleet manager. May require email confirmation
  // depending on project settings ("Confirm email").
  function signUp(email, password) {
    return authFetch("/signup", { email: email, password: password }).then(function (r) {
      if (r.ok && r.body.access_token) persistFrom(r.body);
      return r;
    });
  }

  function signIn(email, password) {
    return authFetch("/token?grant_type=password", { email: email, password: password })
      .then(function (r) {
        if (r.ok) persistFrom(r.body);
        return r;
      });
  }

  function signOut() { saveAuth(null); }

  function refreshIfNeeded() {
    var auth = loadAuth();
    if (!auth) return Promise.resolve(null);
    if (auth.expires_at > Math.floor(Date.now() / 1000)) return Promise.resolve(auth);
    return authFetch("/token?grant_type=refresh_token", { refresh_token: auth.refresh_token })
      .then(function (r) {
        if (r.ok) { persistFrom(r.body); return loadAuth(); }
        saveAuth(null);
        return null;
      });
  }

  function currentUser() {
    var auth = loadAuth();
    return auth ? auth.user : null;
  }

  // ---------- backend API helpers ----------
  function api(method, path, body) {
    return refreshIfNeeded().then(function (auth) {
      var headers = { "Content-Type": "application/json" };
      if (auth) headers.Authorization = "Bearer " + auth.access_token;
      return fetch(path, {
        method: method,
        headers: headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
      }).then(function (r) {
        return r.json().then(function (j) { return { status: r.status, ok: r.ok, body: j }; });
      });
    });
  }

  // POST /api/sessions — call when monitoring starts. Returns session row.
  function startSession() {
    return api("POST", "/api/sessions", {
      device: navigator.platform || "unknown",
      browser: navigator.userAgent.slice(0, 120)
    });
  }

  // PATCH /api/sessions — call when monitoring stops.
  // stats: { average_fatigue, max_fatigue, safety_score, alert_count, head_nod_count }
  function endSession(sessionId, stats) {
    var body = Object.assign({ session_id: sessionId }, stats || {});
    return api("PATCH", "/api/sessions", body);
  }

  // POST /api/events — call on each alert. type must be one of:
  // drowsy | distracted | head_nod | yawn | phone_use | ok_check_in | emergency
  // Only include latitude/longitude if the driver opted into GPS.
  function logEvent(sessionId, type, extra) {
    var body = Object.assign({ session_id: sessionId, type: type }, extra || {});
    return api("POST", "/api/events", body);
  }

  // GET /api/fleet-summary — for fleet-dashboard.html (fleet owners only).
  // Returns { fleet, drivers, sessions }.
  function getFleetSummary() {
    return api("GET", "/api/fleet-summary");
  }

  return {
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    currentUser: currentUser,
    startSession: startSession,
    endSession: endSession,
    logEvent: logEvent,
    getFleetSummary: getFleetSummary
  };
})();
