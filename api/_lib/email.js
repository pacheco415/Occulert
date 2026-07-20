// Server-only transactional email helper. Invitation creation must remain
// usable when email is not configured, so callers receive a delivery status
// and can preserve the one-time copy-link fallback.

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const EMAIL_TIMEOUT_MS = 7000;

function escapeHtml(value) {
  return String(value || "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

function configured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
}

async function readJson(response) {
  try { return await response.json(); }
  catch (_) { return {}; }
}

async function sendFleetInvitationEmail(options) {
  if (!configured()) return { status: "not_configured" };

  const fleetName = String(options.fleetName || "your fleet").replace(/[\0\r\n\t]/g, " ").trim().slice(0, 160) || "your fleet";
  const acceptUrl = String(options.acceptUrl || "");
  const to = String(options.to || "").trim().toLowerCase();
  const invitationId = String(options.invitationId || "");
  const safeFleetName = escapeHtml(fleetName);
  const safeAcceptUrl = escapeHtml(acceptUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EMAIL_TIMEOUT_MS);

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.RESEND_API_KEY,
        "Content-Type": "application/json",
        "Idempotency-Key": "fleet-invitation-" + invitationId,
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL,
        to: [to],
        subject: "You are invited to join " + fleetName + " on Occulert",
        text: [
          "You have been invited to join " + fleetName + " on Occulert.",
          "",
          "Accept the invitation: " + acceptUrl,
          "",
          "This link expires in seven days, works once, and must be opened with the invited email address.",
          "If you were not expecting this invitation, you can ignore this email.",
        ].join("\n"),
        html: "<div style=\"font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#172033\">" +
          "<h1 style=\"color:#0f172a\">Join " + safeFleetName + " on Occulert</h1>" +
          "<p>A fleet manager invited this email address to join their protected Occulert dashboard.</p>" +
          "<p style=\"margin:28px 0\"><a href=\"" + safeAcceptUrl + "\" style=\"background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700\">Accept invitation</a></p>" +
          "<p>This link expires in seven days, works once, and must be opened with the invited email address.</p>" +
          "<p style=\"color:#64748b;font-size:13px\">If you were not expecting this invitation, you can ignore this email.</p>" +
          "</div>",
      }),
      signal: controller.signal,
    });
    const body = await readJson(response);
    if (!response.ok || !body.id) return { status: "failed" };
    return { status: "sent", id: String(body.id) };
  } catch (_) {
    return { status: "failed" };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { configured, sendFleetInvitationEmail };
