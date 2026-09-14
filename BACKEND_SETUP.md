# Backend Setup Guide (Supabase)

This guide turns the backend routes in `api/profile.js`, `api/sessions.js`,
`api/events.js`, `api/session-sync-v1.js`, `api/event-sync-v1.js`,
`api/session-cancel-v1.js`,
`api/fleets.js`, `api/fleet-invitations.js`,
`api/accept-invitation.js`, `api/fleet-summary.js`, `api/account.js`, and `api/_lib/supabase.js` into a working real
backend, replacing the localStorage-only prototype described in
BACKEND_ROADMAP.md.

The live account, billing, sending-domain, DNS, and secret-configuration steps
require the project owner's approval. Review access policies and delivery
configuration before expanding beyond a controlled pilot or handling real
driver data.

## 1. Create a Supabase project

1. Go to supabase.com and create a free account and project yourself.
2. In the SQL editor, run the contents of `db/schema.sql` from this repo.
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

For an existing Occulert project that already has the core tables, review and
apply the migrations it has not yet received, in this order:

1. `db/migrations/20260719_secure_fleet_invitations.sql` adds the
   one-fleet-per-owner constraint, protected invitation table, and atomic
   service-role-only acceptance function.
2. `db/migrations/20260913_native_sync_guards.sql` adds rotating fleet sync
   tokens and atomic service-role-only session start/cancellation functions.
3. `db/migrations/20260913_session_report_snapshot.sql` adds the fleet report
   index and bounded single-snapshot report function.

The account-deletion migration described below remains a separate requirement.

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
- `OCCULERT_SESSION_SYNC_V1_ENABLED` (leave unset or `false` during the first
  deployment of the versioned native-sync package)

Redeploy after adding these. Until they are set, `api/sessions.js`,
`api/profile.js`, `api/events.js`, `api/fleets.js`, the invitation routes, and
`api/fleet-summary.js` will respond with
`501 backend_not_configured` instead of touching a database.

`api/pilot-leads.js` will also store validated pilot requests in the
`pilot_leads` table when the two server-side Supabase variables are present.
Without Supabase or `PILOT_LEADS_WEBHOOK_URL`, the browser keeps only its
local fallback copy and the API reports `stored: false`.

### Safe native-sync rollout

1. Apply both 2026-09-13 migrations before deploying the matching API source.
2. Deploy with `OCCULERT_SESSION_SYNC_V1_ENABLED` unset or `false`. Existing
   browser and native behavior can continue while version 1 remains hidden.
3. With an authenticated test account, verify `GET /api/profile`, stable-ID
   uploads through `/api/session-sync-v1` and `/api/event-sync-v1`, anonymous
   driver-bound per-session cleanup through `/api/session-cancel-v1`, active-session status,
   and a 7/30-day fleet report whose
   `report_window.snapshot` is `true`.
4. Set `OCCULERT_SESSION_SYNC_V1_ENABLED=true`, redeploy, and confirm
   `/api/public-config` returns `session_sync_version: 1` before distributing a
   native build that depends on version 1.

If the flag is turned off again, compatible native clients retain queued data
and wait; they do not fall back to non-idempotent session creation.

The signed-in Account Settings page uses `DELETE /api/account` for permanent
account deletion. Apply `supabase/migrations/20260912170153_atomic_account_deletion.sql`
before deploying the route. The route verifies the bearer token and deletes only
that Supabase Auth user with the server-only service-role key. Foreign keys remove
the user's driver, sessions, events, invitations, and owned fleet in the same
transaction. Other fleet members and their history survive with no fleet assigned.
A database constraint or Storage ownership failure rolls everything back; never
pre-delete data to work around such failures. No Storage uploads are currently used.
Protected APIs verify the user through Auth, so a deleted user's unexpired JWT is
rejected. Successful deletion clears local app state and signs out the browser SDK.
Keep the service-role key on the server; it is never sent to the browser.

Invitation creation returns the one-time link only to the verified manager.
The dashboard can open a pre-addressed message in the manager's existing mail
app or copy the link. Sending a new link revokes the prior token, creates a
fresh token, and is limited to reduce abuse without adding a paid provider.

## 4. Frontend behavior

The endpoints expect an `Authorization: Bearer <access_token>`
header, where `access_token` comes from Supabase Auth running in the
browser. `api/public-config.js` exposes only the public project URL and anon
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

`api/profile.js` safely reads or creates a driver row for the authenticated
user with no caller-provided fleet membership. Only the atomic invitation
acceptance function can assign that row to a fleet. Run the full current
`db/schema.sql` for a new project or all applicable dated migrations above for
an existing project before enabling fleet onboarding or native sync.

## Status

- [x] Schema drafted (`db/schema.sql`)
- [x] API scaffolding drafted (`api/sessions.js`, `api/events.js`,
`api/fleet-summary.js`, `api/_lib/supabase.js`)
- [x] Pilot-lead storage path, spam checks, and per-instance rate limiting
- [x] Supabase project and protected pilot-lead table created
- [x] Full fleet/driver/session/event schema applied and verified
- [x] `SUPABASE_ANON_KEY` environment variable set in Vercel and deployment verified
- [x] Frontend wired with authenticated API calls and local fallback
- [x] Passkey sign-in, enrollment, rename, and revocation implemented with a pinned Supabase SDK
- [ ] Supabase passkey provider enabled with the stable `occulert.com` RP configuration
- [ ] First production-domain enrollment and sign-in verified on a physical Apple device
- [x] Row Level Security and service-role invitation boundaries independently verified
- [x] Trusted fleet invitation/administration flow implemented in code
- [x] Secure fleet invitation migration applied and independently verified
- [ ] Native sync guard migration applied to the production Supabase project
- [ ] Single-snapshot fleet report migration applied to production Supabase
- [ ] Versioned upload and per-session cleanup routes verified with the capability flag off
- [ ] `OCCULERT_SESSION_SYNC_V1_ENABLED=true` advertised only after route verification
- [x] No-cost invitation sharing through the manager's mail app and copy-link fallback
- [x] Manager-scoped session and event history excludes GPS, personal media, and raw motion
- [ ] Protected session-history deployment and signed-in manager verification
- [ ] Optional custom SMTP configured only if pilot volume outgrows Supabase's built-in sender
