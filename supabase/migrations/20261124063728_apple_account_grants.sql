-- The server encrypts Apple refresh tokens before writing them. Account deletion
-- revokes the grant first, then the Auth transaction cascades this row.
create table public.apple_account_grants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sealed_token text not null check (length(sealed_token) between 40 and 12000)
);
alter table public.apple_account_grants enable row level security;
revoke all on public.apple_account_grants from public, anon, authenticated, service_role;
grant select, insert, update on public.apple_account_grants to service_role;
