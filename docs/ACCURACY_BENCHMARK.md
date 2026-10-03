# Occulert Detection Accuracy Benchmark

Occulert has not yet been validated against a peer-reviewed drowsy-driving
dataset. This document defines the repeatable benchmark path and deliberately
does not claim an accuracy percentage before real labeled data is evaluated.
Product/release priorities are maintained in the
[authoritative roadmap](APP_ROADMAP.md); participant observation counts and
fusion coverage are not substitutes for labeled evaluation.

## Current status

| Item | Status |
|---|---|
| Algorithm | MediaPipe FaceMesh EAR, PERCLOS, head movement, and fatigue scoring |
| Sensitivity presets | Low, Medium, High |
| Reproducible EAR threshold runner | Ready in `benchmark/run-benchmark.mjs` |
| Label mapping, exclusions, leak-free splits | Ready in `benchmark/prepare-dataset.mjs` |
| Slice reporting and result provenance | Ready (`--slice-by`, `--json`) |
| Formal dataset validation | Not completed; authorized access, compatible EAR extraction, and frozen labeled evaluation remain required |
| Peer-reviewed publication | Not completed |
| Status reference updated | September 26, 2026 |

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

Measurements must be finite, non-negative numbers; blank measurements are
invalid, while an explicitly measured zero is accepted. Labels must be `awake`,
`drowsy`, or `high_fatigue` (the legacy `sleepy` alias is also accepted by the
runner). Unknown labels fail validation instead of counting as awake. Dataset
preparation excludes invalid measurements and records their count in its
manifest even when no custom exclusion rule is configured.

Both input paths support quoted commas, escaped quotes, and multiline fields.
Malformed quoting, duplicate or blank column names, and inconsistent column
counts stop processing so corrupted metadata cannot silently affect results.

Preparation supports participant-level splitting only, with a non-empty seed
and a numeric test fraction greater than zero and less than one. Slice names
must be unique and lowercase and cannot replace `label`, `ear`, `participant`,
`clip`, or the generated `split`. Invalid configuration stops before files are
written. The runner also checks supplied split tables independently: every row
needs a participant and a `train` or `test` split, and a participant cannot
appear on both sides, even when only one side is selected for scoring.
An explicitly mapped slice source column must exist in the raw export;
missing or misspelled source columns stop preparation before output is written.
A requested slice column must exist; blank values within that column remain
`(unspecified)`. Minimal `label,ear` tables remain supported for frame-level
exploration, but do not establish a held-out evaluation.

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
sensitivity thresholds. A metric with a zero denominator is shown as
`not estimable` (JSON `null`), rather than a measured zero. Supported zero
rates stay zero. Precision uses TP/(TP+FP), recall TP/(TP+FN), F1
2TP/(2TP+FP+FN), and false-alert rate FP/(FP+TN) among awake frames. This
last metric is not false alerts per hour or a session error rate. Inspect
class and participant support before interpreting small condition slices.
Verify the runner itself with:

```bash
npm run test:benchmark
```

This first runner is intentionally dependency-free and evaluates frame-level
EAR thresholds. It does **not** validate camera tracking, calibration,
PERCLOS timing, head-nod logic, the complete fatigue score, or real driving
behavior. Those must be evaluated by a later full-pipeline harness and a
properly governed human pilot.

An [event-level observation scorer](EVENT_BENCHMARK.md) now defines how to
compare exported alerts, usable tracking intervals, and independently labeled
episodes. It has no real dataset results and does not execute the detector or
replace exact-build physical testing.

## Ground-truth workflow

Steps 3 through 7 below are automated so they cannot be done inconsistently by
hand. `benchmark/prepare-dataset.mjs` applies the label mapping, applies the
exclusions, and assigns the split; `benchmark/run-benchmark.mjs` scores it and
records provenance.

1. Obtain permission to use one target dataset.
2. Extract one EAR value per usable frame with the same MediaPipe landmarks
   and preprocessing used by Occulert, producing a raw CSV of derived values.
   Never copy source video or participant images into this repository.
3. Copy `benchmark/dataset-config.example.json` to
   `benchmark/dataset-config.json` (gitignored) and fill in the dataset name,
   version, licence, source column names, label mapping, exclusion rules, and
   slice columns.
4. Prepare the canonical table:

   ```bash
   node benchmark/prepare-dataset.mjs \
     --config benchmark/dataset-config.json \
     --input path/to/raw-export.csv \
     --output path/to/benchmark-ear.csv
   ```

   This prints the exclusion tally, writes a manifest recording every dropped
   row and why, and assigns `train`/`test` by hashing the participant id with
   the configured seed. Because the split is a function of the participant, no
   participant can appear on both sides — the tool exits non-zero if it ever
   detects otherwise. The same seed always reproduces the same split, so a
   split can be regenerated rather than shipped.
5. Freeze the split, then score the held-out test subset only. The example
   uses a 30% test fraction; hash assignment does not guarantee an exact
   proportion, balanced conditions, or a nonempty split for small datasets:

   ```bash
   node benchmark/run-benchmark.mjs \
     --input path/to/benchmark-ear.csv \
     --split test \
     --dataset "NTHU@<version>" \
     --json path/to/results.json
   ```

   Do not look at `--split test` results while choosing thresholds. Tune on
   `--split train` if tuning at all.
6. Report each required slice separately by re-running with `--slice-by`:

   ```bash
   node benchmark/run-benchmark.mjs --input path/to/benchmark-ear.csv \
     --split test --slice-by lighting
   node benchmark/run-benchmark.mjs --input path/to/benchmark-ear.csv \
     --split test --slice-by eyewear
   ```

   Rows with no value for a slice are reported as `(unspecified)` rather than
   silently dropped, so a thin slice is visible instead of invisible.
