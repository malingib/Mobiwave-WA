-- MobiWave WhatsApp: tenant-scoped knowledge and curated memory foundation.
-- Ingestion workers must write through trusted server-side credentials only.
-- Never expose service-role credentials in the browser.

create extension if not exists pgcrypto;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_members (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'agent', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create table if not exists public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  submitted_url text not null,
  canonical_url text,
  display_name text not null check (length(trim(display_name)) between 1 and 200),
  scope text not null default 'submitted_url' check (scope in ('submitted_url', 'same_domain')),
  status text not null default 'pending' check (status in ('pending', 'crawling', 'indexed', 'failed', 'disabled')),
  enabled boolean not null default true,
  last_crawled_at timestamptz,
  last_successful_at timestamptz,
  last_error_code text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, submitted_url)
);

create index if not exists knowledge_sources_tenant_status_idx
  on public.knowledge_sources (tenant_id, status, enabled);

create table if not exists public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_id uuid not null references public.knowledge_sources(id) on delete cascade,
  canonical_url text not null,
  title text,
  content_hash text not null,
  extracted_text text not null,
  content_type text,
  fetched_at timestamptz not null default now(),
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, canonical_url, content_hash)
);

create index if not exists knowledge_documents_current_idx
  on public.knowledge_documents (tenant_id, source_id, is_current);

create table if not exists public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  document_id uuid not null references public.knowledge_documents(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null,
  search_vector tsvector generated always as (to_tsvector('simple', coalesce(content, ''))) stored,
  token_estimate integer check (token_estimate is null or token_estimate >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create index if not exists knowledge_chunks_search_idx
  on public.knowledge_chunks using gin (search_vector);
create index if not exists knowledge_chunks_tenant_doc_idx
  on public.knowledge_chunks (tenant_id, document_id);

create table if not exists public.ai_memory_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  memory_text text not null check (length(trim(memory_text)) between 1 and 6000),
  memory_type text not null default 'business_rule'
    check (memory_type in ('business_preference', 'confirmed_correction', 'resolved_issue', 'business_rule')),
  status text not null default 'needs_review'
    check (status in ('suggested', 'needs_review', 'approved', 'rejected', 'archived')),
  source_type text not null default 'manual'
    check (source_type in ('manual', 'agent_correction', 'resolved_conversation', 'knowledge_source')),
  source_reference text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  expires_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'approved' or approved_at is not null)
);

create index if not exists ai_memory_tenant_status_idx
  on public.ai_memory_items (tenant_id, status, updated_at desc);

create table if not exists public.source_ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_id uuid not null references public.knowledge_sources(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  pages_discovered integer not null default 0 check (pages_discovered >= 0),
  pages_indexed integer not null default 0 check (pages_indexed >= 0),
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists source_ingestion_runs_source_idx
  on public.source_ingestion_runs (tenant_id, source_id, created_at desc);

-- All exposed tables use RLS. Membership is checked against a server-managed
-- membership table, never user-editable user_metadata.
alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.knowledge_sources enable row level security;
alter table public.knowledge_documents enable row level security;
alter table public.knowledge_chunks enable row level security;
alter table public.ai_memory_items enable row level security;
alter table public.source_ingestion_runs enable row level security;

create policy "members can view their tenant memberships"
  on public.tenant_members for select to authenticated
  using (user_id = (select auth.uid()));

create policy "members can view their tenants"
  on public.tenants for select to authenticated
  using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = tenants.id and tm.user_id = (select auth.uid())
  ));

create policy "members can view knowledge sources"
  on public.knowledge_sources for select to authenticated
  using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = knowledge_sources.tenant_id and tm.user_id = (select auth.uid())
  ));

create policy "admins can manage knowledge sources"
  on public.knowledge_sources for all to authenticated
  using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = knowledge_sources.tenant_id
      and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin')
  ))
  with check (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = knowledge_sources.tenant_id
      and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin')
  ));

create policy "members can read current knowledge documents"
  on public.knowledge_documents for select to authenticated
  using (
    is_current = true and exists (
      select 1 from public.tenant_members tm
      where tm.tenant_id = knowledge_documents.tenant_id
        and tm.user_id = (select auth.uid())
    )
  );

create policy "members can read knowledge chunks"
  on public.knowledge_chunks for select to authenticated
  using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = knowledge_chunks.tenant_id and tm.user_id = (select auth.uid())
  ));

create policy "members can read approved memory and their own review queue"
  on public.ai_memory_items for select to authenticated
  using (
    exists (
      select 1 from public.tenant_members tm
      where tm.tenant_id = ai_memory_items.tenant_id and tm.user_id = (select auth.uid())
    )
  );

create policy "admins can create memory items"
  on public.ai_memory_items for insert to authenticated
  with check (
    exists (
      select 1 from public.tenant_members tm
      where tm.tenant_id = ai_memory_items.tenant_id
        and tm.user_id = (select auth.uid())
        and tm.role in ('owner', 'admin')
    )
  );

create policy "admins can update memory items"
  on public.ai_memory_items for update to authenticated
  using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = ai_memory_items.tenant_id
      and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin')
  ))
  with check (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = ai_memory_items.tenant_id
      and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin')
  ));

create policy "admins can delete memory items"
  on public.ai_memory_items for delete to authenticated
  using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = ai_memory_items.tenant_id
      and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin')
  ));

create policy "members can view ingestion run history"
  on public.source_ingestion_runs for select to authenticated
  using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = source_ingestion_runs.tenant_id and tm.user_id = (select auth.uid())
  ));

-- Intentionally no browser write policies for documents, chunks or ingestion runs.
-- A trusted ingestion worker must perform fetches and indexing after SSRF validation.
-- Tenant provisioning and membership changes must be performed by a trusted server flow.
