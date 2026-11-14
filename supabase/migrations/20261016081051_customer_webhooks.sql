create table if not exists public.tenant_webhooks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 120),
  endpoint_url text not null,
  encrypted_secret text not null,
  events text[] not null default array['message.inbound']::text[],
  enabled boolean not null default true,
  last_delivery_at timestamptz,
  last_status text,
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tenant_webhooks_active_idx on public.tenant_webhooks(tenant_id, enabled);

create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  webhook_id uuid not null references public.tenant_webhooks(id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued','delivered','failed','dead')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  response_status integer,
  response_excerpt text,
  last_error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index if not exists webhook_delivery_retry_idx on public.webhook_deliveries(status, next_attempt_at) where status in ('queued','failed');

alter table public.tenant_webhooks enable row level security;
alter table public.webhook_deliveries enable row level security;
create policy "admins can read webhook configurations" on public.tenant_webhooks for select to authenticated
using (exists (select 1 from public.tenant_members tm where tm.tenant_id = tenant_webhooks.tenant_id and tm.user_id = (select auth.uid()) and tm.role in ('owner','admin')));
create policy "admins can read webhook delivery history" on public.webhook_deliveries for select to authenticated
using (exists (select 1 from public.tenant_members tm where tm.tenant_id = webhook_deliveries.tenant_id and tm.user_id = (select auth.uid()) and tm.role in ('owner','admin')));
grant select on public.tenant_webhooks, public.webhook_deliveries to authenticated;
revoke select (encrypted_secret) on public.tenant_webhooks from anon, authenticated;
