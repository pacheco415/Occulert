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
  var insightCard = document.getElementById('fleetInsightCard'), insightButton = document.getElementById('writeFleetInsight');
  var insightDays = 0, insightRequest = null, insightsDisabled = false;
  var insightPollTimer = null, insightUnlockTimer = null;
  var insightRetryTimes = new Map();
  var askCard = document.getElementById('fleetAskCard'), askForm = document.getElementById('fleetAskForm');
  var askFields = document.getElementById('fleetAskFields'), askQuestion = document.getElementById('fleetAskQuestion');
  var askResult = document.getElementById('fleetAskResult');
  var askDays = 0, askRequest = null, askUnavailable = false;
  // Outlast the server's 12 s request budget. Abandoning sooner would discard an
  // answer the server already reserved quota and called the model for.
  var ASK_TIMEOUT_MS = 15000;
  var chartPanel = document.getElementById('fleetTimeOfDay'), chartContent = document.getElementById('fleetTimeContent');
  var chartReview = null, chartRequest = null;

  function drawTimeBlocks(data) {
    var bars = node('div'), table = node('table'), head = node('thead'), heading = node('tr'), body = node('tbody');
    bars.className = 'fleet-time-bars';
    bars.setAttribute('aria-hidden', 'true');
    table.className = 'fleet-time-table';
    table.appendChild(node('caption', 'Drowsy alerts per monitored hour in ' + data.timezone));
    ['Time block', 'Drowsy alerts per monitored hour'].forEach(function (label) {
      var th = node('th', label); th.scope = 'col'; heading.appendChild(th);
    });
    head.appendChild(heading); table.append(head, body);
    var maxRate = Math.max.apply(null, data.blocks.map(function (block) { return block.drowsy_alerts_per_hour || 0; })) || 1;
    data.blocks.forEach(function (block) {
      var label = String(block.start_hour).padStart(2, '0') + ':00–' + String(block.start_hour + 4).padStart(2, '0') + ':00';
      var value = block.rate_available ? String(block.drowsy_alerts_per_hour) : 'Not enough driving';
      var barRow = node('div'), row = node('tr'), timeCell = node('th', label);
      barRow.appendChild(node('span', label));
      if (block.rate_available) {
        var bar = node('meter'); bar.max = maxRate; bar.value = block.drowsy_alerts_per_hour; barRow.appendChild(bar);
      }
      barRow.appendChild(node('span', value)); bars.appendChild(barRow);
      timeCell.scope = 'row'; row.append(timeCell, node('td', value)); body.appendChild(row);
    });
    chartContent.replaceChildren(node('p', 'Drowsy alerts per monitored hour · Last ' + data.days + ' days · ' + data.timezone), bars, table);
    chartPanel.hidden = false;
  }

  async function syncTimeOfDay(summary) {
    if (!chartPanel) return;
    var target = summary.available ? review : null;
    if (target === chartReview) return;
    chartReview = target;
    chartRequest?.abort(); chartRequest = null;
    chartPanel.hidden = true; chartContent.replaceChildren();
    if (!target) return;
    var abort = new AbortController();
    chartRequest = abort;
    var timer = setTimeout(function () { abort.abort(); }, 8000);
    function current() {
      var input = snapshot();
      return !abort.signal.aborted && chartReview === target && review === target &&
        target.ownerId === input.currentUserId && target.fleetId === input.fleetId &&
        Number(input.days) === target.days && !sourceAccess(input, Date.now());
    }
    try {
      var auth = await window.OcculertBackend.getSession();
      if (!current() || auth?.user?.id !== target.ownerId || !auth.access_token) return;
      var response = await fetch('/api/fleet-time-of-day?days=' + target.days, { credentials: 'same-origin', cache: 'no-store',
        signal: abort.signal, headers: { Authorization: 'Bearer ' + auth.access_token } });
      if (!response.ok || !current()) return;
      var data = await response.json(), result = data.report;
      if (!current() || data.ok !== true || data.telemetry_trust !== 'unverified_client_report' ||
          result?.version !== 1 || result.days !== target.days || typeof result.timezone !== 'string' || !result.timezone.trim() ||
          !Array.isArray(result.blocks) || result.blocks.length !== 6 || !result.blocks.every(function (block, i) {
            return block?.start_hour === i * 4 && (block.rate_available === false ? block.drowsy_alerts_per_hour === null :
              block.rate_available === true && Number.isFinite(block.drowsy_alerts_per_hour) && block.drowsy_alerts_per_hour >= 0);
          })) return;
      drawTimeBlocks(result);
    } catch (_) {
      // The chart is optional. The complete-period report stays usable if the chart is unavailable.
    } finally {
      clearTimeout(timer);
      if (chartRequest === abort) chartRequest = null;
    }
  }

  function showPlanMessage(id, feature) {
    var pricing = node('a', 'View fleet plans');
    pricing.href = '/fleet-pricing.html';
    var email = node('a', 'fleet@occulert.com');
    email.href = 'mailto:fleet@occulert.com';
    document.getElementById(id).replaceChildren(feature + ' require an active paid Occulert fleet plan. ',
      pricing, ' or contact ', email, '.');
  }

  function clearInsight() {
    clearTimeout(insightPollTimer); insightPollTimer = null;
    clearTimeout(insightUnlockTimer); insightUnlockTimer = null;
    insightRequest?.abort(); insightRequest = null; insightDays = 0;
    if (!insightCard) return;
    insightCard.hidden = true;
    insightButton.disabled = false; insightButton.textContent = 'Write summary';
    setText('fleetInsightText', ''); setText('fleetInsightDetails', '');
  }
  function showInsightCard(summary) {
    if (!insightCard) return;
    if (!summary.available || insightsDisabled || summary.days !== insightDays) clearInsight();
    if (!summary.available || insightsDisabled) return;
    insightDays = summary.days;
    insightCard.hidden = false;
    var retryAt = insightRetryTimes.get(summary.days);
    if (retryAt > Date.now()) {
      insightButton.disabled = true;
      if (insightUnlockTimer === null) {
        setText('fleetInsightText', "Today's summary couldn't be written. You can try again after " + new Date(retryAt).toLocaleString() + '.');
        insightUnlockTimer = setTimeout(function () {
          insightUnlockTimer = null;
          update({ skipReviewLoad: true });
        }, Math.min(86400000, retryAt - Date.now()));
      }
    } else {
      if (insightRetryTimes.delete(summary.days)) setText('fleetInsightText', '');
      insightButton.disabled = !!insightRequest;
    }
  }
  async function writeInsight(attempt) {
    var input = snapshot(), summary = summarize(input, review);
    if (!summary.available || insightsDisabled || insightRequest || insightRetryTimes.get(summary.days) > Date.now()) return;
    var days = summary.days, version = generation, abort = new AbortController();
    var matchesReport = function () {
      var current = snapshot();
      return insightRequest === abort && version === generation && current.userId === input.userId &&
        current.fleetId === input.fleetId && Number(current.days) === days && summarize(current, review).available;
    };
    insightRequest = abort;
    insightButton.disabled = true;
    setText('fleetInsightDetails', ''); setText('fleetInsightText', 'Loading summary…');
    var timer = setTimeout(function () {
      if (insightRequest !== abort) return;
      abort.abort(); insightRequest = null; insightButton.disabled = false;
      setText('fleetInsightText', 'The request timed out. Try again.');
      update({ skipReviewLoad: true });
    }, 15000);
    try {
      var auth = await window.OcculertBackend.getSession();
      if (!matchesReport()) return;
      if (auth?.user?.id !== input.userId || !auth.access_token || abort.signal.aborted) throw new Error();
      var response = await fetch('/api/fleet-insights?days=' + days, { method: 'GET', credentials: 'same-origin',
        cache: 'no-store', signal: abort.signal, headers: { Authorization: 'Bearer ' + auth.access_token } });
      if (!matchesReport()) return;
      if (response.status === 501) {
        insightsDisabled = true; clearInsight();
        document.getElementById('pilotReviewRefresh').focus();
        return;
      }
      if (response.status === 202) {
        insightButton.textContent = 'Check summary';
        if (attempt >= 3 || document.hidden) {
          setText('fleetInsightText', 'Your summary is still being written. Select Check summary to check again.');
          return;
        }
        var header = response.headers.get('Retry-After');
        var seconds = header?.trim() ? Number(header) : NaN;
        var delay = Number.isFinite(seconds) ? Math.min(10, Math.max(1, seconds)) : 2;
        setText('fleetInsightText', 'Your summary is being written. Checking again automatically…');
        insightPollTimer = setTimeout(function () {
          insightPollTimer = null;
          var canCheck = matchesReport() && !document.hidden;
          if (insightRequest === abort) insightRequest = null;
          if (canCheck) void writeInsight(attempt + 1);
          else update({ skipReviewLoad: true });
        }, delay * 1000);
        return;
      }
      if (response.status === 403) {
        var denial = await response.json();
        if (!matchesReport()) return;
        if (denial?.error !== 'paid_plan_required') throw new Error();
        showPlanMessage('fleetInsightText', 'AI summaries');
        insightButton.textContent = 'Write summary';
        return;
      }
      if (response.status === 502 || response.status === 504) {
        var failure = await response.json();
        if (!matchesReport()) return;
        var retryAt = time(failure?.retry_after);
        if (retryAt > Date.now()) {
          insightRetryTimes.set(days, retryAt);
          insightButton.textContent = 'Write summary';
          return;
        }
      }
      if (!response.ok) throw new Error();
      var data = await response.json();
      if (!matchesReport()) return;
      if (data.ok !== true || data.ai_generated !== true || data.days !== days || typeof data.summary !== 'string' ||
          !data.summary.trim() || data.summary.length > 1200 || typeof data.model !== 'string' || !data.model.trim() ||
          time(data.generated_at) === null || time(data.window_end) === null) throw new Error();
      setText('fleetInsightText', data.summary);
      setText('fleetInsightDetails', data.model + ' · Written ' + new Date(data.generated_at).toLocaleString() +
        ' · Report ending ' + new Date(data.window_end).toLocaleString());
      insightButton.textContent = 'Write summary';
    } catch (_) {
      if (matchesReport()) {
        setText('fleetInsightText', 'Summary unavailable. Try again later.');
        insightButton.textContent = 'Write summary';
      }
    } finally {
      clearTimeout(timer);
      if (insightRequest === abort && insightPollTimer === null) {
        insightRequest = null; insightButton.disabled = false;
        update({ skipReviewLoad: true });
      }
    }
  }
  insightButton?.addEventListener('click', function () { void writeInsight(1); });

  function clearAnswer() {
    askResult.hidden = true;
    setText('fleetAskStatus', ''); setText('fleetAskAnswer', ''); setText('fleetAskDetails', '');
  }
  function showAskCard(summary) {
    if (!askCard) return;
    var days = summary.available && !askUnavailable ? summary.days : 0;
    if (days !== askDays) {
      askRequest?.abort(); askRequest = null;
      askFields.disabled = false; askQuestion.value = ''; clearAnswer();
    }
    askDays = days; askCard.hidden = !days;
  }
  askForm?.querySelectorAll('button[type="button"]').forEach(function (button) {
    button.addEventListener('click', function () {
      clearAnswer(); askQuestion.value = button.textContent; askQuestion.focus();
    });
  });
  askQuestion?.addEventListener('input', clearAnswer);
  askForm?.addEventListener('submit', async function (event) {
    event.preventDefault();
    var input = snapshot(), summary = summarize(input, review), question = askQuestion.value.trim();
    if (!summary.available || askUnavailable || askRequest || askDays !== summary.days) return;
    clearAnswer();
    if (question.length < 3 || question.length > 300) {
      setText('fleetAskStatus', 'Enter a question between 3 and 300 characters.'); askQuestion.focus(); return;
    }
    var days = summary.days, version = generation, abort = new AbortController();
    function matchesReport() {
      var current = snapshot();
      return askRequest === abort && version === generation && current.userId === input.userId &&
        current.fleetId === input.fleetId && Number(current.days) === days && summarize(current, review).available;
    }
    askRequest = abort; askFields.disabled = true;
    setText('fleetAskStatus', 'Getting your answer…');
    var timer = setTimeout(function () {
      if (askRequest !== abort) return;
      if (matchesReport()) setText('fleetAskStatus', 'The question timed out. Try again.');
      abort.abort(); askRequest = null; askFields.disabled = false;
    }, ASK_TIMEOUT_MS);
    try {
      var auth = await window.OcculertBackend.getSession();
      if (!matchesReport()) return;
      if (auth?.user?.id !== input.userId || !auth.access_token) throw new Error();
      var response = await fetch('/api/fleet-ask', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
        signal: abort.signal, headers: { Authorization: 'Bearer ' + auth.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: days, question: question }) });
      if (!matchesReport()) return;
      if (response.status === 501) {
        askUnavailable = true; showAskCard(summary); document.getElementById('pilotReviewRefresh').focus(); return;
      }
      if (response.status === 429) {
        var quota = await response.json();
        if (!matchesReport()) return;
        if (quota?.error === 'fleet_question_monthly_limit') {
          setText('fleetAskStatus', 'Your fleet has used its 50 questions this month. The allowance resets on the first of the month at 00:00 UTC.'); return;
        }
        var seconds = Number(response.headers.get('Retry-After'));
        var wait = Number.isInteger(seconds) && seconds >= 1 && seconds <= 3600
          ? 'Try again in ' + seconds + (seconds === 1 ? ' second.' : ' seconds.') : 'Try again once the limit resets.';
        setText('fleetAskStatus', 'You reached the hourly question limit. ' + wait); return;
      }
      var data = await response.json();
      if (!matchesReport()) return;
      if (response.status === 504 || (!response.ok && data?.attempt_released === true)) {
        var problem = response.status === 504 ? 'The question timed out.' : 'The answer is unavailable.';
        var credit = data?.attempt_released === true ? ' This attempt did not count toward your monthly allowance.' : '';
        setText('fleetAskStatus', problem + credit + ' Try again.'); return;
      }
      if (response.status === 403 && data?.error === 'paid_plan_required') {
        showPlanMessage('fleetAskStatus', 'Fleet questions'); return;
      }
      if (response.status === 400 && data?.error === 'question_has_personal_details') {
        setText('fleetAskStatus', 'Your question includes personal details. Remove them and ask again.'); return;
      }
      if (!response.ok || data?.ok !== true || data.days !== days || data.ai_generated !== true ||
          typeof data.answer !== 'string' || !data.answer.trim() || data.answer.length > 700 ||
          typeof data.model !== 'string' || !data.model.trim() || time(data.generated_at) === null) throw new Error();
      setText('fleetAskStatus', ''); setText('fleetAskAnswer', data.answer);
      var remaining = data.monthly_remaining;
      var allowance = Number.isInteger(remaining) && remaining >= 0 && remaining < 50
        ? ' · ' + remaining + (remaining === 1 ? ' question left' : ' questions left') + ' this month' : '';
      setText('fleetAskDetails', data.model + ' · Written ' + new Date(data.generated_at).toLocaleString() + allowance);
      askResult.hidden = false;
    } catch (_) {
      if (matchesReport()) setText('fleetAskStatus', 'Fleet questions are unavailable. Try again later.');
    } finally {
      clearTimeout(timer);
      if (askRequest === abort) { askRequest = null; askFields.disabled = false; }
    }
  });
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
    showInsightCard(summary);
    showAskCard(summary);
    void syncTimeOfDay(summary);
  }
  function reset() {
    clearInsight();
    insightRetryTimes?.clear();
    generation += 1; controller?.abort(); controller = null; ownerId = ''; fleetId = ''; review = { status: 'idle' };
    if (panel && report) render({ available: false, reason: 'Protected report unavailable. Sign in and refresh protected data before printing.' });
  }
  function update(options) {
    if (!panel || !report) return;
    var input = snapshot(), nextOwner = input.userId && input.currentUserId === input.userId ? input.userId : '';
    if (nextOwner !== ownerId || input.fleetId !== fleetId) { reset(); ownerId = nextOwner; fleetId = input.fleetId || ''; }
    if (review.status === 'loading' && review.days !== Number(input.days)) {
      generation += 1; controller?.abort(); controller = null; review = { status: 'idle' };
    }
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
    controller = abort; review = { status: 'loading', days: days }; update({ skipReviewLoad: true });
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
    if (document.hidden) {
      if (insightPollTimer !== null) {
        clearInsight();
        update({ skipReviewLoad: true });
      }
      return;
    }
    var summary = update();
    if (!summary?.available && review.status === 'ready' && Date.now() - review.loadedAt >= REVIEW_REFRESH_MS) void loadReviews();
  });
  update();
})();
