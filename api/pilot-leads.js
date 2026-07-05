const MAX_FIELD_LENGTH = 1200;

function clean(value, max = MAX_FIELD_LENGTH) {
  return String(value || "").trim().slice(0, max);
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

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return json(response, 405, { ok: false, error: "method_not_allowed" });
  }

  const body = typeof request.body === "object" && request.body ? request.body : {};
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

  const webhookUrl = process.env.PILOT_LEADS_WEBHOOK_URL;
  if (!webhookUrl) {
    return json(response, 202, {
      ok: true,
      stored: false,
      message: "Lead validated. Configure PILOT_LEADS_WEBHOOK_URL to forward submissions.",
    });
  }

  try {
    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "occulert.pilot_lead", lead }),
    });

    if (!webhookResponse.ok) {
      return json(response, 502, { ok: false, error: "webhook_failed" });
    }

    return json(response, 200, { ok: true, stored: true });
  } catch (error) {
    return json(response, 502, { ok: false, error: "webhook_unreachable" });
  }
};
