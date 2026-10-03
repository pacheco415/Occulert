# Browser History summary values

History cards, totals and CSV use the same count, score and date validators. Counts must be nonnegative safe integers; percentages and scores must be finite and between zero and 100. Legacy numeric strings remain accepted. Missing, blank, boolean, fractional-count and invalid values stay unknown. Genuine zero stays zero. Aggregates with some missing counts say “partial”; an aggregate with no recorded counts shows `--`. CSV uses empty cells for unknown values.

Dates require a valid ISO calendar date and timezone. Invalid or absent dates show “Not recorded” and export as empty cells. A strict `recoveredInterrupted: true` flag identifies a partial session; no missing completion flag is treated as evidence of a completed drive. Display formatting does not rewrite any saved measurement, date, partial flag or unknown field. The separate versioned-history migration adds only version and stable record identity metadata.

This change depends on the prepared browser history migration in PR #228. Existing CSV spreadsheet-formula escaping and user-triggered sharing remain in place. It does not calculate a new safety score or establish detection accuracy.
