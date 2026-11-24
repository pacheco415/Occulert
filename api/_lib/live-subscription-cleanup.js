const { requestStripeJson } = require('./stripe-transport');
const { isUuid } = require('./validation');

const terminalStates = new Set(['canceled', 'incomplete_expired']);
const options = { apiVersion: '2024-06-20', timeoutMs: 2500 };

function checkSubscription(value, id, ownerId) {
  if (value?.object !== 'subscription' || value.id !== id || value.livemode !== true ||
      value.metadata?.owner_user_id !== ownerId || typeof value.status !== 'string') {
    throw new Error('unexpected_live_subscription');
  }
}

// Snapshot matching IDs before cancellation changes the search results.
// Re-read each subscription because Stripe search is eventually consistent.
async function cancelLiveSubscriptions(ownerId) {
  const key = process.env.STRIPE_LIVE_SUBSCRIPTION_CANCEL_KEY?.trim();
  if (!key && !process.env.STRIPE_FLEET_ACCESS_READ_KEY?.trim()) return;
  if (!isUuid(ownerId) || !/^rk_live_[A-Za-z0-9_]+$/.test(key || '') ||
      key === process.env.STRIPE_FLEET_ACCESS_READ_KEY?.trim()) throw new Error('invalid_live_cleanup_config');
  const params = new URLSearchParams({ query: `metadata['owner_user_id']:'${ownerId}'`, limit: '20' });
  const ids = new Set(), cursors = new Set();
  for (;;) {
    const result = await requestStripeJson('/v1/subscriptions/search?' + params, key, options);
    if (result?.object !== 'search_result' || !Array.isArray(result.data) || typeof result.has_more !== 'boolean') {
      throw new Error('invalid_subscription_search');
    }
    for (const row of result.data) {
      if (!/^sub_[A-Za-z0-9]+$/.test(row?.id || '')) throw new Error('invalid_subscription_id');
      checkSubscription(row, row.id, ownerId);
      if (!terminalStates.has(row.status)) ids.add(row.id);
    }
    if (!result.has_more) break;
    if (typeof result.next_page !== 'string' || !result.next_page || cursors.has(result.next_page)) {
      throw new Error('invalid_subscription_cursor');
    }
    cursors.add(result.next_page);
    params.set('page', result.next_page);
  }
  // Manual provisioning has no local subscription ledger yet. Search can omit
  // a newly created subscription, so reconcile directly against Stripe's list
  // before discarding the owner identity. Incomplete reads fail closed.
  const listParams = new URLSearchParams({ status: 'all', limit: '20' });
  const listCursors = new Set();
  for (;;) {
    const page = await requestStripeJson('/v1/subscriptions?' + listParams, key, options);
    if (page?.object !== 'list' || !Array.isArray(page.data) || typeof page.has_more !== 'boolean') {
      throw new Error('invalid_subscription_list');
    }
    for (const row of page.data) {
      if (row?.object !== 'subscription' || row.livemode !== true || !/^sub_[A-Za-z0-9]+$/.test(row.id || '')) {
        throw new Error('invalid_subscription_list_entry');
      }
      if (row.metadata?.owner_user_id === ownerId && !terminalStates.has(row.status)) ids.add(row.id);
    }
    if (!page.has_more) break;
    const cursor = page.data.at(-1)?.id;
    if (!cursor || listCursors.has(cursor)) throw new Error('invalid_list_cursor');
    listCursors.add(cursor);
    listParams.set('starting_after', cursor);
  }
  for (const id of ids) {
    const path = '/v1/subscriptions/' + id;
    const current = await requestStripeJson(path, key, options);
    checkSubscription(current, id, ownerId);
    if (terminalStates.has(current.status)) continue;
    const canceled = await requestStripeJson(path, key, { ...options, method: 'DELETE' });
    checkSubscription(canceled, id, ownerId);
    if (canceled.status !== 'canceled') throw new Error('cancellation_unconfirmed');
  }
}

module.exports = { cancelLiveSubscriptions };
