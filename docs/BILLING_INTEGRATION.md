# Stripe billing integration — test mode only

This is a prepared **test-mode** subscription flow for a verified Occulert fleet owner. It does not charge real cards, update `fleets.plan`, unlock features, or put payment controls in the website. Do not put a `sk_live_` key in these variables. The server rejects live keys and live Stripe objects.

## What is implemented

| Endpoint | Owner action | Result |
| --- | --- | --- |
| `POST /api/billing-checkout` | Send `{"plan":"starter"}` or `{"plan":"growth"}` with the owner's Supabase bearer token and an `Idempotency-Key` header | Creates a Stripe test customer if needed and returns a hosted test Checkout URL. |
| `POST /api/billing-portal` | Send the owner's Supabase bearer token | Returns a short-lived Stripe test customer portal URL after a customer exists. |
| `GET /api/billing-status` | Send the owner's Supabase bearer token | Returns **informational** test subscription status, plan, period end, and cancellation flag. |
| `POST /api/billing-webhook` | Stripe sends a signed event | Verifies the raw payload, retrieves the subscription's current state from Stripe, and applies it once in Supabase. No browser callback can update this state. |

Every owner endpoint verifies the bearer token with Supabase Auth and rereads fleet ownership. Checkout and portal return URLs are fixed paths on `occulert.com` or an Occulert subdomain; no request body or query parameter controls them. The webhook requires a current Stripe signature and an event with `livemode: false`. The database function atomically records each processed event ID and updates the test billing row.

## Owner setup required before an end-to-end dry run

1. In a Stripe account, switch to **test mode**. Create two active, positive-amount **monthly recurring** test prices, one for Starter and one for Growth. Record their `price_...` IDs. Use Stripe's default hosted Checkout domain (`checkout.stripe.com`) for this dry run. Checkout fetches each price with the test key and rejects a live, inactive, one-time, or nonmonthly price. Create a **dedicated test customer portal configuration** and record its `bpc_...` ID. Enable subscription cancellation; disable subscription updates, price and quantity changes, and pause options. The server fetches and checks this configuration before opening the portal. Choose actual trial pricing only after the pricing and unit-economics review; these price IDs are configuration, not amounts hardcoded in Occulert.
2. Register a test-mode webhook endpoint at `https://<your-api-host>/api/billing-webhook`. Subscribe it to `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, and `invoice.payment_failed`. Record its test `whsec_...` signing secret. Use the endpoint on the same API deployment as the billing routes.
3. Apply `supabase/migrations/20260927030000_stripe_test_billing.sql` to the Supabase project after the base fleet schema. Check that `fleet_billing_test`, `billing_test_webhook_events`, `register_test_billing_customer`, and `apply_test_billing_event` exist. These tables have no browser-facing RLS policies.
4. Put these **server-only** environment variables in the API deployment, then redeploy that deployment when ready for a dry run:

   ```text
   SUPABASE_URL=<your Supabase project URL>
   SUPABASE_SERVICE_ROLE_KEY=<server-side service role key>
   STRIPE_TEST_SECRET_KEY=sk_test_...
   STRIPE_TEST_WEBHOOK_SECRET=whsec_...
   STRIPE_TEST_PRICE_STARTER=price_...
   STRIPE_TEST_PRICE_GROWTH=price_...
   STRIPE_TEST_PORTAL_CONFIGURATION_ID=bpc_...
   OCCULERT_BILLING_SITE_ORIGIN=https://www.occulert.com
   ```

   `OCCULERT_BILLING_SITE_ORIGIN` is optional and defaults to `https://www.occulert.com`. It accepts only an HTTPS `occulert.com` origin or subdomain with no path, query, or fragment. Keep all Stripe and Supabase secrets out of Git and browser code.
5. Create a separate test owner account through Occulert signup, verify its email address, and create a fleet. Obtain that owner's short-lived Supabase access token from the signed-in test session. Do not use the Supabase service-role key as a user token.

## Dry-run sequence

