const MAX_FIELD_LENGTH = 1200;
const MAX_BODY_LENGTH = 4096;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const crypto = require("node:crypto");
const { pgFetch } = require("./_lib/supabase");
const DEFAULT_ALLOWED_ORIGINS = new Set([
  "https://www.occulert.com",
  "https://occulert.com",
]);
const COMMERCIAL_PLANS = Object.freeze({
  "free-trial": "Free Fleet Trial — $0 / 30 days",
  starter: "Starter — $9 / month",
  growth: "Growth — $25 / month",
  custom: "Custom fleet scope",
  conversation: "Exploratory fleet conversation",
});
const PAID_ROLLOUT_PLANS = new Set(["starter", "growth", "custom"]);
const ROLLOUT_TIMELINES = Object.freeze({
  "within-30-days": "Within 30 days",
  "one-to-three-months": "1–3 months",
  "three-plus-months": "More than 3 months",
  exploring: "Exploring options",
});
const OPERATING_GOALS = Object.freeze({
  participation: "Validate driver participation",
  "manager-workflow": "Reduce manager review time",
  coaching: "Support coaching conversations",
  "broader-rollout": "Prepare a broader rollout",
  other: "Other operating goal",
});

function clean(value, max = MAX_FIELD_LENGTH) {
  return String(value || "").replace(/\0/g, "").trim().slice(0, max);
}

function allowlistedLabel(value, labels) {
  if (typeof value !== "string") return "";
  const key = clean(value, 80);
  return Object.hasOwn(labels, key) ? labels[key] : "";
}

function json(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function allowedOrigins() {
  const configured = String(process.env.OCCULERT_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]);
}

function isAllowedOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return false;
  if (allowedOrigins().has(origin)) return true;

  const host = request.headers.host || "";
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
}

function clientAddress(request) {
  const forwarded = String(request.headers["x-vercel-forwarded-for"] || request.headers["x-forwarded-for"] || "");
  return forwarded.split(",")[0].trim() || request.socket?.remoteAddress || "unknown";
}

async function rateLimitState(request) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("durable_rate_limit_not_configured");
  }
  const rateKey = crypto
    .createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY)
    .update(clientAddress(request))
    .digest("hex");
  const result = await pgFetch("rpc/check_pilot_lead_rate_limit", {
    method: "POST",
    body: {
      p_rate_key: rateKey,
      p_limit: RATE_LIMIT_MAX,
      p_window_seconds: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000),
    },
  });
  const row = Array.isArray(result) ? result[0] : result;
  if (!row || typeof row.allowed !== "boolean") throw new Error("invalid_rate_limit_response");
  return {
    limited: !row.allowed,
    retryAfter: Math.max(1, Number(row.retry_after_seconds) || Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)),
  };
}

function parseWebhookUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return json(response, 405, { ok: false, error: "method_not_allowed" });
  }

  if (!isAllowedOrigin(request)) {
    return json(response, 403, { ok: false, error: "origin_not_allowed" });
  }

  if (!String(request.headers["content-type"] || "").toLowerCase().includes("application/json")) {
    return json(response, 415, { ok: false, error: "unsupported_media_type" });
  }

  let rateLimit;
  try {
    rateLimit = await rateLimitState(request);
  } catch {
    return json(response, 503, { ok: false, error: "rate_limit_unavailable" });
  }
  if (rateLimit.limited) {
    response.setHeader("Retry-After", String(rateLimit.retryAfter));
    return json(response, 429, { ok: false, error: "rate_limited" });
  }

  const body = typeof request.body === "object" && request.body ? request.body : {};
  if (Array.isArray(body)) {
    return json(response, 400, { ok: false, error: "invalid_body" });
  }

  if (JSON.stringify(body).length > MAX_BODY_LENGTH) {
    return json(response, 413, { ok: false, error: "payload_too_large" });
  }

  if (clean(body.website, 120)) {
    return json(response, 400, { ok: false, error: "invalid_lead" });
  }

  const startedAt = Date.parse(String(body.startedAt || ""));
  const ageMs = Date.now() - startedAt;
  if (!Number.isFinite(startedAt) || ageMs < 2000 || ageMs > 2 * 60 * 60 * 1000) {
    return json(response, 400, { ok: false, error: "invalid_lead" });
  }

  const freeTrialInterest = body.interest === "free_trial";
  const paidRolloutInterest = body.interest === "paid_rollout";
  const commercialInterest = freeTrialInterest || paidRolloutInterest;
  const planKey = typeof body.plan === "string" ? clean(body.plan, 80) : "";
  const planLabel = allowlistedLabel(body.plan, COMMERCIAL_PLANS);
  const timelineLabel = allowlistedLabel(body.timeline, ROLLOUT_TIMELINES);
  const goalLabel = allowlistedLabel(body.goal, OPERATING_GOALS);
  const validInterestPlan = freeTrialInterest
    ? planKey === "free-trial"
    : paidRolloutInterest
      ? PAID_ROLLOUT_PLANS.has(planKey)
      : true;
  if (commercialInterest && (!validInterestPlan || !planLabel || !timelineLabel || !goalLabel)) {
    return json(response, 400, { ok: false, error: "invalid_lead" });
  }
  const qualificationMessage = [
    planLabel && `Plan interest: ${planLabel}`,
    timelineLabel && `Desired start: ${timelineLabel}`,
    goalLabel && `Primary goal: ${goalLabel}`,
    clean(body.message, 800),
  ].filter(Boolean).join("\n");
  const lead = {
    name: clean(body.name, 160),
    role: clean(body.role, 160),
    company: clean(body.company, 220),
    email: clean(body.email, 240).toLowerCase(),
    phone: clean(body.phone, 80),
    fleet: clean(body.fleet, 80),
    useCase: clean(body.useCase, 120),
    message: clean(qualificationMessage, 1200),
    source: freeTrialInterest
      ? "free-trial-page"
      : paidRolloutInterest
        ? "paid-rollout-page"
        : "pilot-signup-page",
    receivedAt: new Date().toISOString(),
  };

  if (!lead.name || !lead.company || !isEmail(lead.email)) {
    return json(response, 400, { ok: false, error: "invalid_lead" });
  }

  let stored = false;
  let storageError = false;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const created = await pgFetch("pilot_leads", {
        method: "POST",
        body: {
          name: lead.name,
          role: lead.role || null,
          company: lead.company,
          email: lead.email,
          phone: lead.phone || null,
          fleet: lead.fleet || null,
          use_case: lead.useCase || null,
          message: lead.message || null,
          source: lead.source,
          received_at: lead.receivedAt,
        },
      });
      stored = Array.isArray(created) && created.length > 0;
    } catch {
      storageError = true;
    }
  }

  // Use exactly one configured destination for contact PII. Supabase is the
  // primary store; the webhook is a fallback only when Supabase is absent.
  if (stored) return json(response, 200, { ok: true, stored: true, storage: "supabase" });

  const webhookUrl = parseWebhookUrl(process.env.PILOT_LEADS_WEBHOOK_URL);
  if (!webhookUrl) {
    if (storageError) return json(response, 502, { ok: false, error: "storage_unavailable" });
    return json(response, 202, { ok: true, stored: false, message: "Lead validated but server storage is not configured." });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "occulert.pilot_lead", lead }),
      signal: controller.signal,
    });

    if (!webhookResponse.ok) {
      return json(response, 502, { ok: false, error: "webhook_failed" });
    }

    return json(response, 200, { ok: true, stored: true, storage: "webhook" });
  } catch (error) {
    return json(response, 502, { ok: false, error: "webhook_unreachable" });
  } finally {
    clearTimeout(timeout);
  }
};
