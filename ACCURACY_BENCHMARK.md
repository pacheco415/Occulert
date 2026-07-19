# Occulert Detection Accuracy Benchmark

Occulert has not yet been validated against a peer-reviewed drowsy-driving
dataset. This document defines the repeatable benchmark path and deliberately
does not claim an accuracy percentage before real labeled data is evaluated.

## Current status

| Item | Status |
|---|---|
| Algorithm | MediaPipe FaceMesh EAR, PERCLOS, head movement, and fatigue scoring |
| Sensitivity presets | Low, Medium, High |
| Reproducible EAR threshold runner | Ready in `benchmark/run-benchmark.mjs` |
| Formal dataset validation | Not completed; dataset access is required |
| Peer-reviewed publication | Not completed |
| Last updated | July 2026 |

## Target datasets

1. **NTHU Drowsy Driver Detection Dataset** — labeled daytime/nighttime,
   glasses/no-glasses driving footage. Access requires the dataset owner's
   request process.
2. **DROZY** — video plus physiological and sleepiness measures.
3. **UTA Real-Life Drowsiness Dataset** — real-world drowsiness footage.

Review each dataset's license and consent restrictions before downloading,
processing, or publishing derived results. Do not commit licensed video or
person-identifiable footage to this repository.

## Run the checked-in benchmark

The runner accepts precomputed, labeled Eye Aspect Ratio samples:

```csv
label,ear
awake,0.31
awake,0.28
drowsy,0.14
high_fatigue,0.16
```

Run:

```bash
node benchmark/run-benchmark.mjs --input path/to/labeled-ear.csv
```

It reports precision, recall, F1, and false-alert rate for all three
sensitivity thresholds. Verify the runner itself with:

```bash
npm run test:benchmark
```

This first runner is intentionally dependency-free and evaluates frame-level
EAR thresholds. It does **not** validate camera tracking, calibration,
PERCLOS timing, head-nod logic, the complete fatigue score, or real driving
behavior. Those must be evaluated by a later full-pipeline harness and a
properly governed human pilot.

## Ground-truth workflow

1. Obtain permission to use one target dataset.
2. Extract one EAR value per usable frame with the same MediaPipe landmarks
   and preprocessing used by Occulert.
3. Map the dataset's labels to `awake`, `drowsy`, or `high_fatigue`, recording
   the mapping and any excluded frames.
4. Run the checked-in benchmark without tuning thresholds on the test split.
5. Report participant-level or clip-level splits so adjacent frames from the
   same person do not leak between training/tuning and evaluation.
6. Repeat important slices separately: daytime, nighttime, glasses,
   sunglasses, head turns, camera positions, and skin-tone ranges where the
   dataset supports responsible reporting.
7. Preserve the raw output, runner commit SHA, dataset version, exclusions,
   and environment details with the published results.

## Initial targets

- Medium sensitivity recall above 85% on drowsy/high-fatigue samples.
- Medium sensitivity false-alert rate below 15% on awake samples.
- Stretch target: recall above 90% and false-alert rate below 10%.

Targets are product goals, not current performance claims. Even strong offline
results would not make Occulert a certified medical or safety device.

## Results

| Dataset | Split/version | Sensitivity | Precision | Recall | F1 | False-alert rate |
|---|---|---|---:|---:|---:|---:|
| Pending | Pending | Low | TBD | TBD | TBD | TBD |
| Pending | Pending | Medium | TBD | TBD | TBD | TBD |
| Pending | Pending | High | TBD | TBD | TBD | TBD |

Only replace `TBD` with reproducible results from an authorized dataset. After
that, update `README.md`, `safety.html`, and the related GitHub roadmap issue
with the exact dataset and limitations.
