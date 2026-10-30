# Occulert future capability proposals

Reviewed October 29, 2026 against `main` at
`4bee1800c758c71f4c73e6fdf8a49354d9fdbbe6`. These are future proposals,
not selected implementation tasks or release commitments. Indexing or merging
this document does not authorize new alert delivery, timing, detection,
collection, messaging, billing or entitlement behavior. Select and review each
concrete task separately before implementing it. [Status](STATUS.md) owns dated
release facts; the [development roadmap](APP_ROADMAP.md) owns product contracts
and evidence gates. Those documents take precedence.

The October 28 task-list batch has landed, including the default-off web/native
event adapters, observer labels, scoring replay, monitor extraction and isolated
simulator trace. The [October 29 release intent](RELEASE_2026-10-29.md) records
the source handoff and outstanding device checks. Simulator software evidence
does not establish camera or Watch acceptance. Production deployment and database
receipts remain private; do not copy them into this plan or public PRs.

## The vision

The proposed direction is a standalone phone fatigue monitor with optional
accessories and, where capability and evidence permit, rear-camera road context.
Repeated Watch cues, spoken guidance and consented contact escalation are future
ideas. They are not current delivery guarantees. Phone support, folded Duo camera
operation, accessory signals and paid plans keep their separate device, evidence,
privacy and owner-decision gates.

Three rules from the existing roadmaps apply to every task here:

1. **Keep standalone phone monitoring.** Future accessory or road observations cannot suppress a released camera alert. Any proposal to add or strengthen alerts needs a separately selected task and adequate evidence.
2. **New signals start observation-only, behind flags that default off.** They affect alerts only after labeled, benchmarked evidence ([accuracy](ACCURACY_BENCHMARK.md), [events](EVENT_BENCHMARK.md)).
3. **Fleet views stay privacy-limited.** Camera frames, raw motion, health readings and coordinates never reach protected fleet views.

## Proposed sequence

| Phase | Dependency | Proposed outcome |
|---|---|---|
| 0. Existing release handoff | Exact source, authorized build and devices | SDK 58 candidate accepted on devices; this proposal index available |
| 1. Alert delivery proposals | Explicit task selection and exact-build acceptance | Evaluate bounded Watch repetition, a spoken cue and parked guidance |
| 2. Unanswered-alert proposals | Independent candidate evaluation, consent and legal/provider decisions | Evaluate whether a verified contact channel should be built |
| 3. Road camera | Architecture and platform proof; authorized inputs | Evaluate local road observations on capable devices |
| 4. Accessory corroboration | Authorized, independently labeled held-out data | Decide whether any add-only experiment is supported |
| 5. Revenue | Pilot evidence and written owner decisions | Consider active-driver counts, test entitlements and pricing |
| 6. Languages and platforms | Selected scope and platform/device access | Consider native localization and Android/Wear OS feasibility |

Independent source-only proposals may overlap once selected. Phase 4 needs compatible observation timelines and independent labels; building contact messaging is not a prerequisite for collecting those labels. Phase 5 depends on pilot evidence and owner decisions.

## Already in the repository

Build on these. Do not rebuild them.

