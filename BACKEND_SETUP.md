# Backend Setup Guide (Supabase)

This guide turns the backend routes in `api/profile.js`, `api/sessions.js`,
`api/events.js`, `api/fleets.js`, `api/fleet-invitations.js`,
`api/accept-invitation.js`, `api/fleet-summary.js`, `api/account.js`, and `api/_lib/supabase.js` into a working real
backend, replacing the localStorage-only prototype described in
BACKEND_ROADMAP.md.

The live account, billing, sending-domain, DNS, and secret-configuration steps
require the project owner's approval. Review access policies and delivery
configuration before expanding beyond a controlled pilot or handling real
driver data.

## 1. Create a Supabase project

1. Go to supabase.com and create a free account and project yourself.
2. For a new empty project, apply `supabase/migrations/*.sql` in filename
   order, starting with `20260701000000_baseline.sql`. Do not also replay
   `db/schema.sql` or `db/migrations`; those are archived inside the baseline.
3. Under Authentication, enable email/password (or magic link) sign-in for
drivers and fleet managers.
4. Under Authentication -> URL Configuration, set the Site URL to
`https://www.occulert.com` and allow `https://www.occulert.com/login.html` as
a redirect URL. This keeps confirmation links on the production site instead
of sending drivers to localhost.
5. For a no-cost controlled pilot, Supabase's built-in sender can handle a
small number of confirmation messages. Keep volume low because it can
rate-limit confirmation messages across the project. A custom SMTP provider
is optional if pilot volume later grows.

For an existing Occulert project, first inspect its ledger and deployed
definitions using [migration readiness guidance](docs/MIGRATION_READINESS.md).
Do not replay the new baseline: archived SQL may already be present without
ledger entries. [db/README.md](db/README.md) explains fresh installation and
separately authorized baseline adoption. Put future SQL only in the canonical
Supabase migration directory.

### Sign in with Apple on the web

Use the Occulert Apple Services ID as the first client ID in Supabase's Apple provider. Register the project's HTTPS Auth callback with Apple and allow the production login page and its Apple state query in Supabase's redirect configuration. Keep previews separate.

Set server-only Vercel production variables `APPLE_WEB_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (the PEM contents of the Sign in with Apple .p8 signing key), and `APPLE_GRANT_KEY` (a dedicated 32-byte random key in hexadecimal). Configure the signing variables before deploying. Occulert signs a five-minute ES256 client secret for each Apple token request. Supabase's Apple provider still holds a separately generated client secret that needs renewal before expiry. Preserve the encryption key for existing grants. The browser receives only a readiness flag. The server validates each Apple grant, encrypts its refresh token for revocation, and revokes it on account deletion. Sign in from the production domain, edit a disposable profile, sign out, then sign back in before verifying account deletion.

### Passkey authentication (experimental)

Supabase passkey support is experimental and requires a separate production
configuration gate. Before enabling the passkey controls for a live pilot:

1. In Supabase, open Authentication -> Passkeys and enable passkey
   authentication.
2. Set the Relying Party Display Name to `Occulert`.
3. Set the Relying Party ID to `occulert.com`. Do not include a scheme, path,
   or `www`.
4. Allow these production origins:
   - `https://occulert.com`
   - `https://www.occulert.com`
5. Keep the RP ID stable. Changing it invalidates every passkey registered
   against the prior RP ID.

Vercel's generated `*.vercel.app` previews and `127.0.0.1` are not subdomains
of `occulert.com`, so they cannot complete the production WebAuthn ceremony.
Use automated contract tests before merge, then perform the first enrollment
and sign-in on the production Occulert domain after configuration. A future
custom preview such as `passkey-preview.occulert.com` can be added as another
allowed origin without changing the RP ID.

Passkeys already visible in a password manager do not automatically migrate
into Supabase Auth. The account must first sign in with its confirmed email and
password, then register a new passkey from Account Settings. Email/password and
the privacy-safe reset-link flow remain available for recovery. If the
experimental provider is disabled, those existing methods continue to work.

### Default API quotas and optional event identity

