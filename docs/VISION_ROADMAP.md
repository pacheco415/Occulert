# Occulert vision roadmap for Codex

Prepared October 28, 2026 against `main` at `8785b4a`. This is a planning document. It changes no detection threshold, alert, cloud payload, billing or entitlement behavior. [Status](STATUS.md) owns dated release facts and the [development roadmap](APP_ROADMAP.md) owns evidence gates. Where this plan and those documents differ, they win. Planning windows are targets, not commitments.

## The vision

Any phone becomes a fatigue co-pilot. The front camera watches the driver. On supported iPhones, including iPhone Duo when folded, the rear camera adds road context. An Apple Watch and compatible headphones add optional wrist alerts, head motion and heart signals. Alerts escalate from a gentle tap to sound and spoken guidance and point the driver to a safe stop. With the driver's consent, a chosen contact is told when alerts go unanswered. Fleets pay for the manager dashboard.

Three rules from the existing roadmaps apply to every task here:

1. **The phone camera works alone.** Accessories and the road camera may add or strengthen an alert. A missing or disagreeing signal never suppresses a released camera alert.
2. **New signals start observation-only, behind flags that default off.** They affect alerts only after labeled, benchmarked evidence ([accuracy](ACCURACY_BENCHMARK.md), [events](EVENT_BENCHMARK.md)).
3. **Fleet views stay privacy-limited.** Camera frames, raw motion, health readings and coordinates never reach protected fleet views.

## Timeline

| Phase | Window | Outcome |
|---|---|---|
| 0. Finish in-flight work | Now – Dec 2026 | SDK 58 build accepted on devices; this roadmap indexed |
| 1. Alert ladder | Nov 2026 – Jan 2027 | Watch repeats until eyes reopen; spoken top step; emergency-readiness guidance |
| 2. Unanswered-alert escalation | Jan – Apr 2027 | Consenting contact receives a text when critical alerts go unanswered while moving |
| 3. Road camera | Mar – Jul 2027 | Rear-camera road context recorded as observations on supported iPhones |
| 4. Accessory corroboration | Jun – Sep 2027 | Benchmarked decision on whether headphone, Watch or road signals may trigger earlier alerts |
| 5. Revenue | Starts when a pilot fleet commits | Active-driver counts, entitlements and live billing |
| 6. Any phone, any language | Late 2027 | Localized native app, Android dual-camera probe, Wear OS spike |

Phases 1–3 can overlap. Phase 4 needs data from Phases 2–3. Phase 5 depends on pilot evidence and owner decisions, not on code readiness.

## Already in the repository

Build on these. Do not rebuild them.

| Capability | Where | Recorded state |
|---|---|---|
| Browser/PWA monitoring in 8 languages | `src/`, `app.html`, `lang.v47.js` | Shipped web |
| Native eye probability and PERCLOS | `native-app/hooks/useEyeTracking.ts`, `native-app/app/monitor.tsx` | Private TestFlight |
| Phone alert ladder (600 ms prominent, 1.2 s critical) | `native-app/lib/alertPolicy.ts`, `native-app/lib/alertDelivery.ts`, `native-app/components/AlertSystem.tsx` | Source; physical calibration pending |
| Watch companion with 1/2/3-tap haptics and Time Sensitive background notification | `native-app/targets/occulert-watch/AlertReceiver.swift`, `native-app/lib/watchBridge.ts` | Build-52 user-reported pass |
| Headphone motion and head-nod candidates | `native-app/modules/occulert-headphone-motion/`, `native-app/lib/headphoneMotion.ts`, `native-app/lib/headNodDetector.ts` | Observation only |
| Read-only HealthKit sleep and HRV context | `native-app/lib/appleHealth.ts`, `native-app/app/pre-drive.tsx` | Context only |
| Sensor-fusion coincidence counts | `native-app/lib/sensorFusionObservation.ts` | Observation only |
| Front-and-rear camera probe and parked stability test | `native-app/modules/occulert-device-condition/`, `native-app/lib/deviceCondition.ts`, `native-app/components/ParkedReadinessCard.tsx` | Parked diagnostic; road monitoring not active |
| iPhone Duo camera identity and layout | `native-app/lib/frontCameraIdentity.ts`, [Duo layout](DUO_MONITOR_LAYOUT.md) | Source; no physical Duo test |
| Safe-stop Maps handoff | `native-app/lib/safeStopLinks.ts`, [Safe stop](SAFE_STOP_HANDOFF.md) | Source; device check pending |
| Fleet dashboard, invitations, follow-ups, reports, TV | `fleet-*.html`, `api/` | Shipped web |
| Stripe subscriptions | `api/_lib/routes/billing-*.js`, [Billing](BILLING_INTEGRATION.md) | Test mode only; no entitlements |
| `ok_check_in` and `emergency` event types | `ALLOWED_TYPES` in `api/events.js` | Accepted by the API; no client sends them |

