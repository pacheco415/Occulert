# Fleet AI summaries

A signed-in fleet owner selects **Write summary** on the 7- or 30-day dashboard report. The server verifies the bearer token and looks up the owner's fleet and checks the fleet’s current paid Stripe subscription before reading the cache or reserving a new summary. Opening the dashboard does not request a summary. The demo and TV views do not offer this action.

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

Each fleet can generate one saved summary per period and UTC day. Failed or abandoned generations can be retried after two minutes, up to three claims in total. Concurrent requests share the claim. An older worker cannot complete a later attempt. The dashboard shows the next available time in the manager’s time zone. A saved summary retains its original report window. Deleting the fleet removes its cached summaries.

The 12-second request budget covers database and provider work together. The service makes one generation request. It rejects incomplete responses, non-text content, payloads over 32 KiB, and empty or oversized summaries. Accepted text is limited to 1,200 characters. Set an account spending limit separately to bound costs across all fleets. [Server configuration](../BACKEND_SETUP.md#fleet-ai-summaries)

## Endpoint responses

Use `GET /api/fleet-insights?days=7` or `?days=30`. Responses carry `Cache-Control: no-store` and `Vary: Authorization`.

| HTTP | Result | Meaning |
| --- | --- | --- |
| 200 | `ok: true` | Returns the saved summary, model, days, reporting window, generation timestamp and `ai_generated: true`. |
| 202 | `insights_pending` | Another request owns the reservation. A later read can retrieve the result. The response supplies `Retry-After: 2`. |
| 400 / 405 | `invalid_period` / `method_not_allowed` | Use a single allowed period and GET. |
| 401 / 403 | `unauthorized` / `fleet_not_found` | The token is missing or invalid, or the requester does not own the fleet. |
| 403 | `paid_plan_required` | The fleet has no qualifying paid subscription. |
| 501 | `paid_access_not_configured` | The Stripe read key or eligible live price IDs are missing. |
| 501 | `insights_not_configured` / `backend_not_configured` | The flag, provider key or required backend configuration is missing. The dashboard hides the summary card after this response. |
| 502 | `insights_unavailable` / `period_report_unavailable` | Generation, cached data or the owner lookup could not produce a usable result. |
| 503 | `insights_unavailable`, `period_report_not_enabled` or `period_report_unavailable` | A required database function is missing or the backend is unavailable. |
| 504 | `insights_unavailable` / `period_report_unavailable` | The request timed out. A reserved generation still counts toward the daily limit. |

## Questions

Fleet questions are reserved for owners of paid Occulert fleets. After screening a question, Occulert looks up the verified fleet and owner IDs in Stripe. The search locates the subscription. A separate read verifies current ownership, an active subscription at a configured live price, and a paid invoice covering that price for the current period. A scheduled cancellation preserves access through the paid period. Trials, expired periods, fully refunded or disputed charges, and test subscriptions do not qualify. A positive invoice recorded in live Stripe as paid out of band also qualifies. Occulert sends neither the question nor report data to Stripe.

When enabled, **Ask about your fleet** lets a signed-in owner ask about the 7- or 30-day report. Selecting a suggestion fills the field. Submitting the form sends `POST /api/fleet-ask` with a bearer token and a JSON body containing exactly `question` (3–300 characters after trimming) and `days` (the number `7` or `30`). Query parameters are rejected. Each submission checks the bearer token with Supabase Auth rather than a locally cached key, so a session signed out before its token expires cannot spend attempts.

Before reserving quota or contacting Anthropic, Occulert checks the question against the owner's fleet and driver roster. It rejects matches for driver names, vehicle labels and the company name, as well as text resembling an email address, phone number, UUID or coordinate pair. Ask about fleet totals and leave personal details out of the question.

Anthropic receives a fixed instruction and one message containing the following fields.

| Message field | Contents |
| --- | --- |
| `question`, `days` | The manager's screened question and selected reporting period. |
| `week`, `month` | Each aggregate includes its own `days`, `window_start`, `window_end` and the roster, session, score coverage, alert coverage and review counts listed above. Calculated ratios are `alerts_per_day`, `alerts_per_session` and `share_reviewed`. A zero denominator yields `null`. |
| `time_of_day` | The selected report's `days`, `window_start`, `window_end`, `timezone` and six four-hour `blocks`. Each block contains `start_hour`, `monitored_minutes`, `drowsy_alerts`, `distracted_alerts`, `rate_available` and `drowsy_alerts_per_hour`. The hourly rate is `null` below 120 monitored minutes. |

For a custom date range outside or partly inside a report window, the instruction asks Claude to give the available dates and explain that the exact total is unavailable. The time-of-day blocks aggregate the entire selected window.

Occulert does not log or persist question or answer text. The dashboard holds it in memory and clears it on a period change or sign-out. Responses use `Cache-Control: no-store` and `Vary: Authorization`. Each paid fleet includes **50 question submissions per UTC calendar month**, with a separate limit of **20 per account per hour**. A single database transaction reserves both limits. Requests refused by either limit consume neither allowance. If report retrieval or generation fails before an answer exists, the server makes one attempt to restore the monthly slot. The hourly charge stays in place. The dashboard confirms the credit only when the database acknowledges it. A successful answer includes `monthly_remaining` for the fleet. New submissions above the allowance are blocked without overage charges. The fleet allowance starts fresh at 00:00 UTC on the first of the next month. The server makes at most one model call per submission.

| HTTP | Result | Meaning |
| --- | --- | --- |
| 200 | `ok: true` | Returns a plain-text answer of up to 700 characters, model, selected period, report window, generation timestamp and `ai_generated: true`. |
| 400 | `invalid_query`, `invalid_body`, `invalid_period`, `invalid_question` | Check the request URL, JSON fields, period and question length. |
| 400 | `question_has_personal_details` | Remove the detected details and ask again. This uses no quota. |
| 401 / 403 | `unauthorized` / `fleet_not_found` | Sign in with a valid account that owns the fleet. |
| 403 | `paid_plan_required` | This fleet has no verified current paid coverage. No question quota is consumed. |
| 405 | `method_not_allowed` | Use POST. |
| 429 | `account_write_rate_limited` / `fleet_question_monthly_limit` | The hourly or monthly allowance is exhausted. `Retry-After` gives the wait in seconds. |
| 501 | `ask_not_configured`, `backend_not_configured`, `paid_access_not_configured` | The feature, backend or live billing verification is unconfigured. The dashboard hides the question box for the rest of the visit. |
| 502 | `ask_unavailable` | The request failed, the model returned an unusable answer, or the server could not confirm the quota reservation. |
| 503 / 504 | `ask_unavailable` | The backend is unavailable or the request timed out. |

The paid-plan decision is cached server-side per fleet, owner and billing configuration. Positive results expire within five minutes or at the end of verified invoice coverage, whichever comes first. Negative results expire after one minute. Provider failures are never cached. When live checkout and its verified webhook are introduced, delete the matching cache row on subscription, payment, refund and dispute changes.
