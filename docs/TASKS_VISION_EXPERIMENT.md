# Parked Tasks Vision comparison

This prototype is disabled by default. Open `app.html?detector=tasks` after offline setup has completed, reload if requested, and use it only while parked. Ordinary sessions keep the existing Face Mesh detector. Experimental sessions disable cloud sync and retain comparison scalars locally; they do not upload images or change the alert formula. Additional synchronous GPU inference can affect frame timing, so this is not a production detector switch.

The comparison samples at most twice per second. It records bilateral `eyeBlinkLeft`/`eyeBlinkRight`, `jawOpen`, the average blink coefficient multiplied by 100, and the legacy EAR alongside them. The closure score is a comparison metric, not an established fatigue or yawn measurement. Missing faces and invalid coefficients remain unknown. Session records keep at most the last 1,200 samples (approximately ten minutes) plus running aggregates. Local history remains subject to its existing session cap.

## Owned runtime and privacy

The pinned npm package is `@mediapipe/tasks-vision@1.0.1`. The model is Google's version-1 float16 Face Landmarker bundle. Runtime and model files total about 27.3 MB, with both SIMD and scalar variants available; a device loads only its selected variant. They are requested on demand and excluded from the normal offline installation list. The small comparison helper is included in the normal installation.

`vendor/mediapipe/tasks-vision-1.0.1-occulert.1/runtime-manifest.json` records source URLs, upstream npm integrity, original bundle hash, local patch description, file hashes, and SRI pins. The original Apache 2.0 and Emscripten notices remain present. `scripts/patch-tasks-telemetry.mjs` reproduces the sole bundle modification from the exact upstream bundle: its usage-logging network transport is replaced with a local success callback. Inference and model bytes are unchanged. No CDN or Google telemetry request is made at runtime.

The current service worker must confirm matching pins before initialization. Script SRI, model fetch integrity, and verified service-worker runtime caching protect the files. Corrupted cached files are rejected and fetched again; offline corruption makes the optional comparison unavailable. The experiment requires GPU initialization and falls back to unavailable if unsupported; the existing detector remains usable. CSP is unchanged, including `wasm-unsafe-eval`; JavaScript `unsafe-eval` is not added.

## Evidence and limits

Chromium and WebKit tests initialize the actual runtime, infer a blank frame online and after the origin connection is cut, verify unknown-face output, reject corrupt cached model bytes, and check for external requests and CSP violations. Unit tests cover lifecycle cancellation, worker pin mismatches, throttling, finite coefficients and bounded history. Blank-frame tests establish runtime behavior, not face-detection accuracy.

Google's model cards describe face/AR applications, not validated fatigue warning performance:

- [BlazeFace short-range model card](https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20(Short%20Range).pdf)
- [Face Mesh V2 model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf)
- [Blendshape V2 model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Blendshape%20V2.pdf)

Run the existing event benchmark with `--comparison-dir <directory>` to compare separately labeled/tracked pipeline CSVs. Both directories must contain `sessions.csv`, `tracking.csv`, `episodes.csv`, and `alerts.csv`; session identity, participant, duration, split and ground truth must match, and detector versions must differ. Each pipeline retains its own tracking coverage and metrics; the report does not combine them into one accuracy number. Unfiltered inputs are validated before split selection. No licensed human-face benchmark or physical driving validation has been supplied, so default alerts must remain unchanged.
