# Released scoring oracle fixture

`driver-app-v97.js` is a test-only, byte-for-byte copy of the immutable public
`driver-app.v97.js` introduced by commit
`46d61ef1dbc1b1b08ee0c8d646540c0c862d89ee`.

Its verified SHA-256 is:

```text
189085296fa05f9be1bb3cc3bf3c5949b3abc3a892e898d1290c780760c69cb4
```

The oracle checks this constant before independently parsing/executing the prior
released scoring functions. The fixture is never modified to match the new core.
It depends on neither the public root URL nor its current integrity entry, so
ordinary immutable-asset retirement can remove those after their grace period.
The existing deployment exclusion covers `benchmark/`; no worker list references
this fixture. It is not an application runtime/compiler input.
