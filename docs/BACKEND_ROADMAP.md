# Occulert backend implementation and next steps

Status recorded September 26, 2026. Product/release status lives in the
[authoritative roadmap](APP_ROADMAP.md). This describes the existing Supabase
implementation; choosing a backend or building accounts from scratch is not
pending work.

## Current architecture

Supabase Auth supplies identity. Vercel `/api` endpoints verify access tokens,
derive driver/owner scope on the server, and perform protected Postgres reads
and writes. Row-level security supplies documented read boundaries. The
service-role key stays server-only; browsers receive publishable configuration
through `/api/public-config`.

- Signed-in drivers explicitly opt into session/event sync. Browser and native
  local history remain useful without cloud consent.
- Fleet owners create fleets and invite drivers with hashed, expiring,
  one-time tokens and atomic acceptance.
- Manager summaries load the roster and latest 50 protected sessions.
  Optional history is capped at 200 events; `include_events=0` skips it.
  Adaptive browser polling refreshes data; no realtime subscription is used.
- Manager reporting and saved per-session follow-ups use owner-scoped records.
  Local demo/fallback data never grants protected access. Follow-up writes
  check ownership and reject stale revisions.
- TV requests the protected summary without events and renders aggregate
  counts only; there is no local/demo fallback.
- Pilot readiness derives from protected fleet, roster, and session records,
  without storing a second checklist state.
- Contact requests use validated, rate-limited `/api/pilot-leads`; contact
  details are not retained in browser localStorage.
- Quick start, printable reports, data-quality explanations, and TV controls
  shipped in PR #138. Recorded PR #139 release baseline is `969849b`;
  release verification is separate from real-pilot operating evidence.

See [BACKEND_SETUP.md](../BACKEND_SETUP.md) for setup and operational checks.
The initial schema is [db/schema.sql](../db/schema.sql); later account deletion,
follow-up functions, and query indexes are in
[supabase/migrations](../supabase/migrations). The initial schema alone is not
the full deployed migration history.

## Implemented data model

| Table | Purpose and authorization |
|---|---|
| `fleets` | Company, authenticated owner, descriptive plan, creation time. Owner reads their own fleet; plan does not enforce payment/capacity. |
| `drivers` | Auth user, optional fleet, name/email/vehicle label, active state. Drivers read their own profile; owners read their own roster. |
| `fleet_invitations` | Fleet/email binding, hash, inviter, expiry/acceptance/revocation. Server-only access and atomic acceptance. |
| `sessions` | Server-derived driver/fleet, start/end, client fatigue/safety metrics and alert/head-nod counts, device/browser labels. Driver writes cannot select another driver/fleet. |
| `events` | Session-bound type, fatigue/confidence, time, optional location columns. Writes check the driver's session; manager projections exclude coordinates. |
| `fleet_session_followups` | Latest per-session outcome, revision, updater/time. Server-only owner scope; no free text or historical audit log. |
| `pilot_leads` | Contact/qualification request and allowlisted source. No browser-facing table access. |

## Privacy and evidence boundaries

Camera video, images, audio, and raw motion are not uploaded by these workflows.
Native Health context, local review labels, recovered partial summaries, and
fusion observations remain local and outside protected fleet telemetry.

The web driver can enable GPS and cloud sync independently; the combined
explicit opt-in path supplies optional event coordinates. Location is not
required for monitoring or a pilot. Protected fleet-summary selections omit
coordinates, personal media, and raw motion. TV further omits identities,
vehicles, individual scores, and events. Existing optional event columns do not
constitute a fleet location/route product.

Scores/counts originate in clients; authentication and validation do not
independently measure them. Summaries label `unverified_client_report`.
Reports are not certified risk, accuracy, compliance, employment, or
fitness-to-drive determinations.

A 7/30-day report is a bounded latest-50-session snapshot, not complete window
coverage or a retention guarantee. Explain missing values and unfinished
sessions; missing is not a measured zero.

## Next work

Use the released workflow with an authorized pilot of up to five drivers.
The actual fleet owner and participant details remain unanswered. Review
day-7/day-30 participation, source completeness, manager workflow, and support
issues without accuracy claims.

Pagination, retention changes, aggregates, realtime subscriptions, billing,
entitlements, audit logs, and reminders are future decisions based on pilot
need. Preserve server-derived identity, voluntary consent, ownership checks,
deletion, and privacy-limited projections when expanding.
