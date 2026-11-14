const { json } = require("./responses");

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

// This reserves an attempt before the route's separate mutation. A timeout,
// failed write or creation race never causes a refund or automatic retry.
// Pass the route's provider boundary so it retains the shared request deadline.
async function allowAccountWrite(pgFetch, response, userId, operation) {
  const result = await pgFetch("rpc/reserve_account_write", {
    method: "POST", body: { p_user_id: userId, p_operation: operation },
  });
  const matches = result && typeof result.user_id === "string"
    && typeof userId === "string" && result.user_id.toLowerCase() === userId.toLowerCase()
    && result.operation === operation;
  if (matches && exactKeys(result, ["allowed", "user_id", "operation"]) && result.allowed === true) {
    return true;
  }
  if (matches && result.allowed === false) {
    if (exactKeys(result, ["allowed", "user_id", "operation", "error", "retry_after"])
      && result.error === "account_write_rate_limited"
      && Number.isInteger(result.retry_after) && result.retry_after >= 1 && result.retry_after <= 3600) {
      response.setHeader("Retry-After", String(result.retry_after));
      json(response, 429, { ok: false, error: "account_write_rate_limited" });
      return false;
    }
    if (exactKeys(result, ["allowed", "user_id", "operation", "error"])
      && result.error === "account_not_found") {
      json(response, 401, { ok: false, error: "unauthorized" });
      return false;
    }
  }
  // Missing migrations, malformed responses and unknown outcomes never permit
  // the following driver/fleet write. Provider exceptions keep route mappings.
  json(response, 502, { ok: false, error: "write_quota_unavailable" });
  return false;
}

module.exports = { allowAccountWrite };
