# Local phone activity observation

Prepared November 1, 2026 for [Task 2.2](VISION_ROADMAP.md#task-22--in-vehicle-motion-gate).
**Off by default. Local observation only.** This experiment supplies context for
the existing [unanswered-alert candidate counts](UNANSWERED_ALERT_OBSERVATION.md).
It changes no camera cadence, score, alert, cue timing or cloud payload, and
provides no authority to send messages.

## What Apple's API establishes

[`CMMotionActivity`](https://developer.apple.com/documentation/coremotion/cmmotionactivity)
reports activity classifications, not speed or proof that a vehicle is moving.
Its flags are not mutually exclusive: automotive and stationary can both be
true at a stop, and all flags can be false. Confidence describes the estimated
classification, not verified vehicle movement. The bridge preserves all six
flags and confidence rather than manufacturing a native moving Boolean.

[`startActivityUpdates`](https://developer.apple.com/documentation/coremotion/cmmotionactivitymanager/startactivityupdates%28to%3Awithhandler%3A%29)
first reports the current classification and then reports changes, on a best
effort basis. It is not a heartbeat. Suspended applications do not receive
updates, and resumption may deliver the latest classification. The experiment
does not query historical activity, fabricate periodic evidence or automatically
restart after foreground loss.

[`startDate`](https://developer.apple.com/documentation/coremotion/cmmotionactivity/startdate)
is the activity transition date and may precede the monitoring session. The
inherited [`timestamp`](https://developer.apple.com/documentation/coremotion/cmlogitem/timestamp)
is seconds since boot. The bridge keeps these separate from native callback
receipt time and JS's monotonic clock. Neither callback receipt nor a status
read proves fresh physical measurement.

## Conservative observation labels

Only authorized, high-confidence, unambiguous activity can receive a specific
diagnostic label. Exactly automotive becomes **reported automotive activity**;
exactly stationary becomes **reported stationary**. The existing aggregate
keys remain `reported-activity` and `not-moving` for compatibility; the latter
is not a speed claim. Automotive plus stationary, any other overlapping flags,
unknown, all-false, walking, running, cycling, low/medium confidence and malformed
evidence remain **unknown**. Permission denial/restriction is **denied**; a
missing/unsupported native module is **unavailable**.

The provisional evidence window is **10 seconds**, with at most **1 second**
of native-to-JS delivery delay. Source uptime, activity transition date and
real callback receipt are checked separately. Future, invalid, reversed or
replayed source times fail closed. JS monotonic elapsed time continues aging
the one latest report; cached status reads never renew it. Old evidence becomes
**stale**. Since Apple emits changes rather than a heartbeat, a stable true
classification may age out. That is a deliberate conservative limitation,
not evidence that activity stopped. These bounds require device evaluation.

Context is read at the software candidate's completion. It does not establish
activity throughout the preceding camera interval. Unknown, stale, unavailable,
denied and reported categories retain Task 2.1's separately labeled observation
counts; none changes its six-second camera/output rule, blocks ordinary alerts,
or authorizes a future escalation workflow.

## Activation, permission and lifecycle

Both flags must be explicitly enabled in an authorized development build:

```text
EXPO_PUBLIC_UNANSWERED_ALERT_OBSERVATION=1
EXPO_PUBLIC_MOTION_ACTIVITY_OBSERVATION=1
```

Unset and other values are disabled. Checked-in production EAS configuration
enables neither flag; source checks do not inspect remote environment overrides.
This change performs no build, distribution or flag activation.

Ordinary sessions do not subscribe to, start or query this activity stream.
Even in the experiment, mounting the monitor does not start activity updates.
An explicit foreground Start begins them without awaiting the optional bridge
or delaying the camera. That native operation may request Motion & Fitness
permission. The purpose string covers phone activity and the existing
headphone observations. Denied, restricted, unsupported, stalled and failed
activity startup leave core camera monitoring available.
If the system permission sheet causes foreground loss, the existing monitor
stop rule still applies. The experiment neither bypasses that rule nor
automatically restarts monitoring when the sheet closes.

Each start owns a unique transient token. Stop, aborted Start, unmount and the
existing foreground-loss stop path invalidate JS ownership synchronously.
Native background/destruction teardown invalidates the stream independently;
late queued callbacks are rejected. Owner-conditional native stops cannot tear
down a newer start. No automatic resume or permission retry is introduced.
Existing device-local History ownership and cloud account/consent rules remain
unchanged; this experiment creates no account-owned motion record.

The local module is Apple-only. Missing modules and other platforms report
unavailable; Android gains no activity-recognition or location permission.

## Data and acceptance boundaries

The six flags, confidence and clocks exist only in the latest transient
classification. No activity history, raw acceleration, location, speed, eye
timeline or personal media is stored. Only the existing six aggregate candidate
categories can persist in local History/checkpoints. Cloud sync, retry payloads,
exports, sharing and feedback continue to exclude these counts and all activity
evidence. No network or background processing is added.

Software checks exercise the actual pure controller, optional bridge,
monitor Start/Stop/unmount wiring and production Swift methods against controlled
native stand-ins. The required macOS lane compiles a standalone policy fixture
within 30 seconds and runs its assertions within 10 seconds. Linux hosts execute
the same Swift methods and assertions through Swift's interpreter. The original
separate budgets remain: up to 30 seconds for preparation, then 10 seconds for
the policy assertions. A nonce-tagged, unbuffered monotonic timestamp immediately
before the assertion entry point establishes that boundary. Absolute deadline
checks and watchdogs reject missing, duplicate, malformed or late markers,
overruns and late success after a timeout. Work performed after the marker,
including any lazy JIT compilation, counts against the runtime budget.

Only the fixture's entry-point and timing scaffold differ; no policy condition
or assertion is removed. This avoids an unrelated standalone Linux link-driver
step while retaining compiled coverage on macOS. These host timing checks do
not identify the internal cause of earlier link-driver stalls.

Apple-only autolinking and production flag guards are also checked. On Linux a
missing interpreter is a failure when a compiler is present; its unavailable-tool
skip applies only when both are absent. Other hosts retain the standalone
compiler path and existing tool-availability rules. Compiler/execution
identities and bounded diagnostics are retained. These are controlled policy
tests, not verification of Apple framework scheduling, iOS SDK compilation,
a signed application binary or physical-device acceptance.

Before any use decision, separately authorize an exact native build and record
permission allow/deny/restriction, activity transitions and overlaps, unchanged
activity aging, delayed delivery, Stop/background/restart, device support,
battery and heat under [device acceptance](DEVICE_ACCEPTANCE.md). Arrange any
road observation while parked or with a passenger; do not induce fatigue.
No accuracy result, verified movement gate, contact messaging or emergency
response capability is established here.
