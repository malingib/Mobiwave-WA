create table if not exists public.platform_invoice_dunning_events (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.platform_invoices(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_type text not null check (event_type in ('reminder_3_days','reminder_1_day','past_due','grace_final','suspended')),
  channel text not null check (channel in ('email','in_app')),
  status text not null default 'processing' check (status in ('processing','sent','failed','skipped')),
  attempt_count integer not null default 1 check (attempt_count > 0),
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (invoice_id,event_type,channel)
);

create index if not exists platform_invoice_dunning_events_tenant_idx
  on public.platform_invoice_dunning_events(tenant_id,created_at desc);

alter table public.platform_invoice_dunning_events enable row level security;
revoke all on public.platform_invoice_dunning_events from anon, authenticated;
grant select,insert,update on public.platform_invoice_dunning_events to service_role;

create or replace function public.verify_internal_function_token(p_token text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select coalesce(
    p_token is not null
    and p_token <> ''
    and exists (
      select 1
      from vault.decrypted_secrets
      where name = 'internal_function_token'
        and decrypted_secret = p_token
    ),
    false
  );
$$;

revoke all on function public.verify_internal_function_token(text) from public, anon, authenticated;
grant execute on function public.verify_internal_function_token(text) to service_role;

create or replace function public.claim_platform_invoice_dunning_event(
  p_invoice_id uuid,
  p_tenant_id uuid,
  p_event_type text,
  p_channel text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_id uuid;
begin
  if coalesce(auth.jwt() ->> 'role','') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  insert into public.platform_invoice_dunning_events (
    invoice_id,tenant_id,event_type,channel,status,attempt_count,updated_at
  )
  values (p_invoice_id,p_tenant_id,p_event_type,p_channel,'processing',1,now())
  on conflict (invoice_id,event_type,channel)
  do update set
    status = 'processing',
    attempt_count = public.platform_invoice_dunning_events.attempt_count + 1,
    last_error = null,
    updated_at = now()
  where public.platform_invoice_dunning_events.status = 'failed'
     or (
       public.platform_invoice_dunning_events.status = 'processing'
       and public.platform_invoice_dunning_events.updated_at < now() - interval '20 minutes'
     )
  returning id into claimed_id;

  return claimed_id;
end;
$$;

revoke all on function public.claim_platform_invoice_dunning_event(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.claim_platform_invoice_dunning_event(uuid,uuid,text,text) to service_role;

comment on table public.platform_invoice_dunning_events is
  'Idempotent email and in-app reminder delivery ledger for issued platform invoices.';
