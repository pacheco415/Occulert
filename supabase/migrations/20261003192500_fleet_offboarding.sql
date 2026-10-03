-- Apply before enabling OCCULERT_FLEET_OFFBOARDING_ENABLED.
create table public.fleet_membership_removals (
  id uuid primary key default gen_random_uuid(),
  fleet_id uuid not null references public.fleets(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  removed_at timestamptz not null default now(),
  removed_by uuid references auth.users(id) on delete set null,
  reason text not null check (reason in ('owner_removed','driver_left'))
);
alter table public.fleet_membership_removals enable row level security;
revoke all on public.fleet_membership_removals from public, anon, authenticated;

create or replace function public.remove_fleet_driver(p_owner_user_id uuid,p_driver_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare target_fleet uuid; target_driver public.drivers%rowtype;
begin
  select id into target_fleet from public.fleets where owner_user_id=p_owner_user_id;
  if not found then return jsonb_build_object('error','fleet_not_found'); end if;
  select * into target_driver from public.drivers where id=p_driver_id and fleet_id=target_fleet for update;
  if not found then return jsonb_build_object('error','driver_not_found'); end if;
  update public.drivers set fleet_id=null where id=target_driver.id;
  insert into public.fleet_membership_removals(fleet_id,driver_id,removed_by,reason) values(target_fleet,target_driver.id,p_owner_user_id,'owner_removed');
  return jsonb_build_object('removed',true,'driver_id',target_driver.id);
end;$$;

create or replace function public.leave_fleet(p_user_id uuid,p_expected_fleet_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare target_driver public.drivers%rowtype;
begin
  select * into target_driver from public.drivers where user_id=p_user_id for update;
  if not found then return jsonb_build_object('error','driver_profile_not_found'); end if;
  if target_driver.fleet_id is null then return jsonb_build_object('left',false); end if;
  if p_expected_fleet_id is null or target_driver.fleet_id<>p_expected_fleet_id then return jsonb_build_object('error','membership_changed'); end if;
  update public.drivers set fleet_id=null where id=target_driver.id;
  insert into public.fleet_membership_removals(fleet_id,driver_id,removed_by,reason) values(target_driver.fleet_id,target_driver.id,p_user_id,'driver_left');
  return jsonb_build_object('left',true,'driver_id',target_driver.id);
end;$$;
revoke all on function public.remove_fleet_driver(uuid,uuid) from public,anon,authenticated;
revoke all on function public.leave_fleet(uuid,uuid) from public,anon,authenticated;
grant execute on function public.remove_fleet_driver(uuid,uuid) to service_role;
grant execute on function public.leave_fleet(uuid,uuid) to service_role;
