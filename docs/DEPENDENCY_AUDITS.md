# Dependency audit evidence

Run `node scripts/report-dependency-audits.mjs` with Node 24. The report directory contains separate site, full native and native production dependency-tree JSON reports, plus a receipt recording source revision, lockfile hashes, time and Node/npm versions. CI retains these for 14 days and checks weekly and after relevant dependency changes. An unavailable registry or malformed audit response fails the reporting job; existing vulnerability findings remain visible without misrepresenting the report as clean.

On October 3, 2026 the current locks report zero site findings and 22 native high-severity affected-package entries. The native entries reduce to two underlying advisories propagated through the Expo dependency graph:

- `braces`: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), affected through 3.0.3; no patched version published.
- `node-forge`: [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv), affected through 1.4.0; no patched version published.

At that check the npm registry published 3.0.3 and 1.4.0 as latest. Do not invent an override to a nonexistent patch or accept npm's suggested downgrade from Expo 57 to Expo 44. Existing patched brace-expansion releases are already in the lockfile. Recheck these two upstream advisories before changing their overrides, then run native verification and the EAS npm 10.9.8 installation check.

`--omit=dev` still reports the same 22 native entries because Expo's dependency graph includes CLI/build packages under production dependencies. This flag does not prove which modules ship in an iOS or Android bundle. Bundle reachability and exploitability require separate evidence; do not describe these results as a clean native runtime audit.

On October 19, 2026, a scoped `react-devtools-core` override updates its
`shell-quote` dependency from 1.10.0 to the published same-major 1.12.0 release.
This removes the critical [GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv)
finding. The native compatibility suite exercises the dependency resolved by
React DevTools: ordinary quoted arguments round-trip, and strings containing
LF, CR, U+2028 or U+2029 after a comment token throw instead of producing shell
input. The test does not execute the quoted input.

The isolated shell-quoting change on base `d0bfb02` was checked with Node
24.19.0 and npm 10.9.8. `npm ci --include=dev` succeeded. Both the full native
and `--omit=dev` audits reported zero critical and 22 high-severity
affected-package entries, with no `shell-quote` finding. Those entries covered
three advisories: the `braces` and `node-forge` advisories above, plus
`source-map-js` [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
Native `verify` stopped at the pre-existing Expo patch-version compatibility
drift. Its remaining steps passed separately: typecheck, seven dependency
compatibility tests, four audio lifecycle tests and 12 History interaction tests.

The final shell-quoting branch includes the separate Expo SDK 57 patch update
`7d4a204` as a prerequisite. On October 19, the composed changes passed a clean
`npm ci --include=dev && npm run verify` with Node 24.19.0 and npm 10.9.8,
including the online Expo dependency check, typecheck and all 23 tests. Both
postinstall patches applied on the clean installation. The full native audit
reported zero critical and 21 high-severity affected-package entries, with no
`shell-quote` or `source-map-js` finding. Only the `braces` and `node-forge`
advisories remained; the audit exited 1 for those high-severity findings.

On October 20, 2026, the shell-quoting branch was refreshed against main
`9600145`, then documentation-only main `083d6a1`. The latter merge left native
and root source/configuration unchanged. The native manifest, lockfile and test bytes
are unchanged from `a119922`. A fresh clean `npm ci --include=dev && npm run verify`
passed with Node 24.19.0 and npm 10.9.8, including the online Expo dependency
check, typecheck and all 23 tests. Both postinstall patches applied. Fresh full
native and `--omit=dev` audits each reported zero critical and 21 high-severity
affected-package entries, with no `shell-quote` finding. The only underlying
advisories remained `braces` and `node-forge`; both audit commands exited 1.
This confirms the npm 10.9.8 installation and source checks, not a native build
or physical-device result.

Keep build tooling on trusted source/configuration and the development server private. These constraints reduce exposure; they are not a claim that upstream vulnerabilities have been repaired.
