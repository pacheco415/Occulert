# Occulert Facial Detection Upgrade Roadmap

Goal: improve drowsiness detection reliability while reducing false alerts.

## Important wording

Occulert should describe the product as facial landmark detection, eye tracking, or drowsiness detection, not identity-based facial recognition. The goal is not to identify who a person is. The goal is to measure driver fatigue signals on-device.

## Current system

The current app uses MediaPipe FaceMesh, Eye Aspect Ratio, smoothing, calibration, sensitivity, cooldown, blink events, and alert triggering.

## Upgrade 1: Fatigue score

Replace single-threshold alert logic with a fatigue score from 0 to 100.

Signals:

- Eye closure duration
- Repeated long blinks
- Drowsiness accumulation
- Head turn / lost tracking
- Tracking confidence
- Recovery time after eyes reopen

Thresholds:

- 0 to 29: Safe
- 30 to 59: Watch
- 60 to 79: High Risk
- 80+: Alert

## Upgrade 2: Better false-alert filtering

Reduce false alerts from:

- sunlight squinting
- quick blinks
- phone vibration
- head turning to mirrors
- glasses glare
- temporary face loss

Recommended filters:

- ignore very short closures under 200ms
- require repeated closure evidence before alerts
- decay fatigue score slowly instead of instant reset
- lower confidence when face is partially lost
- pause alert buildup during head turns

## Upgrade 3: Head nod detection

Use landmark movement over time:

- nose bridge vertical movement
- chin position
- eye line tilt
- rapid downward head motion followed by recovery

## Upgrade 4: Tracking confidence

Add a live tracking confidence value based on:

- face present
- both eyes visible
- lighting stability
- landmark jitter
- camera angle

Show this in the UI so drivers know when the app needs better phone placement.

## Upgrade 5: Session report

At session end, show:

- drive time
- alert count
- average fatigue score
- highest fatigue score
- safety score
- tracking confidence average
- recommended action

## Upgrade 6: Fleet data model

For fleet dashboard integration, each app session should produce:

- driver_id
- vehicle_id
- session_start
- session_end
- alert_count
- max_fatigue_score
- average_fatigue_score
- safety_score
- gps_route_summary
- event_log

## Next implementation step

Add a fatigueScore variable to app.html and update it every frame. Keep the existing alert logic as backup until the new system is tested.
