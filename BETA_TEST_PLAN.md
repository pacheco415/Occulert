# Occulert Beta Test Plan

Purpose: collect controlled evidence about false, correct, and missed alerts
before changing detection thresholds or making accuracy claims.

## Current private baseline

- iPhone monitoring, phone alert/audio behavior, Apple Watch haptics, alert
  frequency, layout, and read-only Apple Health context passed real-device
  checks in private TestFlight build 19.
- Session History lets testers label a completed session as **Felt right**,
  **False alert**, or **Missed alert**.
- New sessions preserve the active sensitivity setting, and Session History
  shows progress toward the first 10 reviewed Medium-sensitivity sessions.
- Those labels stay on the tester's iPhone unless the tester chooses to send an
  editable feedback email.
- Build 15 includes structured lighting, eyewear, and phone-position capture,
  plus local coverage counts so repeated test conditions do not create a
  misleading 10-session checkpoint.
- Build 15 includes tester-reported battery use and phone heat; they are
  observations, not measurements.
- Completed reviews collapse to a summary, while incomplete sessions remain
  open with a **Needs review** indicator.
- New sessions are stamped with the app version and immutable native build
  number. Older sessions remain explicitly labeled as not recorded instead of
  being assigned a guessed build.
- A local alert-pattern summary groups reviewed false and missed alerts by
  sensitivity, lighting, eyewear, and phone position. It shows observation
  counts, not accuracy or error rates.
- Current source adds local compatible-headphone motion diagnostics. Raw motion
  readings are discarded; only source status, sample count, and candidate
  head-nod count are saved. This signal is not calibrated and does not affect
  scores, alerts, Watch haptics, or cloud sync.
- Independent development may continue while this checkpoint is deferred, but
  detection-threshold changes and accuracy claims remain blocked on reviewed
  evidence.
- This pilot feedback is not a substitute for the authorized dataset benchmark
  defined in `ACCURACY_BENCHMARK.md`.

## Test goals

- Reduce false alerts.
- Identify missed drowsiness events.
- Test phone mount positions.
- Test night driving and low-light conditions.
- Test glasses, sunglasses, and different face angles.
- Measure battery use and phone heat.
- Collect user feedback from real drivers.

## First accuracy checkpoint

Begin with 10 reviewed sessions on the default Medium sensitivity. Use several
safe conditions before changing thresholds:

1. Normal indoor or daylight conditions while parked.
2. Low light while parked.
3. Prescription glasses or sunglasses while parked.
4. Passenger-seat testing on a normal trip.
5. Different safe phone positions before the vehicle moves.

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

## Data to record

After each safely completed session:

1. Open **Session History**.
2. Choose **Felt right**, **False alert**, or **Missed alert**.
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

Score these categories:

- Detection accuracy
- Alert timing
- Ease of setup
- Battery impact
- Driver trust
- Overall usefulness

## Fleet pilot target

After at least 10 reviewed sessions show no unresolved safety blocker, expand
to 5 to 10 trusted testers. Once that group is stable, prepare a small fleet
pilot:

- 3 to 5 drivers
- 2 weeks
- daily feedback form
- summary report
- before/after safety insights

## Next pilot priorities

1. Complete 10 safely reviewed build-15 sessions on Medium sensitivity.
2. Use the local alert-pattern summary to compare false and missed alerts by
   lighting, eyewear, phone position, and sensitivity after coverage is broad
   enough to avoid misleading conclusions.
3. Adjust thresholds only when the reviewed evidence supports a change.
4. Obtain authorized dataset access and run `ACCURACY_BENCHMARK.md`.
5. Add a privacy-safe aggregate export only if manual review becomes too slow.
