const { requestStripeJson } = require('./stripe-transport');
const { isUuid } = require('./validation');

function paidAccessConfig() {
  const key = process.env.STRIPE_FLEET_ACCESS_READ_KEY || '';
  const prices = (process.env.OCCULERT_FLEET_ASK_PRICE_IDS || '').split(',').map(id => id.trim());
  if (!/^rk_live_[A-Za-z0-9_]+$/.test(key) || !prices.every(id => /^price_[A-Za-z0-9]+$/.test(id))) return null;
  return { key, prices };
}

function coversCurrentPeriod(subscription, priceIds, now) {
  const { items, current_period_start: start, current_period_end: end, latest_invoice: invoice } = subscription;
  if (subscription.status !== 'active' || subscription.pause_collection !== null ||
      !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > now || now >= end ||
      !Array.isArray(items?.data)) return false;
  if (invoice?.object !== 'invoice' || invoice.livemode !== true || invoice.status !== 'paid' ||
      invoice.subscription !== subscription.id || invoice.customer !== subscription.customer ||
      !Number.isSafeInteger(invoice.amount_paid) || invoice.amount_paid <= 0) return false;
  // A prior period's invoice can still be the latest while a renewal is being finalized.
  const paidPrices = items.data.filter(item => item?.price?.livemode === true &&
    item.price.type === 'recurring' && priceIds.includes(item.price.id) &&
    Number.isSafeInteger(item.quantity) && item.quantity > 0).map(item => item.price.id);
  const coversPeriod = invoice.lines?.data?.some(line => line.type === 'subscription' &&
    line.subscription === subscription.id && paidPrices.includes(line.price?.id) &&
    Number.isSafeInteger(line.amount) && line.amount > 0 && Number.isSafeInteger(line.period?.start) &&
    Number.isSafeInteger(line.period?.end) && line.period.start <= now && now < line.period.end);
  if (!coversPeriod) return false;
  if (invoice.charge === null) return invoice.paid_out_of_band === true;
  const charge = invoice.charge;
  return charge?.object === 'charge' && charge.livemode === true && charge.customer === subscription.customer &&
    charge.status === 'succeeded' && charge.paid === true && charge.captured === true &&
    charge.refunded === false && charge.disputed === false && Number.isSafeInteger(charge.amount_captured) &&
    Number.isSafeInteger(charge.amount_refunded) && charge.amount_refunded >= 0 && charge.amount_captured > charge.amount_refunded;
}

async function hasPaidFleetAccess({ fleet, actorId }, { key, prices }) {
  if (!isUuid(fleet.id) || !isUuid(actorId)) throw new Error('invalid_fleet_owner');
  const options = { apiVersion: '2024-06-20', timeoutMs: 2500 };
  const search = new URLSearchParams({
    query: `status:'active' AND metadata['fleet_id']:'${fleet.id}' AND metadata['owner_user_id']:'${actorId}'`, limit: '1',
  });
  const matches = await requestStripeJson('/v1/subscriptions/search?' + search, key, options);
  if (matches?.object !== 'search_result' || !Array.isArray(matches.data) || typeof matches.has_more !== 'boolean' ||
      matches.has_more || matches.data.length > 1) throw new Error('invalid_subscription_search');
  if (!matches.data.length) return false;
  const id = matches.data[0]?.id;
  if (matches.data[0]?.livemode !== true || !/^sub_[A-Za-z0-9]+$/.test(id || '')) throw new Error('invalid_subscription_id');
  // Search is eventually consistent. Authorize from a fresh subscription and expanded invoice.
  const current = await requestStripeJson('/v1/subscriptions/' + id + '?expand%5B%5D=latest_invoice.charge', key, options);
  if (current?.object !== 'subscription' || current.id !== id || current.livemode !== true ||
      typeof current.customer !== 'string' || !/^cus_[A-Za-z0-9]+$/.test(current.customer)) throw new Error('invalid_subscription');
  return current.metadata?.fleet_id === fleet.id && current.metadata?.owner_user_id === actorId &&
    coversCurrentPeriod(current, prices, Math.floor(Date.now() / 1000));
}

module.exports = { paidAccessConfig, hasPaidFleetAccess };
