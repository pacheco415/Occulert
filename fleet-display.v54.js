(function (root) {
  'use strict';

  var THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  var HOUR_MS = 60 * 60 * 1000;
  var DAY_MS = 24 * HOUR_MS;

  function list(value) { return Array.isArray(value) ? value : []; }
  function time(value) {
    var parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function sessionTime(session) { return time(session && (session.ended_at || session.started_at)); }
  function isReviewSession(session) {
    var score = Number(session && session.safety_score);
    var hasScore = session && session.safety_score !== null && session.safety_score !== undefined && session.safety_score !== '' && Number.isFinite(score);
    return Number(session && session.alert_count) > 0 || (hasScore && score < 70);
  }

  function summarize(summary, nowValue) {
    var now = Number.isFinite(Number(nowValue)) ? Number(nowValue) : Date.now();
    var drivers = list(summary && summary.drivers);
    var sessions = list(summary && summary.sessions);
    var activeDriverIds = new Set(drivers.filter(function (driver) { return driver && driver.active !== false; }).map(function (driver) { return String(driver.id || ''); }).filter(Boolean));
    var recent = sessions.filter(function (session) {
      var recordedAt = sessionTime(session);
      return recordedAt > 0 && recordedAt >= now - THIRTY_DAYS_MS && recordedAt <= now + 5 * 60 * 1000;
    });
    var activeSessions = sessions.filter(function (session) { return session && !session.ended_at; });
    var participating = new Set(recent.map(function (session) { return String(session && session.driver_id || ''); }).filter(function (id) { return activeDriverIds.has(id); }));
    var completed = recent.filter(function (session) { return Boolean(session && session.ended_at); });
    var hour = completed.filter(function (session) { return sessionTime(session) >= now - HOUR_MS; }).length;
    var day = completed.filter(function (session) { var at = sessionTime(session); return at < now - HOUR_MS && at >= now - DAY_MS; }).length;
    var month = completed.filter(function (session) { return sessionTime(session) < now - DAY_MS; }).length;
    var activeDrivers = activeDriverIds.size;
    var coverage = activeDrivers ? Math.min(100, Math.round(participating.size / activeDrivers * 100)) : 0;
    return {
      activeSessions: activeSessions.length,
      activeDrivers: activeDrivers,
      recentSessions: recent.length,
      reviewSessions: recent.filter(isReviewSession).length,
      participatingDrivers: participating.size,
      coverage: coverage,
      pulse: { now: activeSessions.length, hour: hour, day: day, month: month },
    };
  }

  function refreshDelay(model, failureCount, saveData) {
    var base = model && model.activeSessions > 0 ? 30000 : (saveData ? 180000 : 90000);
    return Math.min(15 * 60 * 1000, base * Math.pow(2, Math.min(Math.max(0, Number(failureCount) || 0), 3)));
  }

  function ageLabel(timestamp, nowValue) {
    if (!timestamp) return 'Waiting for protected data';
    var seconds = Math.max(0, Math.round(((Number(nowValue) || Date.now()) - timestamp) / 1000));
    if (seconds < 10) return 'Protected data updated just now';
    if (seconds < 60) return 'Protected data updated ' + seconds + ' seconds ago';
    var minutes = Math.floor(seconds / 60);
    return 'Protected data updated ' + minutes + (minutes === 1 ? ' minute ago' : ' minutes ago');
  }

  var api = { summarize: summarize, refreshDelay: refreshDelay, ageLabel: ageLabel };
  root.OcculertFleetDisplay = api;
  if (!root.document) return;

  var state = { model: null, fleetName: '', userId: '', lastSuccess: 0, failures: 0, loading: false, timer: 0 };
  function element(id) { return root.document.getElementById(id); }
  function text(id, value) { var target = element(id); if (target) target.textContent = String(value); }
  function showEmpty(title, message, action) {
    element('displayContent').hidden = true;
    element('emptyState').hidden = false;
    text('emptyTitle', title);
    text('emptyMessage', message);
    element('emptyActions').hidden = !action;
    if (action) {
      var primary = element('emptyPrimary');
      primary.href = action.href;
      primary.textContent = action.label;
    }
  }
  function showContent() { element('emptyState').hidden = true; element('displayContent').hidden = false; }
  function renderModel(model) {
    state.model = model;
    showContent();
    text('activeSessions', model.activeSessions);
    text('activeDrivers', model.activeDrivers);
    text('recentSessions', model.recentSessions);
    text('reviewSessions', model.reviewSessions);
    text('coverageValue', model.coverage + '%');
    text('coverageNote', model.activeDrivers ? model.participatingDrivers + ' of ' + model.activeDrivers + ' active drivers recorded a protected session in the past 30 days.' : 'No active drivers are in the protected roster.');
    element('coverageBar').style.width = model.coverage + '%';
    element('coverageTrack').setAttribute('aria-valuenow', String(model.coverage));
    text('pulseNow', model.pulse.now);
    text('pulseHour', model.pulse.hour);
    text('pulseDay', model.pulse.day);
    text('pulseMonth', model.pulse.month);
  }
  function updateClock() {
    text('pageClock', new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    text('refreshAge', ageLabel(state.lastSuccess));
  }
  function clearSchedule() { root.clearTimeout(state.timer); state.timer = 0; }
  function schedule() {
    clearSchedule();
    if (root.document.hidden || !state.userId) return;
    var saveData = root.navigator && root.navigator.connection && root.navigator.connection.saveData === true;
    state.timer = root.setTimeout(function () { void refresh(); }, refreshDelay(state.model, state.failures, saveData));
  }
  function signedOut() {
    clearSchedule();
    state.model = null;
    state.fleetName = '';
    state.userId = '';
    state.lastSuccess = 0;
    text('displayTitle', 'Fleet operations');
    text('connectionStatus', 'Sign in as a fleet owner to use this shared-screen display.');
    showEmpty('Fleet owner sign-in required', 'No local or demo data is used here. Protected fleet information stays hidden until the owner session is verified.', { href: '/login.html', label: 'Sign in' });
    updateClock();
  }
  async function refresh() {
    clearSchedule();
    if (state.loading || root.document.hidden) return;
    state.loading = true;
    element('refreshButton').disabled = true;
    try {
      var backend = root.OcculertBackend;
      var session = backend && backend.getSession ? await backend.getSession() : null;
      var userId = session && session.user && typeof session.user.id === 'string' ? session.user.id : '';
      if (!userId) { signedOut(); return; }
      if (state.userId && state.userId !== userId) {
        state.model = null;
        state.lastSuccess = 0;
        showEmpty('Account changed', 'Loading the new owner’s protected fleet summary.', null);
      }
      state.userId = userId;
      text('connectionStatus', state.lastSuccess ? 'Refreshing the protected fleet summary…' : 'Loading the protected fleet summary…');
      var result;
      try { result = await backend.getFleetSummary({ includeEvents: false }); }
      catch (_) { result = { ok: false, status: 0, body: { error: 'cloud_unavailable' } }; }
      var current = backend.currentUser ? backend.currentUser() : null;
      if (!current || current.id !== userId) { signedOut(); return; }
      if (!result.ok && result.status === 401) { if (backend.signOut) backend.signOut(); signedOut(); return; }
      if (result.ok && result.body && result.body.fleet) {
        state.fleetName = String(result.body.fleet.company_name || 'Fleet operations').slice(0, 80);
        state.lastSuccess = Date.now();
        state.failures = 0;
        text('displayTitle', state.fleetName);
        text('connectionStatus', 'Protected connection active · automatic read-only refresh');
        renderModel(summarize(result.body, state.lastSuccess));
      } else if (result.body && result.body.error === 'fleet_not_found') {
        state.model = null;
        state.failures = 0;
        text('connectionStatus', 'The signed-in account does not own a fleet yet.');
        showEmpty('Fleet setup needed', 'Create a fleet before opening the shared-screen operations view.', { href: '/fleet-onboarding.html', label: 'Open fleet setup' });
      } else {
        state.failures = Math.min(4, state.failures + 1);
        text('connectionStatus', state.lastSuccess ? 'Connection interrupted · showing the last protected summary while retrying' : 'Protected fleet data is temporarily unavailable · retrying automatically');
        if (!state.model) showEmpty('Protected data unavailable', 'The display will retry automatically. No local or demo data will be substituted.', null);
      }
    } finally {
      state.loading = false;
      element('refreshButton').disabled = false;
      updateClock();
      schedule();
    }
  }
  function toggleFullscreen() {
    var doc = root.document;
    var action = doc.fullscreenElement ? doc.exitFullscreen && doc.exitFullscreen() : doc.documentElement.requestFullscreen && doc.documentElement.requestFullscreen();
    if (action && action.catch) action.catch(function () {});
  }
  function syncFullscreenButton() { text('fullscreenButton', root.document.fullscreenElement ? 'Exit full screen' : 'Full screen'); }
  async function handleAuthChange(event) {
    if (event && event.key !== null && event.key !== 'occulert-auth') return;
    await refresh();
  }

  element('refreshButton').addEventListener('click', function () { void refresh(); });
  if (root.document.documentElement.requestFullscreen) element('fullscreenButton').addEventListener('click', toggleFullscreen);
  else element('fullscreenButton').hidden = true;
  root.document.addEventListener('fullscreenchange', syncFullscreenButton);
  root.document.addEventListener('visibilitychange', function () { if (root.document.hidden) clearSchedule(); else void refresh(); });
  root.addEventListener('storage', function (event) { void handleAuthChange(event); });
  root.setInterval(updateClock, 30000);
  updateClock();
  void refresh();
})(typeof window !== 'undefined' ? window : globalThis);
