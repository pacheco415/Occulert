// GET /api/fleet-period-report?days=7|30. Complete aggregate from the
// server-owned fleet; no individual session, driver, or media data is returned.
const { pgFetch, verifyAccessToken, bearerToken } = require('../supabase');
const { isUuid, validTimestamp } = require('../fleet-history-cursor');

const { json: sendJson } = require("../responses");
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
  const counts = ['roster_total', 'active_drivers', 'reporting_active_drivers', 'sessions', 'completed',
    'no_recorded_end', 'invalid_recorded_end', 'scored', 'unscored', 'valid_alert_records',
    'missing_alert_records', 'alerts', 'reviewed', 'without_reviewed_followup'];
  if (counts.some(key => !Number.isSafeInteger(report[key]) || report[key] < 0)) return false;
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

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return json(response, 405, { ok: false, error: 'method_not_allowed' });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(response, 501, { ok: false, error: 'backend_not_configured' });
  }
  const days = requestedDays(request);
  if (!days) return json(response, 400, { ok: false, error: 'invalid_period' });
  try {
    const user = await verifyAccessToken(bearerToken(request), { cachedIdentity: true });
    if (!user) return json(response, 401, { ok: false, error: 'unauthorized' });
    if (!isUuid(user.id)) throw new Error('invalid_user');
    const fleets = await pgFetch('fleets', {
      params: { select: 'id,company_name', owner_user_id: 'eq.' + user.id, limit: '1' },
    });
    if (!Array.isArray(fleets) || fleets.length > 1) throw new Error('invalid_fleet');
    const fleet = fleets[0];
    if (!fleet) return json(response, 403, { ok: false, error: 'fleet_not_found' });
    if (!isUuid(fleet.id) || typeof fleet.company_name !== 'string') throw new Error('invalid_fleet');
    const report = await pgFetch('rpc/fleet_period_report', {
      method: 'POST', body: { p_actor_id: user.id, p_fleet_id: fleet.id, p_days: days },
    });
    if (!validReport(report, days)) throw new Error('invalid_report');
    return json(response, 200, {
      ok: true, fleet: { id: fleet.id, company_name: fleet.company_name.slice(0, 160) }, report,
      telemetry_trust: 'unverified_client_report',
      privacy: { includes_location: false, includes_personal_media: false, includes_raw_motion: false },
    });
  } catch (error) {
    const code = error && error.details && error.details.code;
    if (['42883', 'PGRST202', 'PGRST205'].includes(code)) {
      return json(response, 503, { ok: false, error: 'period_report_not_enabled' });
    }
    return json(response, 502, { ok: false, error: 'period_report_unavailable' });
  }
};

module.exports.validReport = validReport;

module.exports = require("../provider-budget").withProviderBudget(module.exports);
