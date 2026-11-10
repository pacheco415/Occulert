# Released scoring oracle fixture

`driver-app-v97.js` is a test-only, byte-for-byte copy of the immutable public
`driver-app.v97.js` introduced by commit
`46d61ef1dbc1b1b08ee0c8d646540c0c862d89ee`.

Its verified SHA-256 is:

```text
189085296fa05f9be1bb3cc3bf3c5949b3abc3a892e898d1290c780760c69cb4
```

The oracle checks this constant before independently parsing/executing the prior
released scoring functions. The fixture is never modified to match the new core.
It depends on neither the public root URL nor its current integrity entry, so
ordinary immutable-asset retirement can remove those after their grace period.
The existing deployment exclusion covers `benchmark/`; no worker list references
this fixture. It is not an application runtime/compiler input.

## Synthetic turned-eye fixture

`turned-eye-evidence.json` provides synthetic frontal open/closed observations,
a 25-second low-EAR head turn sampled every 150 ms, and frontal closed-eye
recovery. These scalar measurements are not independent sleep or drowsiness
labels. The fixture contains no recordings or participant data.

`npm run test:scoring-replay` runs the composed live adapters, compares default
scoring with the immutable oracle, and replays `released` against
`perclos-turn-exclude`. Turned frames must leave the PERCLOS denominator, and
the returned face must establish a fresh closed-eye interval before a microsleep
can count. This software fixture does not support promoting the experiment.

## Synthetic road-model fixture

`road-model-synthetic.json` contains hand-authored scalar lane and single-lead
truth, synthetic predictions and fictional model metadata. It contains no road
media, participant data or executable model. Dataset, clip and model licenses
are `NOASSERTION`: they make no assertion of actual rights or consent approval
and establish no repository-wide license. Declared sizes and simulated latencies
are fictional, not measurements.

The [road benchmark guide](../../docs/ROAD_MODEL_BENCHMARK.md) explains the schema,
scoring, missing-output treatment and provenance. Run the fixture with Node 24:

```bash
node benchmark/run-road-model-benchmark.mjs \
  --input benchmark/fixtures/road-model-synthetic.json --split test
```

These synthetic-only results check software contracts. They establish no real
road accuracy, distance, speed, time to collision, on-device latency or safety
result. Authorized clips/models, independent held-out labels and physical-device
acceptance remain separate gates. Do not add real media or model binaries here.

## Synthetic corroboration fixture

`corroboration-synthetic.json` holds four hand-authored sessions from four
fictional participants. It has invented tracking and accessory intervals, cue
timestamps and labels, and contains no media, motion, heart, location or
participant data. Its `consentVersion` is `synthetic`, which the runner refuses
in a real export. The [corroboration replay guide](../../docs/CORROBORATION_REPLAY.md)
explains the schema and policy. Run it with Node 24:

```bash
node benchmark/run-corroboration-replay.mjs \
  --input benchmark/fixtures/corroboration-synthetic.json --split test
```

The expected test-split results are worked out by hand in
`scripts/test-corroboration-replay.mjs`. They check software contracts only and
establish no accuracy, timing or safety result.
