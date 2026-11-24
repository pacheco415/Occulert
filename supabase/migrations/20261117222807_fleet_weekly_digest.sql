-- Apply before deploying fleet digest preferences. No sending job is enabled here.
set local lock_timeout = '3s';

create table public.fleet_digest_preferences (
  fleet_id uuid primary key references public.fleets(id) on delete cascade,
  weekly_enabled boolean not null default false,
  unsubscribe_token_hash text unique,
  updated_at timestamptz not null default now(),
  check ((weekly_enabled and unsubscribe_token_hash is not null and unsubscribe_token_hash ~ '^[0-9a-f]{64}$')
      or (not weekly_enabled and unsubscribe_token_hash is null))
);
alter table public.fleet_digest_preferences enable row level security;
revoke all on public.fleet_digest_preferences from public, anon, authenticated;
grant select, insert, update, delete on public.fleet_digest_preferences to service_role;

create table public.fleet_digest_sends (
  fleet_id uuid not null references public.fleets(id) on delete cascade,
  iso_week date not null check (extract(isodow from iso_week) = 1),
  outcome text not null check (outcome in ('pending', 'sent', 'skipped', 'failed', 'unknown')),
  created_at timestamptz not null default now(),
  primary key (fleet_id, iso_week)
);
alter table public.fleet_digest_sends enable row level security;
revoke all on public.fleet_digest_sends from public, anon, authenticated;
grant select, insert, update, delete on public.fleet_digest_sends to service_role;

-- Recheck the verified actor under the same transaction as the write. The parent
-- lock serializes ownership changes/deletion with setting this fleet's preference.
create function public.set_fleet_digest_preference(p_actor_id uuid, p_fleet_id uuid,
  p_enabled boolean, p_token_hash text)
returns boolean language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
begin
  perform 1 from public.fleets where id = p_fleet_id and owner_user_id = p_actor_id for share;
  if not found then return null; end if;
  insert into public.fleet_digest_preferences(fleet_id, weekly_enabled, unsubscribe_token_hash)
    values (p_fleet_id, p_enabled, p_token_hash)
    on conflict (fleet_id) do update set weekly_enabled = excluded.weekly_enabled,
      unsubscribe_token_hash = excluded.unsubscribe_token_hash, updated_at = clock_timestamp();
  return p_enabled;
end;
$$;
revoke all on function public.set_fleet_digest_preference(uuid,uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.set_fleet_digest_preference(uuid,uuid,boolean,text) to service_role;
