# Email link confirmation

Supabase email links (sign-in, signup confirmation and password reset) return a
complete session in the URL fragment. Anyone can copy those tokens from a link
for their own account and send the link to someone else. Without a check, the
receiving browser would be signed into the sender's account, replacing any
account already signed in there, and later opted-in drives would upload to it.

## Behavior

- Requesting an email link from this browser records a marker in
  `localStorage` (`occulert-auth-link-requests`): the kind (`recovery` or
  `signin`), the lowercased email and the time. Markers hold no secrets. Reset
  markers expire after one hour; sign-in and signup markers after 24 hours.
- After the existing fragment removal and Auth verification, a link is adopted
  without a prompt only when an unexpired marker of the same kind matches the
  verified email and nobody, or the same account, is signed in here.
- Every other link shows a confirmation naming the verified email. Tokens stay
  in memory until the person presses Continue. Cancel discards them and keeps
  the current account. Continue fails without changes if this browser's account
  changed while the confirmation was shown, including a replacement session for
  the same account. A link that expires during confirmation is rejected before
  its tokens can replace the current session.
- Markers are cleared after adoption and on sign-out, which also runs after
  account deletion.

A link opened on a different device or browser from the one that requested it
asks for confirmation once; that is expected.

## Limits

This keeps Supabase's implicit link flow. It stops silent account switching; it
does not stop a person who reads the confirmation and continues anyway. Moving
links to Supabase's PKCE flow would bind each link to the requesting browser,
at the cost of links failing when opened elsewhere.

Tests: `npm run test:auth-link-confirmation`, plus the prompt cases in
`scripts/test-login-auth.mjs` and `scripts/test-account-ui-races.mjs`.
