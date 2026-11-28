const { activePilot } = require('../fleet-paid-access');
// GET /api/fleet-period-report?days=7|30. Complete aggregate from the
// server-owned fleet; no individual session, driver, or media data is returned.
const { json, validReport, ownerPeriodRequest, fetchPeriodReport, periodReportError } = require('../fleet-period');
const { withProviderBudget } = require('../provider-budget');

async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return json(response, 405, { ok: false, error: 'method_not_allowed' });
  }
  try {
    const owner = await ownerPeriodRequest(request, response);
    if (!owner) return;
    const { actorId, fleet, days } = owner;
    const [report, pilot] = await Promise.all([fetchPeriodReport(actorId, fleet.id, days), activePilot(owner)]);
    return json(response, 200, {
      ok: true, fleet: { id: fleet.id, company_name: fleet.company_name.slice(0, 160) }, report,
      ...(pilot ? { pilot_expires_at: pilot.expires_at } : {}),
      telemetry_trust: 'unverified_client_report',
      privacy: { includes_location: false, includes_personal_media: false, includes_raw_motion: false },
    });
  } catch (error) {
    return periodReportError(response, error);
  }
}

module.exports = withProviderBudget(handler);
module.exports.validReport = validReport;
