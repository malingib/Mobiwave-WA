create table if not exists public.tenant_api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  key_prefix text not null,
  secret_hash text not null unique,
  scopes text[] not null default array['messages:send']::text[],
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists tenant_api_keys_tenant_idx on public.tenant_api_keys(tenant_id, created_at desc);

create table if not exists public.tenant_usage_limits (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  monthly_message_limit integer not null default 1000 check (monthly_message_limit >= 0),
  monthly_ai_request_limit integer not null default 500 check (monthly_ai_request_limit >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_type text not null check (event_type in ('message_submitted','message_delivered','ai_request','knowledge_page_indexed','api_request')),
  quantity integer not null default 1 check (quantity > 0),
  reference_id text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists usage_events_monthly_idx on public.usage_events(tenant_id, event_type, occurred_at desc);

alter table public.tenant_api_keys enable row level security;
alter table public.tenant_usage_limits enable row level security;
alter table public.usage_events enable row level security;

create policy "admins can view API key metadata" on public.tenant_api_keys for select to authenticated
using (exists (select 1 from public.tenant_members tm where tm.tenant_id = tenant_api_keys.tenant_id and tm.user_id = (select auth.uid()) and tm.role in ('owner','admin')));
create policy "admins can read usage limits" on public.tenant_usage_limits for select to authenticated
using (exists (select 1 from public.tenant_members tm where tm.tenant_id = tenant_usage_limits.tenant_id and tm.user_id = (select auth.uid()) and tm.role in ('owner','admin')));
create policy "admins can update usage limits" on public.tenant_usage_limits for update to authenticated
using (exists (select 1 from public.tenant_members tm where tm.tenant_id = tenant_usage_limits.tenant_id and tm.user_id = (select auth.uid()) and tm.role in ('owner','admin')))
with check (exists (select 1 from public.tenant_members tm where tm.tenant_id = tenant_usage_limits.tenant_id and tm.user_id = (select auth.uid()) and tm.role in ('owner','admin')));
create policy "admins can view usage events" on public.usage_events for select to authenticated
using (exists (select 1 from public.tenant_members tm where tm.tenant_id = usage_events.tenant_id and tm.user_id = (select auth.uid()) and tm.role in ('owner','admin')));

grant select on public.tenant_api_keys, public.tenant_usage_limits, public.usage_events to authenticated;
grant update on public.tenant_usage_limits to authenticated;
