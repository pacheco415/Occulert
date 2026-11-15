# Eye visibility experiment — parked diagnostic only

## Status and finding

This prototype is **off by default and unvalidated**. It records a low-EAR-variance
candidate in an explicitly selected parked trace. It does not identify sunglasses,
glare, covered eyes, or fitness to drive. It changes no ordinary eye-detection
status, score, threshold, loss warning, or fatigue alert.

The motivating limitation is the existing landmark-based validity check:
`ear > 0.05 && ear < 0.65` in `src/metrics.js`. A plausible landmark geometry is
not direct evidence that the eye region is visible. The new signal deliberately
does not replace that check.

The concrete synthetic finding is that a constant plausible EAR produces a
low-variation candidate after sufficient support, while varying EAR does not.
**Both an unobstructed still-eye sequence and a hypothetical inferred covered-eye
sequence can have the same constant EAR and produce the same result.** The
prototype therefore cannot resolve covered eyes from landmarks alone. Its purpose
is to make this limitation measurable in future independently labeled parked data.
No camera study, sunglasses/glare benchmark, sensitivity, specificity, false-alarm
rate, or physical-device accuracy claim is included in this task.

## Running it

While safely parked, open the driver page with `?eye-visibility=1`. The flag must
appear exactly once with the value `1`; missing, different, or duplicate values
leave it off. It can be combined with the existing parked observer or Tasks
measurement modes. The flag alone keeps the ordinary legacy scoring path.

Start a local session, complete calibration, collect the desired parked samples,
then stop monitoring and use the existing **Export Detection Trace** control.
Export remains blocked while monitoring. The parked experiment indicator remains
visible, and existing experiment consent boundaries disable every cloud route.
Only local scalar trace fields are added: no images, eye-region crops, raw
landmarks, new permissions, or background collection.

The observer flag retains its existing independent-labeling behavior and output
suppression. Selecting eye visibility alone does not add observer suppression or
change alarm delivery. Remain parked throughout this experiment.

## Signal definition

`createEyeVisibility()` in `src/detection-experiments.js` consumes the captured
frame's monotonic time and **raw**, unsmoothed EAR. Its parameters are frozen in
the exported trace's `session.eyeVisibility` metadata:

| Parameter | Prototype value |
| --- | --- |
| Method | `ear-variance-v1` |
| Sliding window | 10,000 ms |
| Minimum supported span | 8,000 ms |
| Minimum distinct samples | 40 |
| Largest continuous gap | 1,000 ms |
| Maximum retained samples | 1,024 |
| Low-variation threshold | Population EAR variance < 0.000004 |
| Validation and effect flags | `validated: false`, `changesStatusOrAlerts: false` |

The threshold and window are exploratory constants, not learned or validated
operating points. Variance is the population mean of squared deviations from the
retained samples' mean. Floating-point cancellation is clamped at zero.

Each opted-in trace row adds:

| Field | Meaning |
| --- | --- |
| `eyeVisibilitySamples` | Number of retained usable, distinct samples |
| `eyeVisibilityWindowMs` | Span between the oldest and newest retained samples |
| `eyeVisibilityVariance` | Population variance, or `null` before sufficient support |
| `eyeVisibilityCandidate` | `1` for low variation, `0` for variation above the threshold, or `null` for unknown |

Neither `0` nor `1` means eyes are visible or covered. Unknown is not converted to
zero. Calibration, recalibration, no face, invalid EAR, turning, gated downward
or unknown pitch, backward/duplicate timestamps, gaps over one second, stop and
restart clear support. Repeated captured video frames are ignored by the existing
capture guard. The fixed buffer cannot grow; exceptionally high frame rates can
leave too little retained elapsed time and therefore return unknown.

Without the flag, the model is not constructed and existing traces keep their
original fields and memory layout. The new model uses two fixed 1,024-entry
Float64 buffers (16,384 bytes); an opted-in default trace adds four scalar columns
(76,800 bytes across 2,400 rows). These are bounded memory allocations in the
optional helper, which remains outside the default offline install.

## Validation in this task

Automated tests exercise the actual model and controller for window/variance
math, insufficient time/sample support, invalid input, loss and calibration
resets, clock discontinuities, bounded retention, stop/restart, and scalar-only
opt-in serialization. An actual driver-runtime replay compares the selected
experiment with the ordinary pipeline across calibration, open/closed eyes,
turns, loss and recovery; states, scores and accepted alerts must match.

The trace adapter accepts the new flag's source provenance, but deliberately
excludes these diagnostic fields from event decisions and ground-truth labels.
A regression proves that inserting low-variation candidates cannot change the
existing tracking intervals, independent episodes, or accepted alert metrics.
All existing cloud-disable, owned-runtime integrity, source-release, strict
offline and trace adapter checks remain required. PR validation records contain
the exact command results for the released immutable asset versions.

## Evidence needed before any promotion

Collect authorized, independently labeled parked sessions with unobstructed eyes,
clear glasses, different sunglasses, reflections/glare, lighting changes, head
turns and no-face controls. Label visibility independently of EAR and of this
candidate. Record device/camera conditions and the exact detector/helper versions;
use participant-separated training and held-out test sets.

Compare the landmark-only baseline and this candidate on each condition. Report
unknown coverage, false positives on visible eyes, missed covered-eye intervals,
detection delay and performance cost. Long ordinary fixation and low-motion
landmark inference are explicit confounders. A pixel contrast alternative would
require a separate reviewed prototype and privacy/performance evaluation; this
task does not capture pixels.

Until that evidence supports a frozen decision rule, this flag stays parked and
diagnostic only. See [the application roadmap](APP_ROADMAP.md),
[accuracy benchmark](ACCURACY_BENCHMARK.md), and
[event benchmark](EVENT_BENCHMARK.md) for the existing promotion gates.

## Composed release

This diagnostic is composed with the three-state eye display, restored-eye cue
and local coverage summary. The immutable release uses `driver-app.v136.js`,
`detection-experiments.v17.js`, `driver-startup-guard.v57.js` and cache
`occulert-v217`; catalog v6 is retained. Published asset bytes are unchanged.
The driver is 131,331 bytes within the existing 131,500-byte ceiling. Selected
static install assets total 378,813 bytes within the existing 379,000-byte
ceiling. The helper stays optional and outside default installation.

The flag remains off by default. Its runtime regression compares the fully
composed ordinary and experimental paths and requires identical statuses,
fatigue scores and accepted alerts.
