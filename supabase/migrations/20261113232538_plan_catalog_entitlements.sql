-- One catalog now powers owner billing, public pricing and tenant plan views.
-- Commercial prices remain snapshots on existing subscriptions and invoices.
alter table public.platform_billing_tiers
  add column if not exists slug text,
  add column if not exists is_public boolean not null default false,
  add column if not exists display_order integer not null default 100,
  add column if not exists featured boolean not null default false,
  add column if not exists feature_highlights text[] not null default '{}',
  add column if not exists feature_flags jsonb not null default '{"inbox": true, "contacts": true, "templates": true, "campaigns": true, "api": true, "webhooks": true}'::jsonb,
  add column if not exists max_team_members integer not null default 0,
  add column if not exists monthly_message_limit integer not null default 0,
  add column if not exists monthly_ai_request_limit integer not null default 0;

update public.platform_billing_tiers
set slug = coalesce(nullif(trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')), ''), 'plan-' || left(id::text, 8))
where slug is null;

with duplicates as (
  select id, slug, row_number() over (partition by slug order by created_at, id) as position
  from public.platform_billing_tiers
)
update public.platform_billing_tiers t
set slug = d.slug || '-' || left(t.id::text, 8)
from duplicates d
where d.id = t.id and d.position > 1;

alter table public.platform_billing_tiers alter column slug set not null;
alter table public.platform_billing_tiers
  add constraint platform_billing_tiers_slug_check check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  add constraint platform_billing_tiers_feature_flags_check check (jsonb_typeof(feature_flags) = 'object'),
  add constraint platform_billing_tiers_limits_check check (
    max_team_members >= 0 and monthly_message_limit >= 0 and monthly_ai_request_limit >= 0
  );
create unique index if not exists platform_billing_tiers_slug_uidx on public.platform_billing_tiers(slug);
create index if not exists platform_billing_tiers_public_order_idx
  on public.platform_billing_tiers(display_order, name) where active and is_public;

create or replace function public.sync_tier_message_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare limit_value integer;
begin
  select t.monthly_message_limit into limit_value
  from public.platform_customer_subscriptions s
  join public.platform_billing_tiers t on t.id = s.tier_id
  where s.tenant_id = new.tenant_id;
  insert into public.tenant_usage_limits(tenant_id, monthly_message_limit)
  values (new.tenant_id, coalesce(limit_value, 0))
  on conflict (tenant_id) do update set monthly_message_limit = excluded.monthly_message_limit, updated_at = now();
  return new;
end;
$$;

drop trigger if exists sync_subscription_message_limit on public.platform_customer_subscriptions;
create trigger sync_subscription_message_limit
after insert or update on public.platform_customer_subscriptions
for each row execute function public.sync_tier_message_limit();

create or replace function public.sync_updated_tier_message_limits()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.monthly_message_limit is distinct from old.monthly_message_limit then
    update public.tenant_usage_limits l set monthly_message_limit = new.monthly_message_limit, updated_at = now()
    from public.platform_customer_subscriptions s
    where s.tenant_id = l.tenant_id and s.tier_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_updated_tier_message_limits on public.platform_billing_tiers;
create trigger sync_updated_tier_message_limits
after update of monthly_message_limit on public.platform_billing_tiers
for each row execute function public.sync_updated_tier_message_limits();

-- New workspaces already have a 0/no-cap usage row; align existing assigned plans too.
update public.tenant_usage_limits l set monthly_message_limit = t.monthly_message_limit, updated_at = now()
from public.platform_customer_subscriptions s
join public.platform_billing_tiers t on t.id = s.tier_id
where s.tenant_id = l.tenant_id;

-- Workspace admins must not be able to raise a platform-assigned quota directly.
drop policy if exists "admins can update usage limits" on public.tenant_usage_limits;
revoke update on public.tenant_usage_limits from authenticated;

create or replace function public.enforce_tier_member_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare member_limit integer; subscription_state text; current_members bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || ':member-limit', 0));
  select t.max_team_members, s.status into member_limit, subscription_state
  from public.platform_customer_subscriptions s
  join public.platform_billing_tiers t on t.id = s.tier_id
  where s.tenant_id = new.tenant_id;
  if coalesce(subscription_state, '') <> 'active' or coalesce(member_limit, 0) = 0 then return new; end if;
  select count(*) into current_members from public.tenant_members tm where tm.tenant_id = new.tenant_id;
  if current_members >= member_limit then
    raise exception 'This plan allows up to % workspace members. Upgrade the plan to add another member.', member_limit
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_tier_member_limit on public.tenant_members;
create trigger enforce_tier_member_limit before insert on public.tenant_members
for each row execute function public.enforce_tier_member_limit();

