// Browser client for Supabase Auth and Occulert's authenticated /api routes.
// Runtime configuration comes from /api/public-config so no deploy-specific
// values or server secrets are committed to this file.

window.OcculertBackend = (function () {
  var STORAGE_KEY = "occulert-auth";
  var configPromise = null;
  var authRevision = 0;
  var localAuthRevision = 0;
  var authLifecycleRevision = 0;
  var completedAttempts = new WeakMap();
  var localAuthRevoked = false;
  var CONFIG_TIMEOUT_MS = 8000;

  function loadAuth() {
    if (localAuthRevoked) return null;
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }
    catch (e) { return null; }
  }

  function saveAuth(data, internalRefresh) {
    var previous = loadAuth();
    authRevision += 1;
    if (!internalRefresh) { localAuthRevision += 1; authLifecycleRevision += 1; }
    try {
      if (!data) localStorage.removeItem(STORAGE_KEY);
      if (!data || !previous || !previous.user || !data.user || previous.user.id !== data.user.id) {
        localStorage.removeItem("occulert-cloud-outbox");
      }
      if (data) localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      else localStorage.removeItem(STORAGE_KEY);
      localAuthRevoked = false;
    } catch (e) { if (!data) localAuthRevoked = true; }
  }

  function readJson(response) {
    return response.text().then(function (text) {
      if (!text) return {};
      try { return JSON.parse(text); }
      catch (e) { return { error: "invalid_json_response" }; }
    });
  }

  // One absolute deadline covers both headers and the complete response body.
  // Explicit settlement also bounds transports that ignore AbortSignal.
  function boundedRequest(url, options, read, authorize) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var controller = typeof AbortController === "function" ? new AbortController() : null;
      var externalSignal = options && options.signal || url && url.signal;
      var timer = setTimeout(function () {
        finish(refreshError("cloud_unavailable"));
        if (controller) controller.abort();
      }, CONFIG_TIMEOUT_MS);
      function finish(error, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (externalSignal) externalSignal.removeEventListener("abort", cancel);
        if (error) reject(error); else resolve(value);
      }
      function cancel() {
        var error = new Error("The account request was cancelled.");
        error.name = "AbortError";
        finish(error);
        if (controller) controller.abort();
      }
      if (externalSignal) {
        if (externalSignal.aborted) cancel();
        else externalSignal.addEventListener("abort", cancel, { once: true });
      }
      Promise.resolve().then(function () {
        if (settled) return;
        if (authorize) authorize();
        return fetch(url, Object.assign({}, options || {}, { signal: controller ? controller.signal : undefined }));
      }).then(function (response) {
        if (settled) return;
        return read(response);
      }).then(function (value) { finish(null, value); }, function (error) { finish(error); });
    });
  }

  function requestJson(url, options, authorize) {
    return boundedRequest(url, options, function (response) {
      return readJson(response).then(function (body) { return { status: response.status, ok: response.ok, body: body }; });
    }, authorize);
  }

  // Supabase's SDK receives the original response, including its native URL
  // and headers, only after a clone proves its body is complete.
  function fetchWithDeadline(url, options) {
    return boundedRequest(url, options, function (response) {
      return response.clone().arrayBuffer().then(function () { return response; });
    });
  }

  // Unlike token revisions, this identity survives a routine refresh but not
  // sign-out, reauthentication, or an auth storage change in another tab.
  function captureAuthLifecycle() {
    var user = currentUser();
    return Object.freeze({ revision: authLifecycleRevision, ownerId: user && user.id });
  }

  function isAuthLifecycleCurrent(context) {
    var user = currentUser();
    return Boolean(context && user && context.ownerId === user.id && context.revision === authLifecycleRevision);
  }

  function captureAuthContext() {
    return Object.freeze({ revision: authRevision, auth: loadAuth() });
  }

  function isAuthContextCurrent(context) {
    var stored = loadAuth();
    return Boolean(context && context.revision === authRevision
      && ((!context.auth && !stored) || sameAuth(context.auth, stored)));
  }

  function requireAuthContext(context) {
    if (!isAuthContextCurrent(context)) throw refreshError("auth_session_changed");
  }

  function beginAuthAttempt() {
    authRevision += 1;
    localAuthRevision += 1;
    authLifecycleRevision += 1;
    return captureAuthContext();
  }

  async function beginAuthLinkAttempt() {
    var context = captureAuthContext();
    // Capture our refresh at settlement, before another action can start.
    await refreshIfNeeded(function (refreshedContext) { context = refreshedContext; });
    requireAuthContext(context);
    return beginAuthAttempt();
  }

  if (window.addEventListener) window.addEventListener("storage", function (event) {
    if (event.key === STORAGE_KEY || event.key === null) { authRevision += 1; authLifecycleRevision += 1; }
  });

  function completedAuthContext(attempt) {
    var context = attempt && completedAttempts.get(attempt);
    requireAuthContext(context);
    return context;
  }

  function loadConfig() {
    if (!configPromise) {
      var attempt = new Promise(function (resolve) {
        var settled = false;
        var controller = typeof AbortController === "function" ? new AbortController() : null;
        var timer = setTimeout(function () {
          finish(null);
          if (controller) controller.abort();
        }, CONFIG_TIMEOUT_MS);
        function finish(config) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(config);
        }
        Promise.resolve().then(function () {
          return fetch("/api/public-config", { headers: { Accept: "application/json" }, cache: "no-store", signal: controller ? controller.signal : undefined });
        }).then(readJson).then(function (body) {
          var config = body && body.supabase;
          finish(config && config.configured && config.url && config.anonKey ? config : null);
        }).catch(function () { finish(null); });
      });
      configPromise = attempt;
      // Failed or timed-out configuration must be retried. An abandoned
      // attempt cannot clear a replacement started by refreshAuthConfig.
      attempt.then(function (config) { if (!config && configPromise === attempt) configPromise = null; });
    }
    return configPromise;
  }

  function isConfigured() {
    return loadConfig().then(function (config) { return Boolean(config); });
  }

  function refreshAuthConfig() {
    configPromise = null;
    return loadConfig();
  }

  function authFetch(path, body, context) {
    return loadConfig().then(function (config) {
      if (context) requireAuthContext(context);
      if (!config) return { status: 503, ok: false, body: { error: "cloud_not_configured" } };
      return requestJson(config.url + "/auth/v1" + path, {
        method: "POST",
        headers: { apikey: config.anonKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(function () {
        return { status: 503, ok: false, body: { error: "cloud_unavailable" } };
      });
    });
  }

  function authErrorText(result) {
    var body = result && result.body ? result.body : (result || {});
    return [body.code, body.error_code, body.error, body.msg, body.message]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function isEmailRateLimited(result) {
    var text = authErrorText(result);
    return text.indexOf("rate limit") >= 0 || text.indexOf("over_email_send_rate_limit") >= 0 || text.indexOf("email_rate_limit_exceeded") >= 0;
  }

  function needsSignupConfirmation(result) {
    var text = authErrorText(result);
    return text.indexOf("email_not_confirmed") >= 0 || text.indexOf("email not confirmed") >= 0;
  }

  function authMessage(result, mode) {
    var text = authErrorText(result);
    if (text.indexOf("auth_session_changed") >= 0) return "Your signed-in account changed. Start this action again.";
    if (isEmailRateLimited(result)) return "Too many confirmation emails were requested. Wait about an hour, then try Create Account once.";
    if (text.indexOf("user_already_exists") >= 0 || text.indexOf("email_exists") >= 0 || text.indexOf("already registered") >= 0) return "An account already exists for this email. Use Sign In instead.";
    if (text.indexOf("invalid_credentials") >= 0 || text.indexOf("invalid login credentials") >= 0) return "Email or password is incorrect.";
    if (needsSignupConfirmation(result)) return "Confirm your email, then return and sign in.";
    if (text.indexOf("weak_password") >= 0 || text.indexOf("password should be") >= 0) return "Use a password with at least 8 characters.";
    if (text.indexOf("signup_disabled") >= 0 || text.indexOf("signups not allowed") >= 0) return "New account creation is temporarily unavailable.";
    if (text.indexOf("cloud_not_configured") >= 0) return "Cloud sign-in is not configured yet. The Driver App is still available in local-only mode.";
    if (text.indexOf("cloud_unavailable") >= 0) return "Occulert could not reach the sign-in service. Check your connection and try again.";
    return mode === "signup" ? "The account could not be created. Please try again." : "Sign-in failed. Check your email and password, then try again.";
  }

  function adoptSession(body, context, internalRefresh) {
    if (context) requireAuthContext(context);
    if (!body || !body.access_token || !body.refresh_token || !body.user || !body.user.id) return null;
    var expiresAt = Number(body.expires_at);
    if (!Number.isFinite(expiresAt)) {
      expiresAt = Math.floor(Date.now() / 1000) + (Number(body.expires_in) || 3600) - 60;
    }
    saveAuth({
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_at: expiresAt,
      user: body.user ? { id: body.user.id, email: body.user.email } : null,
    }, internalRefresh);
    var saved = loadAuth();
    if (!saved || saved.access_token !== body.access_token || saved.refresh_token !== body.refresh_token
      || !saved.user || saved.user.id !== body.user.id) return null;
    if (context) completedAttempts.set(context, captureAuthContext());
    return saved;
  }

  function persistFrom(body) {
    adoptSession(body, null, true);
  }

  // Email links carry a whole session in the URL fragment and can be forwarded
  // from anyone's account. Remember the email this browser asked for; other
  // links wait for an explicit Continue (docs/EMAIL_LINK_CONFIRMATION.md).
  var LINK_KEY = "occulert-auth-link-requests", LINK_TTL = { recovery: 3600000, signin: 86400000 };
  function linkGroup(type) { return type === "recovery" ? type : ["magiclink", "signup", "signin"].indexOf(type) >= 0 ? "signin" : null; }
  function linkRequests() {
    try { var value = JSON.parse(localStorage.getItem(LINK_KEY) || "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
    catch (e) { return {}; }
  }
  function saveLinkRequests(value) {
    try { if (Object.keys(value).length) localStorage.setItem(LINK_KEY, JSON.stringify(value)); else localStorage.removeItem(LINK_KEY); } catch (e) {}
  }
  function recordAuthLinkRequest(type, email) {
    var group = linkGroup(type), address = String(email || "").trim().toLowerCase(), value = linkRequests();
    if (!group || !address) return;
    value[group] = { email: address, created_at: Date.now() };
    saveLinkRequests(value);
  }
  function clearAuthLinkRequest(type) {
    var value = linkRequests(), group = linkGroup(type);
    if (!group || !Object.prototype.hasOwnProperty.call(value, group)) return;
    delete value[group];
    saveLinkRequests(value);
  }
  // Local intent is required even for a link to the current account.
  function authLinkNeedsConfirmation(type, user) {
    var current = loadAuth(), group = linkGroup(type), entry = group && linkRequests()[group], age;
    if (!group || !user || typeof user.id !== "string" || !user.id || typeof user.email !== "string" || !user.email.trim()) return true;
    if (current && current.user && current.user.id !== user.id) return true;
    age = entry ? Date.now() - entry.created_at : NaN;
    return !(entry && typeof entry.created_at === "number" && Number.isFinite(age)
      && entry.email === user.email.trim().toLowerCase() && age >= 0 && age < LINK_TTL[group]);
  }
  // Tokens stay in memory until Continue, which fails if this browser's
  // account changed while the confirmation was shown.
  function pendingLinkConfirmation(user, adopt) {
    var shown = captureAuthContext(), settled = false;
    return { needsConfirmation: true, email: String(user && user.email || ""), cancel: function () { settled = true; },
      confirm: function () {
        return Promise.resolve().then(function () {
          if (settled) throw refreshError("auth_session_changed");
          requireAuthContext(shown);
          settled = true;
          return adopt(beginAuthAttempt());
        });
      } };
  }

  function signupConfirmationRedirect() {
    try {
      if (window.location && window.location.origin) {
        return "?redirect_to=" + encodeURIComponent(window.location.origin + "/login.html");
      }
    } catch (e) {}
    return "";
  }

  function signUp(email, password, context) {
    context = context || beginAuthAttempt();
    recordAuthLinkRequest("signup", email);
    return authFetch("/signup" + signupConfirmationRedirect(), { email: email, password: password }, context).then(function (result) {
      requireAuthContext(context);
      if (result.ok && result.body.access_token && !adoptSession(result.body, context)) throw refreshError("cloud_unavailable");
      return result;
    }).catch(failedAuthRequest);
  }

  function resendSignupConfirmation(email) {
    recordAuthLinkRequest("signup", email);
    return authFetch("/resend" + signupConfirmationRedirect(), { type: "signup", email: email });
  }

  function resendConfirmationMessage(result) {
    var text = authErrorText(result);
    if (isEmailRateLimited(result)) return "Too many confirmation emails were requested. Wait about an hour, then try Resend Confirmation once.";
    if (text.indexOf("invalid") >= 0 && text.indexOf("email") >= 0) return "Enter the exact invited email address, then try again.";
    if (text.indexOf("cloud_not_configured") >= 0) return "Cloud accounts are not configured yet, so a confirmation email cannot be sent.";
    if (text.indexOf("cloud_unavailable") >= 0) return "Occulert could not reach the account service. Check your connection and try again.";
    return "The confirmation email could not be resent. Try again later, or use Forgot Password if this address already has an account.";
  }

  function signIn(email, password, context) {
    context = context || beginAuthAttempt();
    return authFetch("/token?grant_type=password", { email: email, password: password }, context).then(function (result) {
      requireAuthContext(context);
      if (result.ok && result.body.access_token && !adoptSession(result.body, context)) throw refreshError("cloud_unavailable");
      return result;
    }).catch(failedAuthRequest);
  }

  function passwordResetRedirect() {
    try {
      if (window.location && window.location.origin) {
        return "?redirect_to=" + encodeURIComponent(window.location.origin + "/account.html?recovery=1");
      }
    } catch (e) {}
    return "";
  }

  function requestPasswordReset(email) {
    recordAuthLinkRequest("recovery", email);
    return authFetch("/recover" + passwordResetRedirect(), { email: email });
  }

  function passwordResetMessage(result) {
    var text = authErrorText(result);
    if (isEmailRateLimited(result)) return "Too many password reset emails were requested. Wait about an hour, then try once more.";
    if (text.indexOf("expired") >= 0 || text.indexOf("invalid") >= 0) return "This password reset link is invalid or expired. Request a new link from the sign-in page.";
    if (text.indexOf("cloud_not_configured") >= 0) return "Cloud accounts are not configured yet, so a reset email cannot be sent.";
    if (text.indexOf("cloud_unavailable") >= 0) return "Occulert could not reach the account service. Check your connection and try again.";
    return "The password reset request could not be completed. Please try again.";
  }

  // Supabase recovery links return short-lived session tokens in the URL
  // fragment. Consume them only for password recovery, remove the fragment
  // immediately, and verify the user before storing the temporary session.
  async function consumeAuthRedirect() {
    var hash = "";
    try { hash = window.location && window.location.hash ? window.location.hash : ""; }
    catch (e) {}
    if (!hash) return Promise.resolve({ handled: false, ok: false, body: {} });

    var params;
    try { params = new URLSearchParams(hash.slice(1)); }
    catch (e) { return Promise.resolve({ handled: true, ok: false, body: { error: "invalid_recovery_link" } }); }
    if (params.get("type") !== "recovery" && !params.get("error")) {
      return Promise.resolve({ handled: false, ok: false, body: {} });
    }

    try {
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, "", (window.location.pathname || "/account.html") + (window.location.search || ""));
      }
    } catch (e) {}

    var error = params.get("error_description") || params.get("error");
    var accessToken = params.get("access_token");
    var refreshToken = params.get("refresh_token");
    if (error || !accessToken || !refreshToken) {
      return Promise.resolve({ handled: true, ok: false, body: { error: error || "invalid_recovery_link" } });
    }

    var context;
    try { context = await beginAuthLinkAttempt(); }
    catch (error) { return Object.assign({ handled: true }, failedAuthRequest(error)); }

    var expiresAt = Number(params.get("expires_at"));
    if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
      expiresAt = Math.floor(Date.now() / 1000) + (Number(params.get("expires_in")) || 3600) - 60;
    }
    return loadConfig().then(function (config) {
      requireAuthContext(context);
      if (!config) return { handled: true, status: 503, ok: false, body: { error: "cloud_not_configured" } };
      return requestJson(config.url + "/auth/v1/user", {
        method: "GET",
        headers: { apikey: config.anonKey, Authorization: "Bearer " + accessToken, Accept: "application/json" },
      }).then(function (result) {
          requireAuthContext(context);
          var body = result.body;
          if (!(result.ok && body && body.id && typeof body.email === "string" && body.email.trim())) return { handled: true, status: result.status, ok: false, body: body };
          var user = { id: body.id, email: body.email || "" };
          var adopt = function (attempt) {
            if (expiresAt <= Math.floor(Date.now() / 1000)) throw refreshError("cloud_unavailable");
            var saved = adoptSession({ access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt, user: user }, attempt);
            if (!saved || saved.expires_at !== expiresAt || saved.expires_at <= Math.floor(Date.now() / 1000)) throw refreshError("cloud_unavailable");
            clearAuthLinkRequest("recovery");
            return { handled: true, status: result.status, ok: true, body: body };
          };
          if (!authLinkNeedsConfirmation("recovery", user)) return adopt(context);
          // Never switch the signed-in account to an unrequested reset link silently.
          var pending = pendingLinkConfirmation(user, adopt), confirm = pending.confirm;
          pending.confirm = function () { return confirm().catch(function (error) { return Object.assign({ handled: true }, failedAuthRequest(error)); }); };
          return Object.assign({ handled: true, status: result.status, ok: false, body: { error: "link_confirmation_required" } }, pending);
      });
    }).catch(function (error) { return Object.assign({ handled: true }, failedAuthRequest(error)); });
  }

  function signOut() {
    var auth = loadAuth();
    try { localStorage.removeItem(LINK_KEY); } catch (e) {}
    saveAuth(null);
    if (!auth || !auth.access_token) return;
    // Revoke only this captured session. Never persist a revocation refresh or
    // consult current auth: a newer sign-in must remain independent.
    loadConfig().then(async function (config) {
      if (!config) return;
      var token = auth.access_token;
      if (!(auth.expires_at > Math.floor(Date.now() / 1000))) {
        if (!auth.refresh_token || !auth.user || !auth.user.id) return;
        var result = await requestJson(config.url + "/auth/v1/token?grant_type=refresh_token", {
          method: "POST", keepalive: true, redirect: "error",
          headers: { apikey: config.anonKey, "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: auth.refresh_token }),
        });
        var body = result.body;
        if (!result.ok || !body || !body.user || body.user.id !== auth.user.id
          || typeof body.expires_in !== "number" || !Number.isFinite(body.expires_in) || body.expires_in <= 0) return;
        token = body.access_token;
      }
      if (typeof token !== "string" || !token || /[\x00-\x20\x7f-\uffff]/.test(token)) return;
      return requestJson(config.url + "/auth/v1/logout?scope=local", {
        method: "POST", keepalive: true, redirect: "error",
        headers: { apikey: config.anonKey, Authorization: "Bearer " + token },
      });
    }).catch(function () {});
  }

  function sameAuth(left, right) {
    return Boolean(left && right
      && left.access_token === right.access_token
      && left.refresh_token === right.refresh_token
      && left.expires_at === right.expires_at
      && left.user && right.user && left.user.id === right.user.id);
  }

  function refreshError(code) {
    var error = new Error(code === "auth_session_changed"
      ? "Your signed-in account changed. Refresh protected data and try again."
      : "The account service could not be reached. Check your connection and try again.");
    error.code = code;
    return error;
  }

  // One refresh per refresh token in this tab, shared by every concurrent
  // caller, started a minute before expiry. Across tabs a Web Lock serializes
  // refreshes; the holder re-reads storage so another tab's new session is reused.
  var REFRESH_MARGIN = 60, refreshFlight = null;
  function refreshIfNeeded(onRefresh) {
    var auth = loadAuth();
    if (!auth) return Promise.resolve(null);
    if (auth.expires_at > Math.floor(Date.now() / 1000) + REFRESH_MARGIN) return Promise.resolve(auth);
    if (!auth.refresh_token) {
      saveAuth(null);
      if (typeof onRefresh === "function") onRefresh(captureAuthContext());
      return Promise.resolve(null);
    }
    if (!refreshFlight || refreshFlight.token !== auth.refresh_token) {
      var flight = { token: auth.refresh_token, localRevision: localAuthRevision, listeners: [] }, done = function () { if (refreshFlight === flight) refreshFlight = null; };
      flight.promise = withRefreshLock(function () { return refreshSession(auth, flight); });
      flight.promise.then(done, done);
      refreshFlight = flight;
    }
    if (typeof onRefresh === "function") refreshFlight.listeners.push(onRefresh);
    return refreshFlight.promise;
  }

  function withRefreshLock(task) {
    var locks = typeof navigator !== "undefined" && navigator.locks, ran = false;
    if (!locks || typeof locks.request !== "function") return task();
    return Promise.resolve().then(function () {
      return locks.request("occulert-auth-refresh", function () { ran = true; return task(); });
    }).catch(function (error) { if (ran) throw error; return task(); });
  }

  function refreshSession(auth, flight) {
    // Local sign-in/sign-out actions must still win while this refresh waits
    // for the lock. Storage events alone may represent another tab's refresh.
    if (flight.localRevision !== localAuthRevision) return Promise.reject(refreshError("auth_session_changed"));
    var notify = function () { flight.listeners.forEach(function (listener) { listener(captureAuthContext()); }); };
    var latest = loadAuth();
    if (!sameAuth(auth, latest)) {
      // Waiting for the lock: another tab may have stored this user's next session.
      if (!latest || !latest.user || !auth.user || latest.user.id !== auth.user.id || !latest.refresh_token) return Promise.reject(refreshError("auth_session_changed"));
      if (latest.expires_at > Math.floor(Date.now() / 1000) + REFRESH_MARGIN) { notify(); return Promise.resolve(latest); }
      auth = latest;
    }
    var revision = authRevision;
    return authFetch("/token?grant_type=refresh_token", { refresh_token: auth.refresh_token }).then(function (result) {
      // A newer sign-in, sign-out or tab may replace this session in flight.
      if (revision !== authRevision || !sameAuth(auth, loadAuth())) {
        throw refreshError("auth_session_changed");
      }
      if (result.ok && result.body && typeof result.body.access_token === "string" && result.body.access_token
        && typeof result.body.refresh_token === "string" && result.body.refresh_token
        && result.body.user && result.body.user.id === auth.user.id) {
        persistFrom(result.body);
        var refreshed = loadAuth();
        if (!refreshed || refreshed.access_token !== result.body.access_token
          || refreshed.refresh_token !== result.body.refresh_token
          || !refreshed.user || refreshed.user.id !== auth.user.id
          || !Number.isFinite(refreshed.expires_at) || refreshed.expires_at <= Math.floor(Date.now() / 1000)) throw refreshError("cloud_unavailable");
        notify();
        return refreshed;
      }
      if ([400, 401, 403].indexOf(result.status) >= 0) {
        saveAuth(null);
        notify();
        return null;
      }
      // A connection failure is not a sign-out; a still-valid token stays usable.
      if (auth.expires_at > Math.floor(Date.now() / 1000)) return auth;
      throw refreshError("cloud_unavailable");
    });
  }

  function currentUser() {
    var auth = loadAuth();
    return auth ? auth.user : null;
  }

  function failedAuthRequest(error) {
    var changed = error && error.code === "auth_session_changed";
    return { status: changed ? 409 : 503, ok: false, body: { error: changed ? "auth_session_changed" : "cloud_unavailable" } };
  }

  function requireCurrentAuth(auth, revision) {
    if (revision !== authRevision || !sameAuth(auth, loadAuth())) throw refreshError("auth_session_changed");
  }

  // Updates the signed-in user's own credentials through Supabase Auth.
  // Requires a live session; the anon key alone cannot change an account.
  function accountFetch(body, query) {
    return refreshIfNeeded().then(function (auth) {
      if (!auth || !auth.access_token) return { status: 401, ok: false, body: { error: "sign_in_required" } };
      var revision = authRevision;
      return loadConfig().then(function (config) {
        requireCurrentAuth(auth, revision);
        if (!config) return { status: 503, ok: false, body: { error: "cloud_not_configured" } };
        return requestJson(config.url + "/auth/v1/user" + (query || ""), {
          method: "PUT",
          headers: {
            apikey: config.anonKey,
            "Content-Type": "application/json",
            Authorization: "Bearer " + auth.access_token,
          },
          body: JSON.stringify(body),
        }).then(function (result) {
            requireCurrentAuth(auth, revision);
            return result;
        }).catch(failedAuthRequest);
      });
    }).catch(failedAuthRequest);
  }

  // The address only changes after the user confirms the emailed link, so the
  // stored session intentionally keeps the old email until that happens.
  function updateEmail(email) {
    var redirect = "";
    try {
      if (window.location && window.location.origin) redirect = "?redirect_to=" + encodeURIComponent(window.location.origin + "/login.html");
    } catch (e) {}
    return accountFetch({ email: email }, redirect);
  }

  // Supabase verifies current_password when that setting is on.
  function updatePassword(password, currentPassword) {
    var body = { password: password };
    if (typeof currentPassword === "string" && currentPassword) body.current_password = currentPassword;
    return accountFetch(body);
  }

  function accountMessage(result, mode) {
    var text = authErrorText(result);
    var noun = mode === "password" ? "password" : "email";
    if (text.indexOf("sign_in_required") >= 0) return "Sign in again before changing your " + noun + ".";
    if (isEmailRateLimited(result)) return "Too many confirmation emails were requested. Wait about an hour, then try again.";
    if (text.indexOf("reauthentication") >= 0) return "For security, sign out and sign back in, then change your " + noun + " again.";
    if (text.indexOf("current_password") >= 0) return "Your current password was not accepted. Check it and try again.";
    if (text.indexOf("same_password") >= 0) return "That is already your current password. Choose a different one.";
    if (text.indexOf("weak_password") >= 0 || text.indexOf("password should be") >= 0) return "Use a password with at least 8 characters.";
    if (text.indexOf("email_exists") >= 0 || text.indexOf("already registered") >= 0 || text.indexOf("already been registered") >= 0) return "Another account already uses that email address.";
    if (text.indexOf("email_address_invalid") >= 0 || text.indexOf("unable to validate email") >= 0) return "Enter a valid email address.";
    if (text.indexOf("cloud_not_configured") >= 0) return "Cloud accounts are not configured yet, so your " + noun + " cannot be changed here.";
    if (text.indexOf("cloud_unavailable") >= 0) return "Occulert could not reach the account service. Check your connection and try again.";
    return mode === "password" ? "The password could not be updated. Please try again." : "The email could not be updated. Please try again.";
  }

  function api(method, path, body, isCurrent) {
    return refreshIfNeeded().then(function (auth) {
      if (!auth || !auth.access_token) {
        return { status: 401, ok: false, body: { error: "sign_in_required" } };
      }
      var revision = authRevision;
      requireCurrentAuth(auth, revision);
      if (isCurrent && !isCurrent()) throw refreshError("auth_session_changed");
      var headers = { Accept: "application/json", "Content-Type": "application/json", Authorization: "Bearer " + auth.access_token };
      return requestJson(path, {
        method: method,
        headers: headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }, function () {
        // boundedRequest defers fetch by a microtask; authorize at that boundary too.
        requireCurrentAuth(auth, revision);
        if (isCurrent && !isCurrent()) throw refreshError("auth_session_changed");
      }).then(function (result) {
          requireCurrentAuth(auth, revision);
          return result;
      }).catch(failedAuthRequest);
    }).catch(failedAuthRequest);
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
      detector_pipeline: "web_mediapipe_ear",
      detector_version: "web-ear-perclos-1",
      app_version: "web-v81",
    });
  }

  function endSession(sessionId, stats) {
    return api("PATCH", "/api/sessions", Object.assign({ session_id: sessionId }, stats || {}));
  }

  function logEvent(sessionId, type, extra, isCurrent) {
    return api("POST", "/api/events", Object.assign({ session_id: sessionId, type: type }, extra || {}), isCurrent);
  }

  // Only summary totals and the original finish time enter this bounded local queue.
  function createCloudSummaryOutbox(isCurrent, onSynced, canRead) {
    var key = "occulert-cloud-outbox", flights = new Map();
    function read() {
      var rows = JSON.parse(localStorage.getItem(key) || "[]");
      if (!Array.isArray(rows) || rows.length > 20 || rows.some(function (row) {
        return !row || typeof row !== "object" || typeof row.ownerId !== "string" || !row.ownerId || typeof row.sessionId !== "string" || !row.sessionId
          || typeof row.endedAt !== "string" || !Number.isFinite(Date.parse(row.endedAt))
          || new Date(row.endedAt).toISOString() !== row.endedAt
          || !row.stats || typeof row.stats !== "object" || Array.isArray(row.stats) || Object.keys(row.stats).length !== 5
          || ["average_fatigue", "max_fatigue", "safety_score", "alert_count", "head_nod_count"].some(function (field) {
            return !Number.isFinite(row.stats[field]) || row.stats[field] < 0;
          });
      })) throw new Error("Pending cloud summaries are unreadable");
      return rows;
    }
    function current(scope) {
      var user = currentUser();
      return Boolean(user && user.id === scope.ownerId && isCurrent(scope));
    }
    function enqueue(scope, entry) {
      if (!current(scope)) return false;
      var rows = read();
      if (rows.some(function (row) { return row.ownerId === scope.ownerId && row.sessionId === entry.sessionId; })) return true;
      if (rows.length >= 20) return false;
      var stats = {};
      ["average_fatigue", "max_fatigue", "safety_score", "alert_count", "head_nod_count"].forEach(function (field) { stats[field] = entry.stats[field]; });
      var row = { ownerId: scope.ownerId, sessionId: entry.sessionId, endedAt: entry.endedAt, localSessionId: entry.localSessionId, stats: stats };
      // Validate without touching existing storage before committing the new record.
      if (typeof row.sessionId !== "string" || !row.sessionId || typeof row.endedAt !== "string" || !Number.isFinite(Date.parse(row.endedAt)) || new Date(row.endedAt).toISOString() !== row.endedAt || Object.values(stats).some(function (value) { return !Number.isFinite(value) || value < 0; })) throw new Error("Invalid session summary");
      localStorage.setItem(key, JSON.stringify(rows.concat(row)));
      return true;
    }
    function flush(scope) {
      var identity = scope.ownerId + ":" + scope.revision;
      if (flights.has(identity)) return flights.get(identity);
      var pending = (async function () {
        var saved = new Set();
        if (!current(scope)) return saved;
        var entries = read().filter(function (row) { return row.ownerId === scope.ownerId; });
        for (var entry of entries) {
          if (!current(scope)) break;
          var result;
          try { result = await endSession(entry.sessionId, Object.assign({}, entry.stats, { ended_at: entry.endedAt })); }
          catch (error) { break; }
          if (!current(scope)) break;
          var stored = result.body && result.body.session;
          var end = stored && stored.ended_at;
          var ended = typeof end === 'string'
            && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(end)
            && Number.isFinite(Date.parse(end))
            && new Date(end.slice(0, 10) + 'T00:00:00.000Z').toISOString().slice(0, 10) === end.slice(0, 10);
          var confirmed = result.ok && result.body && result.body.ok === true && stored && stored.id === entry.sessionId && ended;
          if (confirmed || result.status >= 400 && result.status < 500 && ![401, 408, 429].includes(result.status)) {
            if (confirmed && onSynced) await onSynced(entry);
            if (!current(scope)) break;
            localStorage.setItem(key, JSON.stringify(read().filter(function (row) { return row.ownerId !== entry.ownerId || row.sessionId !== entry.sessionId; })));
            if (confirmed) saved.add(entry.sessionId);
          } else break;
        }
        return saved;
      })().finally(function () { flights.delete(identity); });
      flights.set(identity, pending);
      return pending;
    }
    function pendingEntries(scope) {
      var user = currentUser();
      if (!scope || !user || user.id !== scope.ownerId || !(canRead || isCurrent)(scope)) return [];
      // A read-only snapshot may be shown before new consent to send anything.
      return JSON.parse(JSON.stringify(read().filter(function (row) { return row.ownerId === scope.ownerId; })));
    }
    function clearOwner(scope) {
      var user = currentUser();
      if (!scope || !user || user.id !== scope.ownerId || !(canRead || isCurrent)(scope)) return false;
      localStorage.setItem(key, JSON.stringify(read().filter(function (row) { return row.ownerId !== scope.ownerId; })));
      return true;
    }
    return { enqueue: enqueue, flush: flush, pendingEntries: pendingEntries, clearOwner: clearOwner, clear: function () { localStorage.removeItem(key); } };
  }

  function getFleetSummary(options) {
    var includeEvents = !options || options.includeEvents !== false;
    return api("GET", "/api/fleet-summary" + (includeEvents ? "" : "?include_events=0"));
  }

  function getFleet() { return api("GET", "/api/fleets"); }

  function createFleet(companyName) {
    return api("POST", "/api/fleets", { company_name: companyName });
  }

  function listFleetInvitations() { return api("GET", "/api/fleet-invitations"); }

  function createFleetInvitation(email) {
    return api("POST", "/api/fleet-invitations", { email: email });
  }

  function resendFleetInvitation(invitationId) {
    return api("POST", "/api/fleet-invitations", { replace_invitation_id: invitationId });
  }

  function revokeFleetInvitation(invitationId) {
    return api("DELETE", "/api/fleet-invitations", { invitation_id: invitationId });
  }

  function acceptFleetInvitation(token) {
    return api("POST", "/api/accept-invitation", { token: token });
  }

  function deleteAccount() {
    return api("DELETE", "/api/account", { confirm: "DELETE" });
  }

  return {
    isConfigured: isConfigured,
    getAuthConfig: loadConfig,
    refreshAuthConfig: refreshAuthConfig,
    getSession: refreshIfNeeded,
    adoptSession: adoptSession,
    beginAuthAttempt: beginAuthAttempt,
    beginAuthLinkAttempt: beginAuthLinkAttempt,
    captureAuthLifecycle: captureAuthLifecycle,
    isAuthLifecycleCurrent: isAuthLifecycleCurrent,
    captureAuthContext: captureAuthContext,
    isAuthContextCurrent: isAuthContextCurrent,
    requireAuthContext: requireAuthContext,
    completedAuthContext: completedAuthContext,
    fetchWithDeadline: fetchWithDeadline,
    authMessage: authMessage,
    isEmailRateLimited: isEmailRateLimited,
    needsSignupConfirmation: needsSignupConfirmation,
    signUp: signUp,
    resendSignupConfirmation: resendSignupConfirmation,
    resendConfirmationMessage: resendConfirmationMessage,
    signIn: signIn,
    requestPasswordReset: requestPasswordReset,
    passwordResetMessage: passwordResetMessage,
    consumeAuthRedirect: consumeAuthRedirect,
    recordAuthLinkRequest: recordAuthLinkRequest,
    authLinkNeedsConfirmation: authLinkNeedsConfirmation,
    pendingLinkConfirmation: pendingLinkConfirmation,
    clearAuthLinkRequest: clearAuthLinkRequest,
    signOut: signOut,
    currentUser: currentUser,
    updateEmail: updateEmail,
    updatePassword: updatePassword,
    accountMessage: accountMessage,
    ensureDriverProfile: ensureDriverProfile,
    startSession: startSession,
    endSession: endSession,
    createCloudSummaryOutbox: createCloudSummaryOutbox,
    logEvent: logEvent,
    getFleetSummary: getFleetSummary,
    getFleet: getFleet,
    createFleet: createFleet,
    listFleetInvitations: listFleetInvitations,
    createFleetInvitation: createFleetInvitation,
    resendFleetInvitation: resendFleetInvitation,
    revokeFleetInvitation: revokeFleetInvitation,
    acceptFleetInvitation: acceptFleetInvitation,
    deleteAccount: deleteAccount,
  };
})();