## How to hand a task to Codex

Give Codex one task at a time with this prompt:

> Read `AGENTS.md` and `docs/VISION_ROADMAP.md`. Implement Task 1.1 only, on a new branch named in the task, from current main. Respect the task's **Do not** list. Run the listed verification and report the results in the pull request.

Every task also inherits `AGENTS.md` and `RELEASING.md`:

- Node 24. Run `npm ci && npm run verify` for site and API changes. Run `cd native-app && npm ci --include=dev && npm run verify` for native changes.
- Add new tests as `scripts/test-*.mjs`. Register each one in `package.json` and `scripts/verify-steps.json`, following `test:head-nod`.
- Never edit a published versioned asset. Use `npm run asset:bump` for JS and CSS changes.
- Put database changes in `supabase/migrations/<timestamp>_<name>.sql`. Enable RLS, grant `service_role` explicitly and add PGlite regressions.
- Add new API routes to the dispatcher in `api/[endpoint].js`. `scripts/test-vercel-function-budget.mjs` enforces the twelve-function limit.
- Derive identity from verified bearer tokens. Ignore client claims of driver or fleet authority.

A merged task reaches **Implemented source** at most. Device acceptance, pilot results and labeled-data evaluation are separate evidence. Steps marked **Owner** need Rich (accounts, money, legal review, physical devices). Codex cannot complete them.

## Phase 0 — Finish in-flight work

- **Owner:** build and install the SDK 58 TestFlight candidate. Record [device acceptance](DEVICE_ACCEPTANCE.md) for camera, Watch delivery, audio routes, safe stop, battery and heat.
- Merge the remaining reviewed pull requests one at a time against current main.

### Task 0.1 — Index this roadmap

- **Owner:** merge the pull request that adds this file first.
- **Branch:** `codex/vision-roadmap-index`
- **Change:** link `docs/VISION_ROADMAP.md` from `docs/README.md` and from "Remaining evidence and later work" in `docs/APP_ROADMAP.md`.
- **Do not:** change any code or asset.
- **Verify:** `npm ci && npm run verify`.

## Phase 1 — Alert ladder

Goal: the driver feels a clear escalation. A gentle tap comes first, then stronger repeated taps with sound, then continuous taps with spoken guidance and the safe-stop prompt. This phase changes delivery only, never detection thresholds.

### Task 1.1 — Watch repeats critical haptics until the eyes reopen

- **Branch:** `codex/watch-escalation-ladder`
- **Change:** `native-app/targets/occulert-watch/AlertReceiver.swift`. Add a pure model, `native-app/lib/watchEscalation.ts`, that documents the timing table.
- **Behavior:** after a fresh `critical` alert, the Watch repeats the existing critical pattern while all of these hold: the Watch app is active, the latest `occulert-status` is fresh (under the existing 12 s window) and reports `closed`. Starting values: repeat every 4 s, stop after 60 s and leave a persistent "Pull over safely" message. Mark both values as provisional constants. Stop at once on `open`, `stopped`, `stale`, a lower level or a newer alert. The `alert` level keeps its current two taps.
- **Do not:** change the message contract, `native-app/lib/alertPolicy.ts`, the 2-second freshness rule or the background notification path. Do not add a workout or extended-runtime session.
- **Tests:** extend `scripts/test-watch-notification.mjs` (it compiles the real receiver methods) for repeat, cancel on open, cancel on stop, stale status and cap. Add `scripts/test-watch-escalation.mjs` for the model.
- **Done when:** both verify suites pass. The "Apple Watch alerts" section of `native-app/README.md` describes the behavior and its open physical-acceptance gap.

