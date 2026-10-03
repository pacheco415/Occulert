# Atomic event ingestion gate

Apply and verify `supabase/migrations/20261003192000_atomic_event_quotas.sql` before setting the server-only `OCCULERT_EVENT_LIMITS_ENABLED=true`. The flag defaults off. Production database authentication was unavailable during development; activation and live migration application are not claimed.

The service-role-only transaction verifies session ownership, locks a per-user one-minute bucket and then the session, rejects events more than two minutes after completion, bounds event timestamps, caps each session at 500 saved events and shares a 60-event burst budget across the user's sessions. Rejected events do not consume saved-event allowance. Session finalization locks the same row through UPDATE, so the transaction rechecks current completion state instead of trusting an earlier API read. All event writers must use this gated route for quotas to cover every write.

The rate table has RLS, no client policies or grants, and account deletion cascades its user bucket. The function has a fixed search path and revoked public/client execution. Event success keeps the existing response shape. Quota failures return 429; ended sessions return 409. This gate changes ingestion limits, not fatigue thresholds. PGlite regressions exercise SQL boundaries and tenant denial but do not claim multi-connection production concurrency stress evidence.
