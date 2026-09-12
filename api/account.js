// DELETE /api/account -> permanently delete the authenticated Occulert account.
// The service-role key is used only on the server after the bearer token has
// been verified. The browser must send { confirm: "DELETE" } deliberately.

const supabaseLib = require("./_lib/supabase");
const pgFetch = supabaseLib.pgFetch;
const verifyAccessToken = supabaseLib.verifyAccessToken;
const deleteAuthUser = supabaseLib.deleteAuthUser;
const bearerToken = supabaseLib.bearerToken;

function json(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

function validBody(request) {
  if (!String(request.headers["content-type"] || "").toLowerCase().includes("application/json")) return false;
  const body = request.body && typeof request.body === "object" && !Array.isArray(request.body) ? request.body : {};
  return JSON.stringify(body).length <= 256 && body.confirm === "DELETE";
}

function inFilter(ids) {
  return "in.(" + ids.join(",") + ")";
}

async function deleteRows(table, ids) {
  for (const id of ids) {
    await pgFetch(table, { method: "DELETE", params: { id: "eq." + id } });
  }
}

module.exports = async function handler(request, response) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(response, 501, { ok: false, error: "backend_not_configured" });
  }
  if (request.method !== "DELETE") {
    response.setHeader("Allow", "DELETE");
    return json(response, 405, { ok: false, error: "method_not_allowed" });
  }

  const user = await verifyAccessToken(bearerToken(request));
  if (!user) return json(response, 401, { ok: false, error: "unauthorized" });
  if (!validBody(request)) return json(response, 400, { ok: false, error: "confirmation_required" });

  try {
    const userId = user.id;
    const drivers = await pgFetch("drivers", {
      params: { select: "id", user_id: "eq." + userId },
    });
    const driverIds = drivers.map((row) => row.id).filter(Boolean);
    const ownedFleets = await pgFetch("fleets", {
      params: { select: "id", owner_user_id: "eq." + userId },
    });
    const fleetIds = ownedFleets.map((row) => row.id).filter(Boolean);

    const sessionIds = [];
    if (driverIds.length) {
      const sessions = await pgFetch("sessions", {
        params: { select: "id", driver_id: inFilter(driverIds) },
      });
      sessionIds.push(...sessions.map((row) => row.id).filter(Boolean));
    }
    if (sessionIds.length) {
      await pgFetch("events", { method: "DELETE", params: { session_id: inFilter(sessionIds) } });
      await pgFetch("sessions", { method: "DELETE", params: { id: inFilter(sessionIds) } });
    }
    if (driverIds.length) await pgFetch("drivers", { method: "DELETE", params: { id: inFilter(driverIds) } });

    const invitations = await pgFetch("fleet_invitations", {
      params: { select: "id", or: "(invited_by.eq." + userId + ",accepted_by.eq." + userId + ")" },
    });
    await deleteRows("fleet_invitations", invitations.map((row) => row.id).filter(Boolean));
    for (const fleetId of fleetIds) {
      const fleetInvitations = await pgFetch("fleet_invitations", {
        params: { select: "id", fleet_id: "eq." + fleetId },
      });
      await deleteRows("fleet_invitations", fleetInvitations.map((row) => row.id).filter(Boolean));
      await pgFetch("fleets", { method: "DELETE", params: { id: "eq." + fleetId } });
    }

    await deleteAuthUser(userId);
    return json(response, 200, { ok: true, deleted: true });
  } catch (error) {
    return json(response, 502, { ok: false, error: "account_deletion_failed" });
  }
};