### Task 1.2 — Spoken guidance at the critical step

- **Branch:** `codex/spoken-critical-cue`
- **Change:** a bundled, pre-recorded cue ("Pull over safely. Find a safe stop.") in `native-app/assets/`. Play it through the existing player lifecycle in `native-app/components/AlertSystem.tsx`, once per critical episode, after the existing critical tones. Follow how `native-app/assets/monitoring-paused.wav` is bundled and loaded.
- **Do not:** add text-to-speech packages, change cue timing for `watch` or `alert`, or keep the audio session active after playback.
- **Tests:** extend `native-app/scripts/test-audio-lifecycle.mjs` and `scripts/test-alert-sounds.mjs`: the cue plays once per episode, cancels on stop and never overlaps a newer critical sequence.
- **Done when:** both verify suites pass. Note in `native-app/README.md` that the cue is English-only until Task 6.1.

### Task 1.3 — Emergency-readiness guidance

- **Branch:** `codex/emergency-readiness-card`
- **Change:** a parked-only informational card in `native-app/app/settings.tsx` (and linked from `native-app/app/pre-drive.tsx`). It recommends: set up Medical ID and emergency contacts in the Health app; turn on Crash Detection; turn on Prominent Haptic in the Watch's Sounds & Haptics settings; and, on Apple Watch Ultra, that the Siren and Emergency SOS are available once the driver has stopped.
- **Do not:** claim Occulert can trigger Siren, SOS, Crash Detection or emergency services. Do not read or infer those settings, and add no permissions.
- **Tests:** add a static copy test that fails if the card text says Occulert triggers, contacts or guarantees emergency help.
- **Done when:** native verify passes.

## Phase 2 — Unanswered-alert escalation

Goal: when critical alerts go unanswered while the vehicle is moving, Occulert texts a contact the driver chose and who agreed to be contacted. The two biggest false-escalation risks are a driver resting while parked and a phone that has slipped out of view. The design handles both. Tracking loss never escalates, and parked rest never escalates.

### Task 2.1 — Unanswered-alert observation model

- **Branch:** `codex/unanswered-alert-observation`
- **Change:** a pure model, `native-app/lib/unansweredAlertPolicy.ts`, fed from `native-app/app/monitor.tsx`. A candidate occurs when a `critical` alert was delivered and the face stays tracked with eyes `closed` for a further 6 s (provisional constant). Any `open` sample resets it. `noFace` or `tracking` never produces a candidate. The model also requires the in-vehicle gate from Task 2.2 when that gate is available. Store only candidate counts in the session's local History diagnostics, the way `native-app/lib/sensorFusionObservation.ts` stores coincidences.
- **Do not:** send anything, change alerts, or add cloud fields.
- **Tests:** add `scripts/test-unanswered-alert-policy.mjs` covering open-eye reset, tracking loss, stop, the gate unavailable versus not-moving, and session boundaries.
- **Done when:** both verify suites pass. Pilot History shows how often candidates would have fired before anything is sent.

### Task 2.2 — In-vehicle motion gate

- **Branch:** `codex/in-vehicle-gate`
- **Change:** a local Expo module (pattern: `native-app/modules/occulert-headphone-motion/`) that reports Core Motion's automotive activity as `moving`, `stationary`, `unknown`, `denied` or `not-built`. Update `NSMotionUsageDescription` in `native-app/app.json` to cover this use truthfully.
- **Do not:** request location, store motion history, or let the gate affect alerts. It may only arm Task 2.1.
- **Tests:** an adapter test like `scripts/test-headphone-motion.mjs` for every state and for permission denial.
- **Done when:** native verify passes. **Owner:** confirm on a physical drive that the state changes as expected.

### Task 2.3 — Emergency contacts storage and API

