const { remainingProviderMs } = require("./provider-budget");

const API_ORIGIN = "https://api.stripe.com";
const MAX_RESPONSE_BYTES = 256 * 1024;

// Enforce the response limit during transfer, before buffering the complete
// provider body. Content-Length alone cannot bound compressed/chunked data.
async function readStripeResponse(response, controller) {
  const oversized = () => new Error("stripe_response_too_large");
  const declared = response.headers?.get("content-length");
  if (/^\d+$/.test(declared || "") && Number(declared) > MAX_RESPONSE_BYTES) {
    if (response.body?.cancel) Promise.resolve(response.body.cancel()).catch(() => {});
    controller.abort();
    throw oversized();
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw oversized();
    return text;
  }
  const reader = response.body.getReader(), chunks = [];
  let size = 0, complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (controller.signal.aborted) {
        const error = new Error("stripe_timeout"); error.status = 504; throw error;
      }
      if (done) { complete = true; break; }
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        controller.abort();
        throw oversized();
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size).toString("utf8");
  } finally {
    if (!complete) Promise.resolve(reader.cancel()).catch(() => {});
    reader.releaseLock();
  }
}

async function requestStripeJson(path, secretKey, opts = {}) {
  if (!/^\/v1\/[A-Za-z0-9_/?=&.%+\-]+$/.test(path)) {
    throw new Error("invalid_stripe_path");
  }
  const timeoutMs = remainingProviderMs(opts.timeoutMs ?? 8000);
  const controller = new AbortController();
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("stripe_timeout"); error.status = 504;
      reject(error); controller.abort();
    }, timeoutMs);
  });
  const operation = (async () => {
    try {
      const method = opts.method || "GET";
      const headers = { Authorization: "Bearer " + secretKey };
      if (opts.apiVersion) headers["Stripe-Version"] = opts.apiVersion;
      if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
      if (opts.fields) headers["Content-Type"] = "application/x-www-form-urlencoded";
      const response = await fetch(API_ORIGIN + path, {
        method,
        redirect: "error",
        headers,
        body: opts.fields ? new URLSearchParams(opts.fields).toString() : undefined,
        signal: controller.signal,
      });
      // The hard deadline already settled the caller; discard late headers.
      if (controller.signal.aborted) return;
      const responseText = await readStripeResponse(response, controller);
      let data;
      try { data = JSON.parse(responseText); } catch (_) { throw new Error("stripe_invalid_response"); }
      if (!response.ok) {
        const error = new Error("stripe_request_failed");
        // A Stripe rejection reflects server-side billing configuration or
        // provider state, not the caller's bearer-token authorization.
        error.status = 502;
        error.providerStatus = response.status;
        error.stripeCode = data && data.error && data.error.code;
        throw error;
      }
      return data;
    } catch (error) {
      if (error && error.name === "AbortError") {
        const timeout = new Error("stripe_timeout");
        timeout.status = 504;
        throw timeout;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  })();
  return Promise.race([operation, expired]);
}

module.exports = { requestStripeJson };
