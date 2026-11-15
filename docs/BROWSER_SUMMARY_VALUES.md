# Browser History summary values

History cards, score bars, totals and CSV use the same count, score and date validators. Counts must be nonnegative safe integers; percentages and scores must be finite and between zero and 100. Legacy numeric strings remain accepted. Missing, blank, boolean, fractional-count and invalid values stay unknown. Genuine zero stays zero. Aggregates with some missing counts say “partial”; an aggregate with no recorded counts shows `--`. CSV uses empty cells for unknown values.

Dates require a valid ISO calendar date and timezone. Invalid or absent dates show “Not recorded” and export as empty cells. A strict `recoveredInterrupted: true` flag identifies a partial session; no missing completion flag is treated as evidence of a completed drive. Display formatting does not rewrite any saved measurement, date, partial flag or unknown field. The separate versioned-history migration adds only version and stable record identity metadata.

The browser history migration originally prepared in PR #228 is included. Existing CSV spreadsheet-formula escaping and user-triggered sharing remain in place. It does not calculate a new safety score or establish detection accuracy.

Unknown safety scores have a hidden, zero-width bar; genuine numeric zero and numeric-string zero retain a recorded zero-width bar. Invalid stored values remain unchanged.

## Local eye coverage

New browser session records include `eyeCoverage: { detectedMs, monitoredMs,
percent }`. The Session Report adds the localized line “Eyes detected: NN% of
session.” A missing, invalid or null percentage displays “Eyes detected:
Unknown”; old records are not backfilled with zero. A genuine measured zero
remains zero. A session with no eligible monitoring duration stores a null
percentage, including a session stopped during calibration.

The accounting clock is `performance.now()`. The denominator is elapsed running
time after calibration, excluding every calibration/recalibration interval.
The numerator holds the most recent raw `hasFace && hasGoodEAR` observation
until the next observation, stop, or the existing six-second detector result
timeout, whichever comes first. A fresh negative observation ends detected
time immediately; a missing callback cannot keep it increasing indefinitely.
This convention estimates elapsed coverage from discrete observations; it is
not a frame-count percentage or a detection-accuracy measurement. A closed eye
with a valid EAR signal can still be detected. Existing detection thresholds,
scores, alerts and the delayed tracking badge do not change.

Stopping freezes the totals before camera/cloud teardown; restarting creates
new totals. Foreground loss and camera/detector failure use the same stop
boundary. Invalid or backward monotonic timestamps do not add elapsed time.
The percentage is rounded to the nearest integer for display and storage.
The object is saved only with local browser history and is removed from the
legacy live-fleet snapshot. It is absent from cloud summaries, fleet payloads,
fleet views and existing CSV exports. No per-frame observations or media are
stored by this feature.
