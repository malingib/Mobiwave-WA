alter table public.platform_customer_subscriptions
  add column if not exists admin_override boolean not null default false;

update public.platform_customer_subscriptions
set admin_override = (status = 'active' and updated_by is not null);

create or replace function public.platform_billing_assign_tier(
  p_tenant_id uuid,
  p_tier_id uuid,
  p_status text,
  p_starts_on date
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
      updated_by, admin_override, updated_at, last_status_change_at
    ) values (
      p_tenant_id, null, p_status, 'KES', 0, coalesce(p_starts_on, current_date),
      case when p_status = 'canceled' then current_date else null end,
      next_trial, next_grace, next_suspended, next_canceled,
      (select auth.uid()), (p_status = 'active'), now(), now()
    )
    on conflict (tenant_id) do update set
      tier_id = null, status = excluded.status, currency = 'KES', monthly_price_minor = 0,
      starts_on = excluded.starts_on, ends_on = excluded.ends_on,
      trial_ends_on = excluded.trial_ends_on, grace_ends_on = excluded.grace_ends_on,
      suspended_at = excluded.suspended_at, canceled_at = excluded.canceled_at,
      updated_by = excluded.updated_by, admin_override = excluded.admin_override,
      updated_at = now(), last_status_change_at = now();
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
      updated_by, admin_override, updated_at, last_status_change_at
    ) values (
      p_tenant_id, chosen.id, p_status, chosen.currency, chosen.monthly_price_minor,
      coalesce(p_starts_on, current_date),
      case when p_status = 'canceled' then current_date else null end,
      next_trial, next_grace, next_suspended, next_canceled,
      (select auth.uid()), (p_status = 'active'), now(), now()
    )
    on conflict (tenant_id) do update set
      tier_id = excluded.tier_id, status = excluded.status, currency = excluded.currency,
      monthly_price_minor = excluded.monthly_price_minor, starts_on = excluded.starts_on,
      ends_on = excluded.ends_on, trial_ends_on = excluded.trial_ends_on,
      grace_ends_on = excluded.grace_ends_on, suspended_at = excluded.suspended_at,
      canceled_at = excluded.canceled_at, updated_by = excluded.updated_by,
      admin_override = excluded.admin_override, updated_at = now(), last_status_change_at = now();
  end if;

  insert into public.platform_billing_audit(actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'subscription_updated', 'tenant', p_tenant_id::text,
    jsonb_build_object('tier_id', p_tier_id, 'status', p_status,
      'admin_override', (p_status = 'active'),
      'trial_ends_on', next_trial, 'grace_ends_on', next_grace));
  return p_tenant_id;
end;
$function$;

