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
personal media and raw motion are excluded. The API offers no total count,
whole-period report, server export or transactional snapshot: concurrent edits, backdated inserts
and deletions may change the records encountered while browsing.

The page checks refreshed account context before and after protected reads,
discards abandoned results, clears records on account/navigation changes, and
does not persist protected rows. API responses use `no-store`. The protected
history document/helper do not use the service worker's offline cache.

## Published loaded-record filters

The v65 filtering package was published in
[PR #149](https://github.com/pacheco415/Occulert/pull/149), merged source
`16241c272fb6befd9f800142ea01effa1bb464fe`, production
`dpl_8JdMobC9XP34VdQEYtX6xL23oN6h` READY. All testing remains deferred.
It leaves previously published v64 bytes unchanged and adds composed driver-name substring search,
All time / Last 7 days / Last 30 days local-calendar periods, and recorded
completion-status selection. Dated views cover today plus the preceding 6 or
29 local days through now; invalid, missing and future start dates remain only
in All time. A missing end is not an active-session claim.

The shown count is explicitly matches out of loaded records, never the total
fleet or a full date-range result. No match does not mean the fleet has no
matching session. Load older adds another protected page using the existing
cursor and 500-row bound, then applies the current filters. There is no
automatic pagination or new API query. Refresh resets browsing and filters.
Account/page changes clear protected rows and filter inputs. Filters stay in
memory and do not enter storage or the URL. Existing dashboard/report/TV scope remains
latest 50; no export, new backend, database migration or detection change is
included in that filtering package. Testing remains deferred.

## Published shown-session export

PR #150 published source `7066fcf1a0f27589301282bb10458ed81f7f9279`, production
`dpl_32JhAvUCFR4wLoRcNP8YSWSfMmiq` READY with public domains assigned and no
alias error. All testing remains deferred. This is a deployment receipt, not
browser or signed-in acceptance. It uses new v66 helper/styles, preserving published v65 bytes.
Export shown sessions CSV is an explicit action on the current rendered
selection, with its captured time and filters. It does not recompute a different
selection while downloading. Each record carries loaded-only scope, loaded and
shown counts, filters, applicable calendar-window boundaries, browsing/export
times and whether older records remain. It is not a full-fleet or full-period
report, and no transactional snapshot is claimed.

Only displayed session fields are exported: driver name, recorded dates,
completion/duration labels, valid scores/counts and unverified telemetry trust.
Missing or invalid metrics remain empty, while measured zero stays zero. Hidden
session/driver/fleet identifiers, company name, location, media, raw motion,
events and saved follow-ups are excluded. All cells use the existing spreadsheet
formula sanitizer and CSV quoting. The filename contains no personal details.

Export requires the current verified account/context, an unchanged rendered
view and a successful browsing window no older than five minutes from its first
load. Loading, failed page loads, account/page changes and cleared or empty views
invalidate export. Filters do not reset freshness. No new server request is
issued by the export action. Blob URLs are revoked on failure, after the
download request, and on account/page changes. The interface says a download
was requested; it does not claim the browser finished saving a file.

This package is published with all testing deferred. It changes no API,
database, native app, detection, consent or existing dashboard/report/TV scope.

## Prepared native alert-feedback filters

The next app source adds stored alert-assessment filters composed with date and
review-status views, including an explicit Not assessed choice. Matching counts,
review navigation and shared summaries retain that scope and original storage
identities. Full-history progress remains separate, and partial recovered
records stay labeled. See [Alert Feedback Preparation](HISTORY_ALERT_FEEDBACK.md).
All testing remains deferred, and installed build 52 is unchanged.

## Deferred verification

Later verification needs to cover local-date boundaries and preference failure,
index-preserving review/edit/share behavior, equal-time cursor ordering and
microseconds, short upstream pages and the 500-row cap, ownership changes,
expired credentials, stalled reads, mobile keyboard/large-text use, and the
actual signed-in fleet journey. These are unperformed checks, not completion
claims or requests for the user to run them now.
