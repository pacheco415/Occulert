# Occulert detection evidence and future upgrades

Status recorded September 25, 2026. Release status belongs to the
[authoritative roadmap](APP_ROADMAP.md). The historical filename remains for
existing links; Occulert performs landmark/eye tracking and fatigue estimation,
not identity recognition.

## Existing source

Browser monitoring uses MediaPipe FaceMesh and derived Eye Aspect Ratio;
native iPhone monitoring uses ML Kit eye probabilities. Both already implement
fatigue metrics, PERCLOS/eye-closure handling, sensitivity controls, alert
rules, and summaries. Adding a fatigue variable or a fleet database is not
the next step. Do not transplant thresholds or measurements between platforms
without evaluating the actual pipeline.

Tracking and parked framing guidance explain whether a face/eyes can be
observed. They do not establish accuracy or fitness to drive. Native
camera/headphone head-nod candidates and fusion co-occurrences are local,
observation-only features. Headphone/Watch availability does not change scoring
or alerts. Health context is informational, read-only, and local.

Session and fleet reports exist. Protected manager reporting excludes GPS
coordinates, personal media, and raw motion. A GPS route summary is not a
required fleet session field or a detection upgrade. Telemetry is
client-reported/unverified; a displayed safety score is a prototype metric.

## Evidence before tuning

1. Collect ten fully reviewed Medium-sensitivity sessions across safe lighting,
   eyewear, and mount-position variants. Use parked/passenger tests; never
   simulate fatigue while driving. Exclude recovered partial sessions.
2. Review false/missed/late-alert observations and setup/tracking failures using
   the [Beta Test Plan](BETA_TEST_PLAN.md). Counts and participant ratings are
   observations, not false-alert or detection-accuracy rates.
3. Obtain authorized labeled data and run the participant-separated,
   reproducible [EAR benchmark](ACCURACY_BENCHMARK.md). It evaluates frame-level
   thresholds only, not either complete pipeline.
4. Define full-pipeline evaluation of tracking, calibration, time-based PERCLOS,
   sustained closures, interruptions, sensitivity, and alert delivery.
   Report condition slices and limitations before public accuracy claims.
5. Independently calibrate/validate head-nod and accessory observations before
   proposing fusion or enabling those signals in alert scoring.

## Future proposals

Investigate repeatable issues caused by glare/squinting, brief closures, natural
head turns, vibration, partial faces, and lost tracking once evidence identifies
the problem. Compare any filtering/decay/confidence change against a frozen
baseline with known labels and required slices. This document approves no new
threshold table or confidence-based safety guarantee.

Fusion scoring, biometric pre-drive risk scoring, identity recognition, and
smart-glasses sensing are not shipped detection capabilities. Trustworthy
evidence and safe setup come first.
