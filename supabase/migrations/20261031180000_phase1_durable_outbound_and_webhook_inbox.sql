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
language sql
security definer
set search_path = public
as $$
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
$$;
revoke all on function public.claim_meta_webhook_events(integer) from public, anon, authenticated;
grant execute on function public.claim_meta_webhook_events(integer) to service_role;
