# Occulert Technical Audit

Last updated: 2026-09-14. Last full source and live-site review: 2026-08-04
(previously 2026-07-08, 2026-07-05, 2026-06-14).

The 2026-09-08 update re-verified the current merged source at `c481817`,
including the full repository suite and 37 local browser checks. Production
was not re-inspected on that date. It also records the previously observed Build 36 TestFlight and
user-feedback evidence below. This does not replace a new regression run when
the next native change is made. For the consolidated near/mid/long-term gap
list, see issue #6.

## 2026-09-14 — Browser startup release and asset delivery

PR #118 (merged as `483a987a1b6013f8bfdbaa68f010b1a9622eac08`) pinned the detector and model graph, checked the first result, added explicit desktop camera selection and missing-device recovery, adjusted CSP for the MediaPipe auxiliary runtime, advanced the service-worker cache to v46, and repaired passkey initialization. Its PR records passing Site Audit and Chromium/WebKit checks; further Safari validation was explicitly deferred.

MediaPipe auxiliary runtime self-hosting and CSP tightening is tracked in [issue #119](https://github.com/pacheco415/Occulert/issues/119).

The follow-up asset-delivery changes use `.v47` filenames for shared JS/CSS and extracted page assets, preserve revalidation for HTML/manifest/service worker, and advance the offline cache to v47. Google Fonts remains hosted by Google with both preconnects. All 17 requested non-monitoring pages now use external styles and scripts in their original execution order. None loads MediaPipe; only Login and Account load the Supabase SDK, and both need it for authentication/passkeys. Other pages use the lightweight backend helper where required.

Live route inspection on 2026-09-14 confirmed `app.html` is the supported monitor; `app-v2.html` and `app-ai-v3.html` served retirement notices. The obsolete notices and robots entries are removed. Neither was in sitemap or active navigation. Issue #9 is already closed; the existing unfiltered Site Audit workflow runs `audit:site` through `verify`, and now exposes a separate audit step.

CSS comparison found different theme-specific card/footer rules rather than identical copies. Shared box sizing, button primitives, and nav alignment move to `base.v47.css`; visual overrides remain in their original layers. The base is imported by all four shared stylesheets and included in the offline precache.

Local validation for this follow-up: `npm run verify` passed; the expanded browser suite passed 139/140 checks, with one WebKit navigation assertion reading during a CSS transition. After changing that assertion to wait for its final position, the focused homepage checks passed 6/6 (three repetitions in each browser). A before/after computed-style comparison passed all 20 desktop/mobile and light/dark scenarios. These are local checks; production deployment and real-device validation are separate.

## 2026-09-14 — MediaPipe runtime self-hosting (#119)

The proposed follow-up pins and self-hosts all nine MediaPipe runtime assets, patches three dynamic-code helpers in both JavaScript variants, removes JavaScript `unsafe-eval`, and removes the detector CDN from the monitor's CSP. Model and WebAssembly bytes are unchanged. The driver advances to `driver-app.v48.js`; the published v47 driver remains available with identical bytes.

Cache v48 verifies the complete runtime before activation and preserves the prior cache on missing or corrupt downloads. This adds about 16 MiB to the first offline installation. Reproduction, licensing, remaining CSP allowances and offline boundaries are documented in [MEDIAPIPE_RUNTIME.md](MEDIAPIPE_RUNTIME.md). Browser and unit tests cover both runtime variants, CSP enforcement, failed fresh installs, failed upgrades, successful recovery and offline inference; these do not establish physical-device behavior or detection accuracy. This entry describes the proposed source change, not a production deployment.

## Original high-priority fixes — current status

| Fix | Status | Evidence |
|---|---|---|
| Split inline CSS/JS out of `index.html` | Done with a bounded exception | PR #54 extracted the homepage assets; one early recovery-link handoff remains inline so URL-fragment credentials are moved before other scripts run |
| Split inline CSS/JS out of `app.html` | Done in current source | PR #55 extracted the styles; `driver-app.js` now holds the monitoring behavior and `app.html` has no inline script blocks |
| Full homepage SEO tags | Done | PR #17. Canonical, `og:title/description/image/url/type`, and four `twitter:*` tags |
| Camera-permission fallback text for iOS Safari vs Android Chrome | Done | PR #60 |
| Real beta waitlist with reliable storage | Done | `api/pilot-leads.js` writes to Supabase using the service-role key |
| Safety / legal disclaimer page | Done | `safety.html` and `privacy.html` are live; `safety.html` carries accuracy-status and pilot-program sections |
| Move the fleet dashboard off `localStorage` | Done | See below |
| Visible product demo above the fold | Done in current source | The four-step interactive demonstration uses the existing optimized visual, works without autoplay video, and keeps parked setup, foreground-only monitoring, on-device processing, and safe-stop limits explicit |
| Testing for night driving, sunglasses, bumpy roads, false alerts | Still open | Now the required-slices work in #65 rather than a separate task |

## Backend: no longer scaffolding

The July revision of this document said the backend "needs a real Supabase
project, credentials, and frontend integration to go live." That is no longer
accurate and the correction matters, because it was the largest open item here.

- `api/_lib/supabase.js` plus ten endpoints (`sessions`, `events`,
  `fleet-summary`, `fleets`, `fleet-invitations`, `accept-invitation`,
  `profile`, `pilot-leads`, `public-config`) are implemented against Supabase.
- `fleet-dashboard.html` loads `occulert-backend.js`, and `loadProtectedFleet()`
  calls `/api/fleet-summary` to render real fleet data for the signed-in owner
  (PR #53).
- `https://occulert.com/api/public-config` returns `{"supabase":{"configured":
  true, ...}}`, so the project and environment variables exist in production.

The remaining `localStorage` in `fleet-dashboard.html` is a deliberate
demo/offline fallback (`seedDemoData`, `clearDemoData`, and a local live-session
cache), not the old prototype store. It should not be read as unfinished work.

## App observations

The web app includes a camera permission flow, MediaPipe FaceMesh loading, Eye
Aspect Ratio detection, calibration, sensitivity and cooldown controls,
vibration and audio alerts, session stats, theme controls, a Bluetooth pairing
UI, and Wake Lock support.

The native iOS app under `native-app/` runs a real vision-camera plus ML Kit
eye-tracking pipeline with history and settings screens, AirPods routing,
directional in-ear alerts (PR #52), a packaged Apple Watch companion (PR #33,
#34) with live monitoring status (PR #61), a pre-drive safety gate (PR #44), and
local-only head-nod and headphone-motion observation (PR #48, #51). It is
tracked in issue #6, not here.

## Native reliability and release evidence

The current merged native source includes the Expo SDK 57 compatibility update
(PR #111), parked camera setup plus interrupted-session recovery (PR #112), and
the WatchConnectivity transfer nil-safety repair (PR #114). Normal iPhone
camera monitoring remains foreground-only: foreground loss stops the session,
and an unexpected interruption can restore only a clearly labeled partial local
summary. Those safeguards do not change fatigue thresholds or turn incomplete
sessions into accuracy evidence.

Build `1.0.0 (36)` was built from `c481817` with the iPhone and Apple Watch
targets, reached the `Occulert Internal` TestFlight group, and later received
positive user-level iPhone/Watch feedback. That is useful release evidence for
this specific build, but it is not a substitute for automated device regression
coverage or a future retest after native changes.

## Accuracy: the one unvalidated claim

Occulert still has no measured detection accuracy against ground-truth data.
This is the most important open item in the project and the only one that
blocks making any public accuracy statement.

As of PR #67 the surrounding tooling is complete — label mapping, exclusion
rules, participant-level leak-free splits, slice reporting, and result
provenance all live in `benchmark/`. What remains is authorized dataset access.
See `ACCURACY_BENCHMARK.md` and issue #65.

Head-nod and headphone-motion signals are recorded but deliberately do not
affect alerts, and must not until they are independently validated.

## App reliability notes

Monitoring pauses when the page is backgrounded; this is expected for
browser-based camera apps. Phone and watch vibration depend on browser and
device support. Bluetooth support varies by browser and is strongest on
Chrome-based browsers. iOS Safari has stricter limitations for background
camera, vibration, and Bluetooth.

## Recommended product direction

Unchanged: prioritize fleet safety — driver drowsiness alerts, a fleet
dashboard, GPS tracking, driver safety scoring, incident history, and a pilot
program for local fleet operators. The backend for this now exists rather than
being planned, which moves the constraint from engineering to evidence: the
pilot program and any accuracy claim both depend on #65.


## 2026-09-14 — Passwordless profile onboarding and selective offline runtime (proposed)

- Create Account sends a Supabase email confirmation link, then offers passkey creation directly; no password required. Email-link sign-in provides recovery. Session identity is checked with Auth before profile creation or enrollment. Display metadata never grants fleet access.
- Added cancellation/retry, unsupported-browser fallback, rate-limit feedback, token-fragment removal and visible partial profile-sync status. Existing password sign-in remains available. Previously published JS bytes remain unchanged; revised scripts use v49 URLs.
- Cache v49 installs only the SIMD or scalar runtime selected by WebAssembly.validate. The other build stays available for integrity-checked online fetches. Tests cover both paths, corrupt downloads, v48 rollback and real offline inference.
- Local browser fixtures do not establish production email delivery, redirect allowlist behavior, or physical-device passkey creation. Those remain release acceptance checks. No production Auth settings changed.
