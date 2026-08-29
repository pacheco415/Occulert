# Occulert Technical Audit

Last updated: 2026-08-29. Last full source and live-site review: 2026-08-04
(previously 2026-07-08, 2026-07-05, 2026-06-14).

The 2026-08-29 update is limited to verifying the current-source extraction of
the driver app's behavior into `driver-app.js` and correcting the documented
homepage inline-script exception. All other source statuses and production
observations remain from the 2026-08-04 review unless a later verification is
named explicitly. For the consolidated near/mid/long-term gap list, see issue
#6.

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
| Visible demo video above the fold | Still open | No `<video>` or embed in `index.html` |
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