| Capability | Where | Recorded state |
|---|---|---|
| Browser/PWA monitoring in 8 languages | `src/`, `app.html`, `lang.v47.js` | Shipped web |
| Native eye probability and PERCLOS | `native-app/hooks/useEyeTracking.ts`, `native-app/hooks/useMonitorAnalysis.ts` | Implemented source; historical build-56 availability is separate |
| Phone alert ladder (600 ms closed-eye confirmation; critical eligibility after warmup) | `native-app/constants/thresholds.ts`, `native-app/lib/alertPolicy.ts`, `native-app/lib/alertDelivery.ts` | Implemented source; critical also depends on session warmup and closure/PERCLOS rules, not a guaranteed 1.2 s alert |
| Watch companion with bounded haptics and Time Sensitive notification path | `native-app/targets/occulert-watch/AlertReceiver.swift`, `native-app/lib/watchBridge.ts` | Implemented source; earlier build-52 user reports stay with that build |
| Headphone motion and head-nod candidates | `native-app/modules/occulert-headphone-motion/`, `native-app/lib/headphoneMotion.ts`, `native-app/lib/headNodDetector.ts` | Observation only |
| Read-only HealthKit sleep and HRV context | `native-app/lib/appleHealth.ts`, `native-app/app/pre-drive.tsx` | Context only |
| Sensor-fusion coincidence counts | `native-app/lib/sensorFusionObservation.ts` | Observation only |
| Front-and-rear camera probe and parked stability test | `native-app/modules/occulert-device-condition/`, `native-app/lib/deviceCondition.ts`, `native-app/components/ParkedReadinessCard.tsx` | Parked diagnostic; road monitoring not active |
| iPhone Duo camera identity and layout | `native-app/lib/frontCameraIdentity.ts`, [Duo layout](DUO_MONITOR_LAYOUT.md) | Source; no physical Duo test |
| Safe-stop Maps handoff | `native-app/lib/safeStopLinks.ts`, [Safe stop](SAFE_STOP_HANDOFF.md) | Source; device check pending |
| Fleet dashboard, invitations, follow-ups, reports, TV | `fleet-*.html`, `api/` | Shipped web |
| Stripe subscriptions | `api/_lib/routes/billing-*.js`, [Billing](BILLING_INTEGRATION.md) | Test mode only; no entitlements |
| `ok_check_in` and `emergency` event types | `ALLOWED_TYPES` in `api/events.js` | Accepted types; acceptance alone provides no emergency workflow or delivery assurance |
| Default-off alert retries | `lib/event-outbox.ts`, `native-app/lib/nativeEventOutbox.ts`, [delivery contract](EVENT_OUTBOX_CONTRACT.md) | Implemented source; no rollout implied |
| Observer labels and scoring replay | `src/detection-experiments.js`, `benchmark/replay-scoring.mjs` | Local evidence tooling; no real accuracy result |

## Select a proposal before implementation

The provisional timings, SMS behavior, collection and pricing below have not
been selected. Follow the active user task scope and previously accepted choices.
A task prompt can be:

> Read `AGENTS.md` and `docs/VISION_ROADMAP.md`. Implement the selected task only, from current main on its own branch. State its dependencies, chosen behavior and evidence gates before editing. Respect its **Do not** list. Run the required verification and report the results in the pull request.

Every task also inherits `AGENTS.md` and `RELEASING.md`:

- Node 24. Run `npm ci && npm run verify` for site and API changes. Run `cd native-app && npm ci --include=dev && npm run verify` for native changes.
- Add new tests as `scripts/test-*.mjs`. Register each one in `package.json` and `scripts/verify-steps.json`, following `test:head-nod`.
- Never edit a published versioned asset. Edit registered source and use `npm run asset:release`; use `asset:bump` for unregistered logical assets, as described in `RELEASING.md`.
- Put database changes in `supabase/migrations/<timestamp>_<name>.sql`. Enable RLS; grant required `service_role` table/sequence privileges explicitly; revoke client grants unless actually needed; add meaningful PGlite regressions. Apply and verify prerequisites before dependent deployment. Do not replay already-applied migrations.
- Add new API routes to the dispatcher in `api/[endpoint].js`. `scripts/test-vercel-function-budget.mjs` enforces the twelve-function limit.
- Derive identity from verified bearer tokens. Ignore client claims of driver or fleet authority.

A merged task reaches **Implemented source** at most. Device acceptance, pilot results and labeled-data evaluation are separate evidence. Steps marked **Owner** need relevant owner input or physical access; account operations may be carried out through tools when the active task authorizes them. Source preparation cannot substitute for devices, participant consent or professional judgment.

## Phase 0 — Finish in-flight work

