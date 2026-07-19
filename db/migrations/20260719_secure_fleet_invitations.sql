-- Existing-project migration: secure manager-owned fleets and one-time driver
-- invitations. Review before applying in the Supabase SQL editor.

create unique index if not exists fleets_owner_user_id_unique
on public.fleets(owner_user_id);

create table if not exists public.fleet_invitations (
  id uuid primary key default gen_random_uuid(),
  fleet_id uuid not null references public.fleets(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists fleet_invitations_fleet_created_idx
on public.fleet_invitations(fleet_id, created_at desc);

alter table public.fleet_invitations enable row level security;

-- No direct browser policies. Invitation access is through the service-role
-- APIs, which first verify the authenticated manager or invited driver.

create or replace function public.accept_fleet_invitation(
  p_token_hash text,
  p_user_id uuid,
  p_user_email text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  invitation public.fleet_invitations%rowtype;
  driver_record public.drivers%rowtype;
  fleet_name text;
begin
  if p_token_hash is null or p_user_id is null or nullif(trim(p_user_email), '') is null then
    raise exception using errcode = 'P0001', message = 'invalid_invitation';
  end if;

  select * into invitation
  from public.fleet_invitations
  where token_hash = p_token_hash
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'invalid_invitation';
  end if;
  if invitation.accepted_at is not null then
    raise exception using errcode = 'P0001', message = 'invitation_already_used';
  end if;
  if invitation.revoked_at is not null then
    raise exception using errcode = 'P0001', message = 'invitation_revoked';
  end if;
  if invitation.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'invitation_expired';
  end if;
  if lower(trim(invitation.email)) <> lower(trim(p_user_email)) then
    raise exception using errcode = 'P0001', message = 'invitation_email_mismatch';
  end if;

  select * into driver_record
  from public.drivers
  where user_id = p_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'driver_profile_required';
  end if;
  if driver_record.fleet_id is not null and driver_record.fleet_id <> invitation.fleet_id then
    raise exception using errcode = 'P0001', message = 'driver_already_assigned';
  end if;

  update public.drivers
  set fleet_id = invitation.fleet_id
  where id = driver_record.id;

  update public.fleet_invitations
  set accepted_at = now(), accepted_by = p_user_id
  where id = invitation.id;

  select company_name into fleet_name
  from public.fleets
  where id = invitation.fleet_id;

  return jsonb_build_object(
    'fleet_id', invitation.fleet_id,
    'company_name', fleet_name,
    'driver_id', driver_record.id
  );
end;
$$;

revoke all on function public.accept_fleet_invitation(text, uuid, text) from public;
revoke all on function public.accept_fleet_invitation(text, uuid, text) from anon;
revoke all on function public.accept_fleet_invitation(text, uuid, text) from authenticated;
grant execute on function public.accept_fleet_invitation(text, uuid, text) to service_role;
