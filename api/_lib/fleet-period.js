const { pgFetch, verifyAccessToken, bearerToken } = require('./supabase');
const { supabaseErrorStatus } = require('./supabase-errors');
const { isUuid, validTimestamp } = require('./fleet-history-cursor');

const { json: sendJson } = require("./responses");

const reportCountFields = Object.freeze(['roster_total', 'active_drivers', 'reporting_active_drivers', 'sessions', 'completed',
  'no_recorded_end', 'invalid_recorded_end', 'scored', 'unscored', 'valid_alert_records',
  'missing_alert_records', 'alerts', 'reviewed', 'without_reviewed_followup']);

function json(response, status, body) {
  response.setHeader("Vary", "Authorization");
  return sendJson(response, status, body);
}

function requestedDays(request) {
  let fromUrl;
  if (request.url) {
    const params = new URL(request.url, 'https://www.occulert.com').searchParams;
    if ([...params.keys()].some(key => key !== 'days') || params.getAll('days').length > 1) return null;
    fromUrl = params.get('days');
  }
  let fromQuery;
  if (request.query !== undefined) {
    if (!request.query || typeof request.query !== 'object' || Array.isArray(request.query) ||
        Object.keys(request.query).some(key => key !== 'days')) return null;
    fromQuery = request.query.days;
    if (fromQuery !== undefined && typeof fromQuery !== 'string') return null;
  }
  if (fromUrl !== undefined && fromQuery !== undefined && fromUrl !== fromQuery) return null;
  const value = fromUrl === undefined ? fromQuery : fromUrl;
  return value === '7' ? 7 : value === '30' ? 30 : null;
}

function validReport(report, days) {
  if (!report || typeof report !== 'object' || Array.isArray(report) || report.version !== 1 ||
      report.days !== days || report.complete_period !== true ||
      report.interruption_reasons_available !== false || report.unrecorded_sessions_detectable !== false ||
      !validTimestamp(report.window_start) || !validTimestamp(report.window_end) ||
      Date.parse(report.window_start) >= Date.parse(report.window_end)) return false;
  const hours = report.monitored_hours, rate = report.alerts_per_monitored_hour;
  if (!Number.isFinite(hours) || hours < 0 || hours > report.completed * 16) return false;
  if (hours === 0 ? rate !== null : !Number.isFinite(rate) || rate < 0) return false;
  if (reportCountFields.some(key => !Number.isSafeInteger(report[key]) || report[key] < 0)) return false;
  if (report.average_safety_score !== null && (!Number.isSafeInteger(report.average_safety_score) ||
      report.average_safety_score < 0 || report.average_safety_score > 100)) return false;
  const pipelines = report.detector_pipelines;
  const pipelineKeys = ['web_mediapipe_ear', 'ios_mlkit_eye_probability', 'android_mlkit_eye_probability', 'unknown'];
  if (!pipelines || typeof pipelines !== 'object' || Array.isArray(pipelines) ||
      Object.keys(pipelines).length !== pipelineKeys.length ||
      pipelineKeys.some(key => !Number.isSafeInteger(pipelines[key]) || pipelines[key] < 0) ||
      pipelineKeys.reduce((sum, key) => sum + pipelines[key], 0) !== report.sessions) return false;
  return report.active_drivers <= report.roster_total && report.reporting_active_drivers <= report.active_drivers &&
    report.completed + report.no_recorded_end + report.invalid_recorded_end === report.sessions &&
    report.scored + report.unscored === report.sessions &&
    report.valid_alert_records + report.missing_alert_records === report.sessions &&
    report.reviewed + report.without_reviewed_followup === report.sessions;
}

// Reads accept a locally verified JWT. Pass { freshIdentity: true } for requests
// that spend quota or call a paid provider, so Supabase Auth rejects a session
// that was signed out before the token expired.
async function ownerPeriodRequest(request, response, bodyDays, { freshIdentity = false } = {}) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    json(response, 501, { ok: false, error: 'backend_not_configured' });
    return null;
  }
  const days = bodyDays === undefined ? requestedDays(request) : bodyDays;
  if (days !== 7 && days !== 30) {
    json(response, 400, { ok: false, error: 'invalid_period' });
    return null;
  }
  const user = await verifyAccessToken(bearerToken(request), freshIdentity ? { freshUser: true } : { cachedIdentity: true });
  if (!user) {
    json(response, 401, { ok: false, error: 'unauthorized' });
    return null;
  }
  if (!isUuid(user.id)) throw new Error('invalid_user');
  const fleets = await pgFetch('fleets', {
    params: { select: 'id,company_name', owner_user_id: 'eq.' + user.id, limit: '1' },
  });
  if (!Array.isArray(fleets) || fleets.length > 1) throw new Error('invalid_fleet');
  const fleet = fleets[0];
  if (!fleet) {
    json(response, 403, { ok: false, error: 'fleet_not_found' });
    return null;
  }
  if (!isUuid(fleet.id) || typeof fleet.company_name !== 'string') throw new Error('invalid_fleet');
  return { actorId: user.id, fleet, days };
}

async function fetchPeriodReport(actorId, fleetId, days) {
  const report = await pgFetch('rpc/fleet_period_report', {
    method: 'POST', body: { p_actor_id: actorId, p_fleet_id: fleetId, p_days: days },
  });
  if (!validReport(report, days)) throw new Error('invalid_report');
  return report;
}

function periodReportError(response, error) {
  if (['42883', 'PGRST202', 'PGRST205'].includes(error?.details?.code)) {
    return json(response, 503, { ok: false, error: 'period_report_not_enabled' });
  }
  return json(response, supabaseErrorStatus(error), { ok: false, error: 'period_report_unavailable' });
}

module.exports = { json, validReport, reportCountFields, ownerPeriodRequest, fetchPeriodReport, periodReportError };
