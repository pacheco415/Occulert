const MAX_RESPONSE_BYTES = 32 * 1024;

async function requestText({ feature, model, apiKey, systemPrompt, input, maxLength, timeoutMs }) {
  if (timeoutMs <= 0) throw Object.assign(new Error('insights_timeout'), { status: 504 });
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
        model, max_tokens: 400, system: systemPrompt,
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
      if (controller.signal.aborted) throw new Error('insights_unavailable');
      if (bytes > MAX_RESPONSE_BYTES) {
        console.warn('fleet_ai_output_rejected', { feature, reason: 'response_byte_limit' });
        throw new Error('insights_unavailable');
      }
      chunks.push(chunk);
    }
    const message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (message.stop_reason === 'max_tokens') {
      console.warn('fleet_ai_output_rejected', { feature, reason: 'max_tokens' });
      throw new Error('insights_unavailable');
    }
    if (message.stop_reason !== 'end_turn' || !Array.isArray(message.content) ||
        !message.content.every(block => block?.type === 'text' && typeof block.text === 'string')) {
      throw new Error('insights_unavailable');
    }
    const text = message.content.map(block => block.text).join('\n').trim();
    if (text.length > maxLength) {
      console.warn('fleet_ai_output_rejected', { feature, reason: 'character_limit' });
      throw new Error('insights_unavailable');
    }
    if (!text || text.includes(apiKey)) {
      throw new Error('insights_unavailable');
    }
    return text;
  }
  try {
    return await Promise.race([deadline, readMessage()]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

module.exports = { requestText };