create or replace function public.platform_paystack_settle_invoice(
  p_reference text,
  p_gateway_transaction_id text,
  p_amount_minor bigint,
  p_currency text,
  p_customer_email text,
  p_gateway_response jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  transaction_row public.platform_paystack_transactions%rowtype;
  invoice_row public.platform_invoices%rowtype;
  subscription_row public.platform_customer_subscriptions%rowtype;
  tier_row public.platform_billing_tiers%rowtype;
  paid_minor bigint;
  balance_minor bigint;
  next_end date;
  has_monthly_subscription boolean := false;
  activated boolean := false;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  select * into transaction_row
  from public.platform_paystack_transactions
  where reference = p_reference
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'checkout_reference_not_found');
  end if;
  if transaction_row.status = 'success' then
    return jsonb_build_object('ok', true, 'duplicate', true, 'invoice_id', transaction_row.invoice_id);
  end if;
  if transaction_row.status not in ('initializing', 'pending') then
    return jsonb_build_object('ok', false, 'error', 'checkout_not_settleable');
  end if;

  select * into invoice_row
  from public.platform_invoices
  where id = transaction_row.invoice_id
  for update;

  if not found then
    update public.platform_paystack_transactions
    set status = 'review', failure_reason = 'Invoice no longer exists', updated_at = now()
    where id = transaction_row.id;
    return jsonb_build_object('ok', false, 'error', 'invoice_not_found');
  end if;

  if p_gateway_transaction_id is null or p_gateway_transaction_id = ''
    or p_amount_minor <> transaction_row.amount_minor
    or p_currency <> transaction_row.currency
    or lower(coalesce(p_customer_email, '')) <> lower(transaction_row.customer_email) then
    update public.platform_paystack_transactions
    set status = 'review',
        gateway_transaction_id = nullif(p_gateway_transaction_id, ''),
        gateway_response = coalesce(p_gateway_response, '{}'::jsonb),
        failure_reason = 'Verified Paystack transaction did not match expected amount, currency or customer',
        updated_at = now()
    where id = transaction_row.id;
    return jsonb_build_object('ok', false, 'error', 'verified_transaction_mismatch');
  end if;

  select coalesce(sum(amount_minor), 0) into paid_minor
  from public.platform_invoice_payments
  where invoice_id = invoice_row.id and reversed_at is null;

  balance_minor := greatest(invoice_row.subtotal_minor - paid_minor, 0);
  if invoice_row.status <> 'issued' or balance_minor <> transaction_row.amount_minor then
    update public.platform_paystack_transactions
    set status = 'review',
        gateway_transaction_id = nullif(p_gateway_transaction_id, ''),
        gateway_response = coalesce(p_gateway_response, '{}'::jsonb),
        failure_reason = 'Invoice balance changed or invoice is no longer payable; manual reconciliation required',
        updated_at = now()
    where id = transaction_row.id;
    return jsonb_build_object('ok', false, 'error', 'invoice_balance_changed');
  end if;

  insert into public.platform_invoice_payments(
    invoice_id, amount_minor, method, reference, paid_at, recorded_by, reversal_reason
  ) values (
    invoice_row.id, transaction_row.amount_minor, 'paystack', transaction_row.reference, now(), null, ''
  );

  update public.platform_invoices set status = 'paid' where id = invoice_row.id;

  select exists(
    select 1 from public.platform_invoice_items item
    where item.invoice_id = invoice_row.id
      and item.description ilike '%monthly subscription%'
  ) into has_monthly_subscription;

  if has_monthly_subscription then
    select * into subscription_row
    from public.platform_customer_subscriptions
    where tenant_id = invoice_row.tenant_id
    for update;

    if found then
      next_end := greatest(coalesce(subscription_row.ends_on, current_date), current_date) + interval '1 month';
      update public.platform_customer_subscriptions
      set status = 'active',
          admin_override = false,
          starts_on = current_date,
          ends_on = next_end,
          suspended_at = null,
          canceled_at = null,
          grace_ends_on = null,
          last_status_change_at = now(),
          updated_at = now()
      where tenant_id = invoice_row.tenant_id;

      if subscription_row.tier_id is not null then
        select * into tier_row
        from public.platform_billing_tiers
        where id = subscription_row.tier_id;

        update public.tenant_usage_limits
        set monthly_message_limit = coalesce(tier_row.monthly_message_limit, 0),
            updated_at = now()
        where tenant_id = invoice_row.tenant_id;
      end if;
      activated := true;
    end if;
  end if;

  update public.platform_paystack_transactions
  set status = 'success',
      gateway_transaction_id = p_gateway_transaction_id,
      gateway_response = coalesce(p_gateway_response, '{}'::jsonb),
      failure_reason = null,
      paid_at = now(),
      updated_at = now()
  where id = transaction_row.id;

  insert into public.platform_billing_audit(actor_id, action, entity_type, entity_id, details)
  values (
    null,
    'paystack_invoice_payment_applied',
    'invoice',
    invoice_row.id::text,
    jsonb_build_object(
      'tenant_id', invoice_row.tenant_id,
      'invoice_number', invoice_row.invoice_number,
      'reference', transaction_row.reference,
      'gateway_transaction_id', p_gateway_transaction_id,
      'amount_minor', transaction_row.amount_minor,
      'currency', transaction_row.currency,
      'subscription_activated', activated,
      'subscription_ends_on', next_end,
      'admin_override_cleared', has_monthly_subscription
    )
  );

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'invoice_id', invoice_row.id,
    'invoice_number', invoice_row.invoice_number,
    'subscription_activated', activated,
    'subscription_ends_on', next_end
  );
end;
$function$;
