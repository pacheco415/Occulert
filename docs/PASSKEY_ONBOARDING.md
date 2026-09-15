# Passwordless profile onboarding

## User flow

1. On Login, choose Create Account and enter name and email. Fleet/vehicle details are optional. No password is requested.
2. Supabase sends a confirmation/sign-in link. The page identifies successful submission without claiming an account already exists or that email arrived.
3. The link returns to `/login.html?enroll=passkey`. The fragment is removed before asynchronous processing. The SDK restores the session and Auth's `getUser` verifies identity and confirmed email before Occulert adopts it.
4. A driver profile is saved through the existing authenticated `/api/profile` endpoint. Display metadata never authorizes fleet access. Selecting fleet manager reveals a separate fleet setup link; actual ownership is verified by the server.
5. The user explicitly chooses Create passkey. Cancellation allows retry or continuation with email. Unsupported browsers retain the email path. Partial profile-sync failure has its own retry button and does not prevent secure passkey enrollment.
6. Return visits can use passkey sign-in or an email link. Email-link sign-in uses `shouldCreateUser: false`; signup uses `true`. Existing password login remains available. Passkey sign-in on a new browser uses the verified user's display metadata rather than another user's cached profile.

## Implementation boundaries

- Uses pinned Supabase SDK 2.112.3; passkeys remain experimental in that SDK. No custom WebAuthn verification, password generation, anonymous accounts, or auto-confirmed email.
- Requests use the browser's existing public Supabase config. No service-role keys or new database policies.
- Client email throttling is a convenience; server Auth rate limits remain authoritative. Nothing automatically resends email.
- Existing immutable JS URLs are retained unchanged. New onboarding, passkey, auth-helper and login scripts use v49 URLs.
- Role-like metadata is only onboarding intent, never authorization. Server fleet checks remain authoritative.

## Acceptance before production release

Local browser tests simulate the SDK auth responses; they do not prove real email delivery or device credentials. Verify on the production-approved domain with a consenting test account:

- Auth email signup is enabled and email confirmation is required (public settings checked during development).
- Redirect allowlist permits `https://www.occulert.com/login.html?enroll=passkey` and `/login.html`; the existing email template contains a confirmation link. This change does not modify production templates or settings.
- New email -> received link -> correct profile -> Face ID/Touch ID or Android passkey prompt -> sign out -> passkey sign-in.
- Email-link recovery, expired links and cancelled device prompts work. Confirm on iOS Safari and Android Chrome.
- Keep the existing relying-party ID unchanged to preserve existing passkeys. A generic Vercel preview domain may not be approved for passkeys.
