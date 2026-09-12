-- Auth deletion and related cleanup commit together or roll back together.
-- Removing a fleet disconnects other members; their personal history survives.
begin;
alter table public.drivers drop constraint drivers_fleet_id_fkey,
  add constraint drivers_fleet_id_fkey foreign key (fleet_id) references public.fleets(id) on delete set null;
alter table public.sessions drop constraint sessions_fleet_id_fkey,
  add constraint sessions_fleet_id_fkey foreign key (fleet_id) references public.fleets(id) on delete set null;
alter table public.drivers drop constraint drivers_user_id_fkey,
  add constraint drivers_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.fleet_invitations drop constraint fleet_invitations_invited_by_fkey,
  add constraint fleet_invitations_invited_by_fkey foreign key (invited_by) references auth.users(id) on delete cascade;
alter table public.fleet_invitations drop constraint fleet_invitations_accepted_by_fkey,
  add constraint fleet_invitations_accepted_by_fkey foreign key (accepted_by) references auth.users(id) on delete cascade;
alter table public.fleets drop constraint fleets_owner_user_id_fkey,
  add constraint fleets_owner_user_id_fkey foreign key (owner_user_id) references auth.users(id) on delete cascade;
commit;
