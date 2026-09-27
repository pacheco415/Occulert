# Approved app and website upgrades — September 26, 2026

The user approved the full 21-item development menu. This document records the
source scope; deployment, installed-native distribution and runtime acceptance
are separate facts recorded in the authoritative [roadmap](APP_ROADMAP.md).
All testing, type checks, parsing/bundle checks and browser/device execution are
deferred at the user's request. Text and diff review are permitted.

## App source

| ID | Change | Boundary |
|---|---|---|
| A1 | Explicit account creation, password recovery and signed-in account-management links | Fixed website URLs contain no credentials or user data. Browser sign-in is separate. Native sign-in uses an existing account password. |
| A2 | Confirmed/unavailable cloud status, Retry, bounded reads and stale-result guards | Failed native reads preserve credentials and sharing consent. Status presentation does not start sharing. |
| A3 | Keyboard accommodation and email Next/password submission | Settings stays scrollable. Actual keyboard/device acceptance is deferred. |
| A4 | Manual local History refresh and up-to-50 retention guidance | Local reread only; no cloud download or retention expansion. Current view and date drafts survive manual refresh. |
| A5 | Custom local-calendar From/To dates and saved sensitivity/lighting/eyewear filters | Missing and unknown choices remain identifiable. All filters compose with existing review and assessment choices. |
| A6 | Newest/oldest/duration/alert sorting | Missing sort values appear last; original storage identity/index is retained for editing. |
| A7 | Remove assessment without removing the session | Only the assessment and its timestamp are removed through the existing ordered edit path. |
| A8 | Feedback draft fallback when Mail fails | A separate Share draft choice opens a user-selected destination. No automatic send; the same limited fields are retained. |

Review navigation, displayed counts and deliberate sharing follow the selected
records. Recovered interrupted summaries remain partial and outside complete
review metrics. These changes do not tune detection, change scores/alerts, add
telemetry or update an installed iPhone/Watch binary.

## Fleet website source

| ID | Change | Boundary |
|---|---|---|
| F1 | Custom local From/To dates | Only loaded records are filtered; no complete-period query is added. |
| F2 | Loaded History sorting | Pagination order remains separate from display order. CSV uses the shown order. |
| F3 | Print shown sessions and browser Save as PDF | Exact shown snapshot, selected filters, loaded counts and unverified-report labels; current account and freshness checks remain required. |
| F4 | Follow-up driver/saved-status filters and counts | Existing latest-50 response. Unsaved choices are separate from saved counts. |
| F5 | Preserve unsaved choices across saves/filtering | Memory only; account changes clear choices, explicit refresh warns before discarding, and uncertain save outcomes require refreshed confirmation. |
| F6 | Invitation email/status filters and manual refresh | Existing owner-scoped invitation list and operations; stale lists are labeled and actions remain blocked until refreshed. |
| F7 | Accurate invitation creation and delivery wording | Creating a one-time link and choosing Email/Copy are distinct. Revocation confirms the selected invitation. |
| F8 | Consistent dashboard CSV request messages, scope and cleanup | CSV formula escaping, authorization and freshness remain. Download requested does not claim that the browser saved a file. |

Older History is bounded to 50 records per request and 500 loaded records.
The dashboard, pilot report and follow-up list retain their latest-50 scope.
Sorting/filtering/printing never silently broadens reporting coverage. Protected
views exclude location, personal media, raw motion and unnecessary identifiers.
No backend API, database migration, permission, retention or billing change is
included in this batch.

## Public guidance and release records

| ID | Change |
|---|---|
| P1 | Separate browser Home Screen setup and private TestFlight iPhone/Watch installation paths. |
| P2 | Update FAQ/features/setup wording for actual availability, local/cloud controls, History and foreground/offline boundaries. |
| P3 | Consistent Support navigation, repaired About links and concrete account/feedback troubleshooting. |
| P4 | FAQ answer associations and visibility, public navigation highlighting, reduced-motion scrolling and touched-control layout/focus improvements. |
| R1 | Consolidated current status in README and roadmap, retaining dated evidence and the native distribution boundary. |

Browser installation guidance was read against official
[Apple instructions](https://support.apple.com/guide/iphone/iphea86e5236/ios)
and [Google Chrome instructions](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=en)
on September 26. This documentation lookup is not a product/browser test.

New website assets use **v67** URLs. Older immutable files retain their bytes.
The offline cache version changes only to distribute the new public assets;
detection files, selection and analysis cadence remain unchanged. Release
packaging updates the asset manifest, integrity pins and cache headers.

## Release constraints

Before this batch, merged source and approved native candidate were PR #152,
`26d2fb42391a08f0b45ba546869520f9d93b04b1`, with recorded production deployment
`dpl_9xKy6YyTcdJX86D3uNx8LKCLok5F` READY. Native TestFlight 1.0.0 (52) remains
from `969849b0c551edb2de6f9230cbeecdce89346b6f`. Record the actual final source
of any later native binary.

Included iOS capacity was recorded at 15/15 used on September 26 at 8:04 p.m.
Pacific; the next period begins September 30 at 5 p.m. Pacific. Recheck capacity
before a new build. No paid upgrade, new binary, submission, OTA update or
automation is part of this source batch.

Larger future projects remain separate: evidence-based detection tuning and
fusion, complete-period fleet reporting/realtime, billing activation, additional
platforms, dual cameras/wearables, public App Store launch and real pilot operation.
This approval does not supply hardware evidence, accuracy results, participants,
screenshots, reviewer credentials, commercial terms or outreach recipients.
