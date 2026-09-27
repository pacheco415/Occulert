# Saved session summary values

Prepared September 26, 2026 on `development/history-summary-values`, based on
approved native source `1eb90f16a4083be07d6a73db217c473ee344d390`. All tests,
type checks and browser/device runs are deferred at the user's request. This is
source preparation for a future binary; TestFlight 1.0.0 (52) is unchanged.

## Concrete repair

Saved history accepts legacy records without requiring every numeric field.
The earlier History duration label turned an absent or negative duration into
`0:00`, while shared summaries turned invalid or absent duration into `0m 0s`.
The earlier fatigue label rounded any non-null value, allowing coerced strings,
booleans, out-of-range numbers or malformed values to appear as a recorded score.

A shared read-only formatter now validates these two fields before display:

- Duration requires an actual finite number from zero through
  `Number.MAX_SAFE_INTEGER` seconds. Fractional seconds are floored once to
  whole elapsed seconds. History uses total minutes and two-digit seconds;
  shared summaries use the same elapsed value with minute/second units.
- Average fatigue requires an actual finite number from 0 through 100 and
  retains the existing nearest-integer display.
- Missing, negative, unsupported or invalid values display `Not recorded`.
  Numeric strings, booleans, arrays and objects are not measurements.
  A valid stored numeric zero remains `0:00`, `0m 0s` or `0`, as applicable.

The same validation applies to each saved-session card and deliberately shared
session summary. The existing strict alert-count formatter remains in use.
Nothing is inferred from a missing value, and valid zeros are not relabeled.

## Boundaries

Formatting never changes saved records, history schema, indices, review filters,
edit/delete identities, sharing selection, monitoring, detection, alert delivery,
recovery, cloud sync, consent, backend or website behavior. Existing aggregate
fusion-duration display keeps its scope and formatter. Dates, sensitivity,
assessment labels and the export privacy allowlist are unchanged.

Source inspection is the only review performed. No tests, type checks, source
execution, browser/device runs, builds, submissions or billing changes are
included. Commit skip markers keep automated testing deferred without changing
ordinary workflow settings. Record the actual selected source and binary
identity when the approved next native build can be prepared.
