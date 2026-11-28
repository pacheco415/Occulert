const { json, deltaFields, reportCountFields, ownerPeriodRequest, validReport, periodReportError } = require('../fleet-period');
const { pgFetch } = require('../supabase');
const { supabaseErrorStatus } = require('../supabase-errors');
const { REQUEST_PROVIDER_BUDGET_MS, remainingProviderMs, withProviderBudget } = require('../provider-budget');

const paidAccess = require('../fleet-paid-access');
const { requestText } = require('../anthropic-text');

const SYSTEM_PROMPT = [
  'Write three to five short plain-text sentences for a fleet manager, using only the supplied period and aggregate counts.',
  'Use the supplied values for unscored sessions, sessions with no recorded end, and missing alert records. Mention all three, including zeros.',
  'Use the supplied deltas to state the change versus the previous period. If comparison is unavailable or there were no previous sessions, say so. Do not calculate changes yourself.',
  'Make no medical claims, judgments about fitness to drive, or comments about individual drivers. Do not infer reasons for missing data.',
].join(' ');
const MAX_SUMMARY_LENGTH = 1200;

const FINISH_RESERVE_MS = 2500;
const MIN_PROVIDER_MS = 4000;

function remainingInsightMs() {
  try { return remainingProviderMs(REQUEST_PROVIDER_BUDGET_MS); }
  catch (error) {
    if (error.status === 504) return 0;
    throw error;
  }
}

function insufficientClaimBudget(response) {
  response.setHeader('Retry-After', '5');
  return json(response, 503, { ok: false, error: 'insights_unavailable' });
}

function retryResponse(response, entry, status = 502) {
  const nextDay = new Date(entry.report_day);
  nextDay.setUTCHours(24, 0, 0, 0);
  const retryAt = entry.attempt_count < 3 ? new Date(Math.min(nextDay.getTime(), Date.parse(entry.next_allowed_at))) : nextDay;
  const seconds = Math.max(0, Math.ceil((retryAt.getTime() - Date.now()) / 1000));
  response.setHeader('Retry-After', String(seconds));
  return json(response, status, { ok: false, error: 'insights_unavailable', retry_after: retryAt.toISOString() });
}

async function requestSummary(report, model, apiKey) {
  const input = { days: report.days, window_start: report.window_start, window_end: report.window_end };
  for (const field of reportCountFields) input[field] = report[field];

  input.monitored_hours = report.monitored_hours;
  input.alerts_per_monitored_hour = report.alerts_per_monitored_hour;
  const prior = report.previous_period;
  input.comparison = !prior ? { status: 'unavailable' } : {
    status: prior.sessions ? 'available' : 'no_previous_sessions',
    window_start: prior.window_start, window_end: prior.window_end,
    previous: Object.fromEntries(deltaFields.map(key => [key, prior[key]])),
    changes: report.period_deltas,
  };
  const timeoutMs = remainingInsightMs() - FINISH_RESERVE_MS;
  return requestText({ model, apiKey, systemPrompt: SYSTEM_PROMPT, input, maxLength: MAX_SUMMARY_LENGTH, timeoutMs });
}

function storedSummary(response, row) {
  if (!row) return json(response, 403, { ok: false, error: 'fleet_not_found' });
  if (row.summary !== null) {
    return json(response, 200, { ok: true, summary: row.summary, model: row.model, days: row.days,
      window_start: row.window_start, window_end: row.window_end,
      generated_at: new Date(row.finished_at).toISOString(), ai_generated: true });
  }
  if (!row.finished_at && Date.now() - Date.parse(row.created_at) <= REQUEST_PROVIDER_BUDGET_MS) {
    response.setHeader('Retry-After', '2');
    return json(response, 202, { ok: false, error: 'insights_pending' });
  }
  return retryResponse(response, row);
}

module.exports = withProviderBudget(async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return json(response, 405, { ok: false, error: 'method_not_allowed' });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (process.env.OCCULERT_FLEET_INSIGHTS_ENABLED !== '1' || !apiKey) {
    return json(response, 501, { ok: false, error: 'insights_not_configured' });
  }
  let owner;
  try {
    owner = await ownerPeriodRequest(request, response, undefined, { freshIdentity: true });
    if (!owner) return;
  } catch (error) {
    if (error.status === 504 && remainingInsightMs() === 0) return insufficientClaimBudget(response);
    return periodReportError(response, error);
  }
  const identity = { p_actor_id: owner.actorId, p_fleet_id: owner.fleet.id, p_days: owner.days };
  const model = process.env.OCCULERT_INSIGHTS_MODEL?.trim() || 'claude-haiku-5-5';
  try {
    if (remainingInsightMs() < FINISH_RESERVE_MS + MIN_PROVIDER_MS) return insufficientClaimBudget(response);
    const billing = paidAccess.paidAccessConfig();
    if (!billing) return json(response, 501, { ok: false, error: 'paid_access_not_configured' });
    if (!await paidAccess.hasPaidFleetAccess(owner, billing)) {
      return json(response, 403, { ok: false, error: 'paid_plan_required' });
    }
    if (remainingInsightMs() < FINISH_RESERVE_MS + MIN_PROVIDER_MS) return insufficientClaimBudget(response);
    const claim = await pgFetch('rpc/claim_fleet_insight_attempt', {
      method: 'POST', body: { ...identity, p_model: model },
    });
    if (!claim) return storedSummary(response, null);
    if (claim.claimed === false) return storedSummary(response, claim.entry);
    if (claim.claimed !== true || ![1, 2, 3].includes(claim.attempt_count) || !Number.isFinite(Date.parse(claim.next_allowed_at)) || !validReport(claim.report, owner.days) ||
        new Date(claim.report.window_end).toISOString().slice(0, 10) !== claim.report_day) {
      throw new Error('invalid_report');
    }
    const finish = (summary) => pgFetch('rpc/finish_fleet_insight_attempt', {
      method: 'POST', body: { ...identity, p_report_day: claim.report_day, p_attempt_count: claim.attempt_count, p_summary: summary,
        p_window_start: summary ? claim.report.window_start : null,
        p_window_end: summary ? claim.report.window_end : null },
    });
    let summary;
    try {
      summary = await requestSummary(claim.report, model, apiKey);
    } catch (error) {
      // The claim already persisted the next allowed attempt, even if finish fails.
      await finish(null).catch(() => {});
      return retryResponse(response, claim, supabaseErrorStatus(error));
    }
    return storedSummary(response, await finish(summary));
  } catch (error) {
    const missing = ['42883', 'PGRST202', 'PGRST205'].includes(error?.details?.code);
    return json(response, missing ? 503 : supabaseErrorStatus(error), { ok: false, error: 'insights_unavailable' });
  }
});
