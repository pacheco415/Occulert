# Owned Supabase browser SDK

The current loader uses `vendor/supabase-2.112.3.js`, copied without modification from `package/dist/umd/supabase.js` in the npm package `@supabase/supabase-js@2.112.3`. The package tarball integrity, SHA-256, original bundle SHA-256 and SDK SHA-384/SRI used by the loader are recorded in `vendor/supabase-2.112.3/upstream.json`. Its MIT license and notices from the installed runtime dependency tree (MIT/0BSD) are retained beside that manifest. The collected tree may include dependencies that are not embedded in the browser bundle.

The new immutable loader uses only owned static bytes, sets SRI and preserves bounded failure/retry behavior. New account pages need no SDK CDN connection. SDK/auth scripts remain network-only in the service worker; this does not claim offline authentication or queue credentials. Supabase authentication still contacts the configured Supabase service.

The original loader (`supabase-loader.v47.js`), its `/vendor/supabase-2.112.3.min.js` proxy route and the jsDelivr script and connection allowance were retired on November 12, 2026, 39 days after the owned loader replaced them and well past the 14-day retention window. No HTML page referenced the old loader. Do not restore a public CDN to the script policy: such a host serves anyone's uploads, so allowing it lets injected markup run arbitrary script.

Updates must review upstream licenses, copy a new package version, record fresh original-file hashes/SRI, release a new loader and pass actual browser account/SDK checks. A dependency version is not a security attestation.
