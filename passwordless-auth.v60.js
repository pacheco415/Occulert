// Passwordless onboarding uses Supabase's verified email session before enrollment.
// Metadata supplies display fields only; fleet permissions remain server-owned.
(function () {
  let clientPromise;
  let retryClient = false;
  let sending = false;
  let nextSendAt = 0;
  function clean(value) { return String(value || '').trim().slice(0, 120); }
  async function client() {
    if (!clientPromise) {
      const attempt = Promise.all([
        retryClient ? window.OcculertSupabaseLoader.retry() : window.OcculertSupabaseLoader.load(),
        retryClient ? window.OcculertBackend.refreshAuthConfig() : window.OcculertBackend.getAuthConfig(),
      ]).then(([sdk, config]) => {
        if (!sdk || typeof sdk.createClient !== 'function' || !config || !config.url || !config.anonKey) throw new Error('Account settings could not load. Please retry.');
        return [sdk, config];
      });
      clientPromise = attempt;
      attempt.catch(() => { if (clientPromise === attempt) { clientPromise = null; retryClient = true; } });
    }
    return clientPromise.then(([sdk, config]) => {
        return sdk.createClient(config.url, config.anonKey, {
          global: { fetch: window.OcculertBackend.fetchWithDeadline },
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: 'implicit' },
        });
      });
  }
  async function start(email, extra) {
    if (sending || Date.now() < nextSendAt) throw new Error('Please wait one minute before requesting another email link.');
    const context = window.OcculertBackend.beginAuthAttempt();
    sending = true;
    try {
      const sdk = await client();
      window.OcculertBackend.requireAuthContext(context);
      const options = {
        shouldCreateUser: Boolean(extra),
        emailRedirectTo: window.location.origin + '/login.html' + (extra ? '?enroll=passkey' : ''),
      };
      if (extra) options.data = { name: clean(extra.name), company: clean(extra.company), vehicle: clean(extra.vehicle), account_type: extra.role === 'fleet' ? 'fleet' : 'driver' };
      const { error } = await sdk.auth.signInWithOtp({ email, options });
      window.OcculertBackend.requireAuthContext(context);
      if (error) {
        if (error.status === 429) nextSendAt = Date.now() + 60_000;
        throw new Error(error.status === 429 ? 'Too many email requests. Wait before trying again.' : 'The email link could not be sent. Check your connection and email address, then retry.');
      }
      nextSendAt = Date.now() + 60_000;
    } finally { sending = false; }
  }
  async function consumeRedirect() {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const type = params.get('type');
    if (!params.has('access_token') && !params.has('error')) return null;
    // Never use a password-recovery token for this onboarding flow.
    const enroll = new URLSearchParams(window.location.search).get('enroll') === 'passkey';
    window.history.replaceState(null, '', window.location.pathname + (enroll ? '?enroll=passkey' : ''));
    if (params.has('error') || !['magiclink', 'signup'].includes(type) || !params.get('refresh_token')) {
      throw new Error('This email link is invalid or expired. Request a new sign-in link.');
    }
    const attempt = window.OcculertBackend.beginAuthAttempt();
    const sdk = await client();
    window.OcculertBackend.requireAuthContext(attempt);
    const { data, error } = await sdk.auth.setSession({ access_token: params.get('access_token'), refresh_token: params.get('refresh_token') });
    window.OcculertBackend.requireAuthContext(attempt);
    if (error || !data || !data.session) throw new Error('This email link could not be verified. Request a new sign-in link.');
    // Validate against Auth; do not trust decoded token claims or URL metadata.
    const verified = await sdk.auth.getUser();
    window.OcculertBackend.requireAuthContext(attempt);
    const user = verified.data && verified.data.user;
    if (verified.error || !user || !user.id || !user.email_confirmed_at || user.is_anonymous || user.id !== data.session.user.id) {
      throw new Error('Confirm your email before creating a passkey. Request a new sign-in link.');
    }
    const adopted = window.OcculertBackend.adoptSession({ ...data.session, user }, attempt);
    if (!adopted || adopted.user?.id !== user.id || adopted.access_token !== data.session.access_token || adopted.refresh_token !== data.session.refresh_token) throw new Error('The session could not be saved. Allow site storage and retry.');
    const context = window.OcculertBackend.completedAuthContext(attempt);
    const metadata = user.user_metadata || {};
    // Start from this identity rather than a previous driver's cached profile.
    const previous = window.OcculertAuth.getProfile();
    const profile = previous && previous.uid === user.id ? { ...previous } : {
      uid: user.id, driverId: user.id, role: 'driver', fleetId: 'OCCULERT-DEMO',
      name: clean(metadata.name), company: clean(metadata.company), vehicle: clean(metadata.vehicle),
    };
    Object.assign(profile, { email: user.email, authenticated: true, cloudProfile: false });
    try { profile.cloudProfile = Boolean((await window.OcculertBackend.ensureDriverProfile(profile)).ok); } catch (_) {}
    window.OcculertBackend.requireAuthContext(context);
    window.OcculertAuth.saveProfile(profile);
    return { profile, enroll, fleetRequested: metadata.account_type === 'fleet' };
  }
  window.OcculertPasswordless = { start, consumeRedirect };
})();
