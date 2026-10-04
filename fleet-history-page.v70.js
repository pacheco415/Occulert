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
  var fromFilter = document.getElementById('historyFrom'), toFilter = document.getElementById('historyTo');
  var customDates = document.getElementById('historyCustomDates'), dateStatus = document.getElementById('historyDateStatus');
  var sortFilter = document.getElementById('historySort');
  var clearFilters = document.getElementById('historyClearFilters');
  var matches = document.getElementById('historyMatches');
  var empty = document.getElementById('historyEmpty');
  var exportButton = document.getElementById('historyExport');
  var exportStatus = document.getElementById('historyExportStatus');
  var printButton = document.getElementById('historyPrint'), printStatus = document.getElementById('historyPrintStatus');
  var printReport = document.getElementById('historyPrintReport'), printRequestedView = null, printRequestedAt = null;
  var PAGE_SIZE = 50, MAX_ROWS = 500, MAX_CURSOR_LENGTH = 1024, LOAD_TIMEOUT_MS = 8000;
  var EXPORT_MAX_AGE_MS = 5 * 60 * 1000, DOWNLOAD_CLEANUP_MS = 15000;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/;
  var DETECTOR_PIPELINES = { web_mediapipe_ear: 'Web camera (MediaPipe EAR)',
    ios_mlkit_eye_probability: 'iPhone (ML Kit eye probability)', android_mlkit_eye_probability: 'Android (ML Kit eye probability)' };
  var VERSION = /^[a-zA-Z0-9._() -]{1,80}$/;
  var rows = [], fleet = null, cursor = null, hasMore = false, loadedAt = null, serverQuery = null, driverFilterComplete = true;
  var context = null, generation = 0, busy = false, controller = null;
  var preferenceKey = null, restoredPreferenceKey = null, reloadRestoredRange = false;
  var preferenceStatus = document.getElementById('historyPreferenceStatus');
  var renderedView = null, viewLoadFailed = false, exportExpiryTimer = null;
  var pendingDownloadUrl = null, downloadCleanupTimer = null;
  if (!status || !access || !title || !scope || !list || !boundary || !refresh || !older ||
      !filters || !driverFilter || !periodFilter || !completionFilter || !fromFilter || !toFilter || !customDates || !dateStatus || !sortFilter ||
      !clearFilters || !matches || !empty || !exportButton || !exportStatus || !printButton || !printStatus || !printReport) return;
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
  function revokeDownload() {
    clearTimeout(downloadCleanupTimer); downloadCleanupTimer = null;
    if (pendingDownloadUrl) {
      try { URL.revokeObjectURL(pendingDownloadUrl); } catch (problem) { /* Cleanup must not block account clearing. */ }
      pendingDownloadUrl = null;
    }
  }
  function invalidateExport() {
    renderedView = null;
    clearTimeout(exportExpiryTimer); exportExpiryTimer = null;
    revokeDownload();
    exportButton.disabled = true;
    printButton.disabled = true;
    clearPrintReport();
  }
  function currentFilters() {
    return { driver: driverFilter.value, period: periodFilter.value, completion: completionFilter.value,
      from: fromFilter.value, to: toFilter.value, sort: sortFilter.value };
  }
  function serverFilters(now) {
    var range = dateRange(now);
    if (range.invalid) throw error('invalid_query', range.invalid);
    if (range.earliest !== null && range.earliest > now) throw error('invalid_query', 'From date must be today or earlier.');
    return { driver_id: driverFilter.value || null,
      from: range.earliest === null ? null : new Date(range.earliest).toISOString(),
      to: range.bounded ? new Date(Math.min(range.latestExclusive === null ? Infinity : range.latestExclusive, now + 1)).toISOString() : null };
  }
  function sameServerFilters(left, right) {
    return !!left && !!right && left.driver_id === right.driver_id && left.from === right.from && left.to === right.to;
  }
  function sameFilters(snapshot) {
    return snapshot.driver === driverFilter.value && snapshot.period === periodFilter.value && snapshot.completion === completionFilter.value &&
      snapshot.from === fromFilter.value && snapshot.to === toFilter.value && snapshot.sort === sortFilter.value;
  }
  function shownViewUnavailable(view, now) {
    if (!context || !fleet || !backend.isAuthContextCurrent(context)) return 'Verify fleet ownership and load sessions before exporting.';
    if (busy) return 'Wait for loading to finish before printing or exporting.';
    if (document.hidden) return 'Return to this page before printing or exporting.';
    if (viewLoadFailed) return 'A loading attempt failed. Refresh history before printing or exporting.';
    if (dateRange(now).invalid) return dateRange(now).invalid;
    if (!view || view !== renderedView || view.generation !== generation || view.context !== context || view.sourceRows !== rows ||
        view.ownerId !== currentUserId() || view.fleetId !== fleet.id || view.fleetName !== fleet.company_name || view.loadedAt !== loadedAt ||
        view.loadedCount !== rows.length || view.hasMore !== hasMore || view.serverQuery !== serverQuery || !sameFilters(view.filters)) {
      return 'The shown view changed. Refresh history before printing or exporting.';
    }
    if (!Number.isFinite(view.loadedAt) || view.loadedAt <= 0 || now < view.loadedAt || now < view.renderedAt || now - view.loadedAt > EXPORT_MAX_AGE_MS) {
      return 'This browsing window is over five minutes old or its clock changed. Refresh history before printing or exporting.';
    }
    if (!view.sessions.length) return 'No shown sessions to print or export. Change the filters or load older sessions when available.';
    return '';
  }
  function exportUnavailable(view, now) {
    var reason = shownViewUnavailable(view, now);
    if (reason) return reason;
    if (!window.OcculertSecurity || typeof window.OcculertSecurity.csvCell !== 'function') return 'CSV export is unavailable. Reload this page to restore export support; you can still browse history.';
    if (typeof Blob !== 'function' || typeof URL.createObjectURL !== 'function' || typeof URL.revokeObjectURL !== 'function') return 'CSV download is unavailable in this browser. You can still browse history.';
    return '';
  }
  function updateExportState() {
    var reason = exportUnavailable(renderedView, Date.now());
    exportButton.disabled = Boolean(reason);
    exportStatus.textContent = reason || 'Export ready for the currently shown loaded sessions. Session reports remain unverified.';
    var printReason = shownViewUnavailable(renderedView, Date.now()) || (typeof window.print !== 'function' ? 'Printing is unavailable in this browser.' : '');
    printButton.disabled = Boolean(printReason);
    printStatus.textContent = printReason || 'Print ready for the shown sessions in their displayed order. Use your browser’s Save as PDF option.';
  }
  function requireExportView(view, now) {
    if (!checkView()) throw error('auth_session_changed', 'Your signed-in account changed. Refresh history to verify fleet access again.');
    var reason = exportUnavailable(view, now);
    if (reason) throw error('export_unavailable', reason);
    backend.requireAuthContext(view.context);
  }
  function setBusy(value) {
    if (value) invalidateExport();
    busy = value;
    refresh.disabled = value;
    older.disabled = value;
    filters.disabled = value || !fleet || !context;
    list.setAttribute('aria-busy', String(value));
    updateExportState();
  }
  function preferenceMessage(message) { if (preferenceStatus) preferenceStatus.textContent = message; }
  function forgetPreferences() {
    if (preferenceKey) { try { window.localStorage.removeItem(preferenceKey); } catch (_) {} }
    preferenceKey = null; restoredPreferenceKey = null;
  }
  function preferenceValues() {
    var value = { version: 1, period: periodFilter.value, completion: completionFilter.value,
      sort: sortFilter.value, from: periodFilter.value === 'custom' ? fromFilter.value : '',
      to: periodFilter.value === 'custom' ? toFilter.value : '' };
    return validPreferences(value) ? value : null;
  }
  function validPreferences(value) {
    if (!value || Array.isArray(value) || value.version !== 1 ||
        !['all', '7', '30', 'custom'].includes(value.period) ||
        !['all', 'completed', 'no_end', 'invalid'].includes(value.completion) ||
        !['newest', 'oldest', 'alerts', 'fatigue', 'score', 'duration'].includes(value.sort) ||
        typeof value.from !== 'string' || typeof value.to !== 'string' || value.from.length > 10 || value.to.length > 10) return false;
    if (value.period !== 'custom') return value.from === '' && value.to === '';
    var from = value.from ? localCalendarDay(value.from) : null, to = value.to ? localCalendarDay(value.to) : null;
    return Boolean((from || to) && (!from || from.getTime() <= Date.now()) && (!value.from || from) && (!value.to || to) && (!from || !to || from <= to));
  }
  function savePreferences() {
    if (!checkView() || !context || !fleet || !preferenceKey) return;
    var value = preferenceValues();
    if (!value) return;
    try {
      window.localStorage.setItem(preferenceKey, JSON.stringify(value));
      preferenceMessage('Date, end status and sort remembered on this device for this account and fleet. Driver selection is not saved.');
    } catch (_) { preferenceMessage('View preferences could not be saved on this device. You can still browse history.'); }
  }
  function restorePreferences() {
    // Read only after the server confirms this account owns the returned fleet.
    var key = 'occulert-history-view-v1:' + currentUserId() + ':' + fleet.id;
    preferenceKey = key;
    if (restoredPreferenceKey === key) return false;
    restoredPreferenceKey = key;
    try {
      var raw = window.localStorage.getItem(key);
      if (raw === null) return false;
      if (raw.length > 512) return false;
      var value = JSON.parse(raw);
      if (!validPreferences(value)) return false;
      periodFilter.value = value.period; completionFilter.value = value.completion; sortFilter.value = value.sort;
      fromFilter.value = value.from; toFilter.value = value.to; customDates.hidden = value.period !== 'custom';
      preferenceMessage('Restored date, end status and sort for this account and fleet. Driver selection is not saved.');
      // A restored range must be requested from the server, never applied to an all-time page.
      return value.period !== 'all';
    } catch (_) { preferenceMessage('Saved preferences are unavailable. Default filters are shown.'); return false; }
  }
  function resetFilters() {
    driverFilter.value = '';
    periodFilter.value = 'all';
    completionFilter.value = 'all';
    fromFilter.value = ''; toFilter.value = ''; sortFilter.value = 'newest'; customDates.hidden = true; dateStatus.textContent = '';
  }
  function clearView(message, preserveFilters) {
    invalidateExport();
    generation += 1;
    if (controller) controller.abort();
    controller = null;
    rows = []; fleet = null; cursor = null; hasMore = false; loadedAt = null; context = null; serverQuery = null; driverFilterComplete = true;
    viewLoadFailed = false;
    if (!preserveFilters) {
      preferenceKey = null; restoredPreferenceKey = null; reloadRestoredRange = false;
      resetFilters(); driverFilter.replaceChildren(node('option', 'All drivers')); driverFilter.firstChild.value = '';
    }
    list.replaceChildren();
    matches.textContent = 'Verify fleet ownership to filter protected sessions.';
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
      forgetPreferences();
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
  function metricNumber(value, isCount) {
    if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'object' ||
        (typeof value === 'string' && !value.trim())) return null;
    var number = Number(value);
    if (!Number.isFinite(number) || number < 0 || (isCount ? !Number.isSafeInteger(number) : number > 100)) return null;
    return isCount ? number : Math.round(number);
  }
  function metric(value, isCount) {
    var number = metricNumber(value, isCount);
    return number === null ? 'Not recorded' : String(number) + (isCount ? '' : ' / 100');
  }
  function detectorPipeline(value) { return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DETECTOR_PIPELINES, value) ? value : null; }
  function detectorVersion(value) { return typeof value === 'string' && VERSION.test(value) ? value : null; }
  function detectorLabel(value) { return value ? DETECTOR_PIPELINES[value] : 'Not recorded'; }
  function detectorProvenanceTrust(session) {
    return session.detector_pipeline || session.detector_version || session.app_version ? 'client_declared' : 'not_recorded';
  }
  function appendSessions(sessions, now, target) {
    var fragment = document.createDocumentFragment();
    sessions.forEach(function (session) {
      var item = node('article', undefined, 'history-session');
      item.setAttribute('role', 'listitem');
      var heading = node('h3', session.driver_name);
      heading.id = (target ? 'printed-history-session-' : 'history-session-') + session.id;
      item.setAttribute('aria-labelledby', heading.id);
      var description = node('p', date(session.started_at) + ' · ' + completion(session, now), 'muted');
      var values = node('dl', undefined, 'history-metrics');
      [
        ['Recorded end', date(session.ended_at)], ['Recorded duration', duration(session, now)],
        ['Safety score', metric(session.safety_score, false)], ['Average fatigue', metric(session.average_fatigue, false)],
        ['Maximum fatigue', metric(session.max_fatigue, false)], ['Reported alerts', metric(session.alert_count, true)],
        ['Reported head nods', metric(session.head_nod_count, true)],
        ['Detector pipeline (client declared)', detectorLabel(session.detector_pipeline)],
        ['Detector version (client declared)', session.detector_version || 'Not recorded'],
        ['App version (client declared)', session.app_version || 'Not recorded'],
      ].forEach(function (entry) {
        var group = node('div'); group.append(node('dt', entry[0]), node('dd', entry[1])); values.appendChild(group);
      });
      item.append(heading, description, values); fragment.appendChild(item);
    });
    (target || list).appendChild(fragment);
  }
  function localCalendarDay(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    var year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    if (year < 1 || month < 1 || month > 12 || day < 1) return null;
    var parsed = new Date(0); parsed.setFullYear(year, month - 1, day); parsed.setHours(0, 0, 0, 0);
    return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day ? parsed : null;
  }
  function dateRange(now) {
    var period = periodFilter.value, earliest = null, latestExclusive = null;
    if (period === '7' || period === '30') {
      var calendarStart = new Date(now); calendarStart.setHours(0, 0, 0, 0);
      calendarStart.setDate(calendarStart.getDate() - (period === '7' ? 6 : 29)); earliest = calendarStart.getTime();
    } else if (period === 'custom') {
      if (fromFilter.validity.badInput || toFilter.validity.badInput) return { invalid: 'Enter valid From and To dates.' };
      if (!fromFilter.value && !toFilter.value) return { invalid: 'Enter at least one date for a custom range.' };
      var from = fromFilter.value ? localCalendarDay(fromFilter.value) : null;
      var to = toFilter.value ? localCalendarDay(toFilter.value) : null;
      if (fromFilter.value && !from || toFilter.value && !to) return { invalid: 'Enter valid From and To dates.' };
      if (from && to && from.getTime() > to.getTime()) return { invalid: 'From date must be on or before To date.' };
      if (from) earliest = from.getTime();
      if (to) { to.setDate(to.getDate() + 1); latestExclusive = to.getTime(); }
    }
    return { earliest: earliest, latestExclusive: latestExclusive, bounded: period !== 'all', invalid: '' };
  }
  function sortLabel(mode) {
    return ({ newest: 'Newest first', oldest: 'Oldest first', alerts: 'Most reported alerts', fatigue: 'Highest maximum fatigue',
      score: 'Lowest safety score', duration: 'Longest recorded duration' })[mode] || 'Newest first';
  }
  function sortSessions(selected, mode, now) {
    var positions = new Map(rows.map(function (session, index) { return [session.id, index]; }));
    function value(session) {
      if (mode === 'alerts') return metricNumber(session.alert_count, true);
      if (mode === 'fatigue') return metricNumber(session.max_fatigue, false);
      if (mode === 'score') return metricNumber(session.safety_score, false);
      if (mode === 'duration') {
        var start = time(session.started_at), end = time(session.ended_at);
        return start === null || end === null || end < start || end > now ? null : end - start;
      }
      return time(session.started_at);
    }
    var direction = mode === 'oldest' || mode === 'score' ? 1 : -1;
    return selected.sort(function (left, right) {
      var a = value(left), b = value(right);
      if (a === null && b !== null) return 1;
      if (a !== null && b === null) return -1;
      if (a !== null && b !== null && a !== b) return (a < b ? -1 : 1) * direction;
      return positions.get(left.id) - positions.get(right.id);
    });
  }
  function renderSessions() {
    invalidateExport();
    // Every redraw, including loaded-record sort/status filters, must still belong to the verified account.
    if (!checkView() || !context || !fleet) return false;
    backend.requireAuthContext(context);
    var now = Date.now(), period = periodFilter.value, selectedCompletion = completionFilter.value;
    customDates.hidden = period !== 'custom';
    var range = dateRange(now), earliest = range.earliest;
    dateStatus.textContent = range.invalid;
    var selected = rows.filter(function (session) {
      if (range.invalid) return false;
      return selectedCompletion === 'all' || completionState(session, now) === selectedCompletion;
    });
    sortSessions(selected, sortFilter.value, now);
    list.replaceChildren();
    appendSessions(selected, now);
    matches.textContent = selected.length + ' of ' + rows.length + ' loaded server-matched sessions shown. ' + sortLabel(sortFilter.value) +
      '. Load older matching sessions to expand this view, up to the 500-session display limit.';
    empty.hidden = selected.length !== 0;
    empty.textContent = range.invalid || (rows.length ? 'No loaded sessions match the recorded end status. Change that filter or load older matching sessions.' :
      'No protected sessions matched the selected driver and start dates. Refresh to check for newer records.');
    // Export this exact selection and comparison time, rather than reevaluating
    // date/status filters later against a clock or calendar that may have changed.
    var timezone = 'Local browser timezone';
    try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || timezone; } catch (problem) { /* A name is metadata only. */ }
    renderedView = Object.freeze({ generation: generation, context: context, ownerId: currentUserId(), sourceRows: rows,
      fleetId: fleet.id, fleetName: fleet.company_name,
      sessions: Object.freeze(selected.slice()), filters: Object.freeze(currentFilters()), renderedAt: now,
      earliest: earliest, latestExclusive: range.latestExclusive, timezone: timezone, loadedAt: loadedAt, loadedCount: rows.length, hasMore: hasMore,
      serverQuery: serverQuery,
      limitReached: rows.length >= MAX_ROWS });
    var remaining = loadedAt + EXPORT_MAX_AGE_MS + 1 - Date.now();
    if (remaining > 0) exportExpiryTimer = setTimeout(function () {
      invalidateExport();
      exportStatus.textContent = 'This browsing window is over five minutes old. Refresh history before exporting.';
      printStatus.textContent = 'This browsing window is over five minutes old. Refresh history before printing.';
    }, remaining);
    updateExportState();
    return true;
  }
  function csvLine(cells) {
    return cells.map(function (value) {
      return '"' + window.OcculertSecurity.csvCell(value).replace(/"/g, '""') + '"';
    }).join(',');
  }
  function csvTimestamp(value) { return time(value) === null ? '' : value; }
  function csvDuration(session, now) {
    var value = duration(session, now);
    return value === 'Not recorded' ? '' : value;
  }
  function exportShownSessions() {
    var view = renderedView, anchor = null, requested = false, outcome = '';
    try {
      var requestedAt = Date.now();
      requireExportView(view, requestedAt);
      exportButton.disabled = true;
      revokeDownload();
      var filter = view.filters;
      var periodName = filter.period === '7' ? 'Last 7 days' : filter.period === '30' ? 'Last 30 days' : filter.period === 'custom' ? 'Custom dates' : 'All time';
      var completionName = filter.completion === 'completed' ? 'Completed session' : filter.completion === 'no_end' ? 'No recorded end time' :
        filter.completion === 'invalid' ? 'Invalid recorded dates' : 'All recorded end statuses';
      var rule = filter.period === 'custom' ? 'selected_local_days_start_inclusive_end_exclusive_and_through_render_time' : filter.period === 'all' ? 'all_time_no_start_date_bounds' :
        filter.period === '7' ? 'today_and_previous_6_local_calendar_days_through_render_time' : 'today_and_previous_29_local_calendar_days_through_render_time';
      var metadata = ['unverified_client_report', 'currently_shown_loaded_sessions_only', view.loadedCount, view.sessions.length,
        filter.driver, periodName, completionName, rule, view.timezone,
        view.earliest === null ? '' : new Date(view.earliest).toISOString(),
        filter.period === '7' || filter.period === '30' ? new Date(view.renderedAt).toISOString() : '',
        new Date(view.loadedAt).toISOString(), new Date(view.renderedAt).toISOString(), new Date(requestedAt).toISOString(),
        String(view.hasMore), String(view.limitReached), 'loaded_records_only_not_a_full_fleet_or_period_report',
        sortLabel(filter.sort), filter.period === 'custom' ? filter.from : '', filter.period === 'custom' ? filter.to : '',
        view.latestExclusive === null ? '' : new Date(view.latestExclusive).toISOString()];
      var header = ['driver_name', 'recorded_start_timestamp', 'recorded_end_timestamp', 'recorded_duration', 'recorded_end_status',
        'safety_score', 'average_fatigue', 'maximum_fatigue', 'reported_alert_count', 'reported_head_nod_count',
        'detector_pipeline', 'detector_version', 'app_version', 'detector_provenance_trust',
        'telemetry_trust', 'export_scope', 'loaded_session_count', 'shown_session_count', 'driver_name_contains_filter',
        'recorded_start_period_filter', 'recorded_end_status_filter', 'local_calendar_period_rule', 'local_calendar_timezone',
        'period_start_inclusive_utc', 'period_end_inclusive_utc', 'browsing_started_at_utc', 'shown_view_rendered_at_utc',
        'export_requested_at_utc', 'older_records_remain', 'browsing_limit_reached', 'scope_limit',
        'shown_sort_order', 'custom_from_local_date', 'custom_to_local_date', 'custom_end_exclusive_utc'];
      var lines = [csvLine(header)];
      view.sessions.forEach(function (session) {
        lines.push(csvLine([session.driver_name, csvTimestamp(session.started_at), csvTimestamp(session.ended_at),
          csvDuration(session, view.renderedAt), completion(session, view.renderedAt), metricNumber(session.safety_score, false),
          metricNumber(session.average_fatigue, false), metricNumber(session.max_fatigue, false), metricNumber(session.alert_count, true),
          metricNumber(session.head_nod_count, true), session.detector_pipeline || '', session.detector_version || '',
          session.app_version || '', detectorProvenanceTrust(session)].concat(metadata)));
      });
      var blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
      pendingDownloadUrl = URL.createObjectURL(blob);
      anchor = document.createElement('a');
      anchor.href = pendingDownloadUrl;
      anchor.download = 'occulert-shown-fleet-sessions.csv';
      anchor.hidden = true;
      document.body.appendChild(anchor);
      // Final checks happen after CSV/blob preparation and immediately before download.
      requireExportView(view, Date.now());
      anchor.click();
      requested = true;
      downloadCleanupTimer = setTimeout(revokeDownload, DOWNLOAD_CLEANUP_MS);
      outcome = 'Download requested for ' + view.sessions.length + ' shown loaded sessions. Your browser handles saving the CSV.';
    } catch (problem) {
      if (problem.code === 'auth_session_changed' || context && !backend.isAuthContextCurrent(context)) {
        clearView('Your signed-in account changed. Refresh history to verify fleet access again.');
      } else {
        outcome = problem.code === 'export_unavailable' ? problem.message : 'CSV download could not be requested. Try Export shown sessions again, or refresh history.';
      }
    } finally {
      if (anchor) anchor.remove();
      if (!requested) revokeDownload();
      updateExportState();
      if (outcome && renderedView === view && checkView()) exportStatus.textContent = outcome;
    }
  }
  function clearPrintReport() {
    printRequestedView = null; printRequestedAt = null;
    printReport.replaceChildren(node('h1', 'Protected history unavailable for printing'),
      node('p', 'Verify fleet ownership, load sessions and use Print shown sessions to prepare the current view.'));
  }
  function requirePrintView(view, now) {
    if (!checkView()) throw error('auth_session_changed', 'Your signed-in account changed. Refresh history to verify fleet access again.');
    var reason = shownViewUnavailable(view, now);
    if (reason) throw error('print_unavailable', reason);
    backend.requireAuthContext(view.context);
  }
  function preparePrint(view, requestedAt) {
    requirePrintView(view, Date.now());
    var filter = view.filters;
    var period = filter.period === '7' ? 'Last 7 days' : filter.period === '30' ? 'Last 30 days' : filter.period === 'custom' ? 'Custom dates' : 'All time';
    var completionName = filter.completion === 'completed' ? 'Completed session' : filter.completion === 'no_end' ? 'No recorded end time' :
      filter.completion === 'invalid' ? 'Invalid recorded dates' : 'All recorded end statuses';
    var summary = node('dl', undefined, 'history-print-summary');
    [
      ['Fleet', view.fleetName], ['Shown sessions', view.sessions.length + ' of ' + view.loadedCount + ' loaded'],
      ['Driver name contains', filter.driver.trim() || 'Any loaded driver'], ['Recorded start dates', period],
      ['Custom local From / To', filter.period === 'custom' ? (filter.from || 'Open start') + ' / ' + (filter.to || 'Open end') : 'Not selected'],
      ['Recorded end status', completionName], ['Shown order', sortLabel(filter.sort)], ['Local calendar timezone', view.timezone],
      ['Browsing started', new Date(view.loadedAt).toLocaleString()], ['Shown view prepared', new Date(view.renderedAt).toLocaleString()],
      ['Print requested', new Date(requestedAt).toLocaleString()], ['Older records remain', view.hasMore ? 'Yes; this view is incomplete' : 'No further rows in this browsing window'],
      ['Browsing limit', '500 loaded sessions maximum' + (view.limitReached ? '; limit reached' : '')],
    ].forEach(function (entry) { var group = node('div'); group.append(node('dt', entry[0]), node('dd', String(entry[1]))); summary.appendChild(group); });
    var printedList = node('div', undefined, 'history-list'); printedList.setAttribute('role', 'list');
    appendSessions(view.sessions, view.renderedAt, printedList);
    printReport.replaceChildren(node('h1', 'Occulert — shown fleet sessions'), summary,
      node('p', 'Loaded-record snapshot of exactly the sessions shown in the selected order. It is not a complete fleet archive or complete-period report. Dates use the selected local calendar days and exclude future starts in date ranges. Records may change or be deleted.', 'history-print-note'),
      node('p', 'Unverified client reports: scores and reported alerts are operational observations, not independently measured evidence or proof of driver safety. A missing end time does not prove a session is active. This snapshot excludes IDs, location, personal media, audio, raw motion, events and saved follow-ups.', 'history-print-note'), printedList);
    requirePrintView(view, Date.now());
  }
  function printShownSessions() {
    var view = renderedView;
    try {
      if (typeof window.print !== 'function') throw error('print_unavailable', 'Printing is unavailable in this browser.');
      printRequestedAt = Date.now(); preparePrint(view, printRequestedAt); printRequestedView = view;
      requirePrintView(view, Date.now());
      printStatus.textContent = 'Print dialog requested for ' + view.sessions.length + ' shown sessions. Choose Save as PDF in your browser if you want a file.';
      window.print();
    } catch (problem) {
      clearPrintReport();
      if (problem.code === 'auth_session_changed' || context && !backend.isAuthContextCurrent(context)) clearView('Your signed-in account changed. Refresh history to verify fleet access again.');
      else printStatus.textContent = problem.code === 'print_unavailable' ? problem.message : 'The print dialog could not be requested. Refresh history and try again.';
    }
  }
  function updateScope() {
    title.textContent = fleet.company_name + ' — recorded sessions';
    scope.textContent = rows.length + (rows.length === 1 ? ' matching session loaded' : ' matching sessions loaded') +
      ' · Pagination loads newest first · Browsing started ' + new Date(loadedAt).toLocaleString() + '. Refresh to see newer sessions and updated records.' +
      (driverFilterComplete ? '' : ' The driver selector shows up to 1,000 roster names; date filters still search every stored session.');
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
        !sameServerFilters(data.filters, serverQuery) || !Array.isArray(data.drivers) || data.drivers.length > 1000 ||
        typeof data.driver_filter_complete !== 'boolean' || data.drivers.some(function (driver) {
          return !driver || !UUID.test(driver.id || '') || typeof driver.name !== 'string' || driver.name.length > 80;
        }) ||
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
        alert_count: session.alert_count, head_nod_count: session.head_nod_count,
        detector_pipeline: detectorPipeline(session.detector_pipeline), detector_version: detectorVersion(session.detector_version),
        app_version: detectorVersion(session.app_version) };
    });
    return { fleet: { id: data.fleet.id, company_name: data.fleet.company_name }, sessions: selected,
      drivers: data.drivers, driverFilterComplete: data.driver_filter_complete,
      hasMore: data.has_more, cursor: data.next_cursor };
  }
  function apiError(response, data) {
    var code = data && data.error || 'history_unavailable';
    if (response.status === 401) return error('unauthorized', 'Sign in as the fleet owner to view protected history.');
    if (response.status === 403) return error('fleet_not_found', 'This account does not own a protected fleet. Use Fleet Setup or sign in with the owner account.');
    if (code === 'invalid_cursor' || code === 'invalid_query' || code === 'invalid_driver') return error('invalid_response', 'The selected filter or browsing window is no longer valid. Refresh history to start again.');
    if (response.status === 501) return error('history_unavailable', 'Protected fleet history is not configured yet.');
    return error('history_unavailable', 'History could not be loaded. Check your connection and try again.');
  }
  async function load(isOlder, preserveFilters) {
    if (busy || document.hidden) return;
    if (isOlder && (!checkView() || !hasMore || !cursor || rows.length >= MAX_ROWS)) return;
    if (!isOlder) {
      checkView();
      if (!preserveFilters) resetFilters();
      var nextQuery;
      try { nextQuery = serverFilters(Date.now()); }
      catch (problem) {
        // Keep verified controls editable so an invalid range can be corrected.
        invalidateExport(); status.textContent = problem.message; dateStatus.textContent = problem.message;
        list.replaceChildren(); matches.textContent = 'No sessions shown. Correct the selected dates to load a new view.';
        empty.hidden = false; empty.textContent = problem.message; older.disabled = true;
        return;
      }
      clearView('Checking protected fleet access…', preserveFilters);
      serverQuery = nextQuery;
    }
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
          var queryParts = requestedCursor ? ['cursor=' + encodeURIComponent(requestedCursor)] :
            ['driver_id', 'from', 'to'].filter(function (key) { return serverQuery[key]; })
              .map(function (key) { return key + '=' + encodeURIComponent(serverQuery[key]); });
          var path = '/api/fleet-session-history' + (queryParts.length ? '?' + queryParts.join('&') : '');
          var response = await backend.fetchWithDeadline(path, { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: abort.signal,
            headers: { Accept: 'application/json', Authorization: 'Bearer ' + auth.access_token } });
          var data = await response.json();
          if (version !== generation) return;
          backend.requireAuthContext(requestContext);
          if (!response.ok) throw apiError(response, data);
          var page = validatePage(data, requestedCursor);
          var selected = page.sessions.slice(0, MAX_ROWS - rows.length);
          var selectedDriver = driverFilter.value;
          driverFilter.replaceChildren(node('option', 'All drivers'));
          driverFilter.firstChild.value = '';
          page.drivers.forEach(function (driver) { var option = node('option', driver.name); option.value = driver.id; driverFilter.appendChild(option); });
          driverFilter.value = selectedDriver;
          fleet = page.fleet;
          if (!isOlder && restorePreferences()) { reloadRestoredRange = true; return; }
          driverFilterComplete = page.driverFilterComplete;
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
      viewLoadFailed = true;
      invalidateExport();
      if (problem.code === 'load_timeout') {
        // Invalidate the whole attempt, including a getSession/JSON promise
        // that ignores cancellation and might otherwise finish after retry.
        clearView(problem.message);
      } else if (problem.code === 'auth_session_changed' || problem.code === 'unauthorized' || problem.code === 'fleet_not_found' ||
          context && !backend.isAuthContextCurrent(context)) {
        forgetPreferences(); clearView(problem.message);
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
      if (version === generation) {
        setBusy(false);
        if (reloadRestoredRange) { reloadRestoredRange = false; void load(false, true); }
      }
    }
  }
  refresh.addEventListener('click', function () { void load(false, true); });
  older.addEventListener('click', function () { void load(true); });
  exportButton.addEventListener('click', exportShownSessions);
  printButton.addEventListener('click', printShownSessions);
  driverFilter.addEventListener('change', function () { void load(false, true); });
  periodFilter.addEventListener('change', function () {
    customDates.hidden = periodFilter.value !== 'custom';
    savePreferences();
    if (periodFilter.value !== 'custom' || fromFilter.value || toFilter.value) void load(false, true);
    else {
      invalidateExport();
      dateStatus.textContent = 'Choose a From or To date to search the protected fleet.';
      status.textContent = 'Choose a custom date and load the matching sessions.';
    }
  });
  completionFilter.addEventListener('change', function () { savePreferences(); renderSessions(); });
  fromFilter.addEventListener('change', function () { savePreferences(); if (fromFilter.value || toFilter.value) void load(false, true); });
  toFilter.addEventListener('change', function () { savePreferences(); if (fromFilter.value || toFilter.value) void load(false, true); });
  sortFilter.addEventListener('change', function () { savePreferences(); renderSessions(); });
  clearFilters.addEventListener('click', function () {
    if (!checkView() || !context || !fleet) return;
    forgetPreferences();
    resetFilters();
    preferenceMessage('Saved view preferences cleared. Default filters are shown.');
    void load(false, true);
  });
  window.addEventListener('storage', function (event) {
    if (event.key === 'occulert-auth' || event.key === null) { forgetPreferences(); clearView('Your account session changed. Refresh history to verify fleet access again.'); }
  });
  window.addEventListener('focus', function () { if (checkView()) updateExportState(); });
  document.addEventListener('visibilitychange', function () { if (checkView()) updateExportState(); });
  window.addEventListener('pagehide', function () { clearView('Refresh history to load protected records again.'); });
  window.addEventListener('beforeprint', function () {
    // Browser-menu printing follows the same fresh owner/view checks as the button.
    try { preparePrint(printRequestedView || renderedView, printRequestedAt || Date.now()); }
    catch (problem) { clearPrintReport(); printReport.appendChild(node('p', problem.code ? problem.message : 'Protected history could not be prepared. Refresh and try again.')); }
  });
  window.addEventListener('afterprint', function () { clearPrintReport(); if (checkView()) updateExportState(); });
  void load(false);
})();
