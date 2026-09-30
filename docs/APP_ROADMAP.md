# Occulert development roadmap

Status updated September 28, 2026. This is the authoritative product roadmap.
Backend, detection, performance, and pilot documents explain specific contracts
and evidence procedures. Older audit and release notes describe their dated
state; they are not the current feature backlog.

## September 27 approved source batch — local review, unreleased

The owner approved the development work described in this conversation. This
local branch prepares a simpler driver screen, parked output checks, local
post-drive feedback, server-filtered fleet history, and a complete stored-session
7/30-day aggregate report. The dashboard's recent-session view remains limited
to the latest 50 sessions; the new printable aggregate report uses all stored
sessions in its selected period after the database migration is applied.

Session records now accept **client-declared** detector pipeline, detector
version, and app version. The period report separates known pipeline counts;
browser and native fatigue scores have different inputs and windows and are
not directly comparable. The [event benchmark](EVENT_BENCHMARK.md) is a scoring
tool for future licensed, independently labeled observations, not a measured
accuracy result. No such dataset, pilot fleet, or physical-device acceptance
result is available for this batch.

The trial request, proposed pricing, onboarding, and support materials are
also updated. The [unit economics worksheet](UNIT_ECONOMICS.md) identifies the
current $9/$25 proposal as unlikely to fund small-scale support and suggests
higher prices to test with future qualified fleets. [Stripe billing preparation](BILLING_INTEGRATION.md)
is isolated to test mode, has no public checkout control, and cannot change
fleet access. Source checks are being completed locally; no migration, website
deployment, native binary, Stripe account setup, live payment, or outreach is
recorded by this branch.

Before any paid release, resolve the contradictory liability caps in the
current Privacy and Safety pages through legal review, then align the final
commercial terms with actual billing and support operations.

## Status definitions

- **Shipped web:** merged and production-verified website behavior. This does
  not establish real-fleet usefulness or detection accuracy.
- **Published web, testing deferred:** merged source with a READY production
  deployment, without source-test or runtime-acceptance results for that package.
- **Private native release:** distribution status for a particular TestFlight
  build. Packaging and Apple availability do not establish installation or
  physical-device acceptance. A source merge does not update an installed binary.
- **Implemented source:** checked-in code awaiting release or device checks.
  **In development** also means review and tests remain unfinished.
- **Validating:** a physical-device, production, pilot, or labeled-data evidence
  gap remains. Source tests cannot close those gaps.
- **Future:** proposed capability without an implementation or delivery claim.

## Current release and approved development batch