7. Keep the emitted `results.json`. It carries the runner commit SHA,
   exact benchmark source SHA-256 hashes, benchmark source dirty status,
   input SHA-256, thresholds, dataset identifier, split, sample count,
   and timestamp. Preparation manifests also include raw-input and exact
   configuration SHA-256 hashes. Source provenance resolves the scripts'
   checkout even when commands run from another directory. A missing Git
   checkout records an unknown commit/dirty state while preserving source
   hashes. These records identify inputs; retain the actual approved input,
   configuration, and source snapshot too. Freeze the separate extractor,
   landmark/runtime assets, sampling/label-alignment rules, licence provenance,
   and exclusions before evaluation. Check mapped raw headers and independent
   participant/event support; do not treat adjacent frames as independent
   people. Store records outside the repository whenever the licence requires
   it. Repeated substantive results must agree; run timestamps may differ.

## Initial targets

- Medium sensitivity recall above 85% on drowsy/high-fatigue samples.
- Medium sensitivity false-alert rate below 15% on awake samples.
- Stretch target: recall above 90% and false-alert rate below 10%.

Targets are product goals, not current performance claims. Even strong offline
results would not make Occulert a certified medical or safety device.

## Results

No authorized dataset has been evaluated yet, so there is no accuracy number to
report. The tables below are the shape the results must take, not results.

### Provenance (fill from `results.json`)

| Field | Value |
|---|---|
| Dataset name and version | TBD |
| Licence / agreement | TBD |
| Split seed and test fraction | TBD |
| Participants: train / test | TBD |
| Rows kept / excluded | TBD |
| Runner commit SHA | TBD |
| Evaluated on | TBD |

### Overall, held-out test split

| Sensitivity | Precision | Recall | F1 | False-alert rate | Samples |
|---|---:|---:|---:|---:|---:|
| Low | TBD | TBD | TBD | TBD | TBD |
| Medium | TBD | TBD | TBD | TBD | TBD |
| High | TBD | TBD | TBD | TBD | TBD |

### Required slices, medium sensitivity

Report a row per slice value the licence and sample size support. A slice with
too few samples to be meaningful should say so rather than show a number.

| Slice | Value | Precision | Recall | F1 | False-alert rate | Samples |
|---|---|---:|---:|---:|---:|---:|
| Lighting | day | TBD | TBD | TBD | TBD | TBD |
| Lighting | night | TBD | TBD | TBD | TBD | TBD |
| Eyewear | none | TBD | TBD | TBD | TBD | TBD |
| Eyewear | prescription glasses | TBD | TBD | TBD | TBD | TBD |
| Eyewear | sunglasses | TBD | TBD | TBD | TBD | TBD |
| Head pose | frontal | TBD | TBD | TBD | TBD | TBD |
| Head pose | turned / partial face | TBD | TBD | TBD | TBD | TBD |
| Camera position | TBD | TBD | TBD | TBD | TBD | TBD |

### Known limitations of any result in these tables

State these alongside any published figure:

- Frame-level EAR thresholds only. Camera tracking, calibration, PERCLOS
  timing, sustained-closure confirmation, head-nod logic, and the composite
  fatigue score are not exercised by this runner.
- Offline video, not live driving. No on-road false-alert rate is implied.
- Head-nod and headphone-motion signals are excluded until independently
  validated.
- One dataset is one population. Results do not transfer to unseen lighting,
  eyewear, camera geometry, or demographics.

Only replace `TBD` with reproducible results from an authorized dataset. After
that, update `README.md`, `safety.html`, and the related GitHub roadmap issue
with the exact dataset, split, metric definitions, and limitations — and never
publish a single headline percentage without them.

## Optional pixel EAR experiment

The released default stays in normalized landmark units. `/app.html?ear-units=pixels` selects parked, local-only testing of `ear-geometry.v1.js`, shared by the browser and dataset preparation. It scales landmark x by video width and y by video height before distance calculations. Missing dimensions or degenerate eye points stay unavailable rather than producing a fabricated open-eye measurement. Camera resolution and orientation changes reset observations and restart calibration in this experimental mode.

A 360×480 reference fixture was chosen to preserve the existing 3:4 portrait behavior; this is not evidence that it is the most common device. Old normalized EAR equals physical EAR × width/height. The experiment therefore converts default thresholds, sample gates, clamps and sensitivity offsets once by 480/360 = 4/3. Its calibrated baseline is measured directly in pixel units. Thresholds use that fixed reference conversion rather than changing when a device rotates. Ordinary app loads keep the released values.

`node benchmark/compare-ear-geometry.mjs receipt.json` uses the actual active driver and shared geometry code with a synthetic 60-pixel-wide eye whose opposing vertical distances are 18 pixels. Legacy normalized EAR is 0.225 at 360×480 and 0.400 at 480×360; pixel EAR is 0.300 in both, matching the dataset extractor. This verifies geometry, not camera accuracy, calibration suitability or driving safety.

Dataset preparation may declare `earGeometry: {mode: "pixel_landmarks", landmarksColumn: "landmarks", widthColumn: "video_width", heightColumn: "video_height"}`. Each source row must then provide JSON MediaPipe landmarks and its actual frame dimensions. The tool outputs derived EAR, never the raw landmarks, and records the extractor hash and mapping. Existing EAR-only exports remain unchanged and explicitly carry unverified geometry provenance. Do not multiply old EAR-only CSV values by an assumed aspect ratio. Licensed dataset access and frozen evaluation are still required before changing the default.
