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

  function refreshAuthConfig() {
    configPromise = null;
    return loadConfig();
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
    if (isEmailRateLimited(result)) return "Too many confirmation emails were requested. Wait about an hour, then try Create Account once.";
    if (text.indexOf("user_already_exists") >= 0 || text.indexOf("email_exists") >= 0 || text.indexOf("already registered") >= 0) return "An account already exists for this email. Use Sign In instead.";
    if (text.indexOf("invalid_credentials") >= 0 || text.indexOf("invalid login credentials") >= 0) return "Email or password is incorrect.";
    if (needsSignupConfirmation(result)) return "Confirm your email, then return and sign in.";
    if (text.indexOf("weak_password") >= 0 || text.indexOf("password should be") >= 0) return "Use a password with at least 6 characters.";
    if (text.indexOf("signup_disabled") >= 0 || text.indexOf("signups not allowed") >= 0) return "New account creation is temporarily unavailable.";
    if (text.indexOf("cloud_not_configured") >= 0) return "Cloud sign-in is not configured yet. The Driver App is still available in local-only mode.";
    if (text.indexOf("cloud_unavailable") >= 0) return "Occulert could not reach the sign-in service. Check your connection and try again.";
    return mode === "signup" ? "The account could not be created. Please try again." : "Sign-in failed. Check your email and password, then try again.";
  }

  function adoptSession(body) {
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
    });
    return loadAuth();
  }

  function persistFrom(body) {
    adoptSession(body);
  }

  function signupConfirmationRedirect() {
    try {
      if (window.location && window.location.origin) {
        return "?redirect_to=" + encodeURIComponent(window.location.origin + "/login.html");
      }
    } catch (e) {}
    return "";
  }

  function signUp(email, password) {
    return authFetch("/signup" + signupConfirmationRedirect(), { email: email, password: password }).then(function (result) {
      if (result.ok && result.body.access_token) persistFrom(result.body);
      return result;
    });
  }

  function resendSignupConfirmation(email) {
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

  function signIn(email, password) {
    return authFetch("/token?grant_type=password", { email: email, password: password }).then(function (result) {
      if (result.ok && result.body.access_token) persistFrom(result.body);
      return result;
    });
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
  function consumeAuthRedirect() {
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

    var expiresAt = Number(params.get("expires_at"));
    if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
      expiresAt = Math.floor(Date.now() / 1000) + (Number(params.get("expires_in")) || 3600) - 60;
    }
    return loadConfig().then(function (config) {
      if (!config) return { handled: true, status: 503, ok: false, body: { error: "cloud_not_configured" } };
      return fetch(config.url + "/auth/v1/user", {
        method: "GET",
        headers: { apikey: config.anonKey, Authorization: "Bearer " + accessToken, Accept: "application/json" },
      }).then(function (response) {
        return readJson(response).then(function (body) {
          if (response.ok && body && body.id) {
            saveAuth({
              access_token: accessToken,
              refresh_token: refreshToken,
              expires_at: expiresAt,
              user: { id: body.id, email: body.email || "" },
            });
          }
          return { handled: true, status: response.status, ok: response.ok && Boolean(body && body.id), body: body };
        });
      }).catch(function () {
        return { handled: true, status: 503, ok: false, body: { error: "cloud_unavailable" } };
      });
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

  // Updates the signed-in user's own credentials through Supabase Auth.
  // Requires a live session; the anon key alone cannot change an account.
  function accountFetch(body, query) {
    return refreshIfNeeded().then(function (auth) {
      if (!auth || !auth.access_token) return { status: 401, ok: false, body: { error: "sign_in_required" } };
      return loadConfig().then(function (config) {
        if (!config) return { status: 503, ok: false, body: { error: "cloud_not_configured" } };
        return fetch(config.url + "/auth/v1/user" + (query || ""), {
          method: "PUT",
          headers: {
            apikey: config.anonKey,
            "Content-Type": "application/json",
            Authorization: "Bearer " + auth.access_token,
          },
          body: JSON.stringify(body),
        }).then(function (response) {
          return readJson(response).then(function (result) {
            return { status: response.status, ok: response.ok, body: result };
          });
        }).catch(function () {
          return { status: 503, ok: false, body: { error: "cloud_unavailable" } };
        });
      });
    });
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

  function updatePassword(password) {
    return accountFetch({ password: password });
  }

  function accountMessage(result, mode) {
    var text = authErrorText(result);
    var noun = mode === "password" ? "password" : "email";
    if (text.indexOf("sign_in_required") >= 0) return "Sign in again before changing your " + noun + ".";
    if (isEmailRateLimited(result)) return "Too many confirmation emails were requested. Wait about an hour, then try again.";
    if (text.indexOf("reauthentication") >= 0) return "For security, sign out and sign back in, then change your " + noun + " again.";
    if (text.indexOf("same_password") >= 0) return "That is already your current password. Choose a different one.";
    if (text.indexOf("weak_password") >= 0 || text.indexOf("password should be") >= 0) return "Use a password with at least 6 characters.";
    if (text.indexOf("email_exists") >= 0 || text.indexOf("already registered") >= 0 || text.indexOf("already been registered") >= 0) return "Another account already uses that email address.";
    if (text.indexOf("email_address_invalid") >= 0 || text.indexOf("unable to validate email") >= 0) return "Enter a valid email address.";
    if (text.indexOf("cloud_not_configured") >= 0) return "Cloud accounts are not configured yet, so your " + noun + " cannot be changed here.";
    if (text.indexOf("cloud_unavailable") >= 0) return "Occulert could not reach the account service. Check your connection and try again.";
    return mode === "password" ? "The password could not be updated. Please try again." : "The email could not be updated. Please try again.";
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

  return {
    isConfigured: isConfigured,
    getAuthConfig: loadConfig,
    refreshAuthConfig: refreshAuthConfig,
    getSession: refreshIfNeeded,
    adoptSession: adoptSession,
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
    signOut: signOut,
    currentUser: currentUser,
    updateEmail: updateEmail,
    updatePassword: updatePassword,
    accountMessage: accountMessage,
    ensureDriverProfile: ensureDriverProfile,
    startSession: startSession,
    endSession: endSession,
    logEvent: logEvent,
    getFleetSummary: getFleetSummary,
    getFleet: getFleet,
    createFleet: createFleet,
    listFleetInvitations: listFleetInvitations,
    createFleetInvitation: createFleetInvitation,
    resendFleetInvitation: resendFleetInvitation,
    revokeFleetInvitation: revokeFleetInvitation,
    acceptFleetInvitation: acceptFleetInvitation,
  };
})();
