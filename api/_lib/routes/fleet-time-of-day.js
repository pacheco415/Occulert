// GET /api/fleet-time-of-day?days=7|30
const { json, ownerPeriodRequest, periodReportError } = require('../fleet-period');
const { fetchTimeOfDayReport } = require('../fleet-time-of-day');
const { withProviderBudget } = require('../provider-budget');
const { pgFetch } = require('../supabase');

async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return json(response, 405, { ok: false, error: 'method_not_allowed' });
  }
  try {
    const owner = await ownerPeriodRequest(request, response);
    if (!owner) return;
    const report = await fetchTimeOfDayReport(pgFetch, owner.actorId, owner.fleet.id, owner.days);
    return json(response, 200, { ok: true, report, telemetry_trust: 'unverified_client_report' });
  } catch (error) {
    return periodReportError(response, error);
  }
}

module.exports = withProviderBudget(handler);
