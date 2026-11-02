# Local unanswered-alert observation

Prepared November 1, 2026 for [Task 2.1](VISION_ROADMAP.md#task-21--unanswered-alert-observation-model).
**Off by default. Observation only.** This source preparation sends no messages,
creates no contact channel and changes no alert thresholds, cue timing or scores.

## What is counted

A candidate requires a critical **phone software output accepted** event while
fresh tracked samples are closed, followed by another **6 seconds** of fresh,
continuously closed samples. The six seconds start at software acceptance, not
the displayed alert level or decision time. A fresh sample must complete the
window; no timer can count a cached closed-eye state.

The provisional freshness bound is **500 ms** for sample gaps and worklet-to-JS
age. Open, watch, no-face, tracking loss, malformed time, reversed time or a gap
disarms pending observation. A new critical decision is required after a gap
or tracking recovery. Its decision must belong to the current uninterrupted
closed interval: a previously unseen cue that completes after open eyes or
reacquisition cannot arm a new interval.

Repeated cues and haptic/audio channels share the existing cue sequence ID.
Each decision is consumed once, including an ineligible first result; a late
repeat cannot re-arm it. A later critical decision cannot extend the initial
window. At most one candidate is counted per closed-eye episode. A counted
episode stays latched through uncertain tracking until explicit open eyes or a
new session. Counts saturate at 1,000,000 per session.

## Meaning and limits of the output signal

`AlertSystem` optionally reports after a current critical haptic promise resolves
or a current critical audio `play()` invocation returns successfully. The event
is named **software-output-accepted**. It does not establish that the OS produced
sound/vibration or that a person heard, felt or answered it. A failed operation,
stale sequence, stopped/unmounted owner or different session emits no accepted
observation. Observer errors cannot affect the existing output path.

Decision, pre-output phone-dispatch, visible alert state and Watch transport
acknowledgement are not acceptance evidence. Watch-only sessions remain
unconfirmed for this observer. No Watch receiver, dispatch plan, preference,
audio route, cue cancellation or physical-delivery contract is changed.

Samples come from the real analysis callback before its throttled UI update.
The observer has its own session generation and monotonic receiver clock. It
rejects delayed JS callbacks and mismatched generations. The current pinned
VisionCamera 4.7.3 adapter normalizes native frame timestamps from iOS
milliseconds and [Android nanoseconds](https://developer.android.com/reference/android/media/Image#getTimestamp()); duplicate, backward, widely spaced or
drifting source timestamps disarm observation. Revalidate this conversion if
the camera stack changes.

The source-clock anchor verifies software stream continuity, **not absolute
capture latency before its first anchor**. These checks do not prove physical
camera freshness, uninterrupted delivery or correct eye classification. Exact
binary/device and independently labeled comparison remain open under
[device acceptance](DEVICE_ACCEPTANCE.md) and the [event benchmark](EVENT_BENCHMARK.md).
Zero candidates do not establish that alerts were perceived or that a drive
was safe.

## Motion and privacy

The runtime labels motion **unknown**. Task 2.2's vehicle-activity gate does not
exist yet, and headphone head-motion availability is not evidence that a
vehicle is moving. The pure model's other observation labels—unavailable,
denied, stale, reported not moving and reported activity—remain separately
counted fixture/future-input categories. None authorizes escalation, including
reported activity; no signal here can authorize sending anything.

Only a versioned aggregate snapshot is saved in local History/checkpoints:
`candidates` and six `byMotion` counters, plus observation-mode/evidence labels.
There are no frame/eye/motion series, timestamps, decision IDs, session
generations, coordinates or personal media in that snapshot. Exact keys,
bounded integer counts and a matching category sum are validated before local
array migration or replacement. Counts are copied before asynchronous storage.

An expanded History row shows experimental candidates and the software-
acceptance limitation. Ordinary/older sessions omit this diagnostic entirely;
recorded zero is distinct from absent data. Interrupted-session recovery copies
only saved counts and never resumes a candidate window. Cloud completion,
event/retry payloads, exports, shares and session feedback exclude these counts.
Existing local History is device-local; this adds no account ownership claim or
new cloud consent/authority.

## Development activation and lifecycle

An explicitly authorized development build may set
`EXPO_PUBLIC_UNANSWERED_ALERT_OBSERVATION=1`. Unset and other values keep the
observer disabled. Checked-in production EAS configuration leaves it off;
source tests do not inspect remote build environment overrides. No build,
distribution or flag activation is part of this change.

When disabled, the monitor creates no tracker, supplies no output/sample or
checkpoint observer callbacks, adds no frame metadata to the existing bridge,
and writes no diagnostic field. When enabled, Start begins a new generation.
Aborted Start, Stop, unmount and foreground loss invalidate pending work. Stop
captures independent counts before asynchronous persistence; late callbacks
cannot update a later session or its saved counts. Recovered counts never arm
new observation. No new permissions, motion requests, background work or
network calls are introduced.

## Verification boundary

The root verification suite includes the pure model tests. Native verification
also runs the actual adapter and mounted analysis tests, mounted AlertSystem
software-output tests, History/storage/recovery tests and checked-in production
default-off guard. They cover delayed first output across open/tracking loss,
deduplication, clock/source discontinuities, session boundaries, frozen Stop
counts, malformed local records, disabled omission and cloud/export/feedback
exclusion. Native bridges are substituted; these are software regressions, not
physical delivery or detection-accuracy evidence. Retain the existing alert and
camera acceptance gates before any separately selected send workflow.
