const MAX_FIELD_LENGTH = 1200;
const MAX_BODY_LENGTH = 4096;
const DEFAULT_ALLOWED_ORIGINS = new Set([
  "https://www.occulert.com",
  "https://occulert.com",
]);

function clean(value, max = MAX_FIELD_LENGTH) {
  return String(value || "").replace(/\0/g, "").trim().slice(0, max);
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

  const body = typeof request.body === "object" && request.body ? request.body : {};
  if (Array.isArray(body)) {
    return json(response, 400, { ok: false, error: "invalid_body" });
  }

  if (JSON.stringify(body).length > MAX_BODY_LENGTH) {
    return json(response, 413, { ok: false, error: "payload_too_large" });
  }

  const lead = {
    name: clean(body.name, 160),
    role: clean(body.role, 160),
    company: clean(body.company, 220),
    email: clean(body.email, 240).toLowerCase(),
    phone: clean(body.phone, 80),
    fleet: clean(body.fleet, 80),
    useCase: clean(body.useCase, 120),
    message: clean(body.message, 1200),
    source: "pilot-signup-page",
    receivedAt: new Date().toISOString(),
  };

  if (!lead.name || !lead.company || !isEmail(lead.email)) {
    return json(response, 400, { ok: false, error: "invalid_lead" });
  }

  const webhookUrl = parseWebhookUrl(process.env.PILOT_LEADS_WEBHOOK_URL);
  if (!webhookUrl) {
    return json(response, 202, {
      ok: true,
      stored: false,
      message: "Lead validated. Configure PILOT_LEADS_WEBHOOK_URL to forward submissions.",
    });
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

    return json(response, 200, { ok: true, stored: true });
  } catch (error) {
    return json(response, 502, { ok: false, error: "webhook_unreachable" });
  } finally {
    clearTimeout(timeout);
  }
};
