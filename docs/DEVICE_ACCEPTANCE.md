# Occulert physical device acceptance protocol

Prepared September 27, 2026. **Blank protocol: no device result is implied.**
The current source and any installed TestFlight binary may differ. Record the
exact website commit/deployment or native app version/build before testing.
Run this only while parked or with a passenger observer; never stage fatigue
or manipulate a phone while driving.

## Test record

| Field | Actual result |
|---|---|
| Tester and date | ____ |
| Platform and app/build or site deployment | ____ |
| Phone model, OS, browser/version | ____ |
| Watch model/watchOS, if used | ____ |
| Mount, camera angle, eyewear and lighting | ____ |
| Audio route, volume, Focus and mute settings | ____ |
| Network state and battery at start | ____ |

Use **Pass / Fail / Not tested** for each check, with a short observed note
and an issue ID for failures. A code review, simulator, web test, or Watch
delivery acknowledgment is not a physical perception test.

## Parked setup and lifecycle

| Check | Status and observation |
|---|---|
| Fresh install/open and upgrade from the previous distributed build | ____ |
| Camera permission granted, denied, then restored | ____ |
| Face/eye tracking under intended day and low-light conditions | ____ |
| Glasses/sunglasses and realistic camera angle tested | ____ |
| Monitoring state clearly active only while frames are analyzed | ____ |
| Camera covered/lost; state becomes stopped or unavailable | ____ |
| Phone locked, app switched, incoming call, then safe restart while parked | ____ |
| Network lost/restored; local monitoring and sync status distinguished | ____ |
| Interrupted session recovers as partial or is clearly marked missing | ____ |
| Large text, VoiceOver/TalkBack, contrast and reduced motion | ____ |
| No setup control requires unsafe interaction while moving | ____ |

## Alert perception while parked

Use the app's deliberate parked test control or safe development fixture.
Record both whether a signal was **sent** and whether a person actually
**heard, felt, or saw** it. Do not produce or simulate fatigue on the road.

| Route or condition | Sent? | Heard/felt/seen? | Delay and notes |
|---|---|---|---|
| Phone speaker and vibration | ____ | ____ | ____ |
| Phone muted or low volume | ____ | ____ | ____ |
| iPhone Safari + Home Screen PWA, Silent switch ON: alert audible (pass/fail) | Not tested | Not tested | Physical iPhone acceptance required |
| Car audio connected | ____ | ____ | ____ |
| Headphones connected | ____ | ____ | ____ |
| Focus or notification restrictions | ____ | ____ | ____ |
| Watch foreground | ____ | ____ | ____ |
| Watch background/screen asleep | ____ | ____ | ____ |
| Watch disconnected/reconnected | ____ | ____ | ____ |
| Repeated alert after cooldown | ____ | ____ | ____ |

A Watch connection reply is not proof that the wrist alert was perceived.
If any intended route cannot be verified, mark it unavailable for that device
and tell the pilot owner before enrollment.

## Sustained operation

| Measurement | Actual value and method |
|---|---|
| Time from open to camera ready | ____ |
| Time from known test event to visible/audible alert | ____ |
| 30-minute and 60-minute camera stalls or tracking gaps | ____ |
| Battery percentage before/after 30 and 60 minutes | ____ |
| Device heat and thermal warnings | ____ |
| Memory/crash symptoms | ____ |
| Offline startup after a prior fully loaded session | ____ |
| Sync success/failure and report appearance after reconnecting | ____ |

Repeat under ordinary expected lighting and mounting conditions. Record
elapsed time and the measurement method; avoid claiming a performance target
has passed from an anecdote.

## Acceptance and release decision

For each intended pilot device, list unresolved failures, workaround,
affected build, owner and retest date. A critical monitoring-state or intended
alert-route failure means **do not include that device in the pilot** until a
new distributed build passes a parked retest. Keep signed-in fleet access,
report coverage, voluntary consent and data-deletion checks in the pilot
record. See [Pilot scorecard](PILOT_SCORECARD.md).
