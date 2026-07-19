# Backend Setup Guide (Supabase)

This guide turns the backend routes in `api/profile.js`, `api/sessions.js`,
`api/events.js`, `api/fleet-summary.js`, and `api/_lib/supabase.js` into a working real
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
`api/profile.js`, `api/events.js`, and `api/fleet-summary.js` will respond with
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
off, unavailable, or the user is signed out. The fleet dashboard remains
local/demo-only until an administrator invitation and fleet-membership flow
is implemented.

## 5. Seed fleets and drivers

`api/profile.js` safely creates a driver row for the authenticated user with
no fleet membership. It does not accept a caller-provided fleet ID. Fleet
membership must be assigned later through a trusted administrator invitation
flow. Run the full current `db/schema.sql` before enabling driver sync.

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
- [ ] Trusted fleet invitation/administration flow
