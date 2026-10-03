// Stripe test-mode REST and webhook helpers. This module deliberately refuses
// live keys; enabling real payments requires a separate review and migration.
const crypto = require("node:crypto");
const { remainingProviderMs } = require("./provider-budget");

const API_ORIGIN = "https://api.stripe.com";
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_WEBHOOK_BYTES = 1024 * 1024;

function config() {
  const secretKey = process.env.STRIPE_TEST_SECRET_KEY || "";
  const webhookSecret = process.env.STRIPE_TEST_WEBHOOK_SECRET || "";
  const starterPrice = process.env.STRIPE_TEST_PRICE_STARTER || "";
  const growthPrice = process.env.STRIPE_TEST_PRICE_GROWTH || "";
  if (!/^sk_test_[A-Za-z0-9_]+$/.test(secretKey) ||
      !/^whsec_[A-Za-z0-9_]+$/.test(webhookSecret) ||
      !/^price_[A-Za-z0-9]+$/.test(starterPrice) ||
      !/^price_[A-Za-z0-9]+$/.test(growthPrice) ||
      starterPrice === growthPrice) {
    const error = new Error("billing_test_not_configured");
    error.status = 501;
    throw error;
  }
  return { secretKey, webhookSecret, prices: { starter: starterPrice, growth: growthPrice } };
}

function portalConfigurationId() {
  const id = process.env.STRIPE_TEST_PORTAL_CONFIGURATION_ID || "";
  if (!/^bpc_[A-Za-z0-9]+$/.test(id)) {
    const error = new Error("billing_test_not_configured");
    error.status = 501;
    throw error;
  }
  return id;
}

function siteOrigin() {
  const raw = process.env.OCCULERT_BILLING_SITE_ORIGIN || "https://www.occulert.com";
  let parsed;
  try { parsed = new URL(raw); } catch (_) { parsed = null; }
  if (!parsed || parsed.protocol !== "https:" || parsed.port || parsed.username || parsed.password ||
      parsed.pathname !== "/" || parsed.search || parsed.hash ||
      !(parsed.hostname === "occulert.com" || parsed.hostname.endsWith(".occulert.com"))) {
    const error = new Error("billing_site_origin_invalid");
    error.status = 501;
    throw error;
  }
  return parsed.origin;
}

function fixedReturnUrls() {
  const origin = siteOrigin();
  return {
    success: origin + "/fleet-dashboard.html?billing=return",
    cancel: origin + "/fleet-pricing.html?billing=canceled",
    portal: origin + "/fleet-dashboard.html?billing=portal-return",
  };
}

function safeStripeUrl(value, hostname) {
  let parsed;
  try { parsed = new URL(value); } catch (_) { return null; }
  return parsed.protocol === "https:" && parsed.hostname === hostname &&
    !parsed.username && !parsed.password ? parsed.href : null;
}

function idempotencyKey(prefix, parts) {
  return "occulert-test-" + prefix + "-" + crypto.createHash("sha256")
    .update(parts.join("\0"), "utf8").digest("hex");
}

async function stripeRequest(path, options) {
  const opts = options || {};
  const cfg = config();
  if (!/^\/v1\/[A-Za-z0-9_/?=&.%\-]+$/.test(path)) {
    throw new Error("invalid_stripe_path");
  }
  const timeoutMs = remainingProviderMs(8000);
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
    const headers = { Authorization: "Bearer " + cfg.secretKey };
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    if (opts.fields) headers["Content-Type"] = "application/x-www-form-urlencoded";
    const response = await fetch(API_ORIGIN + path, {
      method,
      headers,
      body: opts.fields ? new URLSearchParams(opts.fields).toString() : undefined,
      signal: controller.signal,
    });
    const responseText = await response.text();
    if (Buffer.byteLength(responseText) > MAX_RESPONSE_BYTES) throw new Error("stripe_response_too_large");
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
    if (!data || typeof data !== "object" || data.livemode !== false) {
      throw new Error("stripe_live_object_rejected");
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

async function requireMonthlyTestPrice(priceId) {
  const price = await stripeRequest("/v1/prices/" + priceId);
  if (price.id !== priceId || price.livemode !== false || price.active !== true ||
      price.type !== "recurring" || !price.recurring ||
      price.recurring.interval !== "month" || price.recurring.interval_count !== 1 ||
      !Number.isSafeInteger(price.unit_amount) || price.unit_amount <= 0) {
    throw new Error("invalid_monthly_test_price");
  }
  return price;
}

async function requireSafePortalConfiguration(id) {
  const setting = await stripeRequest("/v1/billing_portal/configurations/" + id);
  const features = setting.features || {};
  if (setting.id !== id || setting.livemode !== false || setting.active !== true ||
      !features.subscription_cancel || features.subscription_cancel.enabled !== true ||
      !features.subscription_update || features.subscription_update.enabled !== false ||
      features.subscription_pause && features.subscription_pause.enabled === true) {
    throw new Error("unsafe_test_portal_configuration");
  }
  return setting;
}

async function readRawBody(request) {
  const declared = Number(request.headers["content-length"] || 0);
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) {
    const error = new Error("webhook_too_large");
    error.status = 413;
    throw error;
  }
  if (!request || typeof request[Symbol.asyncIterator] !== "function") {
    throw new Error("raw_webhook_stream_unavailable");
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > MAX_WEBHOOK_BYTES) {
      const error = new Error("webhook_too_large");
      error.status = 413;
      throw error;
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, length);
}

function verifyWebhookSignature(rawBody, signatureHeader, secret, nowMs) {
  if (!Buffer.isBuffer(rawBody) || !/^whsec_[A-Za-z0-9_]+$/.test(secret || "")) return false;
  const pieces = String(signatureHeader || "").split(",").map(part => part.trim());
  const timestampParts = pieces.filter(part => /^t=\d+$/.test(part));
  const signatureParts = pieces.filter(part => /^v1=[a-f0-9]{64}$/i.test(part));
  if (timestampParts.length !== 1 || !signatureParts.length) return false;
  const timestamp = Number(timestampParts[0].slice(2));
  const now = Math.floor((nowMs === undefined ? Date.now() : nowMs) / 1000);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > 300) return false;
  const signed = Buffer.concat([Buffer.from(String(timestamp) + "."), rawBody]);
  const expected = crypto.createHmac("sha256", secret).update(signed).digest();
  return signatureParts.some(part => {
    const actual = Buffer.from(part.slice(3), "hex");
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  });
}

module.exports = {
  config, portalConfigurationId, fixedReturnUrls, safeStripeUrl, idempotencyKey,
  stripeRequest, requireMonthlyTestPrice, requireSafePortalConfiguration,
  readRawBody, verifyWebhookSignature,
};
