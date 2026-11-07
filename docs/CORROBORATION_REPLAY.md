# Corroboration replay: fixture runner, no results

`benchmark/run-corroboration-replay.mjs` replays exported observation timelines
under two cue policies and scores both with the existing
[event scorer](EVENT_BENCHMARK.md):

- **camera-only**: the released camera alerts as exported;
- **camera + corroboration**: those same alerts plus a proposed add-only cue
  when an independent accessory signal agrees with a camera candidate.

It prepares [Task 4.1](VISION_ROADMAP.md#task-41--corroboration-replay-benchmark).
**No labeled data has been evaluated.** The checked-in fixture is hand-authored
and synthetic, so its numbers check software contracts only. Nothing here
changes app behavior, alert timing, collection or upload. Task 4.3 stays
unselected until held-out, independently labeled data supports it.

## Run the fixture

Use Node 24 from the repository root:

```bash
node benchmark/run-corroboration-replay.mjs \
  --input benchmark/fixtures/corroboration-synthetic.json \
  --split test \
  --json benchmark/results-corroboration.json

npm run test:corroboration-replay
```

`--split` is `all` (default), `train` or `test`. `--json` refuses to overwrite
an existing file. `--window-ms`, `--refractory-ms` and `--min-sources` override
the policy. The report records every value, and `policy.defaults` turns false
when any value differs. Choose overrides on the train split only, then report
the test split once.

## Timeline contract (`occulert.corroboration-timeline`, version 1)

Aggregate History counts from `sensorFusionObservation.ts` cannot rebuild when
a coincidence happened, and the browser trace has no native accessory samples.
A compatible export therefore records timestamps, not totals. It records only
the timestamps below: every object refuses unknown fields, so a timeline cannot
carry raw motion, heart readings, coordinates, media references or names.

| Field | Contents |
| --- | --- |
| `kind` | `synthetic-fixture` or `labeled-export` |
| `dataset` | `id`, `version`, `labelSource`: `synthetic` for fixtures, `independent-annotation` for exports |
| `sessions[].sessionId`, `participant` | Pseudonymous identifiers (letters, digits, `.`, `_`, `-`; no spaces or `@`) |
| `sessions[].split` | `train` or `test`; a participant cannot appear in both |
| `sessions[].platform`, `detectorVersion` | Scored separately; never pooled across detectors |
| `sessions[].collection` | `parked` or `passenger` only. Never stage drowsy driving. |
| `sessions[].consentVersion` | The consent text version for that session; `synthetic` is allowed only in fixtures |
| `sessions[].durationMs` | Integer session length, up to 12 hours |
| `sessions[].tracking` | `[startMs, endMs]` intervals when the camera analysis was usable |
| `sessions[].accessories` | Per source (`headphone`, `road`, `watch`): `[startMs, endMs]` intervals when that signal was usable |
| `sessions[].observations` | `{ atMs, source, kind }` candidate onsets: camera `elevated` or `head_nod`; headphone `head_nod`; road `lane_departure` or `closing_distance` |
| `sessions[].alerts` | `{ atMs, level }` released camera alert onsets (`watch`, `alert`, `critical`) |
| `sessions[].episodes` | `{ startMs, endMs, label }` independent `drowsy` or `high_fatigue` labels; no overlaps |

All times are integer milliseconds from session start. Watch has coverage but
no candidate kind: Task 4.2 records freshness only. Watch therefore appears in
coverage and accessory splits but cannot corroborate until a reviewed candidate
definition exists.

## Proposed add-only policy

| Parameter | Default | Source |
| --- | --- | --- |
| `windowMs` | 5000 | `SENSOR_FUSION_COINCIDENCE_WINDOW_MS` in `native-app/lib/sensorFusionObservation.ts` |
| `refractoryMs` | 8000 | `ALERT_COOLDOWN_MS` in `native-app/constants/thresholds.ts` |
| `minSources` | 1 | Camera plus one independent source: the two-sensor gate |

The test suite fails if either native constant changes without this runner.

1. A camera candidate counts only while camera tracking was usable.
2. An accessory candidate counts only while that accessory was usable. Coverage
   ends are exclusive.
3. A cue fires when at least `minSources` distinct accessory sources each have a
   candidate within `windowMs` of the camera candidate, before or after it. It
   fires at the later of the signals; the policy never acts before the evidence.
4. Each accessory candidate corroborates at most once. Camera candidates never
   corroborate each other.
5. A cue within `refractoryMs` after any camera alert or earlier added cue is
   dropped and counted in `droppedByRefractory`.
6. Camera alerts are never removed, delayed or moved. The runner throws if the
   corroborated stream is missing any camera alert.

These values are proposals for evaluation, not approved app behavior.

## Report

The report gives event-scorer results for both policies, for all selected
sessions (`overall`) and for each accessory combination (`byAccessories`, for
example `camera+headphone+road`). Within each group, results are split by
`platform / detectorVersion`. The pooled `overall` score is `null` when more
than one detector is present.

- **Missed events and recall, false alerts per tracked hour, alert delay:**
  defined in the [event benchmark](EVENT_BENCHMARK.md#metric-definitions-and-limits).
- **`delta`:** corroboration pairs, added cues, cues dropped by the cooldown,
  added cues outside every labeled episode, newly detected episodes, episodes
  detected earlier and the median time gained.
- **`coverage`:** for each accessory, the share of usable camera time it
  covered, fully tracked episodes it fully covered and candidates seen while
  usable.
- **`task43StartCondition`:** for a `labeled-export` test split only. It
  reports, per detector, whether corroboration had fewer misses or a lower
  median delay with no added false alerts. This is the roadmap's necessary
  condition for Task 4.3, not a sufficient one. Small samples stay
  inconclusive, and owner review is still required.
- **`provenance`:** the input SHA-256 and the hashes of the scorer sources.

## Limits

Camera alerts come from the export as recorded. For web parked traces,
[`benchmark/replay-scoring.mjs`](../benchmark/replay-scoring.mjs) can regenerate
camera decisions under a scoring variant, and an adapter could write those
onsets into `alerts`. This runner does not call it: browser traces carry no
native accessory samples, so the accessory timeline must come from a separate
consented native export.

A corroborated cue in the replay was never heard by anyone. The replay cannot
show whether an earlier cue helps a driver, how often a real accessory is
connected, or how a cue interacts with the released cooldown on a device. It
uses the cue timestamps in the export as given; it does not re-run detection.
Results describe one labeled sample under its stated conditions.

The fixture does not establish accuracy, safety or alert delivery, and neither
does any result from a real export. Physical acceptance, a consented pilot and
independent labels remain separate gates.
