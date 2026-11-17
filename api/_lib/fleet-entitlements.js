// Test-mode plan summary for a fleet owner. Informational only: no route
// refuses a request because of it, and driver safety alerts are never an
// entitlement. The limits are the proposals on the pricing page, not approved
// prices or terms. Every input is server-derived; nothing here reads a plan,
// a limit or a count from the client.
const PLAN_LIMITS = Object.freeze({
  trial: Object.freeze({ active_drivers: 5 }),
  starter: Object.freeze({ active_drivers: 10 }),
  growth: Object.freeze({ active_drivers: 30 }),
});
const BILLING_STATUSES = new Set([
  'none', 'incomplete', 'incomplete_expired', 'trialing', 'active',
  'past_due', 'unpaid', 'canceled', 'paused',
]);
// A past-due subscription keeps its plan while Stripe retries the payment.
// The grace period is not decided yet; this is the provisional reading.
const SUBSCRIBED_STATUSES = new Set(['trialing', 'active', 'past_due']);

// Exactly "true" turns the check on; anything else allows everything.
function enforcementEnabled(env = process.env) {
  return env.OCCULERT_ENTITLEMENT_ENFORCEMENT_ENABLED === 'true';
}

// `billing` is the fleet's fleet_billing_test row reduced to plan and status,
// or null when the fleet has no row. Returns null for a row this code does not
// understand, so an unknown state is reported as unavailable, never guessed.
function planFromBilling(billing) {
  if (billing === null) return { plan: 'trial', plan_source: 'no_subscription', subscription_status: 'none' };
  if (!billing || typeof billing !== 'object' || Array.isArray(billing)) return null;
  const { plan, status } = billing;
  if (!BILLING_STATUSES.has(status) || !(plan === null || plan === 'starter' || plan === 'growth')) return null;
  if (SUBSCRIBED_STATUSES.has(status)) {
    // A subscribed row without a plan contradicts the webhook's own checks.
    if (plan === null) return null;
    return { plan, plan_source: 'test_subscription', subscription_status: status };
  }
  return { plan: 'trial', plan_source: 'no_subscription', subscription_status: status };
}

// `monthly` is the validated fleet-summary monthly_activity value or null.
function entitlementSummary(billing, monthly, { enforced = enforcementEnabled() } = {}) {
  const current = planFromBilling(billing);
  if (!current) return null;
  const limit = PLAN_LIMITS[current.plan].active_drivers;
  const usage = monthly && Number.isSafeInteger(monthly.active_drivers) && monthly.active_drivers >= 0
    && typeof monthly.month === 'string'
    ? { active_drivers: monthly.active_drivers, month: monthly.month } : null;
  return {
    version: 1,
    test_mode: true,
    enforced: enforced === true,
    ...current,
    limit: { active_drivers: limit },
    usage,
    // Unknown usage is unknown, never treated as within or over the limit.
    within_limit: usage ? usage.active_drivers <= limit : null,
    plans: Object.entries(PLAN_LIMITS).map(([plan, limits]) => ({ plan, active_drivers: limits.active_drivers })),
  };
}

// Reads only the two columns the summary needs, scoped by the server-owned
// fleet id. A database without the test-billing migration has no
// subscriptions, the same reading account deletion uses. Any other failure is
// thrown so the caller reports the summary as unavailable.
async function testBillingState(pgFetch, fleetId) {
  let rows;
  try {
    rows = await pgFetch('fleet_billing_test', {
      params: { select: 'plan,status', fleet_id: 'eq.' + fleetId, limit: '1' },
    });
  } catch (error) {
    if (['42P01', 'PGRST205'].includes(error && error.details && error.details.code)) return null;
    throw error;
  }
  if (!Array.isArray(rows)) throw new Error('invalid_billing_state');
  const row = rows[0];
  if (row === undefined) return null;
  if (!row || typeof row !== 'object') throw new Error('invalid_billing_state');
  return { plan: row.plan ?? null, status: row.status };
}

// The server-only check a future route would consult. With enforcement off,
// the default, it passes for every fleet. An unavailable summary or unknown
// usage also passes: missing data must never lock an owner out.
function entitlementCheckPasses(summary) {
  return !(summary && summary.enforced === true && summary.within_limit === false);
}

module.exports = { PLAN_LIMITS, enforcementEnabled, planFromBilling, entitlementSummary, testBillingState, entitlementCheckPasses };
