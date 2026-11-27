-- Record how Meta verified the callback so workspace-specific and
-- single-workspace legacy verification are distinguishable in the audit UI.
alter table public.meta_integrations
  add column if not exists webhook_verification_source text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.meta_integrations'::regclass
      and conname = 'meta_integrations_webhook_verification_source_check'
  ) then
    alter table public.meta_integrations
      add constraint meta_integrations_webhook_verification_source_check
      check (
        webhook_verification_source is null
        or webhook_verification_source in ('workspace_token', 'platform_legacy_token')
      );
  end if;
end;
$$;

comment on column public.meta_integrations.webhook_verification_source is
  'Token source used for the last successful Meta GET callback verification handshake.';
