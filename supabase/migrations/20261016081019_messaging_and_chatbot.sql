-- Extend MobiWave WhatsApp MVP: conversations, contacts, templates, campaigns, webhook events,
-- tenant settings, and stricter approved-memory access. All browser-visible tables use RLS.
create extension if not exists pgcrypto;

create table if not exists public.tenant_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  ai_enabled boolean not null default false,
  ai_provider text not null default 'openai_compatible',
  ai_model text,
  system_instructions text not null default 'Answer only from approved knowledge and approved business memory. If evidence is insufficient, say so and request human assistance.',
  human_handoff_enabled boolean not null default true,
  context_retention_days integer not null default 30 check (context_retention_days between 0 and 365),
  max_ai_reply_tokens integer not null default 500 check (max_ai_reply_tokens between 50 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone_e164 text not null,
  display_name text,
  consent_status text not null default 'unknown' check (consent_status in ('unknown','opted_in','opted_out')),
  consent_source text,
  consent_at timestamptz,
  opted_out_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, phone_e164),
  check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);
create index if not exists contacts_tenant_consent_idx on public.contacts(tenant_id, consent_status);

create table if not exists public.wa_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  meta_template_name text not null,
  language_code text not null default 'en',
  category text not null check (category in ('MARKETING','UTILITY','AUTHENTICATION')),
  meta_status text not null default 'draft' check (meta_status in ('draft','pending','approved','rejected','paused','disabled')),
  components jsonb not null default '[]'::jsonb,
  meta_template_id text,
  rejection_reason text,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, meta_template_name, language_code)
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 180),
  status text not null default 'draft' check (status in ('draft','scheduled','queued','running','paused','completed','cancelled','failed')),
  template_id uuid references public.wa_templates(id) on delete set null,
  scheduled_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists campaigns_tenant_created_idx on public.campaigns(tenant_id, created_at desc);

create table if not exists public.campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','sending','sent','delivered','read','failed','skipped')),
  meta_message_id text,
  error_code text,
  error_detail text,
  attempts integer not null default 0 check (attempts >= 0),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, contact_id)
);
create index if not exists campaign_recipients_queue_idx on public.campaign_recipients(tenant_id, status, created_at);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  status text not null default 'open' check (status in ('open','pending','resolved','archived')),
  assigned_to uuid references auth.users(id) on delete set null,
  bot_paused boolean not null default false,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, contact_id)
);
create index if not exists conversations_inbox_idx on public.conversations(tenant_id, status, last_message_at desc);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound')),
  actor_type text not null check (actor_type in ('contact','agent','bot','campaign','system')),
  message_type text not null default 'text' check (message_type in ('text','template','image','document','audio','video','interactive','unknown')),
  body text,
  status text not null default 'received' check (status in ('received','queued','sent','delivered','read','failed')),
  meta_message_id text,
  reply_to_message_id uuid references public.messages(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, meta_message_id)
);
create index if not exists messages_conversation_created_idx on public.messages(tenant_id, conversation_id, created_at desc);

create table if not exists public.meta_integrations (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  phone_number_id text,
  waba_id text,
  display_phone_number text,
  verified boolean not null default false,
  enabled boolean not null default false,
  token_secret_name text,
  webhook_verified_at timestamptz,
  last_health_check_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  provider text not null check (provider in ('meta')),
  event_key text not null,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  processing_error text,
  received_at timestamptz not null default now(),
  unique (provider, event_key)
);
create index if not exists webhook_events_pending_idx on public.webhook_events(received_at) where processed_at is null;

alter table public.tenant_settings enable row level security;
alter table public.contacts enable row level security;
alter table public.wa_templates enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_recipients enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.meta_integrations enable row level security;
alter table public.webhook_events enable row level security;

-- Helper predicate is intentionally expressed inline; membership role is stored in tenant_members,
-- which users cannot write to directly.
create policy "members can read tenant settings" on public.tenant_settings for select to authenticated
using (exists (select 1 from public.tenant_members tm where tm.tenant_id = tenant_settings.tenant_id and tm.user_id = (select auth.uid())));
create policy "admins can manage tenant settings" on public.tenant_settings for all to authenticated
using (exists (select 1 from public.tenant_members tm where tm.tenant_id = tenant_settings.tenant_id and tm.user_id = (select auth.uid()) and tm.role in ('owner','admin')))
with check (exists (select 1 from public.tenant_members tm where tm.tenant_id = tenant_settings.tenant_id and tm.user_id = (select auth.uid()) and tm.role in ('owner','admin')));

create policy "members can read contacts" on public.contacts for select to authenticated
using (exists (select 1 from public.tenant_members tm where tm.tenant_id = contacts.tenant_id and tm.user_id = (select auth.uid())));
create policy "agents can manage contacts" on public.contacts for all to authenticated
using (exists (select 1 from public.tenant_members tm where tm.tenant_id = contacts.tenant_id and tm.user_id = (select auth.uid()) and tm.role in ('owner','admin','agent')))
with check (exists (select 1 from public.tenant_members tm where tm.tenant_id = contacts.tenant_id and tm.user_id = (select auth.uid()) and tm.role in ('owner','admin','agent')));