- **Branch:** `codex/emergency-contacts-api`
- **Change:** a migration that adds an `emergency_contacts` table: driver, display name, E.164 phone, `verified_at`, consent text version and `revoked_at`. Allow at most two active contacts per driver. Add owner-scoped routes `GET/POST/DELETE /api/emergency-contacts` through `api/[endpoint].js`.
- **Do not:** expose contacts to fleet owners or browser clients directly, or accept a `driver_id` from the request.
- **Tests:** PGlite tests for RLS, grants, the two-contact limit and account-deletion cascade (extend `scripts/test-account-deletion-db.mjs`). API tests for validation and cross-driver isolation.
- **Done when:** root verify passes and `BACKEND_SETUP.md` documents the migration order.

### Task 2.4 — Contact consent verification

- **Branch:** `codex/emergency-contact-verification`
- **Change:** before a contact can receive escalations, they get one text explaining what Occulert will send and confirm with a code. Add an SMS provider adapter under `api/_lib/` with server-only credentials and a fake transport for tests. Reuse the durable rate-limit pattern from `db/migrations/20260731_durable_pilot_lead_rate_limit.sql`.
- **Owner:** create the SMS provider account, complete US SMS sender registration and put credentials in Vercel environment variables only.
- **Do not:** text an unverified contact, log phone numbers or codes, or accept test credentials in production.
- **Tests:** verification success and expiry, wrong codes, resend limits, revoked contacts, and the fake transport never contacting a network.
- **Done when:** root verify passes.

### Task 2.5 — Escalation endpoint

- **Branch:** `codex/emergency-escalation-endpoint`
- **Change:** `POST /api/emergency-escalations` with a verified bearer token, an `Idempotency-Key` and a session the driver owns. It texts verified contacts with a fixed template. Example: "Occulert: alerts for [driver display name] went unanswered at [time]. Try calling them. Occulert can't confirm their safety. Call 911 if you believe there's an emergency." It records one `emergency` event with no coordinates. Rate-limit to one escalation per driver per 10 minutes (provisional).
- **Do not:** include location, health data or images. Do not let the client choose recipients, the template or the timestamp.
- **Tests:** idempotent retries, rate limit, unverified or revoked contacts skipped, other drivers' sessions rejected, provider failure reported truthfully.
- **Done when:** root verify passes. **Owner:** legal review of the template, consent text and Safety page wording before any real use.

### Task 2.6 — Native countdown and send (development flag)

- **Branch:** `codex/escalation-countdown`
- **Change:** behind a development flag that defaults off, a Task 2.1 candidate starts a 15 s countdown (provisional) with loud audio and a full-width Cancel control for a passenger. Any `open` eye sample cancels it hands-free. When the countdown ends, send through the existing outbox pattern (`native-app/lib/sessionSummaryOutbox.ts`). Offline or failed sends show "Couldn't reach your contact. Call them when safe." and are never reported as delivered. Require sign-in, cloud consent and at least one verified contact.
- **Do not:** enable the flag in production profiles, or start a countdown after monitoring stops or a safe-stop handoff.
- **Tests:** countdown cancel paths, stale session generations, offline outcome, and a static guard that the production profile leaves the flag off.
- **Done when:** native verify passes. **Owner:** parked and passenger-operated testing, then a pilot decision based on Task 2.1 candidate counts.

### Task 2.7 — Escalations in the fleet dashboard (driver opt-in)

- **Branch:** `codex/fleet-escalation-followups`
- **Change:** show `emergency` events in the existing follow-ups panel (`fleet-followups.*.js`, `api/fleet-followups.js`) with time only, defaulting to Open. Only drivers who separately opted in to share escalations with their fleet appear.
- **Do not:** show coordinates, contacts or message text. Do not add a fleet-to-driver alert channel.
- **Tests:** follow-up DB tests for opt-in scope and Playwright coverage for rendering and empty states.
- **Done when:** root verify passes with new asset versions.

## Phase 3 — Road camera

Goal: on iPhones that support simultaneous front and rear capture, the rear camera adds road context such as lane position and closing distance, recorded as observations first. Driver monitoring always keeps priority. On iPhone Duo, this applies only to folded mode.

### Task 3.1 — Dual-capture architecture decision

