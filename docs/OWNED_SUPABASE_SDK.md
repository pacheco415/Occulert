# Owned Supabase browser SDK

The current loader uses `vendor/supabase-2.112.3.js`, copied without modification from `package/dist/umd/supabase.js` in the npm package `@supabase/supabase-js@2.112.3`. The package tarball integrity, SHA-256, original bundle SHA-256 and SDK SHA-384/SRI used by the loader are recorded in `vendor/supabase-2.112.3/upstream.json`. Its MIT license and notices from the installed runtime dependency tree (MIT/0BSD) are retained beside that manifest. The collected tree may include dependencies that are not embedded in the browser bundle.

The new immutable loader uses only owned static bytes, sets SRI and preserves bounded failure/retry behavior. New account pages need no SDK CDN connection. SDK/auth scripts remain network-only in the service worker; this does not claim offline authentication or queue credentials. Supabase authentication still contacts the configured Supabase service.

Keep the old loader and `/vendor/supabase-2.112.3.min.js` proxy/fallback compatibility route for at least the release retention window. Those published bytes and their existing digest remain unchanged. Retire their CDN allowance only after checking retained references and the compatibility window; do not delete the fallback while older pages still need it.

Updates must review upstream licenses, copy a new package version, record fresh original-file hashes/SRI, release a new loader and pass actual browser account/SDK checks. A dependency version is not a security attestation.
