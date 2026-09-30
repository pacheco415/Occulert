-- Keep detector provenance distinct from device labels. Existing rows remain
-- unknown; no platform or model version is inferred retroactively.
alter table public.sessions
  add column if not exists detector_pipeline text,
  add column if not exists detector_version text,
  add column if not exists app_version text;

comment on column public.sessions.detector_pipeline is
  'Client-reported detector family; operational provenance, not attested evidence.';
comment on column public.sessions.detector_version is
  'Client-reported scoring contract version; not a validated accuracy claim.';
comment on column public.sessions.app_version is
  'Client-reported website asset or native app build label.';