The default, unkeyed event route uses the existing service-only
`record_idempotent_event` function with a null client key. It shares the keyed
route's 60 accepted events per user per 60-second window and 500 per session
limits without enabling idempotent delivery. New session starts have a separate
30-accepted-start limit per user per server-timed one-hour window; owned UUID
replays do not spend another quota unit. See [the quota contract](docs/LEGACY_API_QUOTAS.md)
for response, concurrency and rollout details.

**Apply and verify database prerequisites before deploying these routes:**

1. Verify the already-canonical `20261026164040_atomic_event_idempotency.sql`
   definitions and grants. Do not replay a migration already applied to the
   project, or apply the overlapping unmerged PR #192 quota migration.
2. Apply `20261031192453_session_start_quota.sql` once, with production approval,
   and verify its service-only function, quota-table grants, RLS and cascade.
3. Deploy only after both prerequisites are independently verified. Missing
   functions fail closed; the API never falls back to unbounded direct inserts.

`OCCULERT_EVENT_IDEMPOTENCY_ENABLED` remains off by default. Its separate
[event identity rollout gates](docs/EVENT_IDEMPOTENCY.md) still apply; changing
that flag does not enable the web/native retry outbox. Once the quota routes
are deployed, keeping the flag off does not disable their unkeyed event limits.

### Profile and fleet write quotas

`POST /api/profile` reserves at most **60 write attempts per verified account
per one-hour window**. New-fleet creation through `POST /api/fleets` has a
separate **10-attempt one-hour window**. Existing-owned fleet responses are
read-only and remain free. These durable reservations count admitted attempts,
including a later failed mutation or a concurrent-creation loser; they are not
refunded or automatically retried. Rejections return 429
`account_write_rate_limited` with an integer `Retry-After` from 1 to 3,600 seconds.

**Deployment prerequisite:** apply
`20261114210442_account_write_quota.sql` once, with the project owner's approval,
and verify the `reserve_account_write(uuid,text)` definition and service-only
EXECUTE ACL, `account_write_rate_limits` RLS/CRUD grants, fixed account/operation
key, and auth-user deletion cascade **before deploying either dependent POST
route**. A missing or invalid quota response stops the write; there is no
unlimited fallback. The repository disables automatic Vercel deployments for
`codex/profile-write-quota` while this prerequisite is pending. Main still
deploys automatically, so keep the source PR unmerged until the migration is
applied and independently verified. Local tests do not establish live readiness.
See [the account write quota contract](docs/ACCOUNT_WRITE_QUOTAS.md) for exact
counting, race, validation and verification behavior.

## 2. Collect your keys

From Project Settings -> API, copy:

- Project URL -> `SUPABASE_URL`
- `service_role` secret key -> `SUPABASE_SERVICE_ROLE_KEY` (server-side only,
never expose this in client-side code)
- `anon` public key -> `SUPABASE_ANON_KEY` (safe for the browser, used for
driver/fleet manager login)

## 3. Add environment variables in Vercel