- **Branch:** `codex/road-camera-architecture`
- **Change:** `docs/ROAD_CAMERA_ARCHITECTURE.md` only. Today the driver stream runs on VisionCamera's single capture session, while the parked stability test builds its own `AVCaptureMultiCamSession` in `native-app/modules/occulert-device-condition/`. Compare two paths: (a) a native dual-capture module that feeds ML Kit natively for the driver and a road model for the rear camera, or (b) a VisionCamera version from [the upgrade plan](VISION_CAMERA_UPGRADE_PLAN.md), if it supports multi-camera sessions. Cover frame ownership, thermal fallback, interruption handling and the Duo camera-identity rules.
- **Do not:** change runtime code.
- **Done when:** the document names a recommended path and the evidence still missing.

### Task 3.2 — Road-stream load policy

- **Branch:** `codex/road-stream-load-policy`
- **Change:** extend `native-app/lib/captureLoadPolicy.ts` with a road-stream tier. It runs at a low frame rate (provisional 5 fps), turns off first at `serious` thermal state or high system pressure, and never reduces the driver stream. Reuse the `driverOnlyFallback` meaning from the stability test.
- **Tests:** extend `native-app/scripts/test-capture-load.mjs`.
- **Done when:** native verify passes.

### Task 3.3 — Road model evaluation harness

- **Branch:** `codex/road-model-benchmark`
- **Change:** under `benchmark/`, a harness that scores candidate on-device lane and lead-vehicle models on authorized, labeled road clips. It records license, model size, latency, and misses by lighting and weather. Follow `benchmark/provenance.mjs`.
- **Owner:** choose clips whose license permits commercial evaluation. Record consent for any clips you record yourself.
- **Do not:** add a model to the app.
- **Done when:** `benchmark/test-benchmark.mjs`-style tests pass and the harness runs on a small fixture.

### Task 3.4 — Road observations in a development build

- **Branch:** `codex/road-observation`
- **Change:** behind a native development flag, implement the path chosen in Task 3.1. Record only lane-departure and closing-distance candidate counts per session in local History diagnostics, alongside the fusion counts.
- **Do not:** store or upload frames, change alerts, or run while the system reports capture unsupported.
- **Tests:** flag-off byte-identical behavior, fallback to driver-only on pressure, and session-boundary resets.
- **Done when:** native verify passes. **Owner:** parked, then passenger-operated, testing on supported iPhones (and a folded Duo if available) with heat recorded per [device acceptance](DEVICE_ACCEPTANCE.md).

## Phase 4 — Accessory corroboration

Goal: decide with evidence whether headphone nods, Watch heart data or road observations may trigger an earlier or stronger alert. The two-signal corroboration idea is the hypothesis being tested. It may only add alerts. It never suppresses the camera.

### Task 4.1 — Corroboration replay benchmark

- **Branch:** `codex/corroboration-replay`
- **Change:** extend `benchmark/run-event-benchmark.mjs` to replay exported session timelines under two policies: camera-only and camera plus corroborating signals. Report false alerts, missed events, latency and coverage, split by which accessories were present.
- **Owner:** independently labeled sessions from consenting participants, collected parked or as passengers. Do not induce fatigue during road driving.
- **Done when:** the report runs on fixtures. A real result exists only after labeled data.

### Task 4.2 — Watch heart-data freshness observation

- **Branch:** `codex/watch-heart-freshness`
- **Change:** after the Phase 2 collection review in the [device roadmap](DEVICE_ROADMAP_2026_2028.md) is resolved, record how fresh read-only HealthKit heart rate and HRV samples are during monitoring. Store counts and ages only, locally.
- **Do not:** start a workout session, write Health data or upload readings.
- **Done when:** native verify passes and History diagnostics show coverage.

### Task 4.3 — Corroborated early-alert experiment

- **Branch:** `codex/corroborated-early-alert`
- **Start only if** Task 4.1 shows fewer missed or later events without more false alerts on held-out data.
- **Change:** behind a flag that defaults off, allow an earlier `watch`-level cue when the camera and an independent signal agree within the coincidence window.
- **Do not:** delay or suppress any camera alert.
- **Done when:** native verify passes and the benchmark report is linked in the pull request.

