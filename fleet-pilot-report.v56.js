(function () {
  'use strict';
  var MAX_AGE_MS = 5 * 60 * 1000;
  var REVIEW_REFRESH_MS = 2 * 60 * 1000;
  function numeric(value, min, max) {
    if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'object' ||
        (typeof value === 'string' && !value.trim())) return null;
    var number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : null;
  }
  function time(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    var parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  function fresh(value, now) { return Number.isFinite(value) && value > 0 && now >= value && now - value <= MAX_AGE_MS; }
  function sourceAccess(input, now) {
    if (!input.fleetMode || !input.userId || input.currentUserId !== input.userId) return 'Sign in as the fleet owner to load a protected report. Local and demo data are excluded.';
    if (!input.lastSuccessfulAt) return 'Protected report unavailable. Refresh the protected fleet data.';
    if (input.summaryValid !== true || !Array.isArray(input.sessions) || !Array.isArray(input.drivers)) return 'Protected report withheld: session or roster records were missing from the response.';
    if (input.telemetryTrust !== 'unverified_client_report' || !input.privacy ||
        input.privacy.includes_location !== false || input.privacy.includes_personal_media !== false ||
        input.privacy.includes_raw_motion !== false) return 'Protected report withheld: the response did not confirm the expected telemetry and privacy boundaries.';
    if (input.refreshFailures > 0 || !fresh(input.lastSuccessfulAt, now)) return 'Protected data is stale or the latest refresh failed. Refresh before printing; saved counts may have changed.';
    return '';
  }
  function reviewCounts(sessions, review, now, ownerId) {
    if (!sessions.length) return { missing: 0, reviewed: 0, unknown: 0, message: 'No sessions in this window need a saved follow-up.' };
    if (!review || review.status !== 'ready' || review.ownerId !== ownerId || !fresh(review.loadedAt, now)) {
      return { missing: null, reviewed: null, unknown: sessions.length, message: review?.status === 'loading'
        ? 'Loading saved manager review counts…' : review?.message || 'Saved review counts are unavailable or stale. Refresh review counts.' };
    }
    var outcomes = new Map((Array.isArray(review.sessions) ? review.sessions : []).map(function (row) { return [String(row.id || ''), row.followup]; }));
    var reviewed = 0, missing = 0, unknown = 0;
    sessions.forEach(function (session) {
      var marker = outcomes.get(String(session.id || ''));
      if (!marker || !Number.isInteger(marker.version) || marker.version < 0 ||
          !['open', 'in_progress', 'reviewed'].includes(marker.status) || (marker.status === 'reviewed' && marker.version === 0)) unknown += 1;
      else if (marker.status === 'reviewed') reviewed += 1;
      else missing += 1;
    });
    return { missing: unknown ? null : missing, reviewed: unknown ? null : reviewed, unknown: unknown,
      message: unknown ? unknown + ' session records could not be matched to current protected follow-ups. Review counts are unavailable.'
        : reviewed + ' saved Reviewed · ' + missing + ' without a saved Reviewed follow-up. Follow-ups refreshed: ' + new Date(review.loadedAt).toISOString() + '. A manager marker does not prove a tester review or validate telemetry.' };
  }
  function summarize(input, review, now) {
    input = input || {}; now = Number.isFinite(now) ? now : Date.now();
    var days = Number(input.days) === 7 ? 7 : 30, error = sourceAccess(input, now);
    if (error) return { available: false, reason: error, days: days };
    var source = (Array.isArray(input.sessions) ? input.sessions : []).slice(0, 50);
    var cutoff = now - days * 86400000, invalidStarts = 0;
    var sessions = source.filter(function (session) {
      var started = time(session?.started_at);
      if (started === null || started > now) { invalidStarts += 1; return false; }
      return started >= cutoff;
    });
    var active = (Array.isArray(input.drivers) ? input.drivers : []).filter(function (driver) { return driver && driver.active !== false; });
    var activeIds = new Set(active.map(function (driver) { return String(driver.id || ''); }).filter(Boolean));
    var reporting = new Set(sessions.map(function (session) { return String(session.driver_id || ''); }).filter(function (id) { return activeIds.has(id); }));
    var scores = [], completed = 0, noEnd = 0, invalidEnds = 0, alerts = 0, missingAlerts = 0;
    sessions.forEach(function (session) {
      var score = numeric(session.safety_score, 0, 100);
      if (score !== null) scores.push(score);
      var start = time(session.started_at), end = time(session.ended_at);
      if (session.ended_at === null || session.ended_at === undefined || session.ended_at === '') noEnd += 1;
      else if (end !== null && end >= start && end <= now) completed += 1;
      else invalidEnds += 1;
      var count = numeric(session.alert_count, 0, Number.MAX_SAFE_INTEGER);
      if (count === null || !Number.isInteger(count)) missingAlerts += 1;
      else alerts += count;
    });
    return { available: true, days: days, fleetName: String(input.fleetName || 'Protected fleet').slice(0, 120),
      generatedAt: now, updatedAt: input.lastSuccessfulAt, windowStart: cutoff, sourceCount: source.length,
      capped: source.length === 50, sessions: sessions.length, completed: completed, noEnd: noEnd, invalidEnds: invalidEnds,
      interrupted: null, unscored: sessions.length - scores.length, scored: scores.length,
      average: scores.length ? Math.round(scores.reduce(function (sum, value) { return sum + value; }, 0) / scores.length) : null,
      alerts: alerts, missingAlerts: missingAlerts, invalidStarts: invalidStarts, activeDrivers: active.length,
      reportingDrivers: reporting.size, coverage: active.length ? Math.round(reporting.size / active.length * 100) : null,
      review: reviewCounts(sessions, review, now, input.userId) };
  }
  function reportRows(summary) {
    return [
      ['Sessions started in window', String(summary.sessions)],
      ['Completed records (valid recorded end time)', String(summary.completed)],
      ['No recorded end time (state unknown)', String(summary.noEnd)],
      ['Invalid recorded end time', String(summary.invalidEnds)],
      ['Interrupted sessions', 'Unavailable — interruption reason omitted'],
      ['Unscored records (missing, withheld, or invalid)', String(summary.unscored)],
      ['Saved Reviewed manager follow-ups', summary.review.reviewed === null ? 'Unavailable' : String(summary.review.reviewed)],
      ['Sessions without a saved Reviewed follow-up', summary.review.missing === null ? 'Unavailable' : String(summary.review.missing)],
      ['Active roster drivers represented in window', summary.reportingDrivers + ' of ' + summary.activeDrivers + (summary.coverage === null ? ' (no active roster)' : ' (' + summary.coverage + '%)')],
      ['Average client-reported score', summary.average === null ? 'Not recorded' : summary.average + '/100 across ' + summary.scored + ' scored records'],
      ['Client-reported alerts', summary.sessions > 0 && summary.sessions === summary.missingAlerts ? 'Not recorded' :
        summary.alerts + ' across ' + (summary.sessions - summary.missingAlerts) + ' records with valid alert counts'],
    ];
  }
  function reportNotes(summary) {
    return [
      'Bounded scope: last ' + summary.days + ' days, filtered by session start time from the latest ' + summary.sourceCount + ' protected records (maximum 50). ' +
        (summary.capped ? 'The 50-record cap was reached; older sessions in this window may be omitted.' : 'This is a bounded snapshot, not a complete fleet-history guarantee.'),
      summary.invalidStarts + ' records excluded because their start time is missing, invalid, or in the future. ' + summary.missingAlerts + ' included records have no valid alert count.',
      summary.review.message,
      'Completed means a valid end time was recorded. Completion quality and interruption reasons are unknown. No end time does not prove an active or interrupted session.',
      'Client-reported and unverified telemetry. Counts, scores, and saved manager markers do not establish physical readiness, fitness to drive, safety, accuracy, or safety effectiveness. Do not use as sole evidence for discipline, compliance, or emergency decisions.',
      'Tester alert ratings, test conditions, device impact, and interruption reasons are not provided by this protected summary. Missing or withheld values are not treated as zero.',
      'Privacy: aggregate report only. Driver and session identifiers, individual session dates, GPS, personal media, audio, and raw motion are excluded. No new telemetry is collected.',
    ];
  }
  var panel = document.getElementById('pilotQualityPanel'), report = document.getElementById('pilotPrintableReport');
  var ownerId = '', generation = 0, review = { status: 'idle' }, controller = null;
  var api = { summarize: summarize, reportRows: reportRows, reportNotes: reportNotes, update: update, reset: reset, refreshReviews: loadReviews };
  window.OcculertPilotReport = api;
  if (!panel || !report) return;
  function currentUserId() { return window.OcculertBackend?.currentUser()?.id || ''; }
  function snapshot() {
    var input = typeof window.getProtectedPilotSnapshot === 'function' ? window.getProtectedPilotSnapshot() : {};
    return Object.assign({}, input, { currentUserId: currentUserId() });
  }
  function node(tag, value) { var element = document.createElement(tag); if (value !== undefined) element.textContent = value; return element; }
  function setText(id, value) { var element = document.getElementById(id); if (element) element.textContent = value; }
  function renderReport(summary) {
    report.replaceChildren(node('h2', 'Occulert pilot report'));
    if (!summary.available) { report.appendChild(node('p', summary.reason)); return; }
    report.append(node('p', summary.fleetName), node('p', 'Reporting window: last ' + summary.days + ' days · ' + new Date(summary.windowStart).toISOString() + ' to ' + new Date(summary.generatedAt).toISOString()),
      node('p', 'Generated: ' + new Date(summary.generatedAt).toISOString() + ' · Protected data refreshed: ' + new Date(summary.updatedAt).toISOString()));
    var table = node('table'), caption = node('caption', 'Aggregate protected session evidence'), body = node('tbody'); table.appendChild(caption);
    reportRows(summary).forEach(function (row) { var tr = node('tr'), title = node('th', row[0]); title.scope = 'row'; tr.append(title, node('td', row[1])); body.appendChild(tr); });
    table.appendChild(body); report.appendChild(table);
    reportNotes(summary).forEach(function (note) { report.appendChild(node('p', note)); });
  }
  function render(summary) {
    if (!panel || !report) return;
    setText('pilotQualityStatus', summary.available ? 'Last ' + summary.days + ' days · ' + summary.sessions + ' of up to 50 recent protected records · refreshed ' + new Date(summary.updatedAt).toLocaleString() +
      (summary.capped ? ' · 50-record cap reached; older records may be omitted.' : '') : summary.reason);
    setText('qualityCompleted', summary.available ? summary.completed : '—');
    setText('qualityInterrupted', 'Unavailable');
    setText('qualityUnscored', summary.available ? summary.unscored : '—');
    setText('qualityMissingReview', summary.available && summary.review.missing !== null ? summary.review.missing : 'Unavailable');
    setText('pilotReviewStatus', summary.available ? summary.review.message : 'Saved review counts are unavailable until protected fleet data is fresh and its privacy boundaries are confirmed.');
    document.getElementById('pilotReportPrint').disabled = !summary.available;
    document.getElementById('pilotReviewRefresh').disabled = !summary.available || review.status === 'loading';
    renderReport(summary);
  }
  function reset() {
    generation += 1; controller?.abort(); controller = null; ownerId = ''; review = { status: 'idle' };
    if (panel && report) render({ available: false, reason: 'Protected report unavailable. Sign in and refresh protected data before printing.' });
  }
  function update(options) {
    if (!panel || !report) return;
    var input = snapshot(), nextOwner = input.userId && input.currentUserId === input.userId ? input.userId : '';
    if (nextOwner !== ownerId) { reset(); ownerId = nextOwner; }
    var summary = summarize(input, review);
    render(summary);
    if (summary.available && summary.sessions && !document.hidden && !options?.skipReviewLoad &&
        (review.status === 'idle' || (review.status === 'ready' && Date.now() - review.loadedAt >= REVIEW_REFRESH_MS))) void loadReviews();
    return summary;
  }
  async function loadReviews() {
    var input = snapshot(), permitted = summarize(input, review);
    if (!permitted.available || review.status === 'loading' || document.hidden) return;
    if (!permitted.sessions) { review = { status: 'ready', ownerId: input.userId, loadedAt: Date.now(), sessions: [] }; update({ skipReviewLoad: true }); return; }
    var expectedOwner = input.userId, version = generation, abort = new AbortController(), timer;
    controller = abort; review = { status: 'loading' }; update({ skipReviewLoad: true });
    try {
      var result = await Promise.race([
        (async function () {
          var auth = await window.OcculertBackend.getSession();
          if (version !== generation || currentUserId() !== expectedOwner || auth?.user?.id !== expectedOwner || !auth.access_token) throw new Error('Account changed. Refresh protected data.');
          var response = await fetch('/api/fleet-followups', { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: abort.signal,
            headers: { Authorization: 'Bearer ' + auth.access_token } });
          var data = await response.json();
          if (!response.ok || data.ok !== true || !Array.isArray(data.sessions)) throw new Error(data.error === 'followups_not_enabled'
            ? 'Saved follow-ups are not enabled; missing-review counts are unavailable.' : 'Saved follow-ups could not be loaded; missing-review counts are unavailable.');
          return data;
        })(),
        new Promise(function (_, reject) { timer = setTimeout(function () { abort.abort(); reject(new Error('Saved follow-ups timed out; missing-review counts are unavailable.')); }, 8000); }),
      ]);
      if (version !== generation || currentUserId() !== expectedOwner) return;
      // Keep only the fields needed to count protected manager markers.
      review = { status: 'ready', ownerId: expectedOwner, loadedAt: Date.now(), sessions: result.sessions.slice(0, 50).map(function (session) {
        return { id: session.id, followup: { status: session.followup?.status, version: session.followup?.version } };
      }) };
    } catch (error) {
      if (version !== generation || currentUserId() !== expectedOwner) return;
      review = { status: 'error', message: error.message };
    } finally {
      clearTimeout(timer); if (controller === abort) controller = null;
      if (version === generation) update({ skipReviewLoad: true });
    }
  }
  document.getElementById('pilotReviewRefresh').addEventListener('click', function () { void loadReviews(); });
  document.getElementById('pilotReportPrint').addEventListener('click', function () {
    var summary = update();
    if (summary?.available) window.print();
  });
  var printPreviewOpen = false, printing = false;
  window.addEventListener('beforeprint', function () {
    var preview = document.getElementById('pilotReportPreview');
    if (!printing) { printPreviewOpen = preview.open; printing = true; }
    update({ skipReviewLoad: true }); preview.open = true;
  });
  window.addEventListener('afterprint', function () {
    var preview = document.getElementById('pilotReportPreview');
    if (printing) preview.open = printPreviewOpen;
    printing = false; update({ skipReviewLoad: true });
  });
  window.addEventListener('storage', function (event) { if (event.key === 'occulert-auth' || event.key === null) { reset(); update({ skipReviewLoad: true }); } });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    var summary = update();
    if (summary?.available && review.status === 'ready' && Date.now() - review.loadedAt >= REVIEW_REFRESH_MS) void loadReviews();
  });
  update();
})();
