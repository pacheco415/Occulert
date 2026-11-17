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
