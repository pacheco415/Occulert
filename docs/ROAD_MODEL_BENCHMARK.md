# Road model benchmark: synthetic fixtures only

This harness checks scoring and provenance contracts using hand-authored scalar
fixtures and synthetic predictions. **All results are synthetic-only.** No road
clip or candidate model is loaded, downloaded or executed. There is no measured
road accuracy, on-device latency, model size, speed, distance, time to collision
or safety result.

Task 3.3 in the [vision roadmap](VISION_ROADMAP.md#task-33--road-model-evaluation-harness)
proposes later evaluation of authorized, independently labeled road clips. This
fixture implementation prepares part of that work; it does not complete the
data, model or physical-device evidence gates. It adds no app integration,
capture, permissions, alerts or native build.

## Run the fixture

Use Node 24 from the repository root:

```bash
node benchmark/run-road-model-benchmark.mjs \
  --input benchmark/fixtures/road-model-synthetic.json \
  --split test \
  --json benchmark/results-road-model.json

npm run test:road-model-benchmark
```

`--split` may select `all`, `train` or `test`; omit it to score both. A selected
split with no clips is rejected. This differs from an empty condition slice,
which remains in the report with zero support and `null` rates. `--json` is
optional. A JSON destination must be new: the runner refuses to overwrite an
existing file or link. Keep an earlier report or choose a different output name
before running again. The fixture is reproducible software evidence, not a
benchmark result for a real model.

The only evaluation input is the supplied JSON. Provenance reads the scorer
sources and uses fixed Git metadata commands; it does not fetch a URL, execute
a model, open media or resolve paths declared inside the fixture.

## Input contract

The JSON bundle has `schemaVersion: 1` and `kind: "synthetic-road-fixture"`.
Validation covers the entire bundle before split selection, so selecting one
split cannot hide malformed rows or source-group leakage in another.
Unknown fields are rejected. The CLI accepts a local regular UTF-8 JSON file
of at most 2 MiB; the bundle is bounded to eight models, 32 clips, 1,000 total
frames and 8,000 prediction rows.

| Field | Contract |
| --- | --- |
| `dataset` | `id`, `version`, `origin: "hand-authored-synthetic-scalars"` and a fixture `license` declaration. |
| `models` | Metadata for each unique model `id`: `task` is `lane` or `lead-vehicle`, with `version`, `origin: "synthetic-predictions"`, `license` and fictional `declaredSizeBytes`. There is no model artifact. |
| `evaluation` | `laneReferenceY`, `laneTolerance` and `leadIoUThreshold`. The example uses `0.75`, `0.05` and `0.5`, respectively. The first two must be in `[0, 1]`; IoU threshold must be in `(0, 1]`. These are fixture scoring rules, not approved road thresholds. |
| `clips` | Each has `id`, `sourceGroup`, `split`, `lighting`, `weather`, `durationMs`, `license` and `frames`. A source group cannot occur in both `train` and `test`. |
| Frame | `id`, clip-relative `atMs`, and independent `lane` and `leadVehicle` truth objects. Their `state` is `present`, `absent` or `unlabeled`. |
| `predictions` | Rows identify `modelId`, `clipId` and `frameId`, with a task-specific `result` and `simulatedLatencyMs` (a number or `null`). Omitted rows remain missing predictions. |

Lighting is `day`, `night`, `dawn-dusk` or `unknown`. Weather is `dry`, `rain`,
`fog`, `snow` or `unknown`. These are authored fixture labels, not measured
conditions.

A present lane contains `leftX` and `rightX` in normalized image coordinates at
the single `laneReferenceY` row (`y = 0.75` in the example). It describes neither
a full lane curve nor a departure event. A present lead vehicle contains a normalized
`box: [x, y, width, height]` for one ego-lane lead. It does not describe a
multi-object detection or tracking task, and box size is not a distance estimate.
Frame timestamps must strictly increase within each clip and lie in
`[0, durationMs)`. Geometry must be finite and fit within the normalized image;
lane edges must be ordered. Boxes require positive width and height whose
computed right/bottom extents advance beyond `x`/`y`, and a representable
positive width-times-height area. Positive numbers that round to empty extents
or underflow to zero area are rejected.

For example, this is a frame fragment, not a complete input bundle:

```json
{
  "id": "frame-0",
  "atMs": 0,
  "lane": { "state": "present", "leftX": 0.3, "rightX": 0.7 },
  "leadVehicle": { "state": "absent" }
}
```

A lane prediction for that frame can be:

```json
{
  "modelId": "synthetic-lane",
  "clipId": "synthetic-clip",
  "frameId": "frame-0",
  "result": { "state": "present", "leftX": 0.31, "rightX": 0.69 },
  "simulatedLatencyMs": 4
}
```

A lead prediction uses a present `box` instead of lane coordinates. Either task
may return `{ "state": "absent" }` or `{ "state": "unavailable" }`.
`unavailable` is an explicit lack of usable output; it is not an absent object.
Use the [checked-in bundle](../benchmark/fixtures/road-model-synthetic.json)
for the complete schema and fictional license declarations.

## Scoring and missing evidence

Results stay separate for each model and task. Each has an `overall` result and
lighting and weather slices, including condition values with zero support.
Metric values are flat within each result; simulated timing has its own nested
statistics. Keep support counts beside rates. A rate with no denominator is
`null`, not a measured zero.

- A lane match requires the larger boundary-coordinate error to be at most
  `laneTolerance`. A lead match requires intersection-over-union (IoU) to be at
  least `leadIoUThreshold` for the single box. Comparisons use a relative
  floating point allowance of `8 * Number.EPSILON`, scaled to the compared
  values and recorded as `geometryRelativeRoundoffAllowance` in the evaluation
  config. Disjoint boxes with IoU zero never match a positive threshold.
- A correctly localized present result on present truth is a true positive.
  Bad localization counts as both a false positive and a false negative.
- Present truth with an absent, unavailable or missing prediction is a false
  negative. Primary recall includes **all** labeled positives, including those
  without usable output. `coveredRecall` is separate and must not replace it.
- An absent result on absent truth is a true negative; a present result on
  absent truth is a false positive. Unavailable or missing output on negative
  truth never counts as a true negative.
- Negative false-positive rate uses false positives on negative truth divided
  by covered negatives. It is not a rate per driving hour. Localization errors
  on positive truth remain separate from this negative-only rate.
- Unlabeled truth supports no accuracy conclusion. `unlabeledOutputs` counts
  available present/absent outputs, not unavailable or omitted outputs.

Coverage and missing-output counts remain visible rather than silently dropping
hard cases. These are per-frame fixture counts; adjacent frames are not
independent road events, people or drives.

`simulatedLatencyMs` summarizes only numbers supplied in prediction rows.
Explicit `null` timing is missing timing; an omitted prediction is counted as
`missingPredictions`, not an additional null timing row. These values are
fictional inputs, not measured execution time. `declaredSizeBytes` is likewise
fictional metadata. Report metadata labels this
`sizeEvidence: "fictional-fixture-declaration"`, retains the input text as
`licenseDeclaration`, and leaves `measuredModelSizeBytes` and
`verifiedArtifactSha256` as `null`. `metadataSha256` hashes the declaration,
not a model artifact.

## Provenance and rights

The report has `kind: "synthetic-road-contract-report"`. Its `evidence` states
`syntheticFixtureOnly: true`, with `realModelsExecuted`,
`realRoadAccuracyEstablished`, `onDeviceLatencyMeasured` and
`appIntegrationAuthorized` all `false`.

The report uses [the shared provenance helper](../benchmark/provenance.mjs) to
record `runnerCommit`, `sourceDirty` and exact `sourceHashes`, including the
single-file road runner/core. `provenance.inputSha256` hashes the input bytes;
`inputBytes` is their byte count. `configSha256` hashes the evaluation config,
including its geometry/matching contract. Provenance also retains fixture
identity/version, selected `split`, `nodeVersion` and `ranAt`. Each model's
metadata has its separate declaration hash. Running outside the checkout must
not select another repository's commit. Without Git metadata, commit/dirty state
remains unknown while source hashes still identify the code.
Report metrics are computed from validated JSON decoded from the same bytes
whose hash is recorded.

Retain the exact input and source snapshot as well as the report. Equal
substantive inputs and source should reproduce substantive results; report
timestamps may differ. A hash identifies bytes. It does not verify a license,
consent, label quality, model origin or declared size.

The schema accepts bounded license text as an **unverified declaration**; it
does not check rights. The checked-in fixture uses `license: "NOASSERTION"` for
its dataset, clips and models. These declarations make no assertion of actual
rights or consent approval. They grant no permission to use a real dataset or
model and do not establish a repository-wide license. No media, participant
identifiers, routes, locations or raw motion belong in these checked-in fixtures.

## Software verification

The independent fixtures in scripts/test-road-model-benchmark.mjs are the
metric oracle; the checked-in demonstration bundle is a separate smoke input.
The coverage target is each documented scoring and input invariant:

| Area | Check type and examples |
| --- | --- |
| Arithmetic and support | Unit checks with hand-counted lane/lead TP, FP, FN and TN; abstention, unlabeled truth, weighted slices and zero-support rates. |
| Geometry | Unit checks at tolerance/IoU boundaries, plus tiny, underflowed, adjacent and nonrepresentable boxes. |
| Input integrity | Rejection checks for schema/types, bounded numbers and collections, references, duplicates and split leakage before filtering. |
| CLI and provenance | Integration checks for exact byte/config/source hashes, execution from another directory, invalid UTF-8/oversize/flags, bounded diagnostics and preservation of existing output files. |

The example must run and the registered root verification target must pass.
These checks validate software behavior only; the model, data and device gaps
below remain open.

## Gates still open

Before a real road evaluation, separately select and review its scope:

1. Obtain clips and models whose licenses permit the intended commercial
   evaluation, plus required consent and retention/publication rules. Keep
   licensed media and identifying data outside this repository.
2. Define independent lane/lead annotations, unknown and occluded cases,
   exclusions, sampling, preprocessing and timestamp alignment. Freeze
   source-group-separated train/test assignments before tuning. A synthetic
   `sourceGroup` check does not establish participant or route independence.
3. Freeze verified model artifacts, versions, hashes, actual byte sizes and
   runtime/configuration. Implement and review a real inference adapter;
   precomputed synthetic predictions do not exercise one.
4. Define an execution protocol for measured latency on the exact device,
   OS/build and runtime, with warmup, sampling, dropped frames and timing scope
   stated. Evaluate support and misses across lighting/weather conditions on
   held-out data. Synthetic slice labels provide no population coverage.
5. Preserve the [road-camera architecture gates](ROAD_CAMERA_ARCHITECTURE.md),
   driver priority, thermal/interruption fallback, privacy and physical
   folded-Duo acceptance. Task 3.4 app observations require a separately
   selected implementation and exact-build testing.

Real-model accuracy, native performance, sustained capture, physical readiness
and any use in alerts remain unestablished. Neither passing fixture tests nor
a complete provenance record promotes a road signal into a safety decision.
