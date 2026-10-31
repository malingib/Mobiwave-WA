-- Phase 1 reliability: durable outbound attempts and Meta webhook inbox.
-- Forward-only migration; does not rewrite already-applied migrations.

create table if not exists public.outbound_send_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  request_hash text not null,
  contact_id uuid not null references public.contacts(id) on delete restrict,
  conversation_id uuid references public.conversations(id) on delete set null,
  message_type text not null check (message_type in ('text','template')),
  request_payload jsonb not null,
  status text not null default 'prepared'
    check (status in ('prepared','submitting','accepted','rejected','outcome_unknown')),
  meta_message_id text,
  message_id uuid,
  error_code text,
  error_detail text,
  attempts integer not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (tenant_id, idempotency_key)
);
-- Distinguish provider acceptance from actual delivery in message and campaign state.
alter table public.messages drop constraint if exists messages_status_check;
alter table public.messages add constraint messages_status_check
  check (status in ('received','queued','processing','accepted','sent','delivered','read','failed','outcome_unknown'));
alter table public.campaign_recipients add column if not exists accepted_at timestamptz;
alter table public.campaign_recipients drop constraint if exists campaign_recipients_status_check;
alter table public.campaign_recipients add constraint campaign_recipients_status_check
  check (status in ('queued','sending','accepted','sent','delivered','read','failed','skipped','outcome_unknown'));
create index if not exists outbound_send_attempts_recovery_idx
  on public.outbound_send_attempts(status, updated_at)
  where status in ('prepared','submitting','outcome_unknown');
create unique index if not exists outbound_send_attempts_meta_message_uidx
  on public.outbound_send_attempts(tenant_id, meta_message_id)
  where meta_message_id is not null;
alter table public.outbound_send_attempts enable row level security;
revoke all on public.outbound_send_attempts from public, anon, authenticated;
grant select, insert, update on public.outbound_send_attempts to service_role;

create table if not exists public.meta_webhook_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  event_key text not null unique,
  phone_number_id text,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending','processing','processed','retry','dead_letter','ignored')),
  attempts integer not null default 0 check (attempts >= 0),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  updated_at timestamptz not null default now()
);
create index if not exists meta_webhook_events_work_idx
  on public.meta_webhook_events(status, next_attempt_at, received_at)
  where status in ('pending','retry');
alter table public.meta_webhook_events enable row level security;
revoke all on public.meta_webhook_events from public, anon, authenticated;
grant select, insert, update on public.meta_webhook_events to service_role;

-- Atomic bounded claiming for a service-role worker. Events are not deleted on failure.
create or replace function public.claim_meta_webhook_events(p_limit integer default 25)
returns setof public.meta_webhook_events
language plpgsql
security definer
set search_path = public
as $
begin
  -- Recover worker crashes without reclaiming events that may still be active.
  update public.meta_webhook_events
  set status = case when attempts >= 8 then 'dead_letter' else 'retry' end,
      next_attempt_at = now(),
      last_error = coalesce(last_error, 'Worker lease expired before completion.'),
      updated_at = now()
  where status = 'processing' and updated_at < now() - interval '5 minutes';

  return query
  with candidates as (
    select e.id
    from public.meta_webhook_events e
    where e.status in ('pending','retry')
      and e.next_attempt_at <= now()
    order by e.received_at, e.id
    limit greatest(1, least(coalesce(p_limit, 25), 100))
    for update skip locked
  )
  update public.meta_webhook_events e
  set status = 'processing', attempts = e.attempts + 1, updated_at = now()
  from candidates
  where e.id = candidates.id
  returning e.*;
end;
$;
revoke all on function public.claim_meta_webhook_events(integer) from public, anon, authenticated;
grant execute on function public.claim_meta_webhook_events(integer) to service_role;


-- Append-only provider status history and workspace-facing operational notifications.
create table if not exists public.message_status_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  meta_message_id text not null,
  status text not null check (status in ('accepted','sent','delivered','read','failed')),
  provider_timestamp timestamptz,
  error_code text,
  error_title text,
  error_detail text,
  event_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);
create index if not exists message_status_events_lookup_idx
  on public.message_status_events(tenant_id, meta_message_id, received_at);

create table if not exists public.workspace_notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  recipient_user_id uuid references auth.users(id) on delete cascade,
  category text not null check (category in ('message_status','send_error','campaign_error','integration_error','system')),
  severity text not null default 'info' check (severity in ('info','warning','error','critical')),
  title text not null,
  body text not null,
  entity_type text,
  entity_id text,
  dedupe_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (tenant_id, dedupe_key, recipient_user_id)
);
create index if not exists workspace_notifications_inbox_idx
  on public.workspace_notifications(tenant_id, recipient_user_id, created_at desc)
  where read_at is null;
alter table public.message_status_events enable row level security;
alter table public.workspace_notifications enable row level security;
revoke all on public.message_status_events from public, anon, authenticated;
revoke all on public.workspace_notifications from public, anon, authenticated;
grant select, insert, update on public.message_status_events to service_role;
grant select, insert, update on public.workspace_notifications to service_role;

-- Tenant-wide notifications (recipient_user_id IS NULL) need true deduplication too.
create unique index if not exists workspace_notifications_tenant_dedupe_uidx
  on public.workspace_notifications(tenant_id, dedupe_key)
  where recipient_user_id is null;