The last merged source and native candidate before this batch is
[PR #152](https://github.com/pacheco415/Occulert/pull/152),
`26d2fb42391a08f0b45ba546869520f9d93b04b1`. Its recorded production deployment
`dpl_9xKy6YyTcdJX86D3uNx8LKCLok5F` is READY. Native TestFlight remains
**1.0.0 (52)** from `969849b0c551edb2de6f9230cbeecdce89346b6f`.

The user approved all **21 source upgrades** on September 26: account recovery,
recoverable cloud status, keyboard access, local History refresh/retention,
custom dates and condition filters, sorting, assessment removal and feedback
fallback; loaded fleet History dates/sorting/printing, follow-up filters and
preserved drafts, invitation search/refresh/delivery clarity, consistent CSV
behavior; public installation/FAQ/support/accessibility and consolidated release
records. All 21 are implemented in
[PR #153](https://github.com/pacheco415/Occulert/pull/153), with text/diff and
independent source review complete. See [approved upgrades](APPROVED_UPGRADES_2026_09_26.md)
for scope and implementation details. The PR's release receipt records final
merged source and website deployment status. Installed-native distribution and
runtime acceptance remain separate; build 52 does not include this package.
Tests, type checks, browser and device checks for the earlier PR #153 package
were explicitly deferred at that release. This September 27 local batch has
its own source and browser checks recorded separately; physical-device and
real-world checks remain pending. No paid build or billing change, new native
binary, submission or outreach is part of the batch.

PR #150 added CSV export of shown loaded records, following PR #149's loaded
History driver/date/status filters, PR #148's Support/Help and PR #147's older
History browsing and native date filters. PR #151 added feedback filters;
PR #152 aligned missing/invalid duration and fatigue labels while preserving
valid zero. Those native changes are not installed in build 52. Earlier records
below preserve their dated evidence; they do not certify this batch.

The earlier verified website release is [PR #146](https://github.com/pacheco415/Occulert/pull/146),
merged at `9662c3b9e0bfc3cc721796328fd6ff53f7df995e`. It adds invitation validation, associated form labels, constrained
native HTML selectors, nonblocking homepage font loading, and exact-file
benchmark provenance. Core monitoring/auth assets remain v60, invitation
behavior uses v61, form controls use v63, and offline cache remains v54.
The earlier backend/native audit release was [PR #144](https://github.com/pacheco415/Occulert/pull/144),
merged at `d3ae5a30422586cbfa03c9b7092a0fa375d44681`. Its native fixes and
[PR #145](https://github.com/pacheco415/Occulert/pull/145)'s Watch repair are
merged source awaiting a future binary; they are not installed in TestFlight 52.
The atomic invitation-creation prerequisite was installed before rollout:
deployed migration `20260926185813 / atomic_fleet_invitation_creation` maps to
source `20260926010000_atomic_fleet_invitation_creation.sql`.

The earlier PR #138/#139 release baseline is `969849b`. PR #138 (`bc7858a`)
shipped the manager-and-driver quick start, printable report, data-quality
explanations, and TV operating controls. PR #139 (`969849b`) shipped the native
peer-lockfile/clean-install repair and stale Watch alert-feedback guard.
Existing TV and launch-checklist releases remain part of this baseline.

Private TestFlight **1.0.0 (52)** has a finished build and `FINISHED` submission;
Apple reports `VALID` and `IN_BETA_TESTING`. The archive's embedded Watch app
is confirmed. Its exact source is
`969849b0c551edb2de6f9230cbeecdce89346b6f`. **The user confirms build 52
installed and generally working on iPhone, Watch launch, and foreground/background
urgent alert display and wrist vibration.** TestFlight App Details showed the
Watch **Open** button; the background result was reported after returning to
the watch face. The user reports iPhone 17 Pro Max on iOS 27.2 and Apple Watch
Ultra 4, with Watch software described as the same version 27.2. These device
details are not independently verified. Exact delay, Focus/permission variations,
individual accessory, safe-stop, recovery, accessibility, battery/heat checks
remain undocumented. Earlier iPhone/Watch feedback applies to its exact tested
build, not automatically to 52. Included iOS build usage is **15/15**; the next
period begins **September 30 at 5 p.m. Pacific**. No new build, submission, or
OTA update is queued. Continue approved source work with testing deferred;
the merged native audit fixes require a future authorized binary and its own
physical acceptance.

## Shipped and private baseline

| Capability | Recorded status | Practical boundary |
|---|---|---|
| Browser monitoring and PWA | Shipped web | Foreground camera processing, eye/fatigue estimates, sensitivity, phone alerts, local history. Foreground loss stops monitoring; no camera video upload. Browser/accessory behavior varies. |
| Fleet identity and consent | Shipped web | Supabase Auth, fleet creation, hashed one-time invitations, explicit driver cloud consent, protected sessions and owner-scoped roster/history. Local demo data stays separate. |
| Manager reporting and follow-ups | Shipped web | Bounded 7/30-day summaries of the latest 50 protected sessions, privacy-limited CSV, per-session follow-up outcomes, adaptive polling, action queue. Metrics are unverified client reports. |
| Managed early-access offers | Shipped web pages and qualification | Card-free 30-day trial for up to five active drivers; introductory Starter/Growth comparison and rollout requests. No payment collection, automatic renewal, billing, or entitlement enforcement. |
| Fleet TV display | Shipped web, PR #136 and PR #138 | Authenticated read-only browser/AirPlay aggregate view, 7/30-day selection, large text, connection details, and fullscreen controls. No names, vehicles, locations, individual scores, raw events, local fallback, or editing. Native tvOS remains future. |
| Pilot launch checklist | Shipped web, PR #137 | Setup, joined-driver, first-session, 7/30-day milestones derive from protected records. It cannot confirm offline tasks or fitness to drive. |
| iPhone and Apple Watch | Private TestFlight 1.0.0 (52): user-reported iPhone installation/general functional pass, Watch launch, foreground/background urgent display and wrist vibration | Reported iPhone 17 Pro Max/iOS 27.2 and Watch Ultra 4/Watch software described as 27.2 are not independently verified. Exact delay, Focus/permission variations and remaining individual checks are undocumented. Native audit fixes from PR #144 await a future binary. Native uses ML Kit; browser uses MediaPipe. Prior build-49 parked checks and build-36 feedback in the [dated audit](AUDIT.md) are historical evidence. |

## Current capabilities and remaining evidence

| Workstream | Release state | Next evidence |
|---|---|---|
| Manager-and-driver quick start | Shipped web, PR #138 | Use the parked setup, consent, alert-response, TV-privacy, and review instructions with an authorized pilot. Reading progress is not tracked. |
| Printable manager report | Shipped web, PR #138 | Evaluate 7/30-day print/Save PDF, privacy-limited exports, missing-score coverage, current saved per-session review counts, and protected/demo separation with real pilot records. Release checks do not establish fleet usefulness. |
| Fleet data quality | Shipped web, PR #138 | Review unfinished sessions, missing values, history limits, and unverified telemetry during the pilot. Protected summaries omit interruption reasons; do not infer them. |
| TV operating controls | Shipped web, PR #138 | Confirm 7/30-day selection, large text, connection/fullscreen behavior on the pilot's intended display. No native TV build or Apple TV device acceptance is claimed. |
| Native clean installation and Watch alert feedback | Released source, PR #139; private TestFlight 52 available | EAS peer-lockfile repair and stale Watch feedback guard passed source checks. Node 24 verification and separate EAS-matching Node 22.23.1/npm 10.9.8 clean-install checks remain distinct from physical Watch delivery evidence. |
| Pilot recruitment package | Prepared documents; outreach unsent; owner/participants not supplied | [One-page overview, qualification, unsent emails, 30-day plan](PILOT_OUTREACH.md). Launch/physical validation preparation is approved, but no fleet owner, enrolled cohort, operating results, or consent is invented. |
| Parked setup and reliability | Included in TestFlight 52; general iPhone pass reported, individual checks pending | Exact-build camera guidance, fresh permission/readiness, foreground-loss stop, interruptions, 15-second checkpoints, explicitly partial recovery. See [device readiness](PARKED_DEVICE_READINESS.md). |
| Local History and privacy controls | Included in TestFlight 52; general iPhone pass reported, individual checks pending | Install-over-existing-data, save/read failures, aggregate sharing, confirmed individual/all-history deletion, recovery safeguards. Local deletion does not delete cloud records. |
| Alerts, Watch, accessibility | Included in TestFlight 52; Watch launch and foreground/background urgent display/vibration have user-reported passes | Exact delay and Focus/permission variations remain undocumented. Validate speaker, headphones, car audio, larger text, VoiceOver, Reduce Motion/Transparency and other alert conditions. PR #144 native fixes require a future binary and separate acceptance. |
| Runtime and fleet performance | Native source included in TestFlight 52; web portions released | Preserve analysis cadence/preferences; measure battery/heat/camera timing on device and signed-in API latency. [Performance Roadmap](PERFORMANCE_ROADMAP.md) contains targets, not measured claims. |
| Sensor-fusion observations | Included in TestFlight 52, observation only; physical validation pending | Camera/headphone candidate counts, optional Watch availability, bounded co-occurrences, validation coverage, next-session planning. No raw timeline, cloud sync, export, feedback inclusion, score or alert changes. Accessories optional. |

## September 26 browser reliability package

[PR #140](https://github.com/pacheco415/Occulert/pull/140) includes durable local
session history, failed-save guidance, safe handling of late Wake Lock results,
and bounded offline navigation. Protected CSV and copied summaries check the
current owner and data freshness. Completion dates, missing alert counts,
available event samples, and capped pilot age retain their evidence boundaries.
Benchmark preparation rejects malformed split/slice configuration, and the
runner checks participant leakage before selecting held-out rows.

Source review and regression coverage are complete. The linked PR and
[release tracker](https://github.com/pacheco415/Occulert/issues/6) record the
merge and deployment evidence for this package. It changes no native binary or
detection thresholds and evaluates no real dataset. Build-52 physical
acceptance remains separate.

## Fleet refresh recovery package

Dashboard and TV refresh stages have eight-second deadlines, restored manual
controls, and automatic retries after interruptions. Cached summaries remain
visible only for the same stored owner and are labeled stale; protected report
sharing remains withheld after a failed refresh. Account changes invalidate
pending work, and late results cannot replace recovered views or sign out a
newer session. Browser account refreshes preserve newer credentials and retain
the stored account when a transient failure cannot confirm sign-out. A stalled
public configuration lookup is bounded and retried. Network-only account
scripts have a bounded service-worker wait through headers and body so a stalled request cannot hold
driver-page startup; they never fall back to cached account scripts.

Protected summaries and saved follow-ups select the same latest 50 sessions,
using session ID to break equal start times. Regression coverage checks tied
records across the cutoff, owner scoping, hung requests, recovery, and late
responses. Browser CI preserves failure traces even when a retry succeeds;
the earlier intermittent WebKit offline-upgrade cause remains unconfirmed.
The [release tracker](https://github.com/pacheco415/Occulert/issues/6) records
source, merge, and deployment evidence. This package changes no native binary
or detection thresholds and adds no pilot or device observations.

## Complete-transfer offline recovery

Driver-script and HTML network-first requests share a 2.5-second deadline
through both response headers and the complete body. A stalled or failed body
falls back to the installed offline shell; partial or late responses cannot
replace its cached bytes. Complete transfers preserve the native response's
final URL, redirects, decoding metadata, and security headers. Account scripts
remain network-only. The offline cache advances to v52 without changing
published versioned asset bytes or detector runtime selection.

Real-origin Chromium and WebKit tests reproduce stalled driver and page bodies
before this repair and verify recovery, transport cancellation, cache
preservation, and complete compressed/redirected responses after it. Browser
loading failures also retain bounded request/server/controller diagnostics.
The intermittent hosted WebKit loading cause remains unconfirmed; the
separately reproduced body stalls do not establish that cause. Merge and
production evidence are recorded in the
[release tracker](https://github.com/pacheco415/Occulert/issues/6). No native
build, physical-device observation, pilot result, or accuracy claim is added.

## Driver startup recovery

The browser driver page disables monitoring controls until its complete driver
script explicitly finishes initialization. Failed requests, malformed or
partially initialized code, and an eight-second startup deadline show an
accessible **App could not load** message with **Reload app**. Reload creates
a fresh document; late scripts cannot reactivate a failed document. Startup
failure and inactive monitoring display neutral status rather than SAFE/READY.
The driver uses a new v59 asset and offline cache v53; earlier published assets
retain their bytes. Camera, model initialization, and cloud work remain behind
the completed startup gate and existing user actions. Optional account-script
failure still permits complete local startup.

Source review and Chromium/WebKit regression coverage verify these behaviors;
the [release tracker](https://github.com/pacheco415/Occulert/issues/6) records
merge and production evidence. This recovery handles loading failures without
establishing the cause of the intermittent hosted WebKit loading errors. It
uses no native build and changes no detection thresholds or accuracy claims.

## September 26 audit release

PR #144 is merged and its website/backend release is live. Merged-commit checks
pass, including all 280 browser cases without retries and native source/runtime/
Swift checks. Production integration checks passed using rolled-back synthetic
records; no test records remain. These checks add no labeled detection evidence.

Chromium live-origin offline startup passes. Live smoke retains 38 passing
checks and one unresolved WebKit emulated-offline stage; focused and adaptive
repeats also failed at document navigation. The offline loading algorithm was
unchanged and source review found no concrete introduced regression, but the
precise cause and physical Safari/PWA offline behavior remain unestablished.
This failure is not a passing Safari device-acceptance result. Genuine signed-in
browser login and fleet workflows remain separate acceptance checks with a
consenting test account. The native audit changes require a future binary;
no EAS build, submission, or OTA update was queued by this release.

## Native Watch connection recovery

[PR #145](https://github.com/pacheco415/Occulert/pull/145), merged as
`1c340e33ee52539260e17012a5011fab0b40937f`, preserves a confirmed live Watch
reply even when separate connection flags are false or fail. Native status reads have a 1.5-second
deadline after at most 0.5 seconds of activation settling; older checks cannot
overwrite a newer cached connection. Runtime fault tests cover delayed and
failed queries, retries, and out-of-order results. A reply confirms message
receipt, not visible notification or vibration. No build-52 connection hang
was reported, and this source change requires a future binary and device checks.

## Pilot preparation and form reliability

September 26 public validation exercised 13 route states at 320 and 390 pixels
in Chromium and WebKit: all 52 document checks returned 200 without script
errors or page overflow. This is signed-out browser evidence, not physical
Safari acceptance or a genuine signed-in fleet walkthrough.

The follow-up source package validates invitation fields before account
creation or acceptance, associates driver-profile labels with their controls,
and gives form selectors a 44-pixel minimum height. Existing immutable assets
remain unchanged. The homepage loads its font stylesheet without blocking
local styling or navigation when that external request stalls or fails.
Benchmark preparation also rejects absent mapped slice
columns, and undefined metric denominators remain unavailable rather than zero.
Release status and final check evidence are recorded in the
[release tracker](https://github.com/pacheco415/Occulert/issues/6).

The next native-release packet and a blank five-driver, 30-day pilot packet
are prepared. The detection rehearsal uses invented rows only; ten-session
review fields are ready, but no real participants, sessions, labeled accuracy
result, new native binary, or device acceptance have been recorded.

## Validating

The user deferred testing on September 26 and requested independent development
work. Device, signed-in fleet, pilot and dataset evidence remains pending.
The next source package adds local-history date filters and a separate bounded
older-fleet-history browser; existing live summary/report/TV calculations keep
their latest-50-session scope. These additions were prepared in source
`0c4c09c5c04287bec19d1741077a56988fbf4422`. The user subsequently approved
publishing this package on September 26, with all testing still deferred.
PR #147 is merged at `5b5db02` and its production deployment is READY, as
recorded in the [history browsing release record](HISTORY_BROWSING.md).
Publication does not establish runtime or device acceptance. Native distribution still requires a
future binary; none was created. App Store listing copy is a prepared draft,
without submission or invented screenshots, credentials, participant data or
device results.

The support package was published in PR #148 with links from Home, Privacy and
Pilot Quick Start, and an accessible native Settings link awaiting a binary.
Contact uses the existing email; there is no contact form or automatic upload.
See [Support Preparation](SUPPORT_PREPARATION.md).

PR #149 published driver-name search, local 7/30-day date views and recorded-status
filtering within the older-history page's loaded records. These filters do not
search unloaded data or change latest-50 reports. Missing end times do not
establish active sessions.

PR #150 published Export shown sessions CSV, tied to the
current rendered selection and its filter/scope metadata. It requires the same
account and a fresh, successful browsing window, excludes hidden identifiers
and personal media, and does not broaden existing reports. All testing remains
deferred; see [History Browsing](HISTORY_BROWSING.md).

PR #151 merged saved alert-feedback filters in Session
History: All feedback, Felt right, Unnecessary alert, Missed alert, Too late
and Not assessed. They compose with the existing local date and review-status
views. Counts, review navigation and deliberate summary sharing follow the
selected scope, while All-history pilot and fusion progress retain their scope.
Ratings are user observations, never detection-accuracy measurements. This is
untested source for a future binary, not installed in build 52; see
[Alert Feedback Preparation](HISTORY_ALERT_FEEDBACK.md).

The next native source repair aligns saved-session duration and fatigue labels
between History and shared summaries. Missing or invalid values become Not
recorded, valid numeric zero remains zero, and fractional duration seconds use
whole elapsed seconds. The repair reads stored values without rewriting records
or changing monitoring, detection, recovery or cloud behavior. All testing is
deferred, and build 52 is unchanged; see
[Summary Value Preparation](HISTORY_SUMMARY_VALUES.md).

1. **Native acceptance:** build 52 installation/general iPhone functionality,
   Watch launch, and foreground/background urgent display/wrist vibration have
   user-reported passes on the reported devices above. Record exact delay,
   Focus/permission variations, setup, phone/audio/accessory routing,
   safe-stop, interruptions, recovery, accessibility, battery and heat under
   safe parked or passenger conditions. The merged native audit fixes need a
   future authorized binary followed by separate device acceptance. Included
   iOS usage is 15/15 until the next period begins September 30 at 5 p.m. Pacific;
   no build is queued. Record physical Safari/PWA offline behavior and genuine
   signed-in browser login/fleet acceptance separately.
2. **Pilot readiness and recruitment:** qualify one fleet owner and up to five
   willing drivers. Confirm parked setup, cloud consent, ownership, support,
   and stop/escalation rules. The owner and participant questions remain
   unanswered. Preparation/validation is approved; actual identities, voluntary
   participation, and observed evidence still need to be supplied. Outreach
   remains unsent; use only recipients and messages authorized for sending.
3. **Pilot operation:** review participation, incomplete/missing records, setup
   friction, and voluntary false/missed/late-alert observations at days 7 and
   30. Latest-50-session history can truncate a window. Counts describe this
   pilot; they do not establish accuracy or crash prevention.
4. **Labeled benchmark:** obtain authorized data, extract compatible EAR,
   freeze participant-separated splits, record provenance and slices. The
   runner validates frame-level EAR only; full-pipeline evaluation and
   prospective evidence are separate. See [Accuracy Benchmark](ACCURACY_BENCHMARK.md).
5. **Fusion validation:** collect independent signals under safe parked or
   passenger conditions, exclude recovered partial sessions, and never stage
   fatigue on the road. Calibrate/validate accessories before a confidence
   model or scoring integration.

## Future, ordered by evidence

| Priority | Capability | Required evidence or decision |
|---|---|---|
| Next | Detection tuning | Reviewed Medium sessions with varied conditions and reproducible benchmark evidence. Observation counts alone cannot justify threshold changes or public accuracy claims. |
| Published web, testing deferred; later scale work | Bounded older-history browsing; later retention, aggregates and realtime subscriptions | The separate history browser is published in PR #147 without runtime acceptance; larger scaling work still needs observed scale or a demonstrated bottleneck, with permissions/deletion/query behavior defined. Protected fleet updates currently use polling. |
| After pilot | Billing and enforced entitlements | Agreed commercial terms and explicit activation. Published plans do not activate subscriptions. |
| After independent validation | Camera/headphone/Watch confidence fusion, pre-drive scoring | Calibration, ground truth, privacy review, value over camera baseline. Health context remains local/read-only information. |
| Later | Watch complication, Android app/health, device-agnostic engine | Proven need and platform implementation/validation. Android source configuration is not a released Android app. |
| Later | Native tvOS | Browser/AirPlay pilot establishes demand beyond the existing web TV view. |
| Exploratory | Smart glasses, earbud heart-rate/HRV | Supported hardware/API evidence and a specific privacy-safe use case. No promised integration. |
| Exploratory | Driver-and-road dual-camera mode | Parked source diagnostics exist; prove supported simultaneous streams, driver-camera priority, mounting, heat and battery before evaluating road analysis. No released road-hazard detection is claimed. |

## Release and evidence rules

The current user instruction skips all testing, including repository verification,
responsive-browser coverage and native type/bundle checks. Record these as deferred
for this approved batch. Source and diff review remain permitted. The usual
verification requirements below apply when the user resumes testing. Review the full diff and repair findings
before advancing the authorized release workflow. Record Preview, merged
source, production, installed binary, and device evidence separately. Existing
session authorization governs current work; this document does not require
repeated approval for approved source or validation work. External sending and
payment activation remain distinct actions. Current-cycle iOS build capacity
is exhausted; source checks and existing-build physical validation can continue.

Occulert may miss drowsiness or produce false alerts. It cannot guarantee alert
delivery, crash prevention, alertness, emergency response, or compliance. Setup
and interaction happen while safely parked or by a passenger. Feeling tired
means pull over safely and rest, regardless of any score or alert.
