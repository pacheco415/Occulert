# Backend Setup Guide (Supabase)

This guide turns the backend routes in `api/profile.js`, `api/sessions.js`,
`api/events.js`, `api/fleets.js`, `api/fleet-invitations.js`,
`api/accept-invitation.js`, `api/fleet-summary.js`, and `api/_lib/supabase.js` into a working real
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
run only `db/migrations/20260719_secure_fleet_invitations.sql`. It adds the
one-fleet-per-owner constraint, protected invitation table, and atomic
service-role-only acceptance function without recreating existing policies.

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

Redeploy after adding these. Until they are set, `api/sessions.js`,
`api/profile.js`, `api/events.js`, `api/fleets.js`, the invitation routes, and
`api/fleet-summary.js` will respond with
`501 backend_not_configured` instead of touching a database.

`api/pilot-leads.js` will also store validated pilot requests in the
`pilot_leads` table when the two server-side Supabase variables are present.
Without Supabase or `PILOT_LEADS_WEBHOOK_URL`, the browser keeps only its
local fallback copy and the API reports `stored: false`.

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

`api/profile.js` safely creates a driver row for the authenticated user with
no fleet membership. It does not accept a caller-provided fleet ID. Only the
atomic invitation acceptance function can assign that row to a fleet. Run the
full current `db/schema.sql` for a new project or the dated migration above
for the existing project before enabling fleet onboarding.

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
- [x] No-cost invitation sharing through the manager's mail app and copy-link fallback
- [x] Manager-scoped session and event history excludes GPS, personal media, and raw motion
- [ ] Protected session-history deployment and signed-in manager verification
- [ ] Optional custom SMTP configured only if pilot volume outgrows Supabase's built-in sender