- **Owner:** build and install the SDK 58 TestFlight candidate. Record [device acceptance](DEVICE_ACCEPTANCE.md) for camera, Watch delivery, audio routes, safe stop, battery and heat.
- Merge the remaining reviewed pull requests one at a time against current main.

### Task 0.1 — Index this roadmap

- **State:** this source-only refresh includes the links described below; merging it does not select later tasks.
- **Branch:** `codex/vision-roadmap-index`
- **Change:** link `docs/VISION_ROADMAP.md` from `docs/README.md` and from "Remaining evidence and later work" in `docs/APP_ROADMAP.md`.
- **Do not:** change any code or asset.
- **Verify:** `npm ci && npm run verify`.

## Phase 1 — Alert ladder

Proposal: evaluate bounded, cancelable delivery changes while retaining current detection thresholds. Repetition and spoken cues still change released alert behavior and timing; each requires explicit task selection, audio/Watch lifecycle tests and exact-build physical acceptance. No continuous-feedback guarantee is proposed.

### Task 1.1 — Watch repeats critical haptics until the eyes reopen

- **Branch:** `codex/watch-escalation-ladder`
- **Change:** `native-app/targets/occulert-watch/AlertReceiver.swift`. Keep the authoritative repeat/cancel policy in Swift, with tests exercising that actual policy; a new TypeScript timing table must not become a divergent second implementation.
- **Behavior:** after a fresh `critical` alert, the Watch repeats the existing critical pattern while all of these hold: the Watch app is active, the latest `occulert-status` is fresh (under the existing 12 s window) and reports `closed`. Candidate values for later review: repeat every 4 s, cap a continuous closed-eye episode at 60 s and leave a "Pull over safely" message. Repeated alert messages must not renew that episode cap. The values are proposals, not approved defaults. Stop at once on `open`, `stopped`, stale status, loss of foreground, receiver disposal, a lower level or a replacement alert. A replacement message cannot revive canceled stale work or reset the continuous-episode cap. The `alert` level keeps its current two taps.
- **Do not:** change the message contract, `native-app/lib/alertPolicy.ts`, the 2-second freshness rule or the background notification path. Do not add a workout or extended-runtime session.
- **Tests:** extend `scripts/test-watch-notification.mjs` (it compiles the real receiver methods) for repeat, cancel on open, cancel on stop, stale status and cap. Exercise actual Swift policy/timer cancellation with a controlled clock; avoid a model-only test that cannot detect divergence from the receiver.
- **Done when:** both verify suites pass. The "Apple Watch alerts" section of `native-app/README.md` describes the behavior and its open physical-acceptance gap.

### Task 1.2 — Spoken guidance at the critical step

- **Branch:** `codex/spoken-critical-cue`
- **Prerequisite:** review cue wording, language coverage, accessibility and audio-route acceptance; obtaining a recording must preserve its license and provenance.
- **Change:** a bundled, pre-recorded cue ("Pull over safely. Find a safe stop.") in `native-app/assets/`. Play it through the existing player lifecycle in `native-app/components/AlertSystem.tsx`, once per critical episode, after the existing critical tones. Follow how `native-app/assets/monitoring-paused.wav` is bundled and loaded.
- **Do not:** add text-to-speech packages, change cue timing for `watch` or `alert`, or keep the audio session active after playback.
- **Tests:** extend `native-app/scripts/test-audio-lifecycle.mjs` and `scripts/test-alert-sounds.mjs`: the cue plays once per episode, cancels on stop and never overlaps a newer critical sequence.
- **Done when:** both verify suites pass. Note in `native-app/README.md` that the cue is English-only until Task 6.1.

### Task 1.3 — Emergency-readiness guidance

