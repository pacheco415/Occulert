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
| Label mapping, exclusions, leak-free splits | Ready in `benchmark/prepare-dataset.mjs` |
| Slice reporting and result provenance | Ready (`--slice-by`, `--json`) |
| Formal dataset validation | Not completed; dataset access is the only remaining blocker |
| Peer-reviewed publication | Not completed |
| Last updated | August 2026 |

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
5. Freeze the split, then score the held-out half only:

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
   thresholds, dataset identifier, split, sample count, and timestamp, which is
   what makes a published number reproducible. Store it and the prepared table
   outside the repository whenever the licence requires it.

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
