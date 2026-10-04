# Root verification

Use Node 24 and run `npm ci && npm run verify` as required by
[RELEASING.md](../RELEASING.md). The verification runner reads
`scripts/verify-steps.json` and executes its npm scripts sequentially. It retains
each script's existing Node flags and npm lifecycle behavior, prints each
script's output, and reports pass/fail status and elapsed time in a final table.
Any failed or unlaunchable step makes the final exit status nonzero; subsequent
steps still run so one failure does not hide the rest of the results.

The conversion preserved all **64 original npm steps**, in their original
order, without changing their script commands. The manifest separately lists
**one additional runner self-check**, which runs after those 64 steps. The new
total is therefore 65 commands: 64 existing checks plus the runner/coverage
tests. Multi-command npm scripts retain their original internal `&&` behavior.

When adding a root `test:*` or `audit:*` script, add its name on a new line in
`steps`. If it requires a separate environment, add an `excluded` entry with a
specific reason and retain its separate CI job. Verification refuses missing,
duplicate, recursive, or undocumented script entries before running any check.

The existing separate checks remain:

- `test:browser`: Browser Smoke Tests installs Playwright browser engines and
  runs browser integration tests with their own server.
- `test:watch-notification`: Native App Typecheck runs the Swift callback
  harness on macOS; portable root verification does not require `swiftc`.

`audit:site` continues importing the asset, retired-asset, and MediaPipe audits.
This change does not alter the browser or native verification commands, test
thresholds, retries, deployment settings, or product assets.