## Phase 5 — Revenue

Recommended principle: keep core drowsiness alerts, safe stop and unanswered-alert escalation in every tier, including free. Charge for fleet tools and advanced features. A safety feature behind a paywall is hard to defend to drivers, fleets and reviewers.

| Tier | Who | Includes |
|---|---|---|
| Free | Any phone (PWA, Android, iPhone) | Front-camera alerts, safe stop, emergency-readiness guidance, escalation once released |
| Pro | Individual iPhone drivers | Road context, accessory features, extended History and export |
| Fleet | Owners and managers | Dashboard, follow-ups, reports, TV, per-plan driver limits |

**Owner decisions first:** final prices (see [unit economics](UNIT_ECONOMICS.md)), the written definition of an active driver, and legal terms. Consumer Pro purchases made inside the iOS app likely need Apple in-app purchase; confirm the current App Review Guidelines section 3.1 before building.

### Task 5.1 — Active-driver count

- **Branch:** `codex/active-driver-count`
- **Change:** a server-derived monthly active-driver count per fleet, using the owner's written definition, shown on the fleet dashboard.
- **Do not:** block drivers or change billing.
- **Done when:** DB and Playwright tests cover the definition's edge cases and root verify passes.

### Task 5.2 — Entitlements model (test mode)

- **Branch:** `codex/fleet-entitlements`
- **Change:** server-only entitlement checks derived from `fleet_billing_test`, behind a flag that defaults to allowing everything. Show the owner what their plan would limit.
- **Do not:** lock any driver out of safety alerts, or read entitlements from the client.
- **Done when:** API and DB tests pass and `docs/BILLING_INTEGRATION.md` is updated.

### Task 5.3 — Pricing page update

- **Branch:** `codex/pricing-tiers-page`
- **Change:** update `fleet-pricing.html` and its versioned assets to the tiers and prices the owner approved.
- **Done when:** site audit and smoke tests pass.

- **Owner:** live billing activation, following "Before any live billing" in [Billing](BILLING_INTEGRATION.md).

## Phase 6 — Any phone, any language

### Task 6.1 — Native localization

- **Branch:** `codex/native-localization`
- **Change:** extract native UI strings into a typed catalog and add the web app's languages (`en es fr pt de ar zh ja`), including right-to-left layout for Arabic. Record spoken cues per language or keep English with a visible note.
- **Tests:** a missing-key check and the existing monitor layout fixtures at large text in Arabic.
- **Done when:** native verify passes.

### Task 6.2 — Android dual-camera probe

- **Branch:** `codex/android-concurrent-camera-probe`
- **Change:** an Android counterpart to the readiness probe that reports concurrent front-and-rear camera support (Android 11 and later) without starting road monitoring.
- **Done when:** native verify passes. **Owner:** Android physical acceptance.

### Task 6.3 — Wear OS companion spike

- **Branch:** `codex/wear-os-spike`
- **Change:** a feasibility document and minimal companion that receives the existing alert message and vibrates, matching the iPhone message contract.
- **Done when:** the document lists delivery delay, permissions and the open device tests.

## Owner checklist

These are Rich's steps. Codex cannot do them.

- Build, install and record device acceptance for each native release.
- Decide prices, tiers and the active-driver definition.
- Create the SMS provider account and complete US sender registration (Task 2.4).
- Get legal review of escalation wording, consent text, the Safety page and liability terms.
- Request Apple's Critical Alerts entitlement only when [its readiness evidence](../native-app/CRITICAL_ALERTS_READINESS.md) is complete.
- Recruit a pilot fleet and consenting drivers and contacts ([pilot overview](PILOT_OVERVIEW.md)).
- Obtain authorized, independently labeled face and road data.
- Decide whether to arrange physical iPhone Duo access; the device roadmap authorizes no purchase.

Occulert may miss drowsiness or produce false alerts. It cannot guarantee alert delivery, crash prevention or emergency response. Setup and review happen while parked or by a passenger. Feeling tired means pull over safely and rest, regardless of any score or alert.
