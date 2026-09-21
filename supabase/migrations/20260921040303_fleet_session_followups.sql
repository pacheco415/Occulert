-- Session-scoped manager outcomes. No free text or health data is collected.
create table public.fleet_session_followups (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  status text not null check (status in ('open', 'in_progress', 'reviewed')),
  version integer not null default 1 check (version > 0),
  updated_by uuid not null references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now()
);
create index fleet_session_followups_updated_by_idx on public.fleet_session_followups(updated_by);
alter table public.fleet_session_followups enable row level security;
revoke all on public.fleet_session_followups from public, anon, authenticated;
grant select, insert, update on public.fleet_session_followups to service_role;

-- Server-only, invoker rights. Ownership is verified again while holding locks
-- so a session/fleet reassignment cannot race a manager save.
create function public.save_fleet_session_followup(
  p_actor_id uuid, p_session_id uuid, p_status text, p_expected_version integer
) returns setof public.fleet_session_followups
language plpgsql security invoker set search_path = '' as $$
begin
  if p_status is null or p_status not in ('open', 'in_progress', 'reviewed')
     or p_expected_version is null or p_expected_version < 0 then
    raise exception 'Invalid follow-up' using errcode = '22023';
  end if;
  perform s.id from public.sessions s
    join public.fleets f on f.id = s.fleet_id
    where s.id = p_session_id and f.owner_user_id = p_actor_id
    for update of s for share of f;
  if not found then
    raise exception 'Session not found' using errcode = 'P0002';
  end if;
  if p_expected_version = 0 then
    return query insert into public.fleet_session_followups(session_id, status, updated_by)
      values (p_session_id, p_status, p_actor_id)
      on conflict (session_id) do nothing returning *;
  else
    return query update public.fleet_session_followups
      set status = p_status, updated_by = p_actor_id, updated_at = now(), version = version + 1
      where session_id = p_session_id and version = p_expected_version
      returning *;
  end if;
end;
$$;
revoke all on function public.save_fleet_session_followup(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.save_fleet_session_followup(uuid, uuid, text, integer) to service_role;
