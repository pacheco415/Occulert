const { json, reportCountFields, ownerPeriodRequest, validReport, periodReportError } = require('../fleet-period');
const { pgFetch } = require('../supabase');
const { supabaseErrorStatus } = require('../supabase-errors');
const { REQUEST_PROVIDER_BUDGET_MS, remainingProviderMs, withProviderBudget } = require('../provider-budget');

const SYSTEM_PROMPT = [
  'Write three to five short plain-text sentences for a fleet manager, using only the supplied period and aggregate counts.',
  'Use the supplied values for unscored sessions, sessions with no recorded end, and missing alert records. Mention all three, including zeros.',
  'Make no medical claims, judgments about fitness to drive, or comments about individual drivers. Do not infer reasons for missing data.',
].join(' ');
const MAX_SUMMARY_LENGTH = 1200;
const MAX_RESPONSE_BYTES = 32 * 1024;

async function requestSummary(report, model, apiKey) {
  const input = { days: report.days, window_start: report.window_start, window_end: report.window_end };
  for (const field of reportCountFields) input[field] = report[field];

  const timeoutMs = remainingProviderMs(12000);
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const timeout = new Error('insights_timeout');
      timeout.status = 504;
      reject(timeout);
      controller.abort();
    }, timeoutMs);
  });

  async function readMessage() {
    const result = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': apiKey },
      body: JSON.stringify({
        model, max_tokens: 400, system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify(input) }],
      }),
    });
    if (!result.ok || controller.signal.aborted) {
      const failure = new Error('insights_unavailable');
      if (result.status === 504) failure.status = 504;
      throw failure;
    }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of result.body) {
      bytes += chunk.byteLength;
      if (bytes > MAX_RESPONSE_BYTES || controller.signal.aborted) throw new Error('insights_unavailable');
      chunks.push(chunk);
    }
    const message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (message.stop_reason !== 'end_turn' || !Array.isArray(message.content) ||
        !message.content.every(block => block?.type === 'text' && typeof block.text === 'string')) {
      throw new Error('insights_unavailable');
    }
    const summary = message.content.map(block => block.text).join('\n').trim();
    if (!summary || summary.length > MAX_SUMMARY_LENGTH || summary.includes(apiKey)) {
      throw new Error('insights_unavailable');
    }
    return summary;
  }
  try {
    return await Promise.race([deadline, readMessage()]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
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
  return json(response, 502, { ok: false, error: 'insights_unavailable' });
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
    owner = await ownerPeriodRequest(request, response);
    if (!owner) return;
  } catch (error) {
    return periodReportError(response, error);
  }
  const identity = { p_actor_id: owner.actorId, p_fleet_id: owner.fleet.id, p_days: owner.days };
  const model = process.env.OCCULERT_INSIGHTS_MODEL?.trim() || 'claude-haiku-5-5';
  try {
    const claim = await pgFetch('rpc/claim_fleet_insight_summary', {
      method: 'POST', body: { ...identity, p_model: model },
    });
    if (!claim) return storedSummary(response, null);
    if (claim.claimed === false) return storedSummary(response, claim.entry);
    if (claim.claimed !== true || !validReport(claim.report, owner.days) ||
        new Date(claim.report.window_end).toISOString().slice(0, 10) !== claim.report_day) {
      throw new Error('invalid_report');
    }
    const finish = (summary) => pgFetch('rpc/finish_fleet_insight_summary', {
      method: 'POST', body: { ...identity, p_report_day: claim.report_day, p_summary: summary,
        p_window_start: summary ? claim.report.window_start : null,
        p_window_end: summary ? claim.report.window_end : null },
    });
    let summary;
    try {
      summary = await requestSummary(claim.report, model, apiKey);
    } catch (error) {
      // If the deadline also prevents this write, the reservation still blocks a second charge.
      await finish(null).catch(() => {});
      throw error;
    }
    return storedSummary(response, await finish(summary));
  } catch (error) {
    const missing = ['42883', 'PGRST202', 'PGRST205'].includes(error?.details?.code);
    return json(response, missing ? 503 : supabaseErrorStatus(error), { ok: false, error: 'insights_unavailable' });
  }
});
