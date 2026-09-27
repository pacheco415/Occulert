(function () {
  'use strict';
  var backend = window.OcculertBackend;
  var status = document.getElementById('historyStatus');
  var access = document.getElementById('historyAccess');
  var title = document.getElementById('recordsTitle');
  var scope = document.getElementById('historyScope');
  var list = document.getElementById('historyList');
  var boundary = document.getElementById('historyBoundary');
  var refresh = document.getElementById('historyRefresh');
  var older = document.getElementById('historyOlder');
  var filters = document.getElementById('historyFilters');
  var driverFilter = document.getElementById('historyDriver');
  var periodFilter = document.getElementById('historyPeriod');
  var completionFilter = document.getElementById('historyCompletion');
  var clearFilters = document.getElementById('historyClearFilters');
  var matches = document.getElementById('historyMatches');
  var empty = document.getElementById('historyEmpty');
  var PAGE_SIZE = 50, MAX_ROWS = 500, MAX_CURSOR_LENGTH = 1024, LOAD_TIMEOUT_MS = 8000;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/;
  var rows = [], fleet = null, cursor = null, hasMore = false, loadedAt = null;
  var context = null, generation = 0, busy = false, controller = null;
  if (!status || !access || !title || !scope || !list || !boundary || !refresh || !older ||
      !filters || !driverFilter || !periodFilter || !completionFilter || !clearFilters || !matches || !empty) return;
  if (!backend || !backend.captureAuthContext || !backend.getSession || !backend.fetchWithDeadline ||
      !backend.requireAuthContext || !backend.isAuthContextCurrent || !backend.currentUser) {
    status.textContent = 'Account verification is unavailable. Reload this page to try again.';
    refresh.disabled = true;
    return;
  }

  function node(tag, text, className) {
    var element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function error(code, message) {
    var problem = new Error(message);
    problem.code = code;
    return problem;
  }
  function currentUserId() { return backend.currentUser()?.id || ''; }
  function setBusy(value) {
    busy = value;
    refresh.disabled = value;
    older.disabled = value;
    filters.disabled = value || !fleet || !context;
    list.setAttribute('aria-busy', String(value));
  }
  function resetFilters() {
    driverFilter.value = '';
    periodFilter.value = 'all';
    completionFilter.value = 'all';
  }
  function clearView(message) {
    generation += 1;
    if (controller) controller.abort();
    controller = null;
    rows = []; fleet = null; cursor = null; hasMore = false; loadedAt = null; context = null;
    resetFilters();
    list.replaceChildren();
    matches.textContent = 'Verify fleet ownership to filter loaded sessions.';
    empty.textContent = ''; empty.hidden = true;
    title.textContent = 'Recorded sessions';
    scope.textContent = 'Protected records are unavailable until fleet ownership is verified.';
    boundary.textContent = '';
    older.hidden = true;
    older.textContent = 'Load older sessions';
    access.hidden = Boolean(currentUserId());
    setBusy(false);
    if (message) status.textContent = message;
  }
  function checkView() {
    if (context && !backend.isAuthContextCurrent(context)) {
      clearView('Your signed-in account changed. Refresh history to verify fleet access again.');
      return false;
    }
    return true;
  }
  function time(value) {
    if (typeof value !== 'string') return null;
    var parsed = TIMESTAMP.exec(value);
    if (!parsed || parsed[0] !== value) return null;
    var year = Number(parsed[1]), month = Number(parsed[2]), day = Number(parsed[3]);
    var hour = Number(parsed[4]), minute = Number(parsed[5]), second = Number(parsed[6]);
    if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
    var leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    var days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (day < 1 || day > days[month - 1]) return null;
    var zone = parsed[8];
    if (zone !== 'Z') {
      var offsetHour = Number(zone.slice(1, 3)), offsetMinute = Number(zone.slice(4, 6));
      if (offsetHour > 14 || offsetMinute > 59 || offsetHour === 14 && offsetMinute !== 0) return null;
    }
    // Validate calendar dates before parsing: Date.parse can normalize invalid dates.
    // Preserve the fractional instant when comparing against now; never change stored values.
    var wholeSecond = parsed[1] + '-' + parsed[2] + '-' + parsed[3] + 'T' + parsed[4] + ':' + parsed[5] + ':' + parsed[6] + zone;
    var result = Date.parse(wholeSecond) + Number('0.' + (parsed[7] || '0')) * 1000;
    return Number.isFinite(result) ? result : null;
  }
  function missingDate(value) { return value === null || value === undefined || typeof value === 'string' && !value.trim(); }
  function date(value) {
    if (missingDate(value)) return 'Not recorded';
    var result = time(value);
    return result === null ? 'Invalid recorded date' : new Date(result).toLocaleString();
  }
  function completionState(session, now) {
    if (missingDate(session.ended_at)) return 'no_end';
    var start = time(session.started_at), end = time(session.ended_at);
    return start !== null && end !== null && end >= start && end <= now ? 'completed' : 'invalid';
  }
  function completion(session, now) {
    var state = completionState(session, now);
    return state === 'no_end' ? 'No recorded end time' : state === 'completed' ? 'Completed session' : 'Invalid recorded dates';
  }
  function duration(session, now) {
    var start = time(session.started_at), end = time(session.ended_at);
    if (start === null || end === null || end < start || end > now) return 'Not recorded';
    var minutes = Math.round((end - start) / 60000);
    return minutes < 60 ? minutes + ' min' : Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm';
  }
  function metric(value, isCount) {
    if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'object' ||
        (typeof value === 'string' && !value.trim())) return 'Not recorded';
    var number = Number(value);
    if (!Number.isFinite(number) || number < 0 || (isCount ? !Number.isSafeInteger(number) : number > 100)) return 'Not recorded';
    return String(isCount ? number : Math.round(number)) + (isCount ? '' : ' / 100');
  }
  function appendSessions(sessions, now) {
    var fragment = document.createDocumentFragment();
    sessions.forEach(function (session) {
      var item = node('article', undefined, 'history-session');
      item.setAttribute('role', 'listitem');
      var heading = node('h3', session.driver_name);
      heading.id = 'history-session-' + session.id;
      item.setAttribute('aria-labelledby', heading.id);
      var description = node('p', date(session.started_at) + ' · ' + completion(session, now), 'muted');
      var values = node('dl', undefined, 'history-metrics');
      [
        ['Recorded end', date(session.ended_at)], ['Recorded duration', duration(session, now)],
        ['Safety score', metric(session.safety_score, false)], ['Average fatigue', metric(session.average_fatigue, false)],
        ['Maximum fatigue', metric(session.max_fatigue, false)], ['Reported alerts', metric(session.alert_count, true)],
        ['Reported head nods', metric(session.head_nod_count, true)],
      ].forEach(function (entry) {
        var group = node('div'); group.append(node('dt', entry[0]), node('dd', entry[1])); values.appendChild(group);
      });
      item.append(heading, description, values); fragment.appendChild(item);
    });
    list.appendChild(fragment);
  }
  function renderSessions() {
    // Every redraw, including local-only filters, must still belong to the verified account.
    if (!checkView() || !context || !fleet) return false;
    backend.requireAuthContext(context);
    var now = Date.now(), name = driverFilter.value.trim().toLocaleLowerCase();
    var period = periodFilter.value, selectedCompletion = completionFilter.value;
    var earliest = null;
    if (period === '7' || period === '30') {
      var calendarStart = new Date(now);
      calendarStart.setHours(0, 0, 0, 0);
      calendarStart.setDate(calendarStart.getDate() - (period === '7' ? 6 : 29));
      earliest = calendarStart.getTime();
    }
    var selected = rows.filter(function (session) {
      if (name && session.driver_name.toLocaleLowerCase().indexOf(name) === -1) return false;
      if (earliest !== null) {
        var started = time(session.started_at);
        if (started === null || started < earliest || started > now) return false;
      }
      return selectedCompletion === 'all' || completionState(session, now) === selectedCompletion;
    });
    list.replaceChildren();
    appendSessions(selected, now);
    matches.textContent = selected.length + ' of ' + rows.length + ' loaded sessions match. Loaded records only; load older sessions to search more, up to the 500-session limit.';
    empty.hidden = selected.length !== 0;
    empty.textContent = rows.length ? 'No loaded sessions match these filters. Clear filters to see the loaded records, or load older sessions when available. This does not mean the fleet has no matching sessions.' :
      'No sessions were returned in this browsing window. Refresh to check for newer or updated records.';
    return true;
  }
  function updateScope() {
    title.textContent = fleet.company_name + ' — recorded sessions';
    scope.textContent = rows.length + (rows.length === 1 ? ' session loaded' : ' sessions loaded') +
      ' · Newest first · Browsing started ' + new Date(loadedAt).toLocaleString() + '. Refresh to see newer sessions and updated records.';
    older.hidden = !hasMore || rows.length >= MAX_ROWS;
    if (!rows.length) boundary.textContent = 'No recorded sessions were returned in this browsing window.';
    else if (hasMore && rows.length >= MAX_ROWS) boundary.textContent = '500-session browsing limit reached. Older records remain; this view is incomplete.';
    else if (hasMore) boundary.textContent = 'Older sessions remain. Load up to 50 more when you need them.';
    else boundary.textContent = 'No older sessions remain in this browsing window. Records may change or be deleted; refresh to start again.';
  }
  function validatePage(data, previousCursor) {
    var invalid = error('invalid_response', 'History could not be verified. Refresh history to start again.');
    if (!data || data.ok !== true || !data.fleet || !UUID.test(data.fleet.id || '') ||
        typeof data.fleet.company_name !== 'string' || !data.fleet.company_name.trim() || data.fleet.company_name.length > 160 ||
        data.telemetry_trust !== 'unverified_client_report' || !data.privacy ||
        data.privacy.includes_location !== false || data.privacy.includes_personal_media !== false || data.privacy.includes_raw_motion !== false ||
        !Array.isArray(data.sessions) || data.sessions.length > PAGE_SIZE || typeof data.has_more !== 'boolean') throw invalid;
    if (data.has_more ? data.sessions.length < 1 || typeof data.next_cursor !== 'string' ||
        !/^[A-Za-z0-9_-]+$/.test(data.next_cursor) || data.next_cursor.length > MAX_CURSOR_LENGTH || data.next_cursor === previousCursor :
        data.next_cursor !== null) throw invalid;
    if (fleet && fleet.id !== data.fleet.id) throw error('auth_session_changed', 'Fleet access changed. Refresh history to verify it again.');
    var ids = new Set(rows.map(function (session) { return session.id.toLowerCase(); }));
    var selected = data.sessions.map(function (session) {
      if (!session || !UUID.test(session.id || '') || ids.has(session.id.toLowerCase()) ||
          (session.driver_id !== null && !UUID.test(session.driver_id || '')) ||
          typeof session.driver_name !== 'string' || session.driver_name.length > 80 || typeof session.started_at !== 'string') throw invalid;
      ids.add(session.id.toLowerCase());
      // Retain only the fields this privacy-limited view actually displays.
      return { id: session.id, driver_id: session.driver_id, driver_name: session.driver_name || 'Driver',
        started_at: session.started_at, ended_at: session.ended_at, average_fatigue: session.average_fatigue,
        max_fatigue: session.max_fatigue, safety_score: session.safety_score,
        alert_count: session.alert_count, head_nod_count: session.head_nod_count };
    });
    return { fleet: { id: data.fleet.id, company_name: data.fleet.company_name }, sessions: selected,
      hasMore: data.has_more, cursor: data.next_cursor };
  }
  function apiError(response, data) {
    var code = data && data.error || 'history_unavailable';
    if (response.status === 401) return error('unauthorized', 'Sign in as the fleet owner to view protected history.');
    if (response.status === 403) return error('fleet_not_found', 'This account does not own a protected fleet. Use Fleet Setup or sign in with the owner account.');
    if (code === 'invalid_cursor' || code === 'invalid_query') return error('invalid_response', 'This browsing window could not continue. Refresh history to start again.');
    if (response.status === 501) return error('history_unavailable', 'Protected fleet history is not configured yet.');
    return error('history_unavailable', 'History could not be loaded. Check your connection and try again.');
  }
  async function load(isOlder) {
    if (busy || document.hidden) return;
    if (isOlder && (!checkView() || !hasMore || !cursor || rows.length >= MAX_ROWS)) return;
    if (!isOlder) clearView('Checking protected fleet access…');
    var version = generation, expectedUser = currentUserId(), requestedCursor = isOlder ? cursor : null;
    var abort = new AbortController(); controller = abort;
    var timer;
    setBusy(true); access.hidden = true;
    status.textContent = isOlder ? 'Loading older sessions…' : 'Loading protected session history…';
    try {
      await Promise.race([
        (async function () {
          if (!expectedUser) throw error('unauthorized', 'Sign in as the fleet owner to view protected history.');
          var auth = await backend.getSession();
          if (version !== generation) return;
          if (!auth || !auth.access_token) throw error('unauthorized', 'Sign in as the fleet owner to view protected history.');
          var requestContext = backend.captureAuthContext();
          if (currentUserId() !== expectedUser || auth.user?.id !== expectedUser || !requestContext.auth ||
              requestContext.auth.access_token !== auth.access_token || requestContext.auth.refresh_token !== auth.refresh_token ||
              requestContext.auth.user?.id !== expectedUser) throw error('auth_session_changed', 'Your signed-in account changed. Refresh history to verify access again.');
          backend.requireAuthContext(requestContext);
          // A token refresh is allowed only after the previous view's context was checked.
          context = requestContext;
          var path = '/api/fleet-session-history' + (requestedCursor ? '?cursor=' + encodeURIComponent(requestedCursor) : '');
          var response = await backend.fetchWithDeadline(path, { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: abort.signal,
            headers: { Accept: 'application/json', Authorization: 'Bearer ' + auth.access_token } });
          var data = await response.json();
          if (version !== generation) return;
          backend.requireAuthContext(requestContext);
          if (!response.ok) throw apiError(response, data);
          var page = validatePage(data, requestedCursor);
          var selected = page.sessions.slice(0, MAX_ROWS - rows.length);
          fleet = page.fleet;
          if (!loadedAt) loadedAt = Date.now();
          rows = rows.concat(selected); cursor = page.cursor;
          hasMore = page.hasMore || selected.length < page.sessions.length;
          if (!renderSessions()) return;
          updateScope(); older.textContent = 'Load older sessions';
          status.textContent = selected.length ? 'Loaded ' + selected.length + (selected.length === 1 ? ' session. ' : ' sessions. ') + rows.length + ' loaded in this browsing window.' :
            rows.length ? 'No further sessions were returned.' : 'No protected sessions were returned in this browsing window.';
        })(),
        new Promise(function (_, reject) {
          timer = setTimeout(function () {
            reject(error('load_timeout', 'History took too long to load. Refresh history to try again.'));
            abort.abort();
          }, LOAD_TIMEOUT_MS);
        }),
      ]);
    } catch (problem) {
      if (version !== generation) return;
      if (problem.code === 'load_timeout') {
        // Invalidate the whole attempt, including a getSession/JSON promise
        // that ignores cancellation and might otherwise finish after retry.
        clearView(problem.message);
      } else if (problem.code === 'auth_session_changed' || problem.code === 'unauthorized' || problem.code === 'fleet_not_found' ||
          context && !backend.isAuthContextCurrent(context)) {
        clearView(problem.message);
        access.hidden = false;
      } else {
        status.textContent = problem.code ? problem.message : 'History could not be loaded. Check your connection and try again.';
        if (problem.code === 'invalid_response') {
          hasMore = false; cursor = null; older.hidden = true;
          boundary.textContent = 'This browsing window could not continue. Refresh history to start again; any loaded rows are an incomplete view.';
        }
        else if (isOlder) older.textContent = 'Retry loading older sessions';
      }
    } finally {
      clearTimeout(timer);
      if (controller === abort) controller = null;
      if (version === generation) setBusy(false);
    }
  }
  refresh.addEventListener('click', function () { void load(false); });
  older.addEventListener('click', function () { void load(true); });
  driverFilter.addEventListener('input', renderSessions);
  periodFilter.addEventListener('change', renderSessions);
  completionFilter.addEventListener('change', renderSessions);
  clearFilters.addEventListener('click', function () {
    if (!checkView() || !context || !fleet) return;
    resetFilters();
    renderSessions();
  });
  window.addEventListener('storage', function (event) {
    if (event.key === 'occulert-auth' || event.key === null) clearView('Your account session changed. Refresh history to verify fleet access again.');
  });
  window.addEventListener('focus', checkView);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) checkView(); });
  window.addEventListener('pagehide', function () { clearView('Refresh history to load protected records again.'); });
  void load(false);
})();
