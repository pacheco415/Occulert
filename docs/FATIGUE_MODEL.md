# Parked fatigue model feature windows

`benchmark/feature-windows.mjs` turns local parked web comparison exports and independently labeled episodes into one row per complete second after a minute of history. It requires the adapter's `sessions.csv`, `comparison.csv`, `episodes.csv` and `trace-provenance.json`. A new adapter run also writes `accepted-yawns.csv` using accepted events already recorded in trace version 3. Older directories still work. A missing file or unrecorded yawn observation gives an empty yawn feature for that window.

```sh
node benchmark/feature-windows.mjs path/to/parked-session-a path/to/parked-session-b --out fresh-windows
```

The command refuses an existing output directory. `windows.csv` identifies the session, pseudonymous participant, train/test split, window end in milliseconds and label. `windows-manifest.json` records the feature version, ordered feature list, SHA-256 of every consumed input, feature source and runner provenance, and counts of warmup, low-coverage and included windows per session and in total. Keep participant data outside this repository.

## Feature definitions

`fatigue-windows-v1` uses two trailing windows per row. Columns ending in `_30s` and `_60s` each describe the half-open interval ending at the same session-relative whole second. Both use only frames captured strictly before that boundary. Features use each retained capture timestamp and its associated measurements. The final observation supplies no inferred duration up to the boundary. A frame interval contributes time only when its endpoints are adjacent frame IDs, both qualify for that metric, and the gap is at most one second. The earlier state owns the interval, clipped at the window start.

| Feature | Meaning |
| --- | --- |
| `usable_fraction` | Supported legacy eye time divided by the full window length. |
| `perclos` | Closed milliseconds as a percentage of supported eye time. A closed frame has a smoothed EAR below the fixed normalized reference of 0.18. Pixel-reference EAR is multiplied by 3/4 before evaluating these features. |
| `ear_mean`, `ear_min` | Frame-weighted mean and minimum normalized-reference smoothed EAR over usable legacy observations. |
| `blink_count`, `blinks_per_usable_minute` | Count of observed open–closed–open episodes lasting at most 500 ms, and the count per minute of supported eye time. |
| `closure_mean_ms`, `closure_max_ms` | Mean and longest elapsed duration of fully observed, completed closures in the window, including longer closures. An interrupted or still-open-ended episode cannot supply a duration. Both fields are empty when no closure qualifies. |
| `tasks_blink_mean`, `tasks_blink_max` | First average the left and right blink scores on each usable Tasks frame, then take the mean or maximum of those averages. Empty when there is no usable Tasks measurement. |
| `yawn_count` | Count of accepted recorded yawn events on retained frames. Empty if any frame within the window lacks accepted-yawn evidence. |
| `pitch_down_fraction` | Downward time divided by supported pitch time among non-calibrating frames marked legacy-usable or explicitly down. Empty without the selected pitch gate or supported intervals. |

The fixed closure threshold, 500 ms blink limit and minimum coverage are feature definitions for offline experiments. The live monitor uses its own calibration and sensitivity settings. A gap or unusable eye observation interrupts continuity. Empty numeric fields represent missing evidence and must be handled explicitly by a future trainer.

## Labels and exclusions

A row receives label 1 if its end falls at or after the start and strictly before the end of an independently annotated `drowsy` or `high_fatigue` episode in that session. Other included rows receive 0. The extractor rejects overlapping episodes, duplicate session IDs and participants represented in both splits. The split and participant come directly from each session metadata file.

Both windows must cover their complete nominal span and have usable fractions of at least 0.50. For example, a session lasting 63 seconds offers four candidate rows ending at 60, 61, 62 and 63 seconds. A low-coverage row is counted exactly once even when both windows fail. Synthetic fixtures exercise software behavior. The extractor has no role in live alerts and makes no accuracy estimate.

## Train the offline baseline

Run the feature-window extractor over the sessions for both splits. Keep the
participant assignments fixed. Train and evaluate with one command.

```sh
node benchmark/train-fatigue-model.mjs fresh-windows --target-false-alerts-per-hour 1 --out fresh-model
```

The destination must be new. The trainer checks session and participant
identities against the window manifest, rejects cross-split participants and
duplicate ticks, and sorts sessions and ticks before fitting. At least two
training participants are required, with both labels remaining in each
leave-one-participant-out fit.

Each training fold estimates column means and population standard deviations
from its observed values. An empty measurement contributes zero after
standardization (mean imputation). Constant columns use a divisor of one.
Entirely missing columns have mean zero and weight zero. Full-batch logistic
regression starts from zero, takes 200 fixed steps of 0.1 and applies L2 to
the weights only. The penalty with the lowest pooled held-out window log loss
wins among 0.001, 0.01, 0.1 and 1; the first wins exact ties.

The same out-of-fold training predictions select a threshold and consecutive
window count. Candidate thresholds are 0.25, 0.35, 0.45, 0.5, 0.6, 0.7, 0.8,
0.9, 0.95, 0.99 and 1, with streak lengths 1, 2, 3 and 5. Each retained
one-second tick contributes one scored second to the false-alert denominator.
A missing tick breaks the streak and the contiguous positive-label run.
Cooldown is 12 elapsed seconds within a session. Among policies at or below
the requested false-alert rate, maximize positive runs with a candidate, then
minimize false candidates, then prefer the shorter streak and lower threshold.
The training rate measures scored-window time; the separate event benchmark
uses tracked hours and independently annotated whole episodes.

The final fit uses all training rows. `model.json` stores the feature contract,
coefficients, cutoff, streak, training-only input hashes and fit counts, and
`validated: false`. Each hash covers one training session's input digests and
canonical window rows. The pure `fatigueModelScore` function consumes numeric
features with explicit nulls. `test-metrics.json` records a single evaluation
of the frozen model on the held-out split, including window AUC (half credit
for ties), precision, recall and sample counts. Undefined metrics are null.
Keep participant models outside the repo. The checked-in
`benchmark/fixtures/fatigue-model-synthetic.json` is reproduced from generated
scalars by `npm run test:fatigue-model`.
