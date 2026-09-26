-- Server-only create/resend transaction. The fleet row serializes every
-- invitation writer for an owner, including quota and duplicate checks.
create or replace function public.create_fleet_invitation(
  p_fleet_id uuid,
  p_owner_user_id uuid,
  p_owner_email text,
  p_email text,
  p_token_hash text,
  p_replace_invitation_id uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  previous public.fleet_invitations%rowtype;
  invitation public.fleet_invitations%rowtype;
  email_value text;
  current_time_value timestamptz;
begin
  perform 1 from public.fleets
  where id = p_fleet_id and owner_user_id = p_owner_user_id
  -- Serialize writers without blocking acceptance's foreign-key KEY SHARE
  -- check, which follows its existing invitation-row lock.
  for no key update;
  if not found then
    raise exception using errcode = 'P0001', message = 'fleet_not_found';
  end if;

  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'invalid_invitation';
  end if;
  if p_replace_invitation_id is not null then
    select * into previous from public.fleet_invitations
    where id = p_replace_invitation_id and fleet_id = p_fleet_id
    for update;
    current_time_value := clock_timestamp();
    if not found or previous.accepted_at is not null or previous.revoked_at is not null or previous.expires_at <= current_time_value then
      raise exception using errcode = 'P0001', message = 'invitation_not_found';
    end if;
    if previous.created_at > current_time_value - interval '1 minute' then
      raise exception using errcode = 'P0001', message = 'resend_too_soon';
    end if;
    email_value := lower(trim(previous.email));
  else
    current_time_value := clock_timestamp();
    email_value := lower(trim(p_email));
  end if;

  if email_value is null or length(email_value) > 240 or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode = 'P0001', message = 'invalid_email';
  end if;
  if email_value = lower(trim(p_owner_email)) then
    raise exception using errcode = 'P0001', message = 'cannot_invite_self';
  end if;
  if exists (select 1 from public.fleet_invitations
    where fleet_id = p_fleet_id and lower(trim(email)) = email_value
      and accepted_at is null and revoked_at is null and expires_at > current_time_value
      and (p_replace_invitation_id is null or id <> p_replace_invitation_id)) then
    raise exception using errcode = 'P0001', message = 'active_invitation_exists';
  end if;
  if p_replace_invitation_id is null and (select count(*) from public.fleet_invitations
    where fleet_id = p_fleet_id and accepted_at is null and revoked_at is null and expires_at > current_time_value) >= 100 then
    raise exception using errcode = 'P0001', message = 'too_many_pending_invitations';
  end if;
  if (select count(*) from public.fleet_invitations
    where fleet_id = p_fleet_id and created_at > current_time_value - interval '1 hour') >= 20 then
    raise exception using errcode = 'P0001', message = 'invitation_rate_limited';
  end if;

  insert into public.fleet_invitations(fleet_id, email, token_hash, invited_by, expires_at, created_at)
  values(p_fleet_id, email_value, p_token_hash, p_owner_user_id, current_time_value + interval '7 days', current_time_value)
  returning * into invitation;
  if p_replace_invitation_id is not null then
    update public.fleet_invitations set revoked_at = current_time_value where id = previous.id;
  end if;
  -- A failed insert or revoke rolls back the entire function call. Raw tokens
  -- remain in the API only; even the service-only RPC returns no token hash.
  return jsonb_build_object('id', invitation.id, 'email', invitation.email, 'expires_at', invitation.expires_at);
end;
$$;

revoke all on function public.create_fleet_invitation(uuid, uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.create_fleet_invitation(uuid, uuid, text, text, text, uuid) to service_role;
