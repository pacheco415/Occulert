# Production migration coverage

`node scripts/check-migration-readiness.mjs` inventories the checked-in schema and ten migrations, prints their SHA-256 hashes and a read-only ledger query, and exits 2 because production has not been verified. It does not connect to Supabase, use credentials, execute SQL or apply migrations.

Export `select version::text from supabase_migrations.schema_migrations order by version;` as a JSON array of objects such as `[{"version":"20260927010000"}]`, then run `node scripts/check-migration-readiness.mjs path/to/ledger.json`. Exit 1 means required Supabase versions are missing; exit 2 means malformed/unavailable evidence; exit 0 means all required versions are recorded.

The September 27 period-report/billing migrations and September 29 webhook migration are included. `db/schema.sql` and the two legacy `db/migrations` files are listed separately because they are not represented by the 14-digit Supabase ledger. A successful comparison proves ledger coverage only, not identical deployed definitions or that the legacy baseline was applied. Verify deployed definitions, RLS and service-role grants before consolidating migrations or activating dependent features. Do not recreate deployed objects merely because legacy files have no ledger entries.

On October 3, 2026, production database authentication failed during the read-only check. Production migration application remains unverified. The isolated full replay and tenant tests are separate evidence and cannot substitute for the live ledger.
