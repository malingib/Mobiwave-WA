-- Commercial entitlements and Meta service-message allowance.
--
-- Billing status now has a real lifecycle. Inbound visibility is never gated:
-- only outbound sending, campaigns and the developer API are blocked when a
-- workspace has no usable subscription. Existing workspaces keep working via
-- an explicit exemption until a plan is assigned.

-- ---------------------------------------------------------------------------
-- Meta integration telemetry used by the allowance panel and alerts.
-- ---------------------------------------------------------------------------
alter table public.meta_integrations
  add column if not exists waba_timezone text,
  add column if not exists messaging_limit_tier text,
  add column if not exists quality_rating text,
  add column if not exists last_capability_update_at timestamptz;

grant select (
  waba_timezone,
  messaging_limit_tier,
  quality_rating,
  last_capability_update_at
) on public.meta_integrations to authenticated;

-- ---------------------------------------------------------------------------
-- Subscription lifecycle columns and statuses.
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column if not exists billing_exempt boolean not null default false;

alter table public.platform_customer_subscriptions
  add column if not exists trial_ends_on date,
  add column if not exists grace_ends_on date,
  add column if not exists suspended_at timestamptz,
  add column if not exists canceled_at timestamptz,
  add column if not exists last_status_change_at timestamptz not null default now();

alter table public.platform_customer_subscriptions
  drop constraint if exists platform_customer_subscriptions_status_check;
alter table public.platform_customer_subscriptions
  add constraint platform_customer_subscriptions_status_check check (
    status in ('active', 'trialing', 'past_due', 'grace', 'suspended', 'paused', 'canceled')
  );

-- Existing workspaces were operating before subscriptions could suspend
-- sending. Keep them exempt until the platform owner assigns a plan.
update public.tenants set billing_exempt = true where billing_exempt = false;