- **Branch:** `codex/emergency-readiness-card`
- **Change:** a parked-only informational card in `native-app/app/settings.tsx` (and linked from `native-app/app/pre-drive.tsx`). It links to current official setup guidance for Medical ID, emergency contacts and supported Apple emergency/haptic features. Verify model, region and OS availability when implementing; do not present Crash Detection, Siren or any setting as universally available.
- **Do not:** claim Occulert can trigger Siren, SOS, Crash Detection or emergency services. Do not read or infer those settings, and add no permissions.
- **Tests:** add a static copy test that fails if the card text says Occulert triggers, contacts or guarantees emergency help.
- **Done when:** native verify passes.

## Phase 2 — Unanswered-alert escalation

Proposal: evaluate whether unanswered critical-alert reports can support a
consented contact channel. Parked rest, a slipped phone, stale samples,
misclassification, malicious requests and uncertain delivery remain design risks,
not solved outcomes. A future design must exclude tracking loss and parked rest
from escalation and report unknown state truthfully. Task 2.1 observations and
independent evaluation precede selection of a send workflow.

### Task 2.1 — Unanswered-alert observation model

- **Branch:** `codex/unanswered-alert-observation`
- **Change:** a pure model, `native-app/lib/unansweredAlertPolicy.ts`, fed from `native-app/app/monitor.tsx`. A candidate occurs when a `critical` alert was delivered and the face stays tracked with eyes `closed` for a further 6 s (provisional constant). Any `open` sample resets it. `noFace` or `tracking` never produces a candidate. Record motion availability separately. Unknown, stale, denied or unavailable motion never authorizes escalation. Any later send path requires an explicitly reviewed gate; observation-only fixtures may still count separately labeled unknown-gate candidates. Store only candidate counts in the session's local History diagnostics, the way `native-app/lib/sensorFusionObservation.ts` stores coincidences.
- **Do not:** send anything, change alerts, or add cloud fields. Keep the observer off by default and absent from ordinary-session collection; store no raw motion or eye timeline in History.
- **Tests:** add `scripts/test-unanswered-alert-policy.mjs` covering open-eye reset, tracking loss, stop, the gate unavailable versus not-moving, and session boundaries.
- **Done when:** both verify suites pass. Pilot History shows how often candidates would have fired before anything is sent.

### Task 2.2 — In-vehicle motion gate

