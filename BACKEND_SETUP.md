# Backend Setup Guide (Supabase)

This guide turns the backend scaffolding in `api/sessions.js`, `api/events.js`,
`api/fleet-summary.js`, and `api/_lib/supabase.js` into a working real
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
`api/events.js`, and `api/fleet-summary.js` will respond with
`501 backend_not_configured` instead of touching a database.

`api/pilot-leads.js` will also store validated pilot requests in the
`pilot_leads` table when the two server-side Supabase variables are present.
Without Supabase or `PILOT_LEADS_WEBHOOK_URL`, the browser keeps only its
local fallback copy and the API reports `stored: false`.

## 4. Wire up the frontend

The scaffolded endpoints expect an `Authorization: Bearer <access_token>`
header, where `access_token` comes from Supabase Auth running in the
browser (e.g. `supabase.auth.signInWithPassword(...)`). `app.html` and
`fleet-dashboard.html` still read/write `localStorage` today; connecting
them to `/api/sessions`, `/api/events`, and `/api/fleet-summary` is the next
implementation step once the project above exists.

## 5. Seed fleets and drivers

`fleets` and `drivers` rows need to exist (created manually in the Supabase
table editor, or via a future admin screen) before a driver can start a
session, since `api/sessions.js` looks up the driver's `fleet_id` via their
Supabase `user_id`.

## Status

- [x] Schema drafted (`db/schema.sql`)
- [x] API scaffolding drafted (`api/sessions.js`, `api/events.js`,
`api/fleet-summary.js`, `api/_lib/supabase.js`)
- [x] Pilot-lead storage path, spam checks, and per-instance rate limiting
- [ ] Supabase project created (requires you)
- [ ] Environment variables set in Vercel (requires you)
- [ ] Frontend wired to call these endpoints instead of localStorage
- [ ] Row Level Security policies reviewed for production use
- [ ] Admin/seeding flow for creating fleets and drivers