Run these requests against the API deployment after setup. Replace both quoted example values before running the commands, and keep the access token private. Reuse the same idempotency key when retrying one Checkout request. A new key cannot create another session while one is pending.

```sh
API_ORIGIN='https://your-api-host.example'
OWNER_ACCESS_TOKEN='paste-your-short-lived-owner-access-token'
BILLING_TEST_KEY=$(uuidgen)

curl -sS -X POST "$API_ORIGIN/api/billing-checkout" \
  -H "Authorization: Bearer $OWNER_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $BILLING_TEST_KEY" \
  -d '{"plan":"starter"}'

curl -sS "$API_ORIGIN/api/billing-status" \
  -H "Authorization: Bearer $OWNER_ACCESS_TOKEN"

curl -sS -X POST "$API_ORIGIN/api/billing-portal" \
  -H "Authorization: Bearer $OWNER_ACCESS_TOKEN"
```

Open the returned `checkout_url` and complete the hosted flow with a [Stripe test payment method](https://docs.stripe.com/testing). The success redirect is only a navigation signal. Wait for the signed webhook to finish, then call `billing-status` again. It should show `test_mode: true`, `informational_only: true`, `plan: "starter"`, and the subscription's current stored status. Inspect the event delivery in Stripe's test webhook dashboard. Open the portal URL, schedule cancellation or cancel immediately, and verify the later signed webhook changes the cancellation flag or status. Confirm `fleets.plan` and feature access did **not** change.

For a negative check, repeat `billing-status` and `billing-portal` with another user's access token; they must not reveal the owner's billing row or portal. A request with a `sk_live_` key configured must fail before contacting Stripe. A bad webhook signature must not write a billing row. The local focused check is:

```sh
node scripts/test-billing-test-mode.mjs
node scripts/test-billing-test-mode-db.mjs
```

## Event and retry behavior

The webhook accepts the five event types listed above. It ignores other **validly signed** test events. For each supported event, it first claims a 30-second lease for that subscription, then retrieves its current Stripe state instead of trusting the event snapshot. It validates exactly one configured price and fleet-owner metadata before calling `apply_test_billing_event`. The SQL function checks the lease, rejects a customer mismatch, unknown owner, or conflicting active subscription, and records an event ID in the same transaction as the billing update. If another delivery holds the lease or the database result is unclear, the endpoint returns a retryable error. Duplicate deliveries receive a successful duplicate response after the first commit.

Checkout uses a caller-provided idempotency key scoped to the fleet. Customer creation also has a fleet-scoped Stripe idempotency key. The database holds one Checkout reservation and session per fleet. Retrying the same plan returns the existing open session; switching plans waits for that session. A completed session waits for its webhook, and only a session confirmed expired by Stripe can be replaced. If creation fails after Stripe accepts the request but before the session is saved, retry with the **same key**. After 23 hours without a saved session, the reservation fails closed with `checkout_recovery_required`; an operator must inspect the Stripe test customer and clear it only after confirming no completed subscription. This manual recovery and reconciliation for missed webhooks remain live-billing blockers.

## Before any live billing

Keep this integration in test mode until the owner completes real account and price setup, the end-to-end dry run passes, and the team designs subscription entitlements, failed-payment grace periods, cancellation behavior, tax and invoicing requirements, automated reservation recovery, reconciliation for missed webhooks, customer support, and an accessible billing UI. Resolve the conflicting liability caps in the current Privacy and Safety pages through legal review before offering paid service. The current billing status endpoint is deliberately informational and cannot unlock a paid plan.

Stripe references: [Checkout Sessions](https://docs.stripe.com/api/checkout/sessions/create), [Customer Portal Sessions](https://docs.stripe.com/api/customer_portal/sessions/create), [Portal Configuration](https://docs.stripe.com/api/customer_portal/configurations/object), [webhook signatures and raw bodies](https://docs.stripe.com/webhooks/signature), [subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks), and [idempotent requests](https://docs.stripe.com/api/idempotent_requests).
