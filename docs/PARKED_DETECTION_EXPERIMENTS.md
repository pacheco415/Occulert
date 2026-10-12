# Parked detection experiments

These opt-in web experiments are for stationary software evaluation. The empty-query monitor retains the released detection pipeline. None of these changes establish real-world accuracy, driver safety, a physical looking-down angle, mobile CPU/GPU performance, or a validated Tasks alert threshold. Keep the defaults until independent labeled evaluation and exact-build physical validation support a change.

| Query option | Experimental behavior |
| --- | --- |
| `fatigue-timing=elapsed` | Scale continuous fatigue/confidence changes by elapsed processed-frame time / 135 ms, clamped to 0–500 ms; retain discrete nod events. |
| `ear-units=pixels` | Measure landmark distances in video pixels and recalibrate on resolution/orientation changes. |
| `noface-escalation=1` | Request the existing full alert once when face loss follows closed eyes, WATCH fatigue (35), or a downward nose estimate within 3 seconds; freeze fatigue decay for that qualified loss episode. |
| `perclos=time` | Compute closed / usable observed milliseconds in a 60-second window, rather than a fraction of frames. |
| `pitch-gate=1` | Calibrate a dimensionless neutral nose/eye/chin ratio while parked; pause eye/microsleep evidence while down or while calibrated pitch geometry is unknown. |
| `detector=tasks` | Collect the owned Tasks detector's bilateral blink, jaw and matrix measurements alongside the legacy detector on the same captured frame. Tasks does not control alerts. |
| `tasks-delegate=cpu` | Explicitly request CPU for the optional Tasks runtime; its default is GPU. No silent fallback. |

Flags require unique, exact values; duplicate or differently cased values do not enable a mode. Combinations are supported and their sorted names become part of `detectorVersion`. Every enabled experiment disables all protected cloud session, event, live-summary and retry entry points. Existing ordinary pending outboxes are retained unchanged. Experimental reports and small summaries stay in this browser.

## Observation and calibration boundaries

Time PERCLOS counts the previous closed/open state only between two usable endpoints separated by 0–1000 ms. A missing face, unusable landmarks, calibration, turned/down/unknown pitch, or a longer gap grants no observed time. Expiry clips the oldest interval exactly at 60 seconds. A measured all-open window is `0`; no supported window is `null` (shown as `--`). The preallocated 1024-interval deque coalesces matching contiguous intervals, maintains running totals, and reports truncation explicitly if its capacity is exceeded.

Pixel EAR scales x by video width and y by video height before distances. The flag converts existing constants once using a **3:4 portrait reference**: physical EAR = normalized EAR × 4/3 for that reference. The normal `.18` / `.22` presets therefore become `.24` / `.2933…` only in pixel mode. This reference preserves an illustrative portrait behavior; the repository has no measured device-share evidence that it is the most common stream. Physical pixel EAR itself is aspect-ratio independent.

Pixel/pitch calibration requires at least 12 contiguous frontal, finite, open-compatible samples spanning at least 2500 ms within the existing 3200 ms setup. The 20–80% trimmed baseline excludes measurements below the current watch threshold. This is a conservative software eligibility rule, not a validated biological classifier, and naturally small open eyes may fall back to presets. Missing/turned/invalid frames or gaps above one second reset support. Failed recalibration clears the previous personal baseline and uses current presets; it cannot silently retain stale thresholds. Resolution/orientation changes reset thresholds, continuity and calibration.

The pitch gate uses `(noseY − eyeLineY) / (chinY − eyeLineY)` and a synthetic baseline offset of `.12`. A downward frame or unavailable calibrated pitch cannot complete a closed-eye/microsleep episode. Distraction time includes only supported intervals of at most one second. The gate can fall back to current presets when no usable parked baseline exists. Its 2D ratio and threshold remain physically unvalidated.

Face-loss escalation privately authorizes only the controller's current qualified episode. Calibration, an unqualified/stale loss, guessed external eligibility, normal 12-second cooldown and snooze still suppress it. This narrow path permits an alert after tracking confidence decays without inventing a high confidence value. It does not treat every missing face as fatigue.

## Paired measurements and deliberate local export

One bounded reusable canvas captures each distinct processed video frame before legacy inference; both detectors receive that same image. Camera input is never exported or persisted. Generation guards discard old callbacks, rejections and finalizers after stopping, restarting or recalibrating. Experimental Stop immediately tears down the old camera and blocks restart while the old detector's bounded close is pending.

