(function (root) {
  'use strict';

  var HOUR_MS = 60 * 60 * 1000;
  var DAY_MS = 24 * HOUR_MS;
  var SUMMARY_LIMIT = 50;
  var REQUEST_TIMEOUT_MS = 8000;

  function list(value) { return Array.isArray(value) ? value : []; }
  function time(value) {
    if (typeof value !== 'string' || !value.trim()) return NaN;
    var parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  function windowDays(value) { return Number(value) === 7 ? 7 : 30; }
  function clockValue(value) { return typeof value === 'number' && Number.isFinite(value) ? value : Date.now(); }
  function isReviewSession(session) {
    var score = Number(session && session.safety_score);
    var rawScore = session && session.safety_score;
    var hasScore = (typeof rawScore === 'number' || (typeof rawScore === 'string' && rawScore.trim() !== '')) && Number.isFinite(score);
    return Number(session && session.alert_count) > 0 || (hasScore && score < 70);
  }

  function summarize(summary, nowValue, daysValue) {
    var now = clockValue(nowValue);
    var days = windowDays(daysValue);
    var start = now - days * DAY_MS;
    var drivers = list(summary && summary.drivers);
    var sessions = list(summary && summary.sessions).slice(0, SUMMARY_LIMIT);
    var activeDriverIds = new Set(drivers.filter(function (driver) { return driver && driver.active !== false; }).map(function (driver) { return String(driver.id || ''); }).filter(Boolean));
    // The protected API orders and limits by started_at. Keep the display's
    // rolling window on that same field; completion time does not move a
    // session into a different participation window.
    var valid = sessions.filter(function (session) {
      var started = time(session && session.started_at);
      return Number.isFinite(started) && started <= now;
    });
    var recent = valid.filter(function (session) { return time(session.started_at) >= start; });
    var activeSessions = valid.filter(function (session) { return session.ended_at === null || session.ended_at === undefined; });
    var participating = new Set(recent.map(function (session) { return String(session.driver_id || ''); }).filter(function (id) { return activeDriverIds.has(id); }));
    var withEnd = recent.filter(function (session) { return session.ended_at !== null && session.ended_at !== undefined; });
    var completed = withEnd.filter(function (session) {
      var ended = time(session.ended_at);
      return Number.isFinite(ended) && ended >= time(session.started_at) && ended <= now;
    });
    var hour = completed.filter(function (session) { return time(session.ended_at) >= now - HOUR_MS; }).length;
    var day = completed.filter(function (session) { return time(session.ended_at) >= now - DAY_MS; }).length;
    var earlier = completed.filter(function (session) { return time(session.ended_at) < now - DAY_MS; }).length;
    var activeDrivers = activeDriverIds.size;
    return {
      activeSessions: activeSessions.length,
      activeDrivers: activeDrivers,
      recentSessions: recent.length,
      reviewSessions: recent.filter(isReviewSession).length,
      invalidEndSessions: withEnd.length - completed.length,
      participatingDrivers: participating.size,
      coverage: activeDrivers ? Math.min(100, Math.round(participating.size / activeDrivers * 100)) : 0,
      historyLimited: sessions.length >= SUMMARY_LIMIT,
      windowDays: days,
      windowStart: start,
      windowEnd: now,
      pulse: { now: activeSessions.length, hour: hour, day: day, month: earlier },
    };
  }

  function refreshDelay(model, failureCount, saveData) {
    var base = model && model.activeSessions > 0 ? 30000 : (saveData ? 180000 : 90000);
    return Math.min(15 * 60 * 1000, base * Math.pow(2, Math.min(Math.max(0, Number(failureCount) || 0), 3)));
  }

  function ageLabel(timestamp, nowValue) {
    if (!timestamp) return 'Waiting for protected data';
    var seconds = Math.max(0, Math.round((clockValue(nowValue) - timestamp) / 1000));
    if (seconds < 10) return 'Protected data updated just now';
    if (seconds < 60) return 'Protected data updated ' + seconds + ' seconds ago';
    var minutes = Math.floor(seconds / 60);
    return 'Protected data updated ' + minutes + (minutes === 1 ? ' minute ago' : ' minutes ago');
  }

  function rangeLabel(model) {
    var options = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
    return 'Past ' + model.windowDays + ' days · ' + new Date(model.windowStart).toLocaleString([], options) + ' to ' + new Date(model.windowEnd).toLocaleString([], options) + ' (local time) · session start time';
  }

  root.OcculertFleetDisplay = { summarize: summarize, refreshDelay: refreshDelay, ageLabel: ageLabel, rangeLabel: rangeLabel };
  if (!root.document) return;

  var state = { model: null, summary: null, userId: '', lastSuccess: 0, failures: 0, loading: false, timer: 0, nextRefresh: 0, days: 30, authVersion: 0, refreshPending: false, connection: 'checking', cancelRequest: null };
  function element(id) { return root.document.getElementById(id); }
  function text(id, value) { var target = element(id); if (target) target.textContent = String(value); }
  function connection(kind, message) {
    state.connection = kind;
    text('connectionStatus', message);
    element('connectionStatus').setAttribute('data-state', kind);
  }
  function showEmpty(title, message, action) {
    element('displayContent').hidden = true;
    element('emptyState').hidden = false;
    text('emptyTitle', title);
    text('emptyMessage', message);
    element('emptyActions').hidden = !action;
    if (action) {
      element('emptyPrimary').href = action.href;
      element('emptyPrimary').textContent = action.label;
    }
  }
  function clearProtectedView() {
    state.model = null;
    state.summary = null;
    state.userId = '';
    state.lastSuccess = 0;
    state.failures = 0;
    text('displayTitle', 'Fleet operations');
    ['activeSessions', 'activeDrivers', 'recentSessions', 'reviewSessions', 'pulseNow', 'pulseHour', 'pulseDay', 'pulseMonth'].forEach(function (id) { text(id, 0); });
    text('coverageValue', '0%');
    text('coverageNote', 'No protected sessions are available yet.');
    element('coverageBar').style.width = '0%';
    element('coverageTrack').setAttribute('aria-valuenow', '0');
  }
  function renderWindow() {
    ensureOwnerAccess();
    var model = summarize(state.summary, Date.now(), state.days);
    text('windowRange', rangeLabel(model));
    text('sessionWindowLabel', 'available in past ' + state.days + ' days');
    text('reviewWindowLabel', 'available in past ' + state.days + ' days');
    text('coverageWindowLabel', state.days + '-day participation');
    text('pulseWindowLabel', 'Earlier in ' + state.days + ' days');
    element('coverageTrack').setAttribute('aria-label', 'Roster coverage in available ' + state.days + '-day history');
    if (!state.summary) return;
    state.model = model;
    element('emptyState').hidden = true;
    element('displayContent').hidden = false;
    text('activeSessions', model.activeSessions);
    text('activeDrivers', model.activeDrivers);
    text('recentSessions', model.recentSessions);
    text('reviewSessions', model.reviewSessions);
    text('coverageValue', model.coverage + '%');
    text('coverageNote', model.activeDrivers ? model.participatingDrivers + ' of ' + model.activeDrivers + ' active drivers have a session in the available ' + state.days + '-day history.' : 'No active drivers are in the protected roster.');
    element('coverageBar').style.width = model.coverage + '%';
    element('coverageTrack').setAttribute('aria-valuenow', String(model.coverage));
    text('pulseNow', model.pulse.now);
    text('pulseHour', model.pulse.hour);
    text('pulseDay', model.pulse.day);
    text('pulseMonth', model.pulse.month);
    element('summaryScope').setAttribute('data-limited', String(model.historyLimited));
    text('summaryScope', (model.historyLimited ? 'History may be incomplete: the protected summary reached its 50-session limit. Counts and roster coverage may understate activity in this window. ' : 'Session metrics use up to 50 recent protected sessions. ') + 'The selected window uses session start time. Sessions without a recorded end describe available record state; live device monitoring is not verified. Completed activity uses completion time within that window.' + (model.invalidEndSessions ? ' ' + model.invalidEndSessions + ' session records have an invalid end time and are excluded from completed activity.' : ''));
  }
  function updateClock() {
    text('pageClock', new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    text('refreshAge', ageLabel(state.lastSuccess));
    var detail = ageLabel(state.lastSuccess) + '. ';
    if (!state.userId && !state.failures && !state.loading) detail += 'A signed-in fleet owner is required.';
    else if (root.document.hidden) detail += 'Automatic refresh is paused while this tab is hidden.';
    else if (state.loading) detail += 'Checking the protected summary now.';
    else if (state.nextRefresh) detail += 'Next automatic ' + (state.failures ? 'retry' : 'refresh') + ' in about ' + Math.max(1, Math.ceil((state.nextRefresh - Date.now()) / 1000)) + ' seconds.';
    if (state.failures) detail += ' ' + state.failures + (state.failures === 1 ? ' unsuccessful refresh.' : ' unsuccessful refreshes.');
    if (!state.userId && state.failures) detail += ' The owner session has not been verified.';
    if (state.summary && state.connection !== 'connected' && state.connection !== 'loading') detail += ' Displayed counts are from the last protected summary.';
    text('connectionDetails', detail);
  }
  function clearSchedule() {
    root.clearTimeout(state.timer);
    state.timer = 0;
    state.nextRefresh = 0;
  }
  function schedule() {
    clearSchedule();
    if (root.document.hidden || (!state.userId && !state.failures)) return;
    var saveData = root.navigator && root.navigator.connection && root.navigator.connection.saveData === true;
    var delay = refreshDelay(state.model, state.failures, saveData);
    state.nextRefresh = Date.now() + delay;
    state.timer = root.setTimeout(function () { void refresh(); }, delay);
  }
  function signedOut() {
    clearSchedule();
    clearProtectedView();
    connection('signed-out', 'Sign in as a fleet owner to use this shared-screen display.');
    showEmpty('Fleet owner sign-in required', 'No local or demo data is used here. Protected fleet information stays hidden until the owner session is verified.', { href: '/login.html', label: 'Sign in' });
    updateClock();
  }
  function failedRefresh() {
    state.failures = Math.min(4, state.failures + 1);
    var offline = root.navigator && root.navigator.onLine === false;
    connection(offline ? 'offline' : 'interrupted', state.summary ? (offline ? 'Offline' : 'Connection interrupted') + ' · last protected summary shown while retrying' : 'Protected fleet data is temporarily unavailable · retrying automatically');
    if (!state.summary) showEmpty('Protected data unavailable', 'The display will retry automatically. No local or demo data will be substituted.', null);
  }
  function requestWithinDeadline(operation) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = root.setTimeout(function () {
        var error = new Error('Protected refresh timed out');
        error.code = 'refresh_timeout';
        finish(false, error);
      }, REQUEST_TIMEOUT_MS);
      var cancel = function () { finish(false, new Error('Owner session changed')); };
      state.cancelRequest = cancel;
      function finish(ok, value) {
        if (settled) return;
        settled = true;
        root.clearTimeout(timer);
        if (state.cancelRequest === cancel) state.cancelRequest = null;
        if (ok) resolve(value);
        else reject(value);
      }
      // Observe late rejections as well as late responses, but never apply them
      // after the deadline or an owner change has settled this request.
      Promise.resolve().then(function () { if (!settled) return operation(); })
        .then(function (value) { finish(true, value); }, function (error) { finish(false, error); });
    });
  }
  function cancelOwnerRequest() {
    if (state.cancelRequest) state.cancelRequest();
  }
  async function refresh() {
    clearSchedule();
    var ownerBeforeSession = root.OcculertBackend && root.OcculertBackend.currentUser ? root.OcculertBackend.currentUser() : null;
    if (state.userId && (!ownerBeforeSession || ownerBeforeSession.id !== state.userId)) {
      state.authVersion += 1;
      cancelOwnerRequest();
      clearProtectedView();
      showEmpty('Verifying fleet owner', 'Protected fleet information stays hidden while the current owner session is checked.', null);
      updateClock();
    }
    if (state.loading) { state.refreshPending = true; return; }
    if (root.document.hidden) return;
    state.loading = true;
    var requestVersion = state.authVersion;
    element('refreshButton').disabled = true;
    connection('loading', state.lastSuccess ? 'Refreshing the protected fleet summary…' : 'Checking the fleet owner session…');
    updateClock();
    try {
      var backend = root.OcculertBackend;
      var session = backend && backend.getSession ? await requestWithinDeadline(function () { return backend.getSession(); }) : null;
      if (requestVersion !== state.authVersion) return;
      var userId = session && session.user && typeof session.user.id === 'string' ? session.user.id : '';
      if (!userId) { signedOut(); return; }
      var currentBeforeSummary = backend.currentUser ? backend.currentUser() : null;
      if (!currentBeforeSummary || currentBeforeSummary.id !== userId) {
        signedOut();
        state.refreshPending = Boolean(currentBeforeSummary && currentBeforeSummary.id);
        return;
      }
      if (state.userId && state.userId !== userId) {
        clearProtectedView();
        showEmpty('Account changed', 'Loading the new owner’s protected fleet summary.', null);
      }
      state.userId = userId;
      connection('loading', state.lastSuccess ? 'Refreshing the protected fleet summary…' : 'Loading the protected fleet summary…');
      updateClock();
      var result = await requestWithinDeadline(function () { return backend.getFleetSummary({ includeEvents: false }); });
      if (requestVersion !== state.authVersion) return;
      var current = backend.currentUser ? backend.currentUser() : null;
      if (!current || current.id !== userId) {
        signedOut();
        state.refreshPending = Boolean(current && current.id);
        return;
      }
      if (!result.ok && result.status === 401) {
        if (backend.signOut) backend.signOut();
        signedOut();
        return;
      }
      if (result.ok && result.body && result.body.fleet) {
        state.summary = result.body;
        state.lastSuccess = Date.now();
        state.failures = 0;
        text('displayTitle', String(result.body.fleet.company_name || 'Fleet operations').slice(0, 80));
        connection('connected', 'Protected connection active · automatic read-only refresh');
        renderWindow();
      } else if (result.body && result.body.error === 'fleet_not_found') {
        clearProtectedView();
        state.userId = userId;
        connection('setup', 'The signed-in account does not own a fleet yet.');
        showEmpty('Fleet setup needed', 'Create a fleet before opening the shared-screen operations view.', { href: '/fleet-onboarding.html', label: 'Open fleet setup' });
      } else if (result.status === 403) {
        signedOut();
      } else {
        failedRefresh();
      }
    } catch (error) {
      if (requestVersion === state.authVersion) {
        var currentAfterFailure = backend && backend.currentUser ? backend.currentUser() : null;
        if (state.userId && (!currentAfterFailure || currentAfterFailure.id !== state.userId)) {
          if (error && error.code === 'refresh_timeout') {
            // A deadline does not confirm sign-out. Hide another owner's data
            // and retry verification without changing the stored session.
            clearProtectedView();
            failedRefresh();
          } else signedOut();
          state.refreshPending = Boolean(currentAfterFailure && currentAfterFailure.id);
        } else failedRefresh();
      }
    } finally {
      state.loading = false;
      element('refreshButton').disabled = false;
      schedule();
      updateClock();
      if (state.refreshPending) { state.refreshPending = false; void refresh(); }
    }
  }
  async function toggleFullscreen() {
    var doc = root.document;
    try {
      if (doc.fullscreenElement && doc.exitFullscreen) await doc.exitFullscreen();
      else if (doc.documentElement.requestFullscreen) await doc.documentElement.requestFullscreen();
      else {
        text('fullscreenFeedback', 'This browser does not offer full screen from this page. Use the browser’s full-screen menu, or turn on Large text.');
        return;
      }
      syncFullscreenButton();
    } catch (_) {
      text('fullscreenFeedback', 'Full screen could not open. Try the browser’s full-screen menu, or turn on Large text.');
      element('fullscreenFeedback').closest('details').open = true;
    }
  }
  function syncFullscreenButton() {
    text('fullscreenButton', root.document.fullscreenElement ? 'Exit full screen' : 'Full screen');
    text('fullscreenFeedback', root.document.fullscreenElement ? 'Full screen is on. Use Exit full screen or press Escape to return.' : 'Full screen is optional. Large text also works in a normal browser window.');
  }
  function handleAuthChange(event) {
    if (event && event.key !== null && event.key !== 'occulert-auth') return;
    state.authVersion += 1;
    cancelOwnerRequest();
    signedOut();
    void refresh();
  }
  function ensureOwnerAccess() {
    if (!state.summary) return;
    var current = root.OcculertBackend && root.OcculertBackend.currentUser ? root.OcculertBackend.currentUser() : null;
    if (current && current.id === state.userId) return;
    state.authVersion += 1;
    cancelOwnerRequest();
    signedOut();
    if (current && current.id) void refresh();
  }

  element('windowDays').addEventListener('change', function () { state.days = windowDays(element('windowDays').value); renderWindow(); });
  element('largeTextButton').addEventListener('click', function () {
    ensureOwnerAccess();
    var large = element('largeTextButton').getAttribute('aria-pressed') !== 'true';
    element('largeTextButton').setAttribute('aria-pressed', String(large));
    root.document.documentElement.setAttribute('data-display-size', large ? 'large' : 'standard');
  });
  element('refreshButton').addEventListener('click', function () { void refresh(); });
  element('fullscreenButton').addEventListener('click', function () { void toggleFullscreen(); });
  if (!root.document.documentElement.requestFullscreen) {
    element('fullscreenButton').disabled = true;
    text('fullscreenFeedback', 'This browser does not offer full screen from this page. Use the browser’s full-screen menu, or turn on Large text.');
  }
  root.document.addEventListener('fullscreenchange', syncFullscreenButton);
  root.document.addEventListener('visibilitychange', function () {
    if (root.document.hidden) { clearSchedule(); updateClock(); }
    else void refresh();
  });
  root.addEventListener('storage', handleAuthChange);
  root.addEventListener('online', function () { void refresh(); });
  root.addEventListener('offline', function () {
    if (state.userId) { connection('offline', state.summary ? 'Offline · last protected summary shown while retrying' : 'Offline · waiting for protected fleet data'); updateClock(); }
  });
  root.setInterval(updateClock, 15000);
  renderWindow();
  updateClock();
  void refresh();
})(typeof window !== 'undefined' ? window : globalThis);
