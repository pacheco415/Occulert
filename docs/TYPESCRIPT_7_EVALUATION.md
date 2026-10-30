# TypeScript 7.0.2 evaluation

**Decision: no-go for directly replacing the supported TypeScript 6.0.3
dependencies.** The requested CLI checks pass, but the native Expo dependency
gate rejects 7.0.2 and the shared-source compiler guard needs the legacy
JavaScript compiler API. Do not merge Dependabot #263 directly.

## Environment and unchanged inputs

Evaluated October 28, 2026 (Pacific), from main
`282aba3258a8e5a8386a0cffd5affc1d4dab2b86`, on macOS `darwin arm64` with
Node `24.19.0` and npm `11.17.0`. Root and native baselines both resolve
TypeScript `6.0.3`. The candidate was exact `typescript@7.0.2` in both places;
both local `tsc --version` commands reported `Version 7.0.2`. Its installed
platform package was `@typescript/typescript-darwin-arm64@7.0.2`. Native uses
Expo `58.0.21` and Expo CLI `58.1.17`.

Both dependency trees started with clean installs. Source files, compiler
options and test assertions were unchanged. The candidate was installed only
in an isolated evaluation worktree. No engine code was copied from or changed
in the pending web adapter checkout.

## Requested checks and every new diagnostic

| Command and working directory | Supported 6.0.3 | Candidate 7.0.2 | New TypeScript diagnostics |
| --- | --- | --- | --- |
| Root: `npm run typecheck:source` (`tsc -p jsconfig.json`) | Exit 0 | Exit 0 | None |
| Root: `npm run test:event-outbox` | Exit 0, 35 tests passed | Exit 0, 35 tests passed | None |
| `native-app`: `npm run typecheck` (`tsc --noEmit`) | Exit 0 | Exit 0 | None |

The event-outbox command retains its exact compile step:

```sh
tsc --noEmit --strict --target ES2022 --module nodenext --moduleResolution nodenext lib/event-outbox.ts
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/test-event-outbox.mjs
```

There were no new compiler errors in those three checks. The two additional
compatibility failures below prevent a direct dependency upgrade.

## Native supported-version gate

With 7.0.2 installed, this command in `native-app` exited 1:

```sh
CI=1 EXPO_NO_TELEMETRY=1 EXPO_NO_DOTENV=1 npm run check:dependencies
# Runs expo install --check
```

Its version diagnostic was exactly:

```text
typescript@7.0.2 - expected version: ~6.0.3
Found outdated dependencies
```

The restored 6.0.3 setup passes the same online check. No package exclusion,
override or forced compatibility flag was added. Expo documents this CI check
as [immutable dependency validation](https://docs.expo.dev/more/expo-cli/#version-validation).

## Shared-source compiler API boundary

At the dated evaluation, the pending shared-TypeScript input guard in
`scripts/lib/driver-build.mjs` imports `typescript` and uses `createSourceFile`, `ScriptTarget`, `ScriptKind`,
`SyntaxKind`, `forEachChild` and declaration predicates to reject forbidden
dependencies in raw input, including type-only imports. Those checks must stay
enforced when compiling the shared event outbox.

The exact 7.0.2 package's root export is `./lib/version.cjs`. A direct runtime
probe returns version `7.0.2` but `undefined` for each of `createSourceFile`,
`ScriptTarget`, `ScriptKind`, `SyntaxKind` and `forEachChild`. This call, matching
that guard's API boundary, fails before parsing:

```js
import ts from 'typescript';
import { readFileSync } from 'node:fs';
ts.createSourceFile('lib/event-outbox.ts',
  readFileSync('lib/event-outbox.ts', 'utf8'),
  ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
```

```text
TypeError: Cannot read properties of undefined (reading 'ES2022')
```

The identical probe succeeds with 6.0.3 and zero parse diagnostics. The 7.0.2
package has unstable API subpaths; it does not expose the legacy API used by
this guard at the root import. See the [exact package metadata](https://registry.npmjs.org/typescript/7.0.2)
and Microsoft's [side-by-side compiler/API guidance](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).
A separate migration could evaluate a pinned TypeScript 6 API compatibility
package alongside the 7 CLI while preserving all syntax and dependency proofs.
That arrangement is not implemented or validated by this evaluation.

## Composed source follow-up

Follow-up base (October 29, 2026, Pacific): main
`49d936bd9d959d18ca66b2dbb4da45e5cce9c1a0`. PR
[#342](https://github.com/pacheco415/Occulert/pull/342) merged the shared-input
compiler guard described above; PR
[#349](https://github.com/pacheco415/Occulert/pull/349) added native monitor
source-owner tooling that also imports the legacy TypeScript JavaScript API.
Both `scripts/lib/driver-build.mjs` and
`native-app/scripts/lib/monitor-source-owners.mjs` call `createSourceFile` and
use `ScriptTarget`. The scoring hook guard added by PR
[#348](https://github.com/pacheco415/Occulert/pull/348) uses Acorn and
`eslint-scope`; it does not add another TypeScript API consumer.

The supported root and native compiler remains 6.0.3. All four dependency
files (`package.json` and `package-lock.json` in root and `native-app`) match
the follow-up main byte-for-byte. The candidate CLI checks and 35-test
results above remain evidence from the dated evaluation baseline. No new
7.0.2 run or complete API migration against the composed source is claimed.

## Final state

Both `package.json` / `package-lock.json` pairs were restored byte-for-byte to
the supported baseline. Clean root/native reinstalls, all three requested
checks, the 35 outbox tests, the legacy API probe and Expo's dependency check
passed again with 6.0.3. This result publishes documentation only: no dependency
update, asset release, native build, production changes or operational receipts.
