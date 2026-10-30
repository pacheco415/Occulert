# Session revocation at sign-out

Web and native sign-out capture the session being ended and immediately clear
runtime authentication and cloud consent. Local cleanup is independent of the
server request. A later login is never replaced by the captured credentials.

The detached cleanup sends one bounded Supabase
`POST /auth/v1/logout?scope=local`, using that session's access token. If the
captured access token has expired, cleanup refreshes it once first, validates
the returned owner and lifetime, and uses the result only for revocation.
It does not save the refreshed credentials. Network errors and rejected
responses leave the client signed out; cleanup never retries automatically.

`scope=local` targets the captured session. Supabase revokes its refresh tokens;
already issued access JWTs can remain valid until their expiry. Offline local
sign-out cannot guarantee server revocation. See
[Supabase sign-out semantics](https://supabase.com/docs/guides/auth/signout).

The browser client uses `occulert-backend.v86.js`; retained published assets
remain immutable. Native source changes require a new binary and are not in
TestFlight 1.0.0 (58).

## Verification

`scripts/test-backend-client.mjs` and `scripts/test-native-cloud-sync.mjs`
execute the actual clients with controlled storage and network adapters. Cases
cover immediate local invalidation, exact logout scope, expired refresh,
account replacement, failed storage, malformed responses, offline requests and
deadlines for both response headers and bodies. Token values in these fixtures
are synthetic.

Live acceptance requires a dedicated, freshly signed-in test session. Verify
the deployed asset, demonstrate that session's refresh token works, adopt its
rotated result, sign out through the application and confirm the active
pre-sign-out refresh token is rejected. Keep credentials in memory and record
only statuses and source hashes. Automated fixtures alone do not establish
production revocation or native device acceptance.
