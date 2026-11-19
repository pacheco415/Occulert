const { json, reportCountFields, ownerPeriodRequest, fetchPeriodReport, periodReportError } = require('../fleet-period');
const { remainingProviderMs, withProviderBudget } = require('../provider-budget');

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

module.exports = withProviderBudget(async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return json(response, 405, { ok: false, error: 'method_not_allowed' });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (process.env.OCCULERT_FLEET_INSIGHTS_ENABLED !== '1' || !apiKey) {
    return json(response, 501, { ok: false, error: 'insights_not_configured' });
  }
  let report;
  try {
    const owner = await ownerPeriodRequest(request, response);
    if (!owner) return;
    report = await fetchPeriodReport(owner.actorId, owner.fleet.id, owner.days);
  } catch (error) {
    return periodReportError(response, error);
  }
  const model = process.env.OCCULERT_INSIGHTS_MODEL?.trim() || 'claude-haiku-5-5';
  try {
    const summary = await requestSummary(report, model, apiKey);
    return json(response, 200, { ok: true, summary, model, days: report.days,
      window_start: report.window_start, window_end: report.window_end,
      generated_at: new Date().toISOString(), ai_generated: true });
  } catch (error) {
    return json(response, error?.status === 504 ? 504 : 502, { ok: false, error: 'insights_unavailable' });
  }
});
