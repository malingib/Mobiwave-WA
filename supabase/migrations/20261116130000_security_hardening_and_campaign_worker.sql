-- Harden client-facing grants and route consent changes through an audited RPC.

-- API key metadata stays readable; the stored hash must not be selectable.
revoke select on public.tenant_api_keys from anon, authenticated;
revoke insert, update, delete on public.tenant_api_keys from anon, authenticated;
grant select (id, tenant_id, name, key_prefix, scopes, last_used_at, expires_at, revoked_at, created_by, created_at)
  on public.tenant_api_keys to authenticated;
grant update (revoked_at) on public.tenant_api_keys to authenticated;

-- Webhook configuration is read-only for clients; secrets stay with service code.
revoke select, insert, update, delete on public.tenant_webhooks from anon, authenticated;
grant select (id, tenant_id, name, endpoint_url, events, enabled, last_delivery_at, last_status, last_error, created_by, created_at, updated_at)
  on public.tenant_webhooks to authenticated;

-- Message history is written by the send and webhook services, never by clients.
drop policy if exists "agents can write messages" on public.messages;
revoke insert, update, delete on public.messages from anon, authenticated;

-- Consent changes must carry evidence and are audited by the existing trigger.
create or replace function public.record_contact_consent(
  p_tenant_id uuid,
  p_contact_id uuid,
  p_status text,
  p_source text
)
returns public.contacts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  updated_contact public.contacts;
begin
  if actor is null then
    raise exception 'Sign in is required.';
  end if;
  if p_status not in ('opted_in', 'opted_out') then
    raise exception 'Unsupported consent status.';
  end if;
  if p_source is null or length(btrim(p_source)) < 3 then
    raise exception 'Record how and when consent was obtained.';
  end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = actor
      and tm.role in ('owner', 'admin')
  ) then
    raise exception 'You do not have permission to change consent.';
  end if;

  update public.contacts
     set consent_status = p_status,
         consent_source = left(btrim(p_source), 500),
         consent_at = case when p_status = 'opted_in' then now() else consent_at end,
         opted_out_at = case when p_status = 'opted_out' then now() else null end,
         updated_at = now()
   where tenant_id = p_tenant_id
     and id = p_contact_id
   returning * into updated_contact;

  if updated_contact.id is null then
    raise exception 'Contact not found.';
  end if;
  return updated_contact;
end;
$$;

revoke all on function public.record_contact_consent(uuid, uuid, text, text) from public, anon;
grant execute on function public.record_contact_consent(uuid, uuid, text, text) to authenticated;

-- Consent columns may now only change through the RPC above. Other contact
-- fields remain writable through the existing table privileges.
revoke update on public.contacts from anon, authenticated;

-- Resume campaign batches and start due scheduled drafts once a minute.
create index if not exists campaigns_scheduled_idx
  on public.campaigns (scheduled_at)
  where status = 'draft' and scheduled_at is not null;
create index if not exists campaigns_running_updated_idx
  on public.campaigns (updated_at)
  where status = 'running';

do $$
begin
  if exists (select 1 from cron.job where jobname = 'mobiwave-campaign-worker') then
    perform cron.unschedule('mobiwave-campaign-worker');
  end if;
  perform cron.schedule(
    'mobiwave-campaign-worker',
    '* * * * *',
    $command$
    select net.http_post(
      url := 'https://jyjgvsljcmvbhovzevaz.supabase.co/functions/v1/campaign-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Internal-Token', (select decrypted_secret from vault.decrypted_secrets where name = 'internal_function_token')
      ),
      body := '{}'::jsonb
    );
    $command$
  );
end $$;
