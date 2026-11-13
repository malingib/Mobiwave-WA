-- MobiWave WA: platform-owner console.
-- Platform staff are separate from tenant members. Platform access is read-only
-- aggregate data; message content and credentials remain tenant-scoped.

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'admin', 'support')),
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from public, anon;
grant select on public.platform_admins to authenticated;
revoke insert, update, delete on public.platform_admins from authenticated;

drop policy if exists "platform admins can read their own access" on public.platform_admins;
create policy "platform admins can read their own access"
  on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()));

-- No insert/update/delete policy: platform access is provisioned with the
-- service role or the Supabase dashboard, never from the browser.

create index if not exists messages_tenant_created_idx
  on public.messages (tenant_id, created_at desc);

create index if not exists wa_templates_tenant_status_idx
  on public.wa_templates (tenant_id, meta_status);

create or replace function public.platform_tenant_overview()
returns table (
  tenant_id uuid,
  name text,
  slug text,
  created_at timestamptz,
  member_count bigint,
  contact_count bigint,
  open_conversation_count bigint,
  campaign_count bigint,
  approved_template_count bigint,
  message_count_30d bigint,
  last_message_at timestamptz,
  whatsapp_connected boolean,
  whatsapp_verified boolean,
  display_phone_number text,
  is_member boolean
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    t.id as tenant_id,
    t.name,
    t.slug,
    t.created_at,
    (select count(*) from public.tenant_members tm where tm.tenant_id = t.id) as member_count,
    (select count(*) from public.contacts c where c.tenant_id = t.id) as contact_count,
    (select count(*) from public.conversations cv where cv.tenant_id = t.id and cv.status = 'open') as open_conversation_count,
    (select count(*) from public.campaigns ca where ca.tenant_id = t.id) as campaign_count,
    (select count(*) from public.wa_templates wt where wt.tenant_id = t.id and wt.meta_status = 'approved') as approved_template_count,
    (select count(*) from public.messages m where m.tenant_id = t.id and m.created_at >= now() - interval '30 days') as message_count_30d,
    (select max(m.created_at) from public.messages m where m.tenant_id = t.id) as last_message_at,
    coalesce(mi.enabled and mi.verified, false) as whatsapp_connected,
    coalesce(mi.verified, false) as whatsapp_verified,
    mi.display_phone_number,
    exists (
      select 1 from public.tenant_members tm
      where tm.tenant_id = t.id and tm.user_id = (select auth.uid())
    ) as is_member
  from public.tenants t
  left join public.meta_integrations mi on mi.tenant_id = t.id
  where exists (
    select 1 from public.platform_admins pa
    where pa.user_id = (select auth.uid())
  )
  order by t.created_at desc;
$$;

revoke all on function public.platform_tenant_overview() from public, anon;
grant execute on function public.platform_tenant_overview() to authenticated;
