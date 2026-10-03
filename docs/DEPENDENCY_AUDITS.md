# Dependency audit evidence

Run `node scripts/report-dependency-audits.mjs` with Node 24. The report directory contains separate site, full native and native production dependency-tree JSON reports, plus a receipt recording source revision, lockfile hashes, time and Node/npm versions. CI retains these for 14 days and checks weekly and after relevant dependency changes. An unavailable registry or malformed audit response fails the reporting job; existing vulnerability findings remain visible without misrepresenting the report as clean.

On October 3, 2026 the current locks report zero site findings and 22 native high-severity affected-package entries. The native entries reduce to two underlying advisories propagated through the Expo dependency graph:

- `braces`: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), affected through 3.0.3; no patched version published.
- `node-forge`: [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv), affected through 1.4.0; no patched version published.

The npm registry currently publishes 3.0.3 and 1.4.0 as latest. Do not invent an override to a nonexistent patch or accept npm's suggested downgrade from Expo 57 to Expo 44. Existing patched brace-expansion releases are already in the lockfile. Recheck these two upstream advisories before changing overrides, then run native verification and the EAS npm 10.9.8 installation check.

`--omit=dev` still reports the same 22 native entries because Expo's dependency graph includes CLI/build packages under production dependencies. This flag does not prove which modules ship in an iOS or Android bundle. Bundle reachability and exploitability require separate evidence; do not describe these results as a clean native runtime audit.

Keep build tooling on trusted source/configuration and the development server private. These constraints reduce exposure; they are not a claim that upstream vulnerabilities have been repaired.
