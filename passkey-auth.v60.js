// Supabase Passkey (WebAuthn) integration for Occulert's browser account flow.
// The SDK performs every WebAuthn ceremony and server verification. Occulert
// only adopts the resulting Supabase session into its existing auth storage.
(function () {
  var clientPromise = null;
  var localClients = new Set();

  function releaseClient(client) {
    localClients.delete(client);
    try { if (client.auth && typeof client.auth.stopAutoRefresh === "function") Promise.resolve(client.auth.stopAutoRefresh()).catch(function () {}); } catch (_) {}
  }

  function codedError(code) {
    var error = new Error(code);
    error.code = code;
    return error;
  }

  function isSupported() {
    return Boolean(
      window.isSecureContext &&
      window.PublicKeyCredential &&
      window.navigator &&
      window.navigator.credentials
    );
  }

  function errorText(error) {
    return [error && error.code, error && error.name, error && error.message]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function message(error, action) {
    var text = errorText(error);
    if (text.indexOf("passkey_unsupported") >= 0 || text.indexOf("notsupportederror") >= 0 || text.indexOf("insecure") >= 0) {
      return "Passkeys require a supported browser on a secure Occulert page.";
    }
    if (text.indexOf("notallowederror") >= 0 || text.indexOf("cancel") >= 0 || text.indexOf("timed out") >= 0) {
      return "The passkey prompt was cancelled or timed out. You can try again.";
    }
    if (text.indexOf("securityerror") >= 0 || text.indexOf("relying party") >= 0 || text.indexOf("rp id") >= 0) {
      return "Passkeys can only be used on an approved Occulert domain. Use an email link or password on this preview, then try again on www.occulert.com.";
    }
    if (text.indexOf("passkey_disabled") >= 0) {
      return "Passkey authentication is not enabled for Occulert yet. Use an email link or password for now.";
    }
    if (text.indexOf("sdk_load_failed") >= 0 || text.indexOf("sdk_load_timeout") >= 0) {
      return "Safari could not load Occulert's secure passkey helper. Check content blockers or your connection, then retry.";
    }
    if (text.indexOf("sdk_unavailable") >= 0) {
      return "This browser loaded an incompatible passkey helper. Reload the page or use an email link or password.";
    }
    if (text.indexOf("auth_config_unavailable") >= 0 || text.indexOf("cloud_not_configured") >= 0) {
      return "Occulert could not load account settings. Check your connection, then retry.";
    }
    if (text.indexOf("webauthn_credential_not_found") >= 0) {
      return "That passkey is not registered with this Occulert account. Sign in with an email link or password and add a new passkey in Account Settings.";
    }
    if (text.indexOf("webauthn_credential_exists") >= 0 || text.indexOf("invalidstateerror") >= 0) {
      return "This passkey is already registered with your Occulert account.";
    }
    if (text.indexOf("webauthn_challenge_expired") >= 0 || text.indexOf("webauthn_challenge_not_found") >= 0) {
      return "The passkey request expired. Start again to create a fresh request.";
    }
    if (text.indexOf("webauthn_verification_failed") >= 0) {
      return "Occulert could not verify that passkey. Try again or use an email link.";
    }
    if (text.indexOf("too_many_passkeys") >= 0) {
      return "This account has reached its passkey limit. Remove an unused passkey before adding another.";
    }
    if (text.indexOf("email_not_confirmed") >= 0) {
      return "Confirm your email before using a passkey.";
    }
    if (text.indexOf("user_banned") >= 0) {
      return "This account cannot sign in. Contact Occulert support if you believe this is a mistake.";
    }
    if (text.indexOf("auth_session_changed") >= 0) return "Your signed-in account changed. Start this action again.";
    if (text.indexOf("sign_in_required") >= 0) {
      return "Sign in with your an email link or password before managing passkeys.";
    }
    if (text.indexOf("failed to fetch") >= 0 || text.indexOf("network") >= 0 || text.indexOf("cloud_unavailable") >= 0) {
      return "Occulert could not reach the account service. Check your connection and try again.";
    }
    if (action === "register") return "The passkey could not be added. Try again or continue with email.";
    if (action === "manage") return "Your passkeys could not be updated. Try again.";
    return "Passkey sign-in failed. Try again or use your an email link or password.";
  }

  function canRetry(error) {
    var text = errorText(error);
    return ["sdk_load_failed", "sdk_load_timeout", "auth_config_unavailable", "cloud_not_configured", "failed to fetch", "network", "cloud_unavailable"]
      .some(function (value) { return text.indexOf(value) >= 0; });
  }

  function loadSdk(force) {
    if (window.supabase && typeof window.supabase.createClient === "function") return Promise.resolve(window.supabase);
    var loader = window.OcculertSupabaseLoader;
    if (!loader || typeof loader.load !== "function") return Promise.reject(codedError("sdk_load_failed"));
    return (force && typeof loader.retry === "function" ? loader.retry() : loader.load()).then(function (sdk) {
      if (!sdk || typeof sdk.createClient !== "function") throw codedError("sdk_unavailable");
      return sdk;
    });
  }

  function loadAuthConfig(force) {
    if (!window.OcculertBackend || typeof window.OcculertBackend.getAuthConfig !== "function") {
      return Promise.reject(codedError("auth_config_unavailable"));
    }
    var load = force && typeof window.OcculertBackend.refreshAuthConfig === "function"
      ? window.OcculertBackend.refreshAuthConfig
      : window.OcculertBackend.getAuthConfig;
    return Promise.resolve(load()).then(function (config) {
      if (!config || !config.url || !config.anonKey) throw codedError("auth_config_unavailable");
      return config;
    });
  }

  function getClient(force) {
    if (!isSupported()) return Promise.reject(codedError("passkey_unsupported"));
    if (force) clientPromise = null;
    if (!clientPromise) {
      var attempt = Promise.all([loadSdk(force), loadAuthConfig(force)]);
      clientPromise = attempt;
      attempt.catch(function () { if (clientPromise === attempt) clientPromise = null; });
    }
    return clientPromise.then(function (values) {
      var sdk = values[0], config = values[1];
      var client = sdk.createClient(config.url, config.anonKey, {
        global: { fetch: window.OcculertBackend.fetchWithDeadline },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, experimental: { passkey: true } },
      });
      localClients.add(client);
      return client;
    });
  }

  async function retry() {
    clientPromise = null;
    await Promise.all([loadSdk(true), loadAuthConfig(true)]);
  }

  async function authenticatedClient() {
    if (!window.OcculertBackend || typeof window.OcculertBackend.getSession !== "function") {
      throw codedError("sign_in_required");
    }
    var session = await window.OcculertBackend.getSession();
    if (!session || !session.access_token || !session.refresh_token) throw codedError("sign_in_required");
    var context = window.OcculertBackend.captureAuthContext();
    if (!context.auth || context.auth.access_token !== session.access_token || context.auth.refresh_token !== session.refresh_token
      || !context.auth.user || context.auth.user.id !== session.user.id) throw codedError("auth_session_changed");
    var client = await getClient();
    try {
    window.OcculertBackend.requireAuthContext(context);
    var result = await client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    window.OcculertBackend.requireAuthContext(context);
    if (result.error) throw result.error;
    return { client: client, context: context };
    } catch (error) { releaseClient(client); throw error; }
  }

  async function signIn(context) {
    context = context || window.OcculertBackend.beginAuthAttempt();
    var client = await getClient();
    try {
    window.OcculertBackend.requireAuthContext(context);
    if (!client.auth || typeof client.auth.signInWithPasskey !== "function") throw codedError("sdk_unavailable");
    var result = await client.auth.signInWithPasskey();
    window.OcculertBackend.requireAuthContext(context);
    if (result.error) throw result.error;
    if (!result.data || !result.data.session || !result.data.user) throw codedError("webauthn_verification_failed");
    var adopted = window.OcculertBackend.adoptSession(result.data.session, context);
    if (!adopted || !adopted.user || adopted.user.id !== result.data.user.id || adopted.access_token !== result.data.session.access_token || adopted.refresh_token !== result.data.session.refresh_token) throw codedError("webauthn_verification_failed");
    return result.data.user;
    } finally { releaseClient(client); }
  }

  async function register() {
    var operation = await authenticatedClient();
    var client = operation.client;
    try {
    window.OcculertBackend.requireAuthContext(operation.context);
    if (typeof client.auth.registerPasskey !== "function") throw codedError("sdk_unavailable");
    var result = await client.auth.registerPasskey();
    window.OcculertBackend.requireAuthContext(operation.context);
    if (result.error) throw result.error;
    return result.data;
    } finally { releaseClient(client); }
  }

  async function list() {
    var operation = await authenticatedClient();
    var client = operation.client;
    try {
    window.OcculertBackend.requireAuthContext(operation.context);
    if (!client.auth.passkey || typeof client.auth.passkey.list !== "function") throw codedError("sdk_unavailable");
    var result = await client.auth.passkey.list();
    window.OcculertBackend.requireAuthContext(operation.context);
    if (result.error) throw result.error;
    return Array.isArray(result.data) ? result.data : [];
    } finally { releaseClient(client); }
  }

  async function rename(passkeyId, friendlyName) {
    var operation = await authenticatedClient();
    var client = operation.client;
    try {
    window.OcculertBackend.requireAuthContext(operation.context);
    if (!client.auth.passkey || typeof client.auth.passkey.update !== "function") throw codedError("sdk_unavailable");
    var result = await client.auth.passkey.update({ passkeyId: passkeyId, friendlyName: friendlyName });
    window.OcculertBackend.requireAuthContext(operation.context);
    if (result.error) throw result.error;
    return result.data;
    } finally { releaseClient(client); }
  }

  async function remove(passkeyId) {
    var operation = await authenticatedClient();
    var client = operation.client;
    try {
    window.OcculertBackend.requireAuthContext(operation.context);
    if (!client.auth.passkey || typeof client.auth.passkey.delete !== "function") throw codedError("sdk_unavailable");
    var result = await client.auth.passkey.delete({ passkeyId: passkeyId });
    window.OcculertBackend.requireAuthContext(operation.context);
    if (result.error) throw result.error;
    return result.data;
    } finally { releaseClient(client); }
  }

  function signOutLocal() {
    // Detach the current clients immediately; old cleanup cannot reset a
    // replacement client or delay revocation of Occulert's local session.
    clientPromise = null;
    var clients = Array.from(localClients);
    localClients.clear();
    return Promise.all(clients.map(function (client) {
      return Promise.resolve().then(function () {
        if (client && client.auth && typeof client.auth.signOut === "function") return client.auth.signOut({ scope: "local" });
      }).catch(function () {});
    }));
  }

  window.OcculertPasskeys = {
    isSupported: isSupported,
    message: message,
    canRetry: canRetry,
    retry: retry,
    signIn: signIn,
    register: register,
    list: list,
    rename: rename,
    remove: remove,
    signOutLocal: signOutLocal,
  };
})();
