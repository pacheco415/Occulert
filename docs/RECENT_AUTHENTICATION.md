# Recent authentication for permanent account deletion

DELETE /api/account verifies the bearer token with Supabase before interpreting that same token's session and authentication-method claims. It requires a known credential method timestamp within ten minutes, a session UUID and a subject matching the verified user. Token refresh, anonymous authentication, missing/malformed claims and future timestamps do not satisfy this gate. The global last_sign_in_at field and the token issue date do not establish freshness for the presented session.

Reference: https://supabase.com/docs/guides/auth/jwt-fields. The passkey sign-in flow issues a credential-authenticated session using PasskeyLogin in https://github.com/supabase/auth/blob/master/internal/api/passkey_authentication.go. Older/custom tokens lacking the required evidence must sign in again; the server fails closed.