-- ---------------------------------------------------------------------------
-- Assign tier with the full lifecycle. Reactivating a suspended workspace is
-- simply assigning status 'active'; the suspension markers are cleared.
-- ---------------------------------------------------------------------------
create or replace function public.platform_billing_assign_tier(
  p_tenant_id uuid, p_tier_id uuid, p_status text, p_starts_on date
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  chosen public.platform_billing_tiers%rowtype;
  existing_subscription public.platform_customer_subscriptions%rowtype;
  next_trial date;
  next_grace date;
  next_suspended timestamptz;
  next_canceled timestamptz;
begin
  if not exists (select 1 from public.platform_admins where user_id = (select auth.uid()) and role = 'owner') then
    raise exception 'Platform owner access required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'Client workspace not found' using errcode = 'P0002';
  end if;
  if p_status not in ('active', 'trialing', 'past_due', 'grace', 'suspended', 'paused', 'canceled') then
    raise exception 'Invalid subscription status' using errcode = '22023';
  end if;

  select * into existing_subscription
  from public.platform_customer_subscriptions where tenant_id = p_tenant_id;

  if p_tier_id is null and p_status = 'active' then
    raise exception 'An active subscription requires a tier' using errcode = '22023';
  end if;

  next_trial := existing_subscription.trial_ends_on;
  next_grace := existing_subscription.grace_ends_on;
  next_suspended := existing_subscription.suspended_at;
  next_canceled := existing_subscription.canceled_at;

  if p_status = 'trialing' then
    if next_trial is null then
      next_trial := coalesce(p_starts_on, current_date) + 14;
      next_grace := next_trial + 14;
    elsif next_grace is null or next_grace <= next_trial then
      next_grace := next_trial + 14;
    end if;
    next_suspended := null;
    next_canceled := null;
  elsif p_status in ('past_due', 'grace') then
    if next_grace is null or next_grace < current_date then
      next_grace := current_date + 14;
    end if;
    next_suspended := null;
    next_canceled := null;
  elsif p_status = 'active' then
    next_suspended := null;
    next_canceled := null;
  elsif p_status = 'suspended' then
    next_suspended := coalesce(next_suspended, now());
  elsif p_status = 'canceled' then
    next_canceled := coalesce(next_canceled, now());
    next_suspended := coalesce(next_suspended, now());
  end if;

  if p_tier_id is null then
    insert into public.platform_customer_subscriptions(
      tenant_id, tier_id, status, currency, monthly_price_minor, starts_on, ends_on,
      trial_ends_on, grace_ends_on, suspended_at, canceled_at,
      updated_by, updated_at, last_status_change_at
    ) values (
      p_tenant_id, null, p_status, 'KES', 0, coalesce(p_starts_on, current_date),
      case when p_status = 'canceled' then current_date else null end,
      next_trial, next_grace, next_suspended, next_canceled,
      (select auth.uid()), now(), now()
    )
    on conflict (tenant_id) do update set
      tier_id = null, status = excluded.status, currency = 'KES', monthly_price_minor = 0,
      starts_on = excluded.starts_on, ends_on = excluded.ends_on,
      trial_ends_on = excluded.trial_ends_on, grace_ends_on = excluded.grace_ends_on,
      suspended_at = excluded.suspended_at, canceled_at = excluded.canceled_at,
      updated_by = excluded.updated_by, updated_at = now(), last_status_change_at = now();
  else
    select * into chosen from public.platform_billing_tiers
    where id = p_tier_id
      and (active or (existing_subscription.tenant_id = p_tenant_id and existing_subscription.tier_id = p_tier_id));
    if not found then raise exception 'Active tier not found' using errcode = 'P0002'; end if;
    if existing_subscription.tenant_id = p_tenant_id and existing_subscription.tier_id = p_tier_id then
      chosen.currency := existing_subscription.currency;
      chosen.monthly_price_minor := existing_subscription.monthly_price_minor;
    end if;
    insert into public.platform_customer_subscriptions(
      tenant_id, tier_id, status, currency, monthly_price_minor, starts_on, ends_on,
      trial_ends_on, grace_ends_on, suspended_at, canceled_at,
      updated_by, updated_at, last_status_change_at
    ) values (
      p_tenant_id, chosen.id, p_status, chosen.currency, chosen.monthly_price_minor,
      coalesce(p_starts_on, current_date),
      case when p_status = 'canceled' then current_date else null end,
      next_trial, next_grace, next_suspended, next_canceled,
      (select auth.uid()), now(), now()
    )
    on conflict (tenant_id) do update set
      tier_id = excluded.tier_id, status = excluded.status, currency = excluded.currency,
      monthly_price_minor = excluded.monthly_price_minor, starts_on = excluded.starts_on,
      ends_on = excluded.ends_on, trial_ends_on = excluded.trial_ends_on,
      grace_ends_on = excluded.grace_ends_on, suspended_at = excluded.suspended_at,
      canceled_at = excluded.canceled_at, updated_by = excluded.updated_by,
      updated_at = now(), last_status_change_at = now();
  end if;

  insert into public.platform_billing_audit(actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'subscription_updated', 'tenant', p_tenant_id::text,
    jsonb_build_object('tier_id', p_tier_id, 'status', p_status,
      'trial_ends_on', next_trial, 'grace_ends_on', next_grace));
  return p_tenant_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Single source of truth for commercial access. Edge functions call this with
-- the service role; the browser calls it through the same membership check.
-- ---------------------------------------------------------------------------
create or replace function public.tenant_entitlements(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := (select auth.uid());
  is_service boolean := coalesce((select auth.role()), '') = 'service_role';
  tenant_row public.tenants%rowtype;
  subscription_row public.platform_customer_subscriptions%rowtype;
  tier_row public.platform_billing_tiers%rowtype;
  has_subscription boolean := false;
  effective text;
  send_allowed boolean := false;
  days_left integer;
  today date := current_date;
begin
  if not is_service then
    if actor is null or not exists (
      select 1 from public.tenant_members tm
      where tm.tenant_id = p_tenant_id and tm.user_id = actor
    ) then
      raise exception 'Workspace membership required' using errcode = '42501';
    end if;
  end if;

  select * into tenant_row from public.tenants where id = p_tenant_id;
  if not found then raise exception 'Workspace not found' using errcode = 'P0002'; end if;

  select * into subscription_row from public.platform_customer_subscriptions where tenant_id = p_tenant_id;
  has_subscription := found;
  if has_subscription and subscription_row.tier_id is not null then
    select * into tier_row from public.platform_billing_tiers where id = subscription_row.tier_id;
  end if;

  if tenant_row.billing_exempt then
    effective := 'exempt';
    send_allowed := true;
  elsif not has_subscription then
    effective := 'unassigned';
  elsif subscription_row.status = 'canceled' then
    effective := 'canceled';
  elsif subscription_row.status = 'paused' then
    effective := 'paused';
  elsif subscription_row.status = 'suspended' then
    effective := 'suspended';
  elsif subscription_row.status = 'active'
    and (subscription_row.ends_on is null or subscription_row.ends_on >= today) then
    effective := 'active';
    send_allowed := true;
  elsif subscription_row.status = 'trialing'
    and subscription_row.trial_ends_on is not null
    and subscription_row.trial_ends_on >= today then
    effective := 'trialing';
    send_allowed := true;
  elsif subscription_row.grace_ends_on is not null
    and subscription_row.grace_ends_on >= today then
    effective := 'grace';
    send_allowed := true;
  else
    effective := 'suspended';
  end if;

  if effective = 'trialing' then
    days_left := greatest(0, subscription_row.trial_ends_on - today);
  elsif effective = 'grace' then
    days_left := greatest(0, subscription_row.grace_ends_on - today);
  end if;

  return jsonb_build_object(
    'state', effective,
    'subscription_status', case when has_subscription then subscription_row.status else null end,
    'can_send', send_allowed,
    'billing_exempt', tenant_row.billing_exempt,
    'has_subscription', has_subscription,
    'trial_ends_on', subscription_row.trial_ends_on,
    'grace_ends_on', subscription_row.grace_ends_on,
    'days_remaining', days_left,
    'currency', case when has_subscription then subscription_row.currency else null end,
    'monthly_price_minor', case when has_subscription then subscription_row.monthly_price_minor else null end,
    'starts_on', case when has_subscription then subscription_row.starts_on else null end,
    'ends_on', case when has_subscription then subscription_row.ends_on else null end,
    'tier', case when tier_row.id is null then null else jsonb_build_object(
      'id', tier_row.id, 'slug', tier_row.slug, 'name', tier_row.name,
      'feature_highlights', to_jsonb(tier_row.feature_highlights),
      'feature_flags', tier_row.feature_flags,
      'max_team_members', tier_row.max_team_members,
      'monthly_message_limit', tier_row.monthly_message_limit
    ) end
  );
end;
$$;

revoke all on function public.tenant_entitlements(uuid) from public, anon;
grant execute on function public.tenant_entitlements(uuid) to authenticated, service_role;

-- Keep the existing workspace-plan RPC shape, now backed by entitlements.
create or replace function public.platform_tenant_plan(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  entitlements jsonb;
  tier jsonb;
  tier_description text;
  messages_used bigint;
begin
  entitlements := public.tenant_entitlements(p_tenant_id);
  tier := entitlements -> 'tier';

  if tier is not null and tier ->> 'id' is not null then
    select description into tier_description
    from public.platform_billing_tiers where id = (tier ->> 'id')::uuid;
    tier := tier || jsonb_build_object('description', coalesce(tier_description, ''));
  end if;

  select coalesce(sum(u.quantity), 0) into messages_used
  from public.usage_events u
  where u.tenant_id = p_tenant_id and u.event_type = 'message_submitted'
    and u.occurred_at >= (date_trunc('month', now() at time zone 'UTC') at time zone 'UTC')
    and u.occurred_at < ((date_trunc('month', now() at time zone 'UTC') + interval '1 month') at time zone 'UTC');

  return entitlements || jsonb_build_object(
    'monthly_messages_used', messages_used,
    'tier', tier
  );
end;
$$;

revoke all on function public.platform_tenant_plan(uuid) from public, anon;
grant execute on function public.platform_tenant_plan(uuid) to authenticated;

-- Customer-facing billing summary: plan, lifecycle and issued invoices.
create or replace function public.tenant_billing_summary(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  entitlements jsonb;
  account_row public.platform_customer_accounts%rowtype;
  invoices jsonb;
begin
  entitlements := public.tenant_entitlements(p_tenant_id);
  select * into account_row from public.platform_customer_accounts where tenant_id = p_tenant_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'invoice_number', i.invoice_number,
    'currency', i.currency,
    'subtotal_minor', i.subtotal_minor,
    'paid_minor', coalesce(p.paid_minor, 0),
    'balance_minor', greatest(i.subtotal_minor - coalesce(p.paid_minor, 0), 0),
    'due_on', i.due_on,
    'issued_at', i.issued_at,
    'status', i.status,
    'is_overdue', i.status = 'issued'
      and greatest(i.subtotal_minor - coalesce(p.paid_minor, 0), 0) > 0
      and i.due_on < current_date
  ) order by i.issued_at desc), '[]'::jsonb) into invoices
  from public.platform_invoices i
  left join lateral (
    select sum(pay.amount_minor) as paid_minor
    from public.platform_invoice_payments pay
    where pay.invoice_id = i.id and pay.reversed_at is null
  ) p on true
  where i.tenant_id = p_tenant_id
  limit 36;

  return jsonb_build_object(
    'entitlements', entitlements,
    'account', jsonb_build_object(
      'billing_name', coalesce(account_row.billing_name, ''),
      'billing_email', coalesce(account_row.billing_email, ''),
      'billing_reference', coalesce(account_row.billing_reference, '')
    ),
    'invoices', invoices
  );
end;
$$;

revoke all on function public.tenant_billing_summary(uuid) from public, anon;
grant execute on function public.tenant_billing_summary(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Meta service-message allowance and billable delivered traffic.
-- The first 1,000 delivered service messages per business phone number are
-- free each month; marketing, utility and authentication templates are billed
-- from the first delivered message.
-- ---------------------------------------------------------------------------
create or replace function public.tenant_meta_allowance(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := (select auth.uid());
  is_service boolean := coalesce((select auth.role()), '') = 'service_role';
  integration_row public.meta_integrations%rowtype;
  tz text;
  period_start timestamptz;
  period_end timestamptz;
  free_used integer := 0;
  billable_delivered integer := 0;
  unknown_pricing integer := 0;
  has_pricing boolean := false;
  by_category jsonb := '{}'::jsonb;
  delivered_count integer := 0;
begin
  if not is_service then
    if actor is null or not exists (
      select 1 from public.tenant_members tm
      where tm.tenant_id = p_tenant_id and tm.user_id = actor
    ) then
      raise exception 'Workspace membership required' using errcode = '42501';
    end if;
  end if;

  select * into integration_row from public.meta_integrations where tenant_id = p_tenant_id;
  if not found then
    return jsonb_build_object('connected', false, 'free_limit', 1000);
  end if;

  select name into tz from pg_timezone_names
  where name = coalesce(nullif(integration_row.waba_timezone, ''), 'Africa/Nairobi')
  limit 1;
  if tz is null then tz := 'Africa/Nairobi'; end if;

  period_start := (date_trunc('month', now() at time zone tz) at time zone tz);
  period_end := period_start + interval '1 month';

  with delivered as (
    select distinct on (e.meta_message_id)
      e.meta_message_id,
      nullif(e.payload -> 'pricing' ->> 'type', '') as pricing_type,
      coalesce(nullif(e.payload -> 'pricing' ->> 'category', ''), 'unknown') as category,
      coalesce(
        (e.payload -> 'pricing' ->> 'billable')::boolean,
        coalesce(e.payload -> 'pricing' ->> 'type', '') <> 'free_customer_service'
      ) as billable
    from public.message_status_events e
    where e.tenant_id = p_tenant_id
      and e.status = 'delivered'
      and e.payload ? 'pricing'
      and coalesce(e.provider_timestamp, e.received_at) >= period_start
      and coalesce(e.provider_timestamp, e.received_at) < period_end
    order by e.meta_message_id, coalesce(e.provider_timestamp, e.received_at) desc
  )
  select
    count(*) filter (where pricing_type = 'free_customer_service'),
    count(*) filter (where pricing_type is distinct from 'free_customer_service' and billable),
    count(*) filter (where pricing_type is null),
    count(*)
  into free_used, billable_delivered, unknown_pricing, delivered_count
  from delivered;

  with delivered as (
    select distinct on (e.meta_message_id)
      e.meta_message_id,
      nullif(e.payload -> 'pricing' ->> 'type', '') as pricing_type,
      coalesce(nullif(e.payload -> 'pricing' ->> 'category', ''), 'unknown') as category,
      coalesce(
        (e.payload -> 'pricing' ->> 'billable')::boolean,
        coalesce(e.payload -> 'pricing' ->> 'type', '') <> 'free_customer_service'
      ) as billable
    from public.message_status_events e
    where e.tenant_id = p_tenant_id
      and e.status = 'delivered'
      and e.payload ? 'pricing'
      and coalesce(e.provider_timestamp, e.received_at) >= period_start
      and coalesce(e.provider_timestamp, e.received_at) < period_end
    order by e.meta_message_id, coalesce(e.provider_timestamp, e.received_at) desc
  )
  select coalesce(jsonb_object_agg(category, total), '{}'::jsonb) into by_category
  from (
    select category, count(*) as total
    from delivered
    where billable and pricing_type is distinct from 'free_customer_service'
    group by category
  ) grouped;

  has_pricing := delivered_count > 0;

  return jsonb_build_object(
    'connected', true,
    'phone_number_id', integration_row.phone_number_id,
    'waba_timezone', tz,
    'period_start', period_start,
    'period_end', period_end,
    'free_limit', 1000,
    'free_service_used', coalesce(free_used, 0),
    'free_service_remaining', greatest(0, 1000 - coalesce(free_used, 0)),
    'billable_delivered', coalesce(billable_delivered, 0),
    'billable_by_category', by_category,
    'unknown_pricing', coalesce(unknown_pricing, 0),
    'has_pricing_data', has_pricing,
    'messaging_limit_tier', integration_row.messaging_limit_tier,
    'quality_rating', integration_row.quality_rating,
    'last_capability_update_at', integration_row.last_capability_update_at
  );
end;
$$;

revoke all on function public.tenant_meta_allowance(uuid) from public, anon;
grant execute on function public.tenant_meta_allowance(uuid) to authenticated, service_role;

-- Support efficient per-tenant pricing lookups without scanning all events.
create index if not exists message_status_events_delivered_pricing_idx
  on public.message_status_events (tenant_id, status, provider_timestamp)
  where status = 'delivered';
