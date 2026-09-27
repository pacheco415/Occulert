# History browsing source package

Prepared September 26, 2026 on `development/independent-feature-work`, with
implementation source `0c4c09c5c04287bec19d1741077a56988fbf4422`. The user
approved publishing this prepared package on September 26 while retaining the
instruction to skip testing. No automated tests, type checks, browser/device
runs, native builds or database changes were performed for this package.
Publication completed in [PR #147](https://github.com/pacheco415/Occulert/pull/147),
merged source `5b5db0201ea3df17dc70f6b2189ff9b1093b512a`. Vercel production
`dpl_HaWioevunU551T1CqGofjsBAgS5N` is READY with the public domain assigned.
This is deployment metadata, not runtime acceptance. GitHub Actions runs were
skipped for this package using per-commit markers; workflow configuration was
unchanged. No browser or signed-in checks were performed after publication.
The previously verified website baseline is PR #146 at `9662c3b`. Installed
TestFlight remains 1.0.0 (52); these native date filters require a future binary.

## Local app history

Session History adds All time, Last 7 days and Last 30 days. Dated views include
today and the preceding 6 or 29 local calendar days, through the current time.
Records without a usable saved/updated timestamp and future-dated records remain
available in All time. Date and review-status filters compose without rewriting
history or changing original storage indices used for edits and deletion.

The selected period is remembered separately from records. Preference writes
are serialized; a failed preference write leaves the current view usable.
Continue Reviewing and Review Next use the selected period. Status counts and
shared summaries describe the shown view; pilot, checkpoint and observation
summaries remain explicitly scoped to All history. Monitoring, detection,
alerts, cloud consent and history schema are unchanged.

## Protected website history

`fleet-history.html` is a separate owner-only view linked from the dashboard.
It loads at most 50 sessions per request and keeps at most 500 in memory.
Load older is manual; Refresh clears the view and starts from the newest records.
The existing dashboard, reports, saved follow-ups and TV still use their latest
50 sessions. Browsing older records does not broaden those summaries.

`GET /api/fleet-session-history` accepts only an optional, single `cursor`.
Every request verifies the account and derives its fleet from server-side
ownership. Cursors never grant access or supply fleet/driver scope. Queries use
`started_at.desc,id.desc`, an inclusive upper boundary from the first page and
an exclusive last-seen boundary. Database timestamp text, including microseconds,
is preserved. Values are strictly validated and timestamp filter values are
quoted before URL encoding; see [PostgREST logical filters](https://docs.postgrest.org/en/v14/references/api/tables_views.html#logical-operators)
and [URL grammar](https://docs.postgrest.org/en/v14/references/api/url_grammar.html#reserved-characters).

The API requests 51 rows as look-ahead and returns at most 50. When upstream
row limits produce a shorter nonempty response, one additional owner-scoped,
bounded older-row query determines whether pagination can continue. Only the
displayed page's driver names are resolved, with both fleet and driver-ID filters.
It uses the existing fleet/date/session index and needs no migration.

Responses contain fleet name, session dates, driver name/ID and the same
privacy-limited metric fields as the current fleet summary. They identify
`unverified_client_report` telemetry. Events, saved follow-ups, location,
personal media and raw motion are excluded. No total count, whole-period report,
export or transactional snapshot is claimed: concurrent edits, backdated inserts
and deletions may change the records encountered while browsing.

The page checks refreshed account context before and after protected reads,
discards abandoned results, clears records on account/navigation changes, and
does not persist protected rows. API responses use `no-store`. The protected
history document/helper do not use the service worker's offline cache.

## Deferred verification

Later verification needs to cover local-date boundaries and preference failure,
index-preserving review/edit/share behavior, equal-time cursor ordering and
microseconds, short upstream pages and the 500-row cap, ownership changes,
expired credentials, stalled reads, mobile keyboard/large-text use, and the
actual signed-in fleet journey. These are unperformed checks, not completion
claims or requests for the user to run them now.
