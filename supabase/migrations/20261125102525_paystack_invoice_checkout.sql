-- Paystack hosted checkout and invoice-specific settlement.
-- The provider ledger is service-role only; customers interact through Edge Functions.

alter table public.platform_invoice_payments
  drop constraint if exists platform_invoice_payments_method_check;
alter table public.platform_invoice_payments
  add constraint platform_invoice_payments_method_check
  check (method in ('mpesa', 'bank_transfer', 'cash', 'card', 'paystack', 'other'));

create unique index if not exists platform_invoice_payments_paystack_reference_uidx
  on public.platform_invoice_payments(reference)
  where method = 'paystack' and reference <> '';

create table if not exists public.platform_paystack_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  invoice_id uuid not null references public.platform_invoices(id) on delete restrict,
  reference text not null unique check (reference ~ '^MWPAY-[A-Za-z0-9-]{16,80}$'),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency in ('KES', 'USD')),
  customer_email text not null check (length(customer_email) between 3 and 254),
  status text not null default 'initializing'
    check (status in ('initializing', 'pending', 'success', 'failed', 'review')),
  authorization_url text,
  access_code text,
  gateway_transaction_id text,
  gateway_response jsonb not null default '{}'::jsonb,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists platform_paystack_transactions_tenant_created_idx
  on public.platform_paystack_transactions(tenant_id, created_at desc);
create index if not exists platform_paystack_transactions_invoice_created_idx
  on public.platform_paystack_transactions(invoice_id, created_at desc);
create unique index if not exists platform_paystack_gateway_transaction_uidx
  on public.platform_paystack_transactions(gateway_transaction_id)
  where gateway_transaction_id is not null;
create unique index if not exists platform_paystack_one_open_checkout_per_invoice_uidx
  on public.platform_paystack_transactions(invoice_id)
  where status in ('initializing', 'pending');

alter table public.platform_paystack_transactions enable row level security;
revoke all on public.platform_paystack_transactions from public, anon, authenticated;
grant select, insert, update on public.platform_paystack_transactions to service_role;

create or replace function public.platform_paystack_prepare_checkout(
  p_invoice_id uuid,
  p_reference text,
  p_customer_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  invoice_row public.platform_invoices%rowtype;
  existing_row public.platform_paystack_transactions%rowtype;
  paid_minor bigint;
  balance_minor bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_reference !~ '^MWPAY-[A-Za-z0-9-]{16,80}$'
     or p_customer_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Invalid checkout reference or billing email' using errcode = '22023';
  end if;

  select * into invoice_row
  from public.platform_invoices
  where id = p_invoice_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invoice_not_found');
  end if;
  if invoice_row.status <> 'issued' then
    return jsonb_build_object('ok', false, 'error', 'invoice_not_payable');
  end if;

  select coalesce(sum(amount_minor), 0) into paid_minor
  from public.platform_invoice_payments
  where invoice_id = invoice_row.id and reversed_at is null;
  balance_minor := greatest(invoice_row.subtotal_minor - paid_minor, 0);
  if balance_minor <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invoice_already_settled');
  end if;

  select * into existing_row
  from public.platform_paystack_transactions
  where invoice_id = invoice_row.id and status in ('initializing', 'pending')
  order by created_at desc
  limit 1
  for update;

  if found then
    if existing_row.status = 'initializing' and existing_row.created_at < now() - interval '5 minutes' then
      update public.platform_paystack_transactions
      set status = 'failed', failure_reason = 'Checkout initialization timed out', updated_at = now()
      where id = existing_row.id;
    else
      if existing_row.amount_minor <> balance_minor or existing_row.currency <> invoice_row.currency then
        return jsonb_build_object('ok', false, 'error', 'existing_checkout_amount_conflict');
      end if;
      if existing_row.authorization_url is null then
        return jsonb_build_object('ok', false, 'error', 'checkout_initializing');
      end if;
      return jsonb_build_object(
        'ok', true, 'created', false,
        'reference', existing_row.reference,
        'authorization_url', existing_row.authorization_url,
        'amount_minor', existing_row.amount_minor,
        'currency', existing_row.currency,
        'invoice_number', invoice_row.invoice_number
      );
    end if;
  end if;

  insert into public.platform_paystack_transactions(
    tenant_id, invoice_id, reference, amount_minor, currency, customer_email, status
  ) values (
    invoice_row.tenant_id, invoice_row.id, p_reference, balance_minor,
    invoice_row.currency, lower(trim(p_customer_email)), 'initializing'
  );

  return jsonb_build_object(
    'ok', true, 'created', true,
    'reference', p_reference,
    'amount_minor', balance_minor,
    'currency', invoice_row.currency,
    'invoice_number', invoice_row.invoice_number
  );
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
set search_path = public, pg_temp
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
  if coalesce(auth.role(), '') <> 'service_role' then
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
      set status = 'review', gateway_transaction_id = nullif(p_gateway_transaction_id, ''),
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
      set status = 'review', gateway_transaction_id = nullif(p_gateway_transaction_id, ''),
          gateway_response = coalesce(p_gateway_response, '{}'::jsonb),
          failure_reason = 'Invoice balance changed or invoice is no longer payable; manual reconciliation required',
          updated_at = now()
      where id = transaction_row.id;
    return jsonb_build_object('ok', false, 'error', 'invoice_balance_changed');
  end if;

  insert into public.platform_invoice_payments(
    invoice_id, amount_minor, method, reference, paid_at, recorded_by, reversal_reason
  ) values (
    invoice_row.id, transaction_row.amount_minor, 'paystack', transaction_row.reference,
    now(), null, ''
  );

  update public.platform_invoices
  set status = 'paid'
  where id = invoice_row.id;

  select exists (
    select 1
    from public.platform_invoice_items item
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
    null, 'paystack_invoice_payment_applied', 'invoice', invoice_row.id::text,
    jsonb_build_object(
      'tenant_id', invoice_row.tenant_id,
      'invoice_number', invoice_row.invoice_number,
      'reference', transaction_row.reference,
      'gateway_transaction_id', p_gateway_transaction_id,
      'amount_minor', transaction_row.amount_minor,
      'currency', transaction_row.currency,
      'subscription_activated', activated,
      'subscription_ends_on', next_end
    )
  );

  return jsonb_build_object(
    'ok', true, 'duplicate', false,
    'invoice_id', invoice_row.id,
    'invoice_number', invoice_row.invoice_number,
    'subscription_activated', activated,
    'subscription_ends_on', next_end
  );
end;
$function$;

revoke all on function public.platform_paystack_prepare_checkout(uuid, text, text) from public, anon, authenticated;
revoke all on function public.platform_paystack_settle_invoice(text, text, bigint, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.platform_paystack_prepare_checkout(uuid, text, text) to service_role;
grant execute on function public.platform_paystack_settle_invoice(text, text, bigint, text, text, jsonb) to service_role;