In your Vercel project settings -> Environment Variables, add:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY` (if the frontend will call Supabase Auth directly)

Redeploy after adding these. Until they are set, `api/sessions.js`,
`api/profile.js`, `api/events.js`, `api/fleets.js`, the invitation routes, and
`api/fleet-summary.js` will respond with
`501 backend_not_configured` instead of touching a database.

The Vercel Hobby deployment has a 12-function limit. This source keeps 12
top-level `api/*.js` entry points: `api/[endpoint].js` dispatches seven named
URLs to handlers in `api/_lib/routes/`. Keep those URLs and the route allowlist
in sync when editing the API, and run `npm run test:vercel-function-budget`
before deployment. The Stripe webhook must continue receiving its original
request stream for signature verification.

`api/pilot-leads.js` will also store validated pilot requests in the
`pilot_leads` table when the two server-side Supabase variables are present.
Without Supabase or `PILOT_LEADS_WEBHOOK_URL`, the API reports
`stored: false`; the request form tells the visitor it could not confirm
delivery and asks them to retry. It does not claim an offline submission.

Review coverage of these migrations before activating the dependent features.
Apply only migrations demonstrated to be missing, **in order**, after the
existing-project adoption check above:

1. `supabase/migrations/20260926200000_session_detector_provenance.sql` adds
   self-reported detector and app version fields to protected sessions.
2. `supabase/migrations/20260927010000_fleet_period_report.sql` adds the
   owner-scoped complete 7/30-day aggregate used by print and aggregate CSV.
   The dashboard's detailed recent view still uses at most 50 sessions.
3. `supabase/migrations/20260927030000_stripe_test_billing.sql` is only for
   the separate Stripe **test-mode** dry run described in
   `docs/BILLING_INTEGRATION.md`; it does not enable paid access.
4. `supabase/migrations/20260929010000_billing_ignored_webhook_events.sql`
   records ignored test webhook events for safe repeated acknowledgment.
5. `supabase/migrations/20261022120000_revoke_direct_table_access.sql`
   removes the browser roles' (`anon`, `authenticated`) direct table access to
   `fleets`, `drivers`, `fleet_invitations`, `sessions`, `events` and
   `pilot_leads`, and grants the service role explicitly. The web and native
   apps never query these tables directly, so no route changes. Apply it any
   time after the baseline; see [direct table access](docs/DIRECT_TABLE_ACCESS.md).
6. `supabase/migrations/20261023010000_prune_pilot_lead_rate_limits.sql`
   makes the pilot-form rate limiter delete up to 100 rows idle for more than
   a day on each call, so the table stops growing forever. The function keeps
   its signature and grants; `/api/pilot-leads` works the same before and after.

The complete canonical chain also includes atomic account deletion, fleet
follow-ups, query indexes and atomic invitation creation. Production database
authentication failed during the October 3 read-only check; their current
production ledger coverage remains unknown. Local replay does not verify it.

The new period route reports `period_report_not_enabled` when its SQL function
is absent. Do not present a bounded recent-session snapshot as a complete
period report in that case.

## Fleet AI summaries

Fleet summaries and questions are off by default. Configure these server-side Vercel variables only in the intended environment.

| Variable | Behavior |
| --- | --- |
| `OCCULERT_FLEET_INSIGHTS_ENABLED` | Set to exactly `1` to enable summaries. |
| `OCCULERT_FLEET_ASK_ENABLED` | Set to exactly `1` to enable questions. This flag is independent of the summary flag. |
| `STRIPE_FLEET_ACCESS_READ_KEY` | Live restricted Stripe key for subscription, invoice and charge reads. Grant read access only. Use a separate key from test checkout. |
| `OCCULERT_FLEET_ASK_PRICE_IDS` | Comma-separated live Stripe recurring price IDs for Occulert plans that include fleet summaries and questions. |
| `ANTHROPIC_API_KEY` | Both routes use the same key. Keep it in server environment settings. |
| `OCCULERT_INSIGHTS_MODEL` | Optional model ID shared by both routes. The default is `claude-haiku-5-5`. Confirm the selected model is available to the configured account. |

Before enabling either feature, verify the period-report function, approve the public privacy wording and pilot access terms, and set the provider's [monthly spend limit](https://platform.claude.com/settings/spend-limits).
For summaries, also verify the daily cache migration `supabase/migrations/20261119034729_fleet_insight_summaries.sql`.
For questions, verify the quota migration `supabase/migrations/20261118003200_fleet_ask_quota.sql` and the time-of-day report migration `supabase/migrations/20261122163338_fleet_time_of_day.sql`. Apply `supabase/migrations/20261124055212_fleet_question_monthly_allowance.sql` before deploying the included monthly allowance. Occulert supplies the model key for paid fleets.
Link each eligible live subscription to the verified Occulert fleet by setting its Stripe subscription metadata `fleet_id` and `owner_user_id` from trusted billing administration. Customer-entered fields must never set these values. Verify the matching paid price and invoice in Stripe. The checkout and account-deletion integration currently handles test customers only. Before onboarding live subscriptions, connect the live customer cancellation and deletion process described on the privacy page.

Before turning questions on, check a paying owner and a free-trial owner in an authorized rollout. The paying owner should receive an answer. The free-trial owner should receive HTTP 403 (`paid_plan_required`) without consuming quota or calling Anthropic. An unavailable Stripe read must produce an error before generation. [Stripe restricted keys](https://docs.stripe.com/keys)

Redeploy the intended environment after changing a flag. To check questions without making a model call, send the following request without credentials. With the flag off or the provider key missing, expect HTTP 501 (`ask_not_configured`). With the flag, key and backend configured, expect HTTP 401 (`unauthorized`).

```sh
curl -i -X POST https://www.occulert.com/api/fleet-ask \
  -H 'Content-Type: application/json' \
  --data '{"days":7,"question":"How many sessions were reviewed?"}'
```

To turn questions off, unset `OCCULERT_FLEET_ASK_ENABLED`, redeploy and repeat the check for HTTP 501. The summary flag and shared key can stay in place. See [Fleet AI summaries and questions](docs/FLEET_INSIGHTS.md).

The signed-in Account Settings page uses `DELETE /api/account` for permanent
account deletion. Apply `supabase/migrations/20260912170153_atomic_account_deletion.sql`
before deploying the route. The route verifies the bearer token and deletes only
that Supabase Auth user with the server-only service-role key. Foreign keys remove
the user's driver, sessions, events, invitations, and owned fleet in the same
transaction. Other fleet members and their history survive with no fleet assigned.
A database constraint or Storage ownership failure rolls everything back; never
pre-delete data to work around such failures. No Storage uploads are currently used.
Account deletion verifies the current user through Auth and requires recent
authentication in the same verified token. Profile/email and sensitive fleet
operations also use current Auth details. Selected identity-only routes can
verify asymmetric JWTs with cached public keys; these do not check current Auth
account or session status. They still require current owned database rows, which
account deletion removes. See [cached verification and its revocation limits](docs/CACHED_JWKS_VERIFICATION.md).
Successful deletion clears local app state and signs out the browser SDK.
Password changes and passkey changes on the Account page need a sign-in from
the last 10 minutes in the browser; see [recent sign-in](docs/ACCOUNT_RECENT_SIGN_IN.md)
for the rule and the Supabase password settings that back it.
Keep the service-role key on the server; it is never sent to the browser.

Invitation creation returns the one-time link only to the verified manager.
The dashboard can open a pre-addressed message in the manager's existing mail
app or copy the link. Sending a new link revokes the prior token, creates a
fresh token, and is limited to reduce abuse without adding a paid provider.

### Parked alert check confirmations

Before deploying `/api/parked-alert-checks`, apply and verify
`supabase/migrations/20261110080001_parked_alert_checks.sql` in the existing
project's canonical migration order. This source change does not apply production
SQL. The table and its invoker functions grant access only to `service_role`;
RLS is enabled, with no direct browser-role grants.

After a signed-in driver enables cloud sync and runs the existing parked test,
the browser asks whether they heard or felt it. Choosing Yes or No sends only
`completed_at`, `platform` and `confirmed`. The server verifies the token and
resolves the driver's current active fleet membership itself. It stores the
latest answer per driver/fleet; a newer No replaces an earlier Yes. The answer
is client-reported, not independent evidence of delivery or fitness to drive.

The owner's GET returns only confirmed and active-driver counts across the
complete current active roster. This denominator is the roster, not the separate
monthly completed-session activity metric. Inactive and other-fleet drivers do
not contribute. No age expiry is introduced: reactivation or returning to the
same fleet makes that fleet’s retained latest answer eligible again. Missing or failed counts remain unavailable, not zero. Account,
driver and fleet deletion cascade to these records.

No answer is queued or retried automatically. The browser discards a pending
answer after a consent/account change, monitoring start, a replacement test or
leaving the page. A request already accepted by the server cannot be recalled.
Local-only drivers keep the existing output check and send no confirmation.

## 4. Frontend behavior

The endpoints expect an `Authorization: Bearer <access_token>`
header, where `access_token` comes from Supabase Auth running in the
browser. The browser client refreshes the access token 60 seconds before it
expires. Concurrent calls in a tab share one refresh, and tabs take turns through
the `occulert-auth-refresh` Web Lock, reusing a session another tab just stored.
Local sign-in and sign-out actions invalidate an older refresh even while it
waits for that lock; cross-tab storage updates can still supply a rotated token.
If an early refresh cannot reach Supabase, the still-valid token keeps working. `api/public-config.js` exposes only the public project URL and anon
key at runtime; it must never expose the service-role key. Email/password
login creates or updates the authenticated user's driver profile, and
`app.html` writes opted-in session summaries and alert events through the
protected API routes. Local storage remains the fallback when cloud sync is
off, unavailable, or the user is signed out. A verified manager creates a
server-owned fleet at `fleet-onboarding.html`, then generates a seven-day
one-time link for the driver's exact email. The raw token is shown once and
only its SHA-256 digest is stored. `accept-invite.html` requires the driver to
sign in with that verified email before the database atomically assigns the
driver to the fleet. The authenticated fleet dashboard reads only the fleet
owned by the access-token user.

## 5. Seed fleets and drivers

`api/profile.js` safely creates a driver row for the authenticated user with
no fleet membership. It does not accept a caller-provided fleet ID. Only the
atomic invitation acceptance function can assign that row to a fleet. Run the
canonical migration chain for a new project; follow the adoption and coverage
guidance for an existing project before enabling fleet onboarding.

## Status

- [x] Canonical schema drafted and locally verified (`supabase/migrations`)
- [x] API scaffolding drafted (`api/sessions.js`, `api/events.js`,
`api/fleet-summary.js`, `api/_lib/supabase.js`)
- [x] Pilot-lead storage path, spam checks, and per-instance rate limiting
- [x] Supabase project and protected pilot-lead table created
- [ ] Current production schema and migration ledger independently verified
- [x] `SUPABASE_ANON_KEY` environment variable set in Vercel and deployment verified
- [x] Frontend wired with authenticated API calls and local fallback
- [x] Passkey sign-in, enrollment, rename, and revocation implemented with a pinned Supabase SDK
- [ ] Supabase passkey provider enabled with the stable `occulert.com` RP configuration
- [ ] First production-domain enrollment and sign-in verified on a physical Apple device
- [x] Row Level Security and service-role invitation boundaries independently verified
- [x] Trusted fleet invitation/administration flow implemented in code
- [ ] Current production invitation migration coverage independently verified
- [x] No-cost invitation sharing through the manager's mail app and copy-link fallback
- [x] Manager-scoped session and event history excludes GPS, personal media, and raw motion
- [ ] Protected session-history deployment and signed-in manager verification
- [ ] Optional custom SMTP configured only if pilot volume outgrows Supabase's built-in sender

Earlier setup notes reported the core schema and secure invitation migration
as applied and verified. That historical report is retained here; it does not
resolve the October 3 database authentication failure or confirm the current
canonical ledger. See `docs/MIGRATION_READINESS.md` for the present evidence.

### Shared provider time allowance and diagnostics

Every API entry point creates one monotonic 12-second provider allowance, isolated per request. Nested consolidated routes reuse that allowance. Supabase authentication, REST/admin operations, Stripe test requests and the pilot-lead fallback webhook use the smaller of their existing per-call timeout and the remaining allowance. Optional stored-lead notification also uses the smaller of three seconds and the remaining allowance, and is skipped after exhaustion without failing a stored lead. A later provider mutation is not sent after exhaustion. Supabase and Stripe deadlines cover response bodies and ignore late completion; the fallback webhook also settles by its deadline when fetch ignores abort. Mutations are never retried automatically. This bounds provider waiting, not arbitrary application CPU work or the complete Vercel invocation. Existing response shapes remain unchanged.

Responses include a generated `X-Occulert-Request-ID`. Failed server responses and unhandled exceptions emit a small JSON diagnostic with that ID, bounded status, elapsed milliseconds and an unhandled flag. Diagnostics omit request URLs, headers, bodies, identity, provider response details and exception messages. Use the response ID to locate a failure without collecting driver information. A timeout may follow a committed provider mutation; use the existing idempotent finalization behavior before retrying.

Supabase requests bound complete response bodies to 2 MiB for PostgREST and
64 KiB for Auth user/admin responses; JWKS retains its existing 64 KiB limit.
The reader cancels a stream as soon as it exceeds the byte limit and rejects
an oversized advertised Content-Length before reading. Oversized responses
fail explicitly rather than returning partial fleet records. Successful
malformed or oversized responses return 502. Known deadlines return 504;
Supabase network failures and other upstream 5xx return 503, including HTML
gateway pages. Existing validation, permission and migration-specific errors
keep their documented responses, and provider pages are never sent to clients.
These statuses do not authorize automatic mutation retries.

### Repeat-safe session starts

`POST /api/sessions` accepts an optional client-generated UUID in `session_id`. The server stores it as the existing session primary key and derives driver and fleet identity from the authenticated profile. Repeating that UUID returns the original owned session, including its original timestamps, provenance, historical fleet and any completed summary. A competing insert is reconciled by an owner-scoped read; a UUID occupied by another driver's session returns `409 session_id_conflict` without exposing the other row. Invalid supplied IDs return `400 invalid_session_id`. Omitting the field preserves server-generated IDs.

Successful responses advertise `session_start_protocol: "client_uuid_v1"`. This server change does not enable automatic client retries or persist start intents. Clients must establish deployment support before retrying starts: older deployments ignore the supplied UUID and would create duplicates. Database exceptions other than UUID conflicts remain failures; the server never retries an insert automatically. The atomic quota-backed start path additionally requires the session-start migration and verification described in [default API quotas](docs/LEGACY_API_QUOTAS.md).

## Optional stored-lead notification

Leave `LEAD_NOTIFY_WEBHOOK_URL` unset to keep notifications disabled. Configure it only with an authorized HTTPS email, Slack or Zapier webhook destination. After a successful Supabase insert the server sends only the event type, server-derived source, received timestamp and lead ID. It never forwards name, email, phone, company or message to this optional destination. The lead ID remains linkable metadata and should be treated as private. Redirects and URL credentials are rejected. Delivery is best effort, bounded to three seconds, and failure does not fail the stored lead submission. This is separate from the existing contact-data storage fallback webhook.

## Monthly active-driver count

The optional `monthly_activity` aggregate in `GET /api/fleet-summary` requires
`supabase/migrations/20261107160000_fleet_monthly_activity.sql`. Apply it only
after inspecting the existing ledger and obtaining production migration
authorization, then verify service-only execution and owner isolation before
deploying dependent source. No migration was applied as part of source work.
A missing or failed aggregate is reported as null and shown as unavailable;
existing roster and recent-session reporting still work. See
[the definition and boundaries](docs/FLEET_MONTHLY_ACTIVITY.md).

## Plan and usage summary (test mode)

The optional `entitlements` value in `GET /api/fleet-summary` reads `plan` and
`status` from `fleet_billing_test` and needs no new migration. It is
informational: no route refuses a request because of it. Leave
`OCCULERT_ENTITLEMENT_ENFORCEMENT_ENABLED` unset; no route consults the check it
controls. A failed billing read is reported as null and shown as unavailable,
and a database without the test-billing migration reports a trial. See
[the plan and usage summary](docs/BILLING_INTEGRATION.md#plan-and-usage-summary-test-mode).

### Live subscription cleanup on account deletion

Configure the server-only `STRIPE_LIVE_SUBSCRIPTION_CANCEL_KEY` alongside `STRIPE_FLEET_ACCESS_READ_KEY`. Use a separate live restricted key with write access to Subscriptions only. Every manually provisioned Occulert subscription needs the authenticated owner's UUID in `metadata.owner_user_id`. Deletion searches for that owner across statuses and pages, verifies each current subscription, and cancels renewable subscriptions before deleting Auth. A missing key or an unconfirmed cancellation keeps the account available for retry. A paginated subscription-list reconciliation also finds manually provisioned subscriptions awaiting Stripe search indexing. If the request budget expires before reconciliation finishes, the account is kept. Before enabling live Checkout, record subscription IDs durably as part of provisioning and reconcile them during deletion.

### Demo paid fleet AI on a preview

Set `OCCULERT_PREVIEW_TEST_ENTITLEMENT=1` on the intended Vercel preview, enable the desired fleet AI feature and configure its provider. Use the preview's test billing setup and an active test subscription for the signed-in fleet. The service logs a startup notice when this path is enabled. Test entitlements bypass the live cache. Production, local development and deployments without a Vercel preview environment use the normal live entitlement checks.

### Owner-approved fleet AI pilots

Apply the fleet pilot grants migration before setting the server-only `OCCULERT_FLEET_PILOT_ENTITLEMENTS=1` flag. An administrator records the approved fleet, granting administrator UUID, expiration, monthly cap (1–50), and note in `public.fleet_pilot_grants` using SQL. Deleting the row revokes access. The service role can read grants, while writes remain restricted to database administrators. A valid pilot takes precedence over subscription access. The paid subscription path continues to apply when a grant expires or is revoked. The fleet's usual hourly limit and existing monthly usage both still apply.