revoke all on function public.sync_tier_message_limit() from public, anon, authenticated;
revoke all on function public.sync_updated_tier_message_limits() from public, anon, authenticated;
revoke all on function public.enforce_tier_member_limit() from public, anon, authenticated;

-- Existing operator-created rows with these names retain their agreed prices.
update public.platform_billing_tiers t set
  is_public = true,
  display_order = case t.slug when 'starter' then 10 when 'basic' then 20 when 'pro' then 30 when 'enterprise' then 40 else t.display_order end,
  featured = (t.slug = 'pro'),
  feature_highlights = case when cardinality(t.feature_highlights) = 0 then case t.slug
    when 'starter' then array['Suggested team size: 2 users']
    when 'basic' then array['Suggested team size: 4 users']
    when 'pro' then array['Suggested team size: 10 users']
    when 'enterprise' then array['Custom team size']
    else t.feature_highlights end else t.feature_highlights end
where t.slug in ('starter', 'basic', 'pro', 'enterprise');

-- Preserve the pricing currently shown on the public page as the initial editable catalog.
insert into public.platform_billing_tiers
  (name, slug, description, currency, monthly_price_minor, setup_fee_minor, active, is_public,
   display_order, featured, feature_highlights, feature_flags, max_team_members)
values
  ('Starter', 'starter', 'A clear starting point for small teams', 'KES', 200000, 200000, true, true, 10, false,
   array['Suggested team size: 2 users'],
   '{"inbox": true, "contacts": true, "templates": true, "campaigns": true, "api": true, "webhooks": true}', 0),
  ('Basic', 'basic', 'More room for a growing customer team', 'KES', 400000, 400000, true, true, 20, false,
   array['Suggested team size: 4 users'],
   '{"inbox": true, "contacts": true, "templates": true, "campaigns": true, "api": true, "webhooks": true}', 0),
  ('Pro', 'pro', 'Connected workflows for growing teams', 'KES', 800000, 800000, true, true, 30, true,
   array['Suggested team size: 10 users'],
   '{"inbox": true, "contacts": true, "templates": true, "campaigns": true, "api": true, "webhooks": true}', 0),
  ('Enterprise', 'enterprise', 'For larger teams and custom requirements', 'KES', 2000000, 3000000, true, true, 40, false,
   array['Custom team size'],
   '{"inbox": true, "contacts": true, "templates": true, "campaigns": true, "api": true, "webhooks": true}', 0)
on conflict (slug) do nothing;

create or replace function public.platform_billing_save_tier_catalog(
  p_id uuid, p_name text, p_slug text, p_description text, p_currency text,
  p_monthly_price_minor bigint, p_setup_fee_minor bigint, p_active boolean,
  p_is_public boolean, p_display_order integer, p_featured boolean,
  p_feature_highlights text[], p_feature_flags jsonb,
  p_max_team_members integer, p_monthly_message_limit integer, p_monthly_ai_request_limit integer
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare saved_id uuid;
begin
  if not exists (
    select 1 from public.platform_admins pa
    where pa.user_id = (select auth.uid()) and pa.role = 'owner'
  ) then
    raise exception 'Platform owner access required' using errcode = '42501';
  end if;
  if nullif(trim(p_name), '') is null or length(p_name) > 80
    or coalesce(p_slug, '') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(p_slug) > 100
    or length(coalesce(p_description, '')) > 1000
    or p_currency not in ('KES', 'USD')
    or p_monthly_price_minor < 0 or p_setup_fee_minor < 0
    or p_display_order < 0 or p_max_team_members < 0
    or p_monthly_message_limit < 0 or p_monthly_ai_request_limit < 0
    or p_feature_flags is null or jsonb_typeof(p_feature_flags) <> 'object'
    or exists (select 1 from unnest(coalesce(p_feature_highlights, '{}')) item where length(item) > 180)
    or cardinality(coalesce(p_feature_highlights, '{}')) > 12 then
    raise exception 'Invalid tier details' using errcode = '22023';
  end if;
  if not (p_feature_flags ?& array['inbox','contacts','templates','campaigns','api','webhooks'])
    or p_feature_flags - array['inbox','contacts','templates','campaigns','api','webhooks'] <> '{}'::jsonb
    or exists (select 1 from jsonb_each(p_feature_flags) e where jsonb_typeof(e.value) <> 'boolean') then
    raise exception 'Unsupported feature flags' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.platform_billing_tiers(
      name, slug, description, currency, monthly_price_minor, setup_fee_minor, active,
      is_public, display_order, featured, feature_highlights, feature_flags,
      max_team_members, monthly_message_limit, monthly_ai_request_limit
    ) values (
      trim(p_name), p_slug, coalesce(p_description, ''), p_currency, p_monthly_price_minor,
      p_setup_fee_minor, p_active, p_is_public, p_display_order, p_featured,
      coalesce(p_feature_highlights, '{}'), p_feature_flags, p_max_team_members,
      p_monthly_message_limit, p_monthly_ai_request_limit
    ) returning id into saved_id;
  else
    update public.platform_billing_tiers set
      name = trim(p_name), slug = p_slug, description = coalesce(p_description, ''),
      currency = p_currency, monthly_price_minor = p_monthly_price_minor,
      setup_fee_minor = p_setup_fee_minor, active = p_active, is_public = p_is_public,
      display_order = p_display_order, featured = p_featured,
      feature_highlights = coalesce(p_feature_highlights, '{}'), feature_flags = p_feature_flags,
      max_team_members = p_max_team_members, monthly_message_limit = p_monthly_message_limit,
      monthly_ai_request_limit = p_monthly_ai_request_limit, updated_at = now()
    where id = p_id returning id into saved_id;
    if saved_id is null then raise exception 'Tier not found' using errcode = 'P0002'; end if;
  end if;
  insert into public.platform_billing_audit(actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), case when p_id is null then 'tier_created' else 'tier_updated' end,
    'tier', saved_id::text, jsonb_build_object('name', trim(p_name), 'active', p_active, 'is_public', p_is_public));
  return saved_id;
