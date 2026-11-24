# Fleet AI summaries

A signed-in fleet owner selects **Write summary** on the 7- or 30-day dashboard report. The server verifies the bearer token and looks up the owner's fleet before reading the cache or reserving a new summary. Opening the dashboard does not request a summary. The demo and TV views do not offer this action.

## What goes to Anthropic

The Messages API receives the selected model, a fixed instruction, a 400-token output limit and one message containing the fields below. Occulert verifies the database report before selecting these fields.

| Group | Fields |
| --- | --- |
| Period | `days`, `window_start`, `window_end` |
| Roster | `roster_total`, `active_drivers`, `reporting_active_drivers` |
| Sessions and end times | `sessions`, `completed`, `no_recorded_end`, `invalid_recorded_end` |
| Score coverage | `scored`, `unscored` |
| Alert coverage | `valid_alert_records`, `missing_alert_records`, `alerts` |
| Review coverage | `reviewed`, `without_reviewed_followup` |

Fleet and driver identities, company names, raw scores, individual sessions, media, health data and locations are excluded. The instruction asks for three to five plain-text sentences and requires counts for unscored sessions, sessions without a recorded end and missing alert records. The dashboard displays accepted text alongside its model, generation time and report cutoff. Check the counts before acting.

## Cost and caching

The service-role database functions reserve at most one provider attempt for each fleet, period and UTC date. A fleet requesting both periods can generate at most two provider calls that UTC day. A second click, page reload or concurrent request reuses the reservation. A saved response retains its original report window even if new sessions have since arrived. Failed and abandoned attempts consume the reservation for that day. Deleting the fleet removes its cached summaries.

The 12-second request budget covers database and provider work together. The service makes one generation request. It rejects incomplete responses, non-text content, payloads over 32 KiB, and empty or oversized summaries. Accepted text is limited to 1,200 characters. Set an account spending limit separately to bound costs across all fleets. [Server configuration](../BACKEND_SETUP.md#fleet-ai-summaries)

## Endpoint responses

Use `GET /api/fleet-insights?days=7` or `?days=30`. Responses carry `Cache-Control: no-store` and `Vary: Authorization`.

| HTTP | Result | Meaning |
| --- | --- | --- |
| 200 | `ok: true` | Returns the saved summary, model, days, reporting window, generation timestamp and `ai_generated: true`. |
| 202 | `insights_pending` | Another request owns the reservation. A later read can retrieve the result. The response supplies `Retry-After: 2`. |
| 400 / 405 | `invalid_period` / `method_not_allowed` | Use a single allowed period and GET. |
| 401 / 403 | `unauthorized` / `fleet_not_found` | The token is missing or invalid, or the requester does not own the fleet. |
| 501 | `insights_not_configured` / `backend_not_configured` | The flag, provider key or required backend configuration is missing. The dashboard hides the summary card after this response. |
| 502 | `insights_unavailable` / `period_report_unavailable` | Generation, cached data or the owner lookup could not produce a usable result. |
| 503 | `insights_unavailable`, `period_report_not_enabled` or `period_report_unavailable` | A required database function is missing or the backend is unavailable. |
| 504 | `insights_unavailable` / `period_report_unavailable` | The request timed out. A reserved generation still counts toward the daily limit. |