create policy "members can read templates" on public.wa_templates for select to authenticated
using (exists (select 1 from public.tenant_members tm where tm.tenant_id = wa_templates.tenant_id and tm.user_id = (select auth.uid())));
create policy "admins can manage templates" on public.wa_templates for all to authenticated
using (exists (select 1 from public.tenant_members tm where tm.tenant_id = wa_templates.tenant_id and tm.user_id = (select auth.uid()) and tm.role in ('owner','admin')))
with check (exists (select 1 from public.tenant_members tm where tm.tenant_id = wa_templates.tenant_id and tm.user_id = (select auth.uid()) and tm.role in ('owner','admin')));

create policy "members can read campaigns" on public.campaigns for select to authenticated
using (exists (select 1 from public.tenant_members tm where tm.tenant_id = campaigns.tenant_id and tm.user_id = (select auth.uid())));
create policy "admins can manage campaigns" on public.campaigns for all to authenticated
using (exists (select 1 from public.tenant_members tm where tm.tenant_id = campaigns.tenant_id and tm.user_id = (select auth.uid()) and tm.role in ('owner','admin')))
with check (exists (select 1 from public.tenant_members tm where tm.tenant_id = campaigns.tenant_id and tm.user_id = (select auth.uid()) and tm.role in ('owner','admin')));

create policy "members can read campaign recipients" on public.campaign_recipients for select to authenticated
using (exists (select 1 from public.tenant_members tm where tm.tenant_id = campaign_recipients.tenant_id and tm.user_id = (select auth.uid())));
create policy "admins can manage campaign recipients" on public.campaign_recipients for all to authenticated
using (exists (select 1 from public.tenant_members tm where tm.tenant_id = campaign_recipients.tenant_id and tm.user_id = (select auth.uid()) and tm.role in ('owner','admin')))
with check (exists (select 1 from public.tenant_members tm where tm.tenant_id = campaign_recipients.tenant_id and tm.user_id = (select auth.uid()) and tm.role in ('owner','admin')));

create policy "members can read conversations" on public.conversations for select to authenticated
using (exists (select 1 from public.tenant_members tm where tm.tenant_id = conversations.tenant_id and tm.user_id = (select auth.uid())));
create policy "agents can manage conversations" on public.conversations for all to authenticated
using (exists (select 1 from public.tenant_members tm where tm.tenant_id = conversations.tenant_id and tm.user_id = (select auth.uid()) and tm.role in ('owner','admin','agent')))
with check (exists (select 1 from public.tenant_members tm where tm.tenant_id = conversations.tenant_id and tm.user_id = (select auth.uid()) and tm.role in ('owner','admin','agent')));

create policy "members can read messages" on public.messages for select to authenticated
using (exists (select 1 from public.tenant_members tm where tm.tenant_id = messages.tenant_id and tm.user_id = (select auth.uid())));
create policy "agents can write messages" on public.messages for insert to authenticated
with check (exists (select 1 from public.tenant_members tm where tm.tenant_id = messages.tenant_id and tm.user_id = (select auth.uid()) and tm.role in ('owner','admin','agent')));

create policy "members can read meta integration status" on public.meta_integrations for select to authenticated
using (exists (select 1 from public.tenant_members tm where tm.tenant_id = meta_integrations.tenant_id and tm.user_id = (select auth.uid())));
create policy "admins can manage meta integration status" on public.meta_integrations for all to authenticated
using (exists (select 1 from public.tenant_members tm where tm.tenant_id = meta_integrations.tenant_id and tm.user_id = (select auth.uid()) and tm.role in ('owner','admin')))
with check (exists (select 1 from public.tenant_members tm where tm.tenant_id = meta_integrations.tenant_id and tm.user_id = (select auth.uid()) and tm.role in ('owner','admin')));

-- Browser users may not inspect or forge webhook payloads; trusted functions use service-role credentials.
create policy "admins can inspect webhook processing status" on public.webhook_events for select to authenticated
using (exists (select 1 from public.tenant_members tm where tm.tenant_id = webhook_events.tenant_id and tm.user_id = (select auth.uid()) and tm.role in ('owner','admin')));

-- Tighten memory visibility: ordinary agents see approved items only; tenant admins can review queue.
drop policy if exists "members can read approved memory and their own review queue" on public.ai_memory_items;
create policy "members can read approved memory and admins review queue" on public.ai_memory_items for select to authenticated
using (
  status = 'approved' and exists (
    select 1 from public.tenant_members tm where tm.tenant_id = ai_memory_items.tenant_id and tm.user_id = (select auth.uid())
  )
  or exists (
    select 1 from public.tenant_members tm where tm.tenant_id = ai_memory_items.tenant_id and tm.user_id = (select auth.uid()) and tm.role in ('owner','admin')
  )
);