- **Branch:** `codex/in-vehicle-gate`
- **Prerequisite:** verify current official Core Motion API semantics. Apple documents that [automotive and stationary classifications can overlap](https://developer.apple.com/documentation/coremotion/cmmotionactivity). Automotive activity is not a speed measurement or proof that a vehicle is moving; do not label it as verified motion. Establish freshness, confidence and stationary/unknown handling before defining a gate.
- **Change:** a local Expo module (pattern: `native-app/modules/occulert-headphone-motion/`) that reports the supported activity evidence and its timestamp/confidence without inventing a movement state that the API cannot establish. Update `NSMotionUsageDescription` in `native-app/app.json` to cover this use truthfully.
- **Do not:** request location, store motion history, or let the gate affect alerts. It may only arm Task 2.1.
- **Tests:** an adapter test like `scripts/test-headphone-motion.mjs` for every state and for permission denial.
- **Done when:** native verify passes. **Owner:** confirm on a physical drive that the state changes as expected.

### Task 2.3 — Emergency contacts storage and API

- **Branch:** `codex/emergency-contacts-api`
- **Change:** a migration that adds an `emergency_contacts` table: driver, display name, E.164 phone, `verified_at`, consent text version and `revoked_at`. Allow at most two active contacts per driver. Add authenticated driver-scoped routes `GET/POST/DELETE /api/emergency-contacts` through `api/[endpoint].js`.
- **Do not:** expose contacts to fleet owners or grant browser roles direct table access, or accept a `driver_id` from the request. The authenticated driver may read/manage only their own contacts through the API. Decide minimal retention, deletion, consent versioning and abuse controls before selecting this task.
- **Tests:** PGlite tests for RLS, grants, the two-contact limit and account-deletion cascade (extend `scripts/test-account-deletion-db.mjs`). API tests for validation and cross-driver isolation.
- **Done when:** root verify passes and `BACKEND_SETUP.md` documents the migration order.

### Task 2.4 — Contact consent verification

- **Branch:** `codex/emergency-contact-verification`
- **Change:** after the driver explicitly requests an invitation and abuse/cost controls pass, the proposed contact gets one verification text explaining the proposed messages and confirms with a code. Add an SMS provider adapter under `api/_lib/` with server-only credentials and a fake transport for tests. Reuse the durable rate-limit pattern from `db/migrations/20260731_durable_pilot_lead_rate_limit.sql`.
- **Owner:** create the SMS provider account, complete US SMS sender registration and put credentials in Vercel environment variables only.
- **Do not:** send escalations to an unverified contact, send unsolicited retries, log phone numbers/codes, or accept test credentials in production. Invitation authorization, provider delivery uncertainty, opt-out/revocation, replay protection and contact consent must be designed before real messaging.
- **Tests:** verification success and expiry, wrong codes, resend limits, revoked contacts, and the fake transport never contacting a network.
- **Done when:** root verify passes.

### Task 2.5 — Escalation endpoint

- **Branch:** `codex/emergency-escalation-endpoint`
- **Change:** `POST /api/emergency-escalations` with a verified bearer token, an `Idempotency-Key` and a session the driver owns. It texts verified contacts with a fixed template. Example: "Occulert: alerts for [driver display name] went unanswered at [time]. Try calling them. Occulert can't confirm their safety. Call 911 if you believe there's an emergency." A successful accepted submission may record the proposed `emergency` event with no coordinates, using explicit submitted/delivery-unknown semantics. Client telemetry cannot prove drowsiness, vehicle movement or danger; the API must not represent it as verified safety evidence. Rate-limit to one escalation per driver per 10 minutes (provisional).
- **Do not:** include location, health data or images. Do not let the client choose recipients, the template or the timestamp.
- **Tests:** idempotent retries, rate limit, unverified or revoked contacts skipped, other drivers' sessions rejected, provider failure reported truthfully.
- **Done when:** root verify passes. **Owner:** legal review of the template, consent text and Safety page wording before any real use.

### Task 2.6 — Native countdown and send (development flag)

- **Branch:** `codex/escalation-countdown`
- **Change:** behind a development flag that defaults off, a Task 2.1 candidate with the required fresh motion gate starts a 15 s countdown (provisional) with loud audio and a full-width Cancel control for a passenger. Any `open` eye sample cancels it hands-free. When the countdown ends, use a separately reviewed, expiring, idempotent delivery policy. Neither the session-summary outbox nor the alert outbox is an emergency-message contract; do not reuse either unchanged or deliver stale escalation after reconnect. Offline or failed sends show "Delivery unconfirmed. Contact them when safe." and are never reported as delivered. Require sign-in, cloud consent and at least one verified contact.
- **Do not:** enable the flag in production profiles, queue delayed emergency messaging, or start or continue a countdown after Stop, backgrounding, permission/tracking loss, an invalid motion gate, a safe-stop handoff, logout/account switch or consent/contact revocation. Recheck all scope and expiry guards immediately before dispatch.
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
- **Change:** `docs/ROAD_CAMERA_ARCHITECTURE.md` only. Today the driver stream runs on VisionCamera's single capture session, while the parked stability test builds its own `AVCaptureMultiCamSession` in `native-app/modules/occulert-device-condition/`. Compare two paths: (a) a native dual-capture module that feeds ML Kit natively for the driver and a road model for the rear camera, or (b) a camera version selected through a refreshed compatibility review, if official APIs actually support the required multi-camera sessions. The [October 4 upgrade plan](VISION_CAMERA_UPGRADE_PLAN.md) is historical; its Expo/RN baseline is not the current dependency set. Cover frame ownership, thermal fallback, interruption handling and the Duo camera-identity rules.
- **Do not:** change runtime code.
- **Done when:** the document names a recommended path and the evidence still missing.

### Task 3.2 — Road-stream load policy

- **Branch:** `codex/road-stream-load-policy`
- **Change:** extend `native-app/lib/captureLoadPolicy.ts` with a road-stream tier. A candidate low road-frame rate (5 fps for evaluation, not an approved default) turns off first at `serious` thermal state or high system pressure. A pure policy addition must remain unused until the road architecture is selected; it must not change current driver capture cadence or lifecycle, including the existing critical-heat stop. Reuse the `driverOnlyFallback` meaning from the stability test.
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
- **Change:** compose the existing `benchmark/replay-scoring.mjs` and event scorer to replay compatible exported session timelines under two policies: camera-only and camera plus corroborating signals. Report false alerts, missed events, latency and coverage, split by which accessories were present.
- **Prerequisite:** define a consented, minimal, compatible observation timeline. Existing aggregate fusion/road candidate counts cannot reconstruct when corroboration occurred; do not invent event timestamps from totals or assume the browser trace contains native accessory samples.
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

Pricing hypothesis for owner review: retain standalone monitoring and existing safe-stop access while charging for selected fleet tools. The example tiers below are proposals, not approved prices, entitlements or availability claims. Unbuilt features cannot be advertised as included.

| Tier | Who | Includes |
|---|---|---|
| Free | Supported phone platforms, once individually accepted | Front-camera alerts, safe stop, emergency-readiness guidance, escalation once released |
| Pro | Individual iPhone drivers | Road context, accessory features, extended History and export |
| Fleet | Owners and managers | Dashboard, follow-ups, reports, TV, per-plan driver limits |

**Owner decisions first:** final prices (see [unit economics](UNIT_ECONOMICS.md)), the written definition of an active driver, and legal terms. Before selecting a purchase flow, review the current official App Review Guidelines, storefront requirements and legal terms; this planning document makes no platform-policy determination.

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
- **Tests:** a missing-key check and the existing monitor layout fixtures at large text in Arabic. Preserve alert meaning and consent text; fluent human review and physical accessibility acceptance remain required for translated release copy.
- **Done when:** native verify passes.

### Task 6.2 — Android dual-camera probe

- **Branch:** `codex/android-concurrent-camera-probe`
- **Change:** an Android counterpart to the readiness probe that reports concurrent front-and-rear camera capability only where the selected Android API and device support it without starting road monitoring.
- **Done when:** native verify passes. **Owner:** Android physical acceptance.

### Task 6.3 — Wear OS companion spike

- **Branch:** `codex/wear-os-spike`
- **Change:** a feasibility document and minimal companion that receives the existing alert message and vibrates, matching the iPhone message contract.
- **Done when:** the document lists delivery delay, permissions and the open device tests.

## Owner decisions and external evidence

These steps require separate authorization, accounts, real devices, participants or professional judgment. Source preparation cannot stand in for them.

- Authorize any native build/submission separately, then install and record exact-build device acceptance. Do not infer quota, remote build numbers or availability from this plan.
- Decide prices, tiers and the active-driver definition.
- Create the SMS provider account and complete US sender registration (Task 2.4).
- Get legal review of escalation wording, consent text, the Safety page and liability terms.
- Request Apple's Critical Alerts entitlement only when [its readiness evidence](../native-app/CRITICAL_ALERTS_READINESS.md) is complete.
- Recruit a pilot fleet and consenting drivers and contacts ([pilot overview](PILOT_OVERVIEW.md)).
- Obtain authorized, independently labeled face and road data.
- Decide whether to arrange physical iPhone Duo access; the device roadmap authorizes no purchase.

Occulert may miss drowsiness or produce false alerts. It cannot guarantee alert delivery, crash prevention or emergency response. Setup and review happen while parked or by a passenger. Feeling tired means pull over safely and rest, regardless of any score or alert.
