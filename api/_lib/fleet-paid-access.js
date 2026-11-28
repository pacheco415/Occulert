const { requestStripeJson } = require('./stripe-transport');
const { createHash } = require('node:crypto');
const db = require('./supabase');
const { isUuid } = require('./validation');

function previewFleetIds() {
  if (process.env.VERCEL_ENV !== 'preview' || process.env.OCCULERT_PREVIEW_TEST_ENTITLEMENT !== '1') return [];
  const ids = (process.env.OCCULERT_PREVIEW_FLEET_IDS || '').split(',').map(id => id.trim().toLowerCase());
  return ids.every(isUuid) ? ids : [];
}

if (previewFleetIds().length) {
  console.warn('Occulert preview test entitlement is enabled for allowlisted fleets.');
}

function paidAccessConfig() {
  const key = process.env.STRIPE_FLEET_ACCESS_READ_KEY || '';
  const prices = (process.env.OCCULERT_FLEET_ASK_PRICE_IDS || '').split(',').map(id => id.trim());
  if (!/^rk_live_[A-Za-z0-9_]+$/.test(key) || !prices.every(id => /^price_[A-Za-z0-9]+$/.test(id))) return previewFleetIds().length ? { previewOnly: true } : null;
  return { key, prices };
}

function paidThrough(subscription, priceIds, now) {
  const { items, current_period_start: start, current_period_end: end, latest_invoice: invoice } = subscription;
  if (subscription.status !== 'active' || subscription.pause_collection !== null ||
      !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > now || now >= end ||
      !Array.isArray(items?.data)) return 0;
  if (invoice?.object !== 'invoice' || invoice.livemode !== true || invoice.status !== 'paid' ||
      invoice.subscription !== subscription.id || invoice.customer !== subscription.customer ||
      !Number.isSafeInteger(invoice.amount_paid) || invoice.amount_paid <= 0) return 0;
  // A prior period's invoice can still be the latest while a renewal is being finalized.
  const paidPrices = items.data.filter(item => item?.price?.livemode === true &&
    item.price.type === 'recurring' && priceIds.includes(item.price.id) &&
    Number.isSafeInteger(item.quantity) && item.quantity > 0).map(item => item.price.id);
  const paidLine = invoice.lines?.data?.find(line => line.type === 'subscription' &&
    line.subscription === subscription.id && paidPrices.includes(line.price?.id) &&
    Number.isSafeInteger(line.amount) && line.amount > 0 && Number.isSafeInteger(line.period?.start) &&
    Number.isSafeInteger(line.period?.end) && line.period.start <= now && now < line.period.end);
  if (!paidLine) return 0;
  const paidEnd = Math.min(end, paidLine.period.end);
  if (invoice.charge === null) return invoice.paid_out_of_band === true ? paidEnd : 0;
  const charge = invoice.charge;
  const settledCharge = charge?.object === 'charge' && charge.livemode === true && charge.customer === subscription.customer &&
    charge.status === 'succeeded' && charge.paid === true && charge.captured === true &&
    charge.refunded === false && charge.disputed === false && Number.isSafeInteger(charge.amount_captured) &&
    Number.isSafeInteger(charge.amount_refunded) && charge.amount_refunded >= 0 && charge.amount_captured > charge.amount_refunded;
  return settledCharge ? paidEnd : 0;
}

async function verifyWithStripe({ fleet, actorId }, { key, prices }) {
  const options = { apiVersion: '2024-06-20', timeoutMs: 2500 };
  const search = new URLSearchParams({
    query: `status:'active' AND metadata['fleet_id']:'${fleet.id}' AND metadata['owner_user_id']:'${actorId}'`, limit: '1',
  });
  const matches = await requestStripeJson('/v1/subscriptions/search?' + search, key, options);
  if (matches?.object !== 'search_result' || !Array.isArray(matches.data) || typeof matches.has_more !== 'boolean' ||
      matches.has_more || matches.data.length > 1) throw new Error('invalid_subscription_search');
  if (!matches.data.length) return 0;
  const id = matches.data[0]?.id;
  if (matches.data[0]?.livemode !== true || !/^sub_[A-Za-z0-9]+$/.test(id || '')) throw new Error('invalid_subscription_id');
  // Search is eventually consistent. Authorize from a fresh subscription and expanded invoice.
  const current = await requestStripeJson('/v1/subscriptions/' + id + '?expand%5B%5D=latest_invoice.charge', key, options);
  if (current?.object !== 'subscription' || current.id !== id || current.livemode !== true ||
      typeof current.customer !== 'string' || !/^cus_[A-Za-z0-9]+$/.test(current.customer)) throw new Error('invalid_subscription');
  if (current.metadata?.fleet_id !== fleet.id || current.metadata?.owner_user_id !== actorId) return 0;
  return paidThrough(current, prices, Math.floor(Date.now() / 1000));
}

async function hasPaidFleetAccess(owner, config) {
  const { fleet, actorId } = owner;
  if (!isUuid(fleet.id) || !isUuid(actorId)) throw new Error('invalid_fleet_owner');
  if (previewFleetIds().includes(fleet.id.toLowerCase())) {
    const [row] = await db.pgFetch('fleet_billing_test', { params: {
      fleet_id: 'eq.' + fleet.id, owner_user_id: 'eq.' + actorId, status: 'eq.active',
      select: 'fleet_id,owner_user_id,status,stripe_subscription_id', limit: '1',
    } });
    if (row?.fleet_id === fleet.id && row.owner_user_id === actorId && row.status === 'active' && /^sub_[A-Za-z0-9]+$/.test(row.stripe_subscription_id)) return true;
  }
  if (config.previewOnly) return false;
  const tag = createHash('sha256').update(JSON.stringify([config.key, config.prices])).digest('hex');
  const params = { fleet_id: 'eq.' + fleet.id, owner_id: 'eq.' + actorId, policy_tag: 'eq.' + tag,
    select: 'paid,valid_until', limit: '1' };
  const [cached] = await db.pgFetch('fleet_paid_access_cache', { params });
  if (typeof cached?.paid === 'boolean' && Date.parse(cached.valid_until) > Date.now()) return cached.paid;

  const verifiedAt = Date.now();
  const through = await verifyWithStripe(owner, config);
  const paid = through * 1000 > Date.now();
  const until = paid ? Math.min(through * 1000, verifiedAt + 300000) : verifiedAt + 60000;
  await db.pgFetch('fleet_paid_access_cache', { method: 'POST', mergeDuplicates: true,
    body: { fleet_id: fleet.id, owner_id: actorId, policy_tag: tag, paid, valid_until: new Date(until).toISOString() } });
  return paid;
}

module.exports = { paidAccessConfig, hasPaidFleetAccess };