end;
$$;

create or replace function public.platform_public_tiers()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'slug', t.slug, 'name', t.name, 'description', t.description,
    'currency', t.currency, 'monthly_price_minor', t.monthly_price_minor,
    'setup_fee_minor', t.setup_fee_minor, 'featured', t.featured,
    'display_order', t.display_order, 'feature_highlights', to_jsonb(t.feature_highlights),
    'max_team_members', t.max_team_members, 'monthly_message_limit', t.monthly_message_limit,
    'feature_flags', t.feature_flags
  ) order by t.display_order, t.name), '[]'::jsonb)
  from public.platform_billing_tiers t where t.active and t.is_public;
$$;

create or replace function public.platform_tenant_plan(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id and tm.user_id = (select auth.uid())
  ) then
    raise exception 'Workspace membership required' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'subscription_status', s.status,
    'currency', s.currency,
    'monthly_price_minor', s.monthly_price_minor,
    'starts_on', s.starts_on,
    'monthly_messages_used', coalesce((
      select sum(u.quantity) from public.usage_events u
      where u.tenant_id = p_tenant_id and u.event_type = 'message_submitted'
        and u.occurred_at >= (date_trunc('month', now() at time zone 'UTC') at time zone 'UTC')
        and u.occurred_at < ((date_trunc('month', now() at time zone 'UTC') + interval '1 month') at time zone 'UTC')
    ), 0),
    'tier', case when t.id is null then null else jsonb_build_object(
      'id', t.id, 'slug', t.slug, 'name', t.name, 'description', t.description,
      'feature_highlights', to_jsonb(t.feature_highlights), 'feature_flags', t.feature_flags,
      'max_team_members', t.max_team_members, 'monthly_message_limit', t.monthly_message_limit
    ) end
  ) into result
  from public.platform_customer_subscriptions s
  left join public.platform_billing_tiers t on t.id = s.tier_id
  where s.tenant_id = p_tenant_id;
  return coalesce(result, jsonb_build_object('subscription_status', null, 'tier', null));
end;
$$;

revoke all on function public.platform_billing_save_tier_catalog(uuid,text,text,text,text,bigint,bigint,boolean,boolean,integer,boolean,text[],jsonb,integer,integer,integer) from public, anon;
grant execute on function public.platform_billing_save_tier_catalog(uuid,text,text,text,text,bigint,bigint,boolean,boolean,integer,boolean,text[],jsonb,integer,integer,integer) to authenticated;
revoke all on function public.platform_public_tiers() from public;
grant execute on function public.platform_public_tiers() to anon, authenticated;
revoke all on function public.platform_tenant_plan(uuid) from public, anon;
grant execute on function public.platform_tenant_plan(uuid) to authenticated;
