// GET    /api/fleet-invitations -> list the authenticated owner's invitations.
// POST   /api/fleet-invitations -> create a seven-day, one-time invitation.
// DELETE /api/fleet-invitations -> revoke a pending invitation.
//
// Raw invitation tokens are returned once and never stored. Supabase keeps
// only a SHA-256 digest, so a database read cannot reveal usable invite URLs.

const crypto = require("node:crypto");
const supabaseLib = require("./_lib/supabase");
const pgFetch = supabaseLib.pgFetch;
const verifyAccessToken = supabaseLib.verifyAccessToken;
const bearerToken = supabaseLib.bearerToken;
const MAX_BODY_LENGTH = 2048;

function json(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

function validBody(request) {
  if (!String(request.headers["content-type"] || "").toLowerCase().includes("application/json")) return false;
  const body = typeof request.body === "object" && request.body ? request.body : {};
  return !Array.isArray(body) && JSON.stringify(body).length <= MAX_BODY_LENGTH;
}

function normalizedEmail(value) {
  const email = String(value || "").replace(/\0/g, "").trim().toLowerCase().slice(0, 240);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function emailVerified(user) {
  return Boolean(user && user.email && (user.email_confirmed_at || user.confirmed_at));
}

async function ownedFleet(userId) {
  const rows = await pgFetch("fleets", {
    params: { select: "id,company_name,plan", owner_user_id: "eq." + userId, limit: "1" },
  });
  return rows[0] || null;
}

module.exports = async function handler(request, response) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(response, 501, { ok: false, error: "backend_not_configured" });
  }

  if (!["GET", "POST", "DELETE"].includes(request.method)) {
    response.setHeader("Allow", "GET, POST, DELETE");
    return json(response, 405, { ok: false, error: "method_not_allowed" });
  }

  try {
    const user = await verifyAccessToken(bearerToken(request));
    if (!user) return json(response, 401, { ok: false, error: "unauthorized" });
    if (!emailVerified(user)) return json(response, 403, { ok: false, error: "email_not_verified" });
    if (request.method !== "GET" && !validBody(request)) {
      return json(response, 415, { ok: false, error: "invalid_json_body" });
    }

    const fleet = await ownedFleet(user.id);
    if (!fleet) return json(response, 403, { ok: false, error: "fleet_not_found" });

    if (request.method === "GET") {
      const invitations = await pgFetch("fleet_invitations", {
        params: {
          select: "id,email,expires_at,accepted_at,revoked_at,created_at",
          fleet_id: "eq." + fleet.id,
          order: "created_at.desc",
          limit: "100",
        },
      });
      return json(response, 200, { ok: true, fleet: fleet, invitations: invitations });
    }

    if (request.method === "DELETE") {
      const invitationId = request.body && request.body.invitation_id;
      if (!validUuid(invitationId)) return json(response, 400, { ok: false, error: "invalid_invitation_id" });
      const rows = await pgFetch("fleet_invitations", {
        method: "PATCH",
        params: {
          id: "eq." + invitationId,
          fleet_id: "eq." + fleet.id,
          accepted_at: "is.null",
          revoked_at: "is.null",
        },
        body: { revoked_at: new Date().toISOString() },
      });
      if (!rows.length) return json(response, 404, { ok: false, error: "invitation_not_found" });
      return json(response, 200, { ok: true, invitation: rows[0] });
    }

    const replacementId = String(request.body && request.body.replace_invitation_id || "");
    if (replacementId && !validUuid(replacementId)) return json(response, 400, { ok: false, error: "invalid_invitation_id" });
    const email = replacementId ? null : normalizedEmail(request.body && request.body.email);
    if (!replacementId && !email) return json(response, 400, { ok: false, error: "invalid_email" });
    if (email && email === normalizedEmail(user.email)) return json(response, 400, { ok: false, error: "cannot_invite_self" });

    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const invitation = await pgFetch("rpc/create_fleet_invitation", {
      method: "POST",
      body: {
        p_fleet_id: fleet.id,
        p_owner_user_id: user.id,
        p_owner_email: user.email,
        p_email: email,
        p_token_hash: tokenHash,
        p_replace_invitation_id: replacementId || null,
      },
    });
    if (!invitation || !invitation.id || !invitation.email || !invitation.expires_at) return json(response, 502, { ok: false, error: "invitation_not_saved" });

    const acceptPath = "/accept-invite.html#token=" + token;

    return json(response, 201, {
      ok: true,
      invitation: {
        id: invitation.id,
        email: invitation.email,
        expires_at: invitation.expires_at,
        accept_path: acceptPath,
      },
    });
  } catch (error) {
    const code = error && error.details && error.details.message;
    const statuses = { fleet_not_found: 403, invalid_invitation: 400, invitation_not_found: 404,
      resend_too_soon: 429, invalid_email: 400, cannot_invite_self: 400,
      active_invitation_exists: 409, too_many_pending_invitations: 429, invitation_rate_limited: 429 };
    if (error && error.details && error.details.code === "P0001" && Object.prototype.hasOwnProperty.call(statuses, code)) {
      if (code === "resend_too_soon") response.setHeader("Retry-After", "60");
      if (code === "invitation_rate_limited") response.setHeader("Retry-After", "3600");
      return json(response, statuses[code], { ok: false, error: code });
    }
    return json(response, 502, { ok: false, error: "supabase_error" });
  }
};
