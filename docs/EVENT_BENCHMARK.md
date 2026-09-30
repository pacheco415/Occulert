# Full-alert observation benchmark (prepared, no results)

The existing [EAR benchmark](ACCURACY_BENCHMARK.md) scores individual browser
eye measurements. `benchmark/run-event-benchmark.mjs` adds a separate scoring
contract for **exported alert observations** against independently annotated
drowsy episodes. It does not run a camera, browser, native binary, MediaPipe,
or ML Kit. No real dataset has been evaluated. A future, consented export or
dataset adapter must provide the four tables below before this can establish
performance for an exact detector version.

## Required CSV inputs

All times are milliseconds relative to the start of their session. CSV headers
are case-insensitive; extra session columns can be used with `--slice-by`.

| File | Required columns | Meaning |
| --- | --- | --- |
| `sessions.csv` | `session_id,participant,platform,detector_version,duration_ms,split` | One row per session. `platform` is `web`, `ios`, or `android`. `split` is `train` or `test`; a participant cannot appear in both. Include condition columns such as `lighting`, `eyewear`, and `camera_position` when known. |
| `tracking.csv` | `session_id,start_ms,end_ms` | Intervals when face/eye analysis was usable. These are not mere camera-on intervals. Intervals may overlap and are merged when scored. |
| `episodes.csv` | `session_id,start_ms,end_ms,label` | Independently annotated `drowsy` or `high_fatigue` episodes. Episodes in a session must not overlap. |
| `alerts.csv` | `session_id,at_ms` | Occulert fatigue alert onset. Tracking-loss and setup notices do not belong here. |

Freeze participant-separated train/test assignments and ground-truth annotation
rules before tuning thresholds. Retain authorized source material and dataset
license information outside this repository if required. Never commit camera
images, video, audio, names, locations, or raw motion to benchmark fixtures.

```bash
node benchmark/run-event-benchmark.mjs \
  --sessions path/to/sessions.csv \
  --tracking path/to/tracking.csv \
  --episodes path/to/episodes.csv \
  --alerts path/to/alerts.csv \
  --split test --slice-by lighting \
  --dataset 'authorized-dataset@version' \
  --json path/to/event-results.json
```

The output includes input SHA-256 hashes and the runner source snapshot. It
always reports each platform and detector version separately, including within
condition slices; it omits a pooled `overall` score when either differs. Repeat
for `eyewear` and `camera_position`,
with sample sizes beside every result.

## Metric definitions and limits

- **Tracking coverage:** merged usable tracking time divided by session time.
- **Event recall:** episodes with at least one fatigue alert between episode
  start and end, divided by episodes whose *entire* interval had usable
  tracking. Episodes with incomplete tracking are counted separately, never
  silently turned into misses or successes.
- **False alerts per tracked hour:** alerts during usable tracking but outside
  all annotated episodes, divided by usable tracking hours. Alerts outside
  usable tracking are counted separately and excluded from this rate.
- **Alert delay:** time from episode start to its first alert; median and 95th
  percentile are available only for detected, fully tracked episodes.

These are operational measurements of one labeled sample under its stated
conditions. They do not measure whether an alert was heard, obeyed, or prevented
a crash. Small or unrepresentative condition slices must remain visibly
inconclusive. Run separate physical-device tests for alert delivery, power,
camera interruption, and Watch behavior, and a prospective voluntary pilot for
real setup and usage. Never stage drowsy driving on public roads.

The current web and iPhone pipelines use different measurements and time
windows. Do not compare or combine their scores until each is calibrated and
validated independently. A future export must include exact build and detector
version, usable tracking intervals, and deliberate alert onset timestamps; the
current production session summary is not sufficient for this benchmark.
