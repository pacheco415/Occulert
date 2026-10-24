# Recent sign-in for account security changes

Changing the password, adding a passkey and removing a passkey on
`account.html` now need a sign-in from the last 10 minutes. Account deletion
already had this rule on the server (`api/_lib/recent-auth.js`).

## How the check works

`account-page-2` reads the stored access token's `amr` claim and accepts it
when an entry has a known sign-in method and a timestamp no more than 600
seconds old and not in the future. The token must belong to the signed-in
user, have the `authenticated` role and not be anonymous. The methods are the
deletion route's list plus `recovery`, because a password reset link is itself
a fresh sign-in by email and must be able to set the new password. A token
refresh (`token_refresh`) does not count.

Without a recent sign-in the page shows **Confirm your sign-in** in the
security card and sends nothing. The person signs in again with their password
or a passkey, or cancels. The action then runs once, as long as the same account
is still signed in. If the browser's account changes while the prompt is open,
the prompt closes and nothing is sent.

The change-password form also has an optional **Current password** field. When
it is filled, the page signs in with it first (so a wrong password changes
nothing) and sends it to Supabase as `current_password`. A password typed in the
re-auth step is sent the same way. People who use a reset link or a passkey
leave it blank.

## Limits

This is a browser check. It stops someone using an unattended signed-in
browser, such as the fleet TV display. It does not stop someone who has copied
an access token. The Supabase Auth settings below cover that case.

## Supabase settings to turn on

In the Supabase dashboard, Authentication → Providers → Email (names may differ
slightly):

- **Secure password change**: a password change needs a sign-in within 24
  hours or a reauthentication code.
- **Require current password when updating**: Supabase checks
  `current_password`. After turning it on, test a full password reset from the
  login page. If Supabase refuses the reset without a current password, turn
  it off again and keep only the browser check.
- **Minimum password length: 8**, to match the Account form.

New passwords are only set on `account.html`. Sign-up is passwordless, so the
sign-in fields on `login.html` and `accept-invite.html` keep accepting existing
6- and 7-character passwords.
