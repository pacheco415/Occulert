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
    if (!input.fleetMode || !input.userId || input.currentUserId !== input.userId || !input.fleetId) return 'Sign in as the fleet owner to load a protected report. Local and demo data are excluded.';
    if (!input.lastSuccessfulAt) return 'Protected report unavailable. Refresh the protected fleet data.';
    if (input.summaryValid !== true || !Array.isArray(input.sessions) || !Array.isArray(input.drivers)) return 'Protected report withheld: session or roster records were missing from the response.';
    if (input.telemetryTrust !== 'unverified_client_report' || !input.privacy ||
        input.privacy.includes_location !== false || input.privacy.includes_personal_media !== false ||
        input.privacy.includes_raw_motion !== false) return 'Protected report withheld: the response did not confirm the expected telemetry and privacy boundaries.';
    if (input.refreshFailures > 0 || !fresh(input.lastSuccessfulAt, now)) return 'Protected data is stale or the latest refresh failed. Refresh before printing; saved counts may have changed.';
    return '';
  }
  function validPeriodReport(report, days) {
    if (!report || report.version !== 1 || report.days !== days || report.complete_period !== true ||
        report.interruption_reasons_available !== false || report.unrecorded_sessions_detectable !== false ||
        !Number.isFinite(Date.parse(report.window_start)) || !Number.isFinite(Date.parse(report.window_end)) ||
        Date.parse(report.window_start) >= Date.parse(report.window_end)) return false;
    var keys = ['roster_total', 'active_drivers', 'reporting_active_drivers', 'sessions', 'completed', 'no_recorded_end',
      'invalid_recorded_end', 'scored', 'unscored', 'valid_alert_records', 'missing_alert_records', 'alerts',
      'reviewed', 'without_reviewed_followup'];
    if (keys.some(function (key) { return !Number.isSafeInteger(report[key]) || report[key] < 0; }) ||
        report.active_drivers > report.roster_total || report.reporting_active_drivers > report.active_drivers ||
        report.completed + report.no_recorded_end + report.invalid_recorded_end !== report.sessions ||
        report.scored + report.unscored !== report.sessions ||
        report.valid_alert_records + report.missing_alert_records !== report.sessions ||
        report.reviewed + report.without_reviewed_followup !== report.sessions) return false;
    var pipelines = report.detector_pipelines;
    var pipelineKeys = ['web_mediapipe_ear', 'ios_mlkit_eye_probability', 'android_mlkit_eye_probability', 'unknown'];
    if (!pipelines || typeof pipelines !== 'object' || Array.isArray(pipelines) ||
        Object.keys(pipelines).length !== pipelineKeys.length ||
        pipelineKeys.some(function (key) { return !Number.isSafeInteger(pipelines[key]) || pipelines[key] < 0; }) ||
        pipelineKeys.reduce(function (sum, key) { return sum + pipelines[key]; }, 0) !== report.sessions) return false;
    return report.average_safety_score === null || Number.isSafeInteger(report.average_safety_score) &&
      report.average_safety_score >= 0 && report.average_safety_score <= 100;
  }
  function summarize(input, review, now) {
    input = input || {}; now = Number.isFinite(now) ? now : Date.now();
    var days = Number(input.days) === 7 ? 7 : 30, error = sourceAccess(input, now);
    if (error) return { available: false, reason: error, days: days };
    if (!review || review.status !== 'ready' || review.ownerId !== input.userId || review.fleetId !== input.fleetId ||
        review.days !== days || !fresh(review.loadedAt, now) || !validPeriodReport(review.report, days))
      return { available: false, reason: review?.status === 'loading' ? 'Loading complete-period report…' :
        review?.status === 'error' ? review.message : 'Complete-period report has not loaded. Refresh the report.', days: days };
    var report = review.report;
    if (Date.parse(report.window_end) > now + 1000 || now - Date.parse(report.window_end) > MAX_AGE_MS)
      return { available: false, reason: 'Complete-period report is stale. Refresh the report.', days: days };
    return { available: true, days: days, fleetName: String(input.fleetName || 'Protected fleet').slice(0, 120),
      generatedAt: review.loadedAt, updatedAt: input.lastSuccessfulAt,
      windowStart: Date.parse(report.window_start), windowEnd: Date.parse(report.window_end),
      sourceCount: report.sessions, completePeriod: true, sessions: report.sessions,
      completed: report.completed, noEnd: report.no_recorded_end, invalidEnds: report.invalid_recorded_end,
      interrupted: null, unscored: report.unscored, scored: report.scored, average: report.average_safety_score,
      alerts: report.alerts, missingAlerts: report.missing_alert_records, validAlertRecords: report.valid_alert_records,
      rosterTotal: report.roster_total, activeDrivers: report.active_drivers,
      detectorPipelines: report.detector_pipelines,
      reportingDrivers: report.reporting_active_drivers,
      coverage: report.active_drivers ? Math.round(report.reporting_active_drivers / report.active_drivers * 100) : null,
      review: { reviewed: report.reviewed, missing: report.without_reviewed_followup,
        message: report.reviewed + ' saved Reviewed · ' + report.without_reviewed_followup +
          ' without a saved Reviewed follow-up. A manager marker does not prove a tester review or validate telemetry.' } };
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
      ['Average client-reported score (mixed detectors)', summary.average === null ? 'Not recorded' : summary.average + '/100 across ' + summary.scored + ' scored records'],
      ['Detector pipelines (web / iPhone / Android / unknown)', [summary.detectorPipelines.web_mediapipe_ear,
        summary.detectorPipelines.ios_mlkit_eye_probability, summary.detectorPipelines.android_mlkit_eye_probability,
        summary.detectorPipelines.unknown].join(' / ')],
      ['Client-reported alerts', summary.validAlertRecords ? summary.alerts + ' across ' + summary.validAlertRecords + ' records with valid alert counts' :
        summary.sessions ? 'Not recorded' : '0 across 0 records with valid alert counts'],
    ];
  }
  function reportNotes(summary) {
    return [
      'Complete stored-record scope: every session with a recorded start in the last ' + summary.days +
        ' days for this protected fleet, counted by the database as of ' + new Date(summary.windowEnd).toISOString() +
        '. There is no latest-50 cap. Sessions that were never recorded cannot be detected.',
      summary.noEnd + ' records have no end time. ' + summary.invalidEnds + ' have an invalid recorded end time. ' +
        summary.missingAlerts + ' included records have no valid alert count.',
      summary.review.message,
      'Completed means a valid end time was recorded. Completion quality and interruption reasons are unknown. No end time does not prove an active or interrupted session.',
      'Client-reported and unverified telemetry. Counts, scores, and saved manager markers do not establish physical readiness, fitness to drive, safety, accuracy, or safety effectiveness. Do not use as sole evidence for discipline, compliance, or emergency decisions.',
      'Web, iPhone, and Android detector scores use different measurements and are not directly comparable. The mixed-detector average is descriptive only.',
      'Tester alert ratings, test conditions, device impact, and interruption reasons are not provided by this protected summary. Missing or withheld values are not treated as zero.',
      'Privacy: aggregate report only. Driver and session identifiers, individual session dates, GPS, personal media, audio, and raw motion are excluded. No new telemetry is collected.',
    ];
  }
  var panel = document.getElementById('pilotQualityPanel'), report = document.getElementById('pilotPrintableReport');
  var ownerId = '', fleetId = '', generation = 0, review = { status: 'idle' }, controller = null;
  var api = { summarize: summarize, sourceAccess: sourceAccess, validPeriodReport: validPeriodReport,
    reportRows: reportRows, reportNotes: reportNotes, update: update, reset: reset, refreshReviews: loadReviews };
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
    report.append(node('p', summary.fleetName), node('p', 'Reporting window: ' + new Date(summary.windowStart).toISOString() + ' to ' + new Date(summary.windowEnd).toISOString()),
      node('p', 'Generated: ' + new Date(summary.generatedAt).toISOString() + ' · Protected data refreshed: ' + new Date(summary.updatedAt).toISOString()));
    var table = node('table'), caption = node('caption', 'Complete-period aggregate protected session evidence'), body = node('tbody'); table.appendChild(caption);
    reportRows(summary).forEach(function (row) { var tr = node('tr'), title = node('th', row[0]); title.scope = 'row'; tr.append(title, node('td', row[1])); body.appendChild(tr); });
    table.appendChild(body); report.appendChild(table);
    reportNotes(summary).forEach(function (note) { report.appendChild(node('p', note)); });
  }
  function render(summary) {
    if (!panel || !report) return;
    setText('pilotQualityStatus', summary.available ? 'Complete last ' + summary.days + ' days · ' + summary.sessions +
      ' stored sessions · refreshed ' + new Date(summary.generatedAt).toLocaleString() : summary.reason);
    setText('qualityCompleted', summary.available ? summary.completed : '—');
    setText('qualityInterrupted', 'Unavailable');
    setText('qualityUnscored', summary.available ? summary.unscored : '—');
    setText('qualityMissingReview', summary.available && summary.review.missing !== null ? summary.review.missing : 'Unavailable');
    setText('pilotReviewStatus', summary.available ? summary.review.message : 'Complete-period manager review counts are unavailable until the protected report loads.');
    document.getElementById('pilotReportPrint').disabled = !summary.available;
    var csvButton = document.getElementById('pilotReportCSV');
    if (csvButton) csvButton.disabled = !summary.available ||
      typeof requestDashboardCSVDownload !== 'function' || typeof window.OcculertSecurity?.csvCell !== 'function';
    document.getElementById('pilotReviewRefresh').disabled = !!sourceAccess(snapshot(), Date.now()) || review.status === 'loading';
    renderReport(summary);
  }
  function reset() {
    generation += 1; controller?.abort(); controller = null; ownerId = ''; fleetId = ''; review = { status: 'idle' };
    if (panel && report) render({ available: false, reason: 'Protected report unavailable. Sign in and refresh protected data before printing.' });
  }
  function update(options) {
    if (!panel || !report) return;
    var input = snapshot(), nextOwner = input.userId && input.currentUserId === input.userId ? input.userId : '';
    if (nextOwner !== ownerId || input.fleetId !== fleetId) { reset(); ownerId = nextOwner; fleetId = input.fleetId || ''; }
    var summary = summarize(input, review);
    render(summary);
    if (!document.hidden && !options?.skipReviewLoad && !sourceAccess(input, Date.now()) && review.status !== 'loading' &&
        (review.status === 'idle' || review.status === 'ready' && (review.days !== summary.days || Date.now() - review.loadedAt >= REVIEW_REFRESH_MS))) void loadReviews();
    return summary;
  }
  async function loadReviews() {
    var input = snapshot();
    if (sourceAccess(input, Date.now()) || review.status === 'loading' || document.hidden) return;
    var days = Number(input.days) === 7 ? 7 : 30;
    var expectedOwner = input.userId, expectedFleet = input.fleetId, version = generation, abort = new AbortController(), timer;
    controller = abort; review = { status: 'loading' }; update({ skipReviewLoad: true });
    try {
      var result = await Promise.race([
        (async function () {
          var auth = await window.OcculertBackend.getSession();
          if (version !== generation || currentUserId() !== expectedOwner || auth?.user?.id !== expectedOwner || !auth.access_token) throw new Error('Account changed. Refresh protected data.');
          var response = await fetch('/api/fleet-period-report?days=' + days, { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: abort.signal,
            headers: { Authorization: 'Bearer ' + auth.access_token } });
          var data = await response.json();
          if (!response.ok || data.ok !== true) throw new Error(data.error === 'period_report_not_enabled'
            ? 'Complete-period reporting is not enabled yet. Apply the database migration before printing.' : 'Complete-period report could not be loaded. Refresh the report.');
          if (!data.fleet || data.fleet.id !== expectedFleet || data.telemetry_trust !== 'unverified_client_report' ||
              !data.privacy || data.privacy.includes_location !== false || data.privacy.includes_personal_media !== false ||
              data.privacy.includes_raw_motion !== false || !validPeriodReport(data.report, days))
            throw new Error('Complete-period response could not be verified. Refresh the report.');
          return data.report;
        })(),
        new Promise(function (_, reject) { timer = setTimeout(function () { abort.abort(); reject(new Error('Complete-period report timed out. Refresh the report.')); }, 8000); }),
      ]);
      if (version !== generation || currentUserId() !== expectedOwner || snapshot().fleetId !== expectedFleet) return;
      review = { status: 'ready', ownerId: expectedOwner, fleetId: expectedFleet, days: days, loadedAt: Date.now(), report: result };
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
  document.getElementById('pilotReportCSV')?.addEventListener('click', function () {
    var summary = update({ skipReviewLoad: true });
    if (!summary?.available || typeof requestDashboardCSVDownload !== 'function' ||
        typeof window.OcculertSecurity?.csvCell !== 'function') return;
    var rows = [['metric', 'value', 'window_days', 'window_start', 'window_end', 'report_scope']]
      .concat(reportRows(summary).map(function (row) { return [row[0], row[1], summary.days,
        new Date(summary.windowStart).toISOString(), new Date(summary.windowEnd).toISOString(), 'complete_stored_period_aggregate']; }));
    reportNotes(summary).forEach(function (note) { rows.push(['Report note', note, summary.days,
      new Date(summary.windowStart).toISOString(), new Date(summary.windowEnd).toISOString(), 'complete_stored_period_aggregate']); });
    var csv = rows.map(function (row) { return row.map(function (value) {
      return '"' + window.OcculertSecurity.csvCell(value).replace(/"/g, '""') + '"';
    }).join(','); }).join('\n');
    requestDashboardCSVDownload(csv, 'occulert-complete-pilot-report-' + summary.days + 'd.csv', true);
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
    if (!summary?.available && review.status === 'ready' && Date.now() - review.loadedAt >= REVIEW_REFRESH_MS) void loadReviews();
  });
  update();
})();
