set local lock_timeout = '3s';
create table public.fleet_paid_access_cache (
  fleet_id uuid not null references public.fleets(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  policy_tag text not null,
  paid boolean not null,
  valid_until timestamptz not null,
  primary key (fleet_id, owner_id)
);
alter table public.fleet_paid_access_cache enable row level security;
revoke all on public.fleet_paid_access_cache from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.fleet_paid_access_cache to service_role;