The Tasks runtime is `1.0.1-occulert.1`, copied byte-for-byte from the prior pinned experiment with its telemetry-removal patch, model, Apache/Emscripten licenses and NOTICE. Its six exact pins are in `vendor/mediapipe/tasks-vision-1.0.1-occulert.1/runtime-manifest.json`. It loads only on demand through owned integrity pins and the current integrity worker. Offline cached optional bytes are checked before use; corrupt model bytes fail closed. Default offline installation does not preload the optional runtime.

A stopped Tasks session exposes **Export parked detection comparison**. Its JSON retains at most 2400 distinct captured-frame scalar rows and 256 legacy alert observations, with explicit dropped counts and retained ranges. The full trace stays in memory; local history receives only a small aggregate. Rows include session-relative/camera timestamps, raw/smoothed EAR, blink/jaw coefficients, pitch/yaw degrees, separate inference times and total frame cost. Unsupported signals are `null`; per-pipeline usability and calibration are explicit. A pitch-unknown or calibration-completion frame cannot acquire legacy tracking support merely because EAR is finite.

The export records flag names, geometry units, helper integrity, exact model/runtime pins, requested/usable delegate and failure state. MatrixData's documented default column-major layout plus the pinned JS packed-data copy support the declared normalized `Rz(roll) Ry(yaw) Rx(pitch)` decomposition; synthetic known rotations verify the math. That inference is not exact-version C++/physical pose validation. Degenerate, reflected, sheared, non-finite or singular-pitch matrices remain unknown. See [MatrixData](https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/mediapipe/framework/formats/matrix_data.proto) and [upstream geometry writer](https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/mediapipe/tasks/cc/vision/face_geometry/libs/geometry_pipeline.cc).

## Independent labels and reproducible software evidence

Convert the explicit export with externally labeled episodes and a pseudonymous participant split:

```bash
node benchmark/parked-detection-trace.mjs \
  --trace path/to/local-export.json --episodes path/to/independent-episodes.csv \
  --participant P001 --split test --out path/to/derived-inputs
node benchmark/run-event-benchmark.mjs \
  --sessions path/to/derived-inputs/sessions.csv \
  --tracking path/to/derived-inputs/tracking.csv \
  --episodes path/to/derived-inputs/episodes.csv \
  --alerts path/to/derived-inputs/alerts.csv \
  --comparison path/to/derived-inputs/comparison.csv --split test
```

The adapter cannot fabricate labels or Tasks alerts. It validates bounds, unique frames, signal types, exact owned pins, and separately supplied train/test identity. The existing event runner checks participant leakage and scores legacy alert observations against independent labels. Timing/paired support is reported by detector version; **Tasks event recall, false-alert rate and delay remain unavailable/null** until a frozen validated Tasks decision replay exists. Retained trace intervals do not extrapolate over omitted frames or camera gaps.

`benchmark/prepare-dataset.mjs` also accepts `earGeometry.mode: "pixel_landmarks"` with mapped landmark/video-width/video-height columns. It calls the exact same pixel geometry helper and fingerprints its source. Obtain dataset rights independently; no new external face imagery was downloaded for these checks.

The synthetic deque probe (`node benchmark/microbench-detection-window.mjs`) measured five runs of 100,000 alternating 135 ms samples with every seventeenth frame unknown on Node 24.19.0 / Apple M5. Its median was 2.906 ms versus 118.817 ms for an equivalent rebuilding-array control; final percentages matched within floating-point tolerance. Typed backing storage was 17,408 bytes with zero dropped intervals. These are local software timings, not mobile performance or accuracy results.

The attached software evidence also records actual Chromium/WebKit CPU/GPU startup and 20 measured blank-canvas inference calls after three warmups, including actual availability and no fallback. This blank 640×480 desktop workload has no usable faces and cannot establish paired face accuracy, pose direction or on-road timing. [Software evidence](evidence/parked-detection-software.json) preserves its workload, hashes and counts.

Import traces using their matching source revision. The adapter checks the exact owned helper, runtime and model hashes, the detector/flag and geometry contract, and rejects usable legacy frames that also claim calibration or downward pitch. Unsupported time-PERCLOS, including calibration-only sessions, remains unavailable in local history and reports; measured zero remains 0%. These checks validate consistency, not the authenticity of user-edited JSON.

## Parked calibration sample minimum

`calibration-min=12` requires at least 12 accepted EAR samples before the legacy
calibration can personalize its baseline. Fewer samples fall back to the same
default thresholds and chosen sensitivity. The existing 3200 ms window and
sample eligibility remain unchanged. A unique exact value is required; absent,
duplicate or different values preserve the one-sample legacy rule. This flag
does not switch to the experimental detector controller; pixel/pitch modes
retain their existing stronger continuity and duration requirements. Keep this
flag parked until labeled sessions support changing the default.

Every new session and Recalibrate clears the preceding personal baseline and
base thresholds, including when calibration later has no accepted samples.
