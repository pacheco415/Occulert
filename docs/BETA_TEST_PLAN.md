# Occulert Beta Test Plan

Purpose: collect controlled observations about correct, false, missed, and late
alerts before changing detection thresholds or making accuracy claims. Current
release status is in the [authoritative roadmap](APP_ROADMAP.md).

## Release status and recorded evidence

- Private TestFlight 1.0.0 (52) has a finished build and FINISHED submission;
  Apple reports VALID / IN_BETA_TESTING, and the embedded Watch app is confirmed.
  No physical build-52 acceptance is recorded. Confirm the actual installed
  version/build for each session; distribution does not establish installation,
  alert delivery, battery/thermal performance, or acceptance.
- Earlier build-19/36 feedback and build-49 parked checks remain historical.
  There are 0 iOS builds left this cycle; validate the available build 52 and
  continue source work without queueing another build.
- The implemented native behaviors below are included in build 52. Their
  physical acceptance is pending, not binary packaging. The current browser
  reliability branch does not change that native binary.
- Session History lets testers label a completed session as **Felt right**,
  **False alert**, **Missed alert**, or **Late alert**.
- New sessions preserve the active sensitivity setting, and Session History
  shows progress toward the first 10 reviewed Medium-sensitivity sessions.
- Those labels stay on the tester's iPhone unless the tester chooses to send an
  editable feedback email.
- Current source includes structured lighting, eyewear, and phone-position capture,
  plus local coverage counts so repeated test conditions do not create a
  misleading 10-session checkpoint.
- Current source includes tester-reported battery use and phone heat; they are
  observations, not measurements.
- Completed reviews collapse to a summary, while incomplete sessions remain
  open with a **Needs review** indicator.
- New sessions are stamped with the app version and immutable native build
  number. Older sessions remain explicitly labeled as not recorded instead of
  being assigned a guessed build.
- A local alert-pattern summary groups reviewed false and missed alerts by
  sensitivity, lighting, eyewear, and phone position. It shows observation
  counts, not accuracy or error rates.
- Build 52 includes local compatible-headphone motion diagnostics. Raw motion
  readings are discarded; only source status, sample count, and candidate
  head-nod count are saved. This signal is not calibrated and does not affect
  scores, alerts, Watch haptics, or cloud sync.
- Build 52 includes an optional parked camera check for face framing, mount
  angle, and eye visibility. The check is on-device, stores no frames, and
  returns before fatigue scoring or alert delivery.
- Active monitoring stores an aggregate local checkpoint every 15 seconds. If
  the app ends unexpectedly, the next launch can restore a clearly labeled
  partial Session History record without treating it as a complete cloud
  session.
- Independent development may continue while this checkpoint is deferred, but
  detection-threshold changes and accuracy claims remain blocked on reviewed
  evidence.
- This pilot feedback is not a substitute for the authorized dataset benchmark
  defined in `ACCURACY_BENCHMARK.md`.

## Test goals

- Reduce false alerts.
- Identify missed drowsiness events.
- Test phone mount positions.
- Review naturally occurring low-light observations and safe parked/passenger tests.
- Test glasses, sunglasses, and different face angles.
- Record battery percentage change and tester-reported heat, with model/build.
- Collect user feedback from real drivers.

## First review checkpoint

Begin with 10 fully reviewed, complete sessions on default Medium sensitivity,
with exact build recorded. Exclude recovered partial sessions from the target.
Use several safe conditions before considering threshold changes; ten reviews
alone do not establish accuracy:

1. Normal indoor or daylight conditions while parked.
2. Low light while parked.
3. Prescription glasses or sunglasses while parked.
4. Passenger-seat testing on a normal trip.
5. Different safe phone positions before the vehicle moves.
6. Parked camera setup preview in daylight and low light, including a deliberate
   off-center position to verify the guidance changes.

## Safety rule

Never intentionally drive while tired and never simulate drowsiness while
driving. Do not interact with Occulert while operating a vehicle. A passenger
may observe the app, or the tester can review Session History only after the
vehicle is safely parked. Occulert is never a reason to remain on the road when
sleepy.

## Test scenarios

1. Daylight
2. Low light or nighttime
3. Sunglasses
4. Prescription glasses
5. Phone mounted high
6. Phone mounted low
7. Bumpy road
8. Brief natural head turns
9. Passenger-seat observation
10. Stationary controlled eye-closure test
11. Parked interruption-recovery test: begin monitoring, wait at least 20
    seconds, force close the app, relaunch, and confirm the partial recovered
    record is clearly labeled

## Data to record

After each safely completed session:

1. Open **Session History**.
2. Choose **Felt right**, **False alert**, **Missed alert**, or **Late alert**.
3. Record lighting, eyewear, and phone position directly on the session card.
4. Record the tester-observed battery use and phone heat after safely parking.
5. Record any remaining non-sensitive test conditions below.

Do not record or attach face video, camera images, audio, precise location, or
other person-identifiable footage.

- Date
- TestFlight build
- Phone model
- Watch model, if used
- Lighting condition
- Phone mount location
- Glasses/sunglasses used
- Sensitivity setting
- Number of alerts
- Structured alert assessment
- Battery percentage before/after
- Phone heat level
- Optional tester notes

## Simple scoring

Use a 1 to 5 score:

- 1 = not usable
- 2 = many issues
- 3 = usable but needs improvement
- 4 = good
- 5 = excellent

These are participant experience ratings, not measured accuracy. Rate:

- Perceived alert fit
- Alert timing
- Ease of setup
- Battery impact
- Driver trust
- Overall usefulness

## Fleet pilot target

Prepare one fleet owner and up to five willing drivers for a 30-day controlled
pilot. The owner and participant details remain unanswered; no enrollment,
consent, or operating results are recorded by this plan. Before operating,
review the ten-session checkpoint, varied conditions,
and unresolved setup/alert concerns; do not interpret enrollment as device or
accuracy acceptance. Agree:

- Voluntary participation, compatible phones, parked setup, and cloud consent
- Existing rest/safe-stop policy, a support owner, and pause/exit/deletion steps
- Day-7 and day-30 reviews using protected, bounded snapshots
- Setup, participation, missing records, manager workflow, and driver observations
- No crash-reduction, fitness-to-drive, or before/after safety claims

Protected manager snapshots cover the latest 50 sessions and omit local review
labels, recovery reasons, Health context, raw motion, and fusion observations.
A missing record does not establish that no drive or alert occurred. Local
reviews and voluntarily shared aggregate feedback are separate evidence.
Recruitment questions and unsent email drafts are in
[Pilot Outreach](PILOT_OUTREACH.md).

## Next pilot priorities

1. Confirm the exact installed build, then complete ten safely reviewed,
   complete Medium-sensitivity sessions across varied conditions.
2. Use the local alert-pattern summary to compare false and missed alerts by
   lighting, eyewear, phone position, and sensitivity after coverage is broad
   enough to avoid misleading conclusions.
3. Adjust thresholds only when the reviewed evidence supports a change.
4. Obtain authorized dataset access and run `ACCURACY_BENCHMARK.md`.
5. Use the implemented local privacy-limited aggregate sharing deliberately;
   reports contain observation counts, not accuracy rates.

Local fusion coverage and its next-session planner remain observation only.
Camera/headphone candidate counts and optional Watch availability do not change
scores or alerts. Independently calibrate/validate each signal before fusion
scoring; do not stage on-road fatigue or treat a represented condition as proof
of accuracy.
