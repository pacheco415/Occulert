# Backend Setup Guide (Supabase)

This guide turns the backend routes in `api/profile.js`, `api/sessions.js`,
`api/events.js`, `api/fleets.js`, `api/fleet-invitations.js`,
`api/accept-invitation.js`, `api/fleet-summary.js`, and `api/_lib/supabase.js` into a working real
backend, replacing the localStorage-only prototype described in
BACKEND_ROADMAP.md.

**None of these steps can be done on your behalf.** They require creating
and owning a Supabase account, running SQL against your own database, and
setting Vercel environment variables yourself. This scaffolding was drafted
by an AI assistant and has not been security-reviewed for production use;
review it carefully (especially the Row Level Security policies) before
handling real driver data.

## 1. Create a Supabase project

1. Go to supabase.com and create a free account and project yourself.
2. In the SQL editor, run the contents of `db/schema.sql` from this repo.
3. Under Authentication, enable email/password (or magic link) sign-in for
drivers and fleet managers.

For an existing Occulert project that already has the core tables, review and
run only `db/migrations/20260719_secure_fleet_invitations.sql`. It adds the
one-fleet-per-owner constraint, protected invitation table, and atomic
service-role-only acceptance function without recreating existing policies.

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
- [ ] Full fleet/driver/session/event schema applied and verified
- [ ] `SUPABASE_ANON_KEY` environment variable set in Vercel and deployment verified
- [x] Frontend wired with authenticated API calls and local fallback
- [ ] Row Level Security policies reviewed for production use
- [x] Trusted fleet invitation/administration flow implemented in code
- [ ] Secure fleet invitation migration applied and independently verified
