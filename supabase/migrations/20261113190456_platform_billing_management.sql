-- Platform billing ledger. All access is through owner-checked RPCs so the
-- browser never receives cross-tenant billing table privileges.

create sequence if not exists public.platform_invoice_number_seq;

create table if not exists public.platform_billing_tiers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  description text not null default '' check (length(description) <= 1000),
  currency text not null default 'KES' check (currency in ('KES', 'USD')),
  monthly_price_minor bigint not null check (monthly_price_minor >= 0),
  setup_fee_minor bigint not null default 0 check (setup_fee_minor >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_customer_accounts (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  billing_name text not null default '' check (length(billing_name) <= 160),
  billing_email text not null default '' check (length(billing_email) <= 254),
  billing_reference text not null default '' check (length(billing_reference) <= 100),
  billing_address text not null default '' check (length(billing_address) <= 1000),
  notes text not null default '' check (length(notes) <= 2000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_customer_subscriptions (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  tier_id uuid references public.platform_billing_tiers(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'paused', 'canceled')),
  currency text not null check (currency in ('KES', 'USD')),
  monthly_price_minor bigint not null check (monthly_price_minor >= 0),
  starts_on date not null default current_date,
  ends_on date,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);

create table if not exists public.platform_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  tenant_name_snapshot text not null,
  billing_name_snapshot text not null default '',
  billing_email_snapshot text not null default '',
  billing_reference_snapshot text not null default '',
  billing_address_snapshot text not null default '',
  currency text not null check (currency in ('KES', 'USD')),
  subtotal_minor bigint not null check (subtotal_minor > 0),
  due_on date not null,
  status text not null default 'issued' check (status in ('issued', 'void')),
  notes text not null default '' check (length(notes) <= 2000),
  issued_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists platform_invoices_tenant_issued_idx
  on public.platform_invoices (tenant_id, issued_at desc);
create index if not exists platform_invoices_due_idx
  on public.platform_invoices (due_on) where status = 'issued';

create table if not exists public.platform_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.platform_invoices(id) on delete restrict,
  description text not null check (length(trim(description)) between 1 and 240),
  quantity integer not null check (quantity between 1 and 10000),
  unit_amount_minor bigint not null check (unit_amount_minor >= 0),
  line_total_minor bigint generated always as (quantity::bigint * unit_amount_minor) stored
);
create index if not exists platform_invoice_items_invoice_idx
  on public.platform_invoice_items (invoice_id);

create table if not exists public.platform_invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.platform_invoices(id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  method text not null check (method in ('mpesa', 'bank_transfer', 'cash', 'card', 'other')),
  reference text not null default '' check (length(reference) <= 160),
  paid_at timestamptz not null default now(),
  recorded_by uuid references auth.users(id) on delete set null,
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id) on delete set null,
  reversal_reason text not null default '' check (length(reversal_reason) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists platform_invoice_payments_invoice_idx
  on public.platform_invoice_payments (invoice_id, paid_at desc);

create table if not exists public.platform_billing_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists platform_billing_audit_created_idx
  on public.platform_billing_audit (created_at desc);

alter table public.platform_billing_tiers enable row level security;
alter table public.platform_customer_accounts enable row level security;
alter table public.platform_customer_subscriptions enable row level security;
alter table public.platform_invoices enable row level security;
alter table public.platform_invoice_items enable row level security;
alter table public.platform_invoice_payments enable row level security;
alter table public.platform_billing_audit enable row level security;

revoke all on public.platform_billing_tiers, public.platform_customer_accounts,
  public.platform_customer_subscriptions, public.platform_invoices,
  public.platform_invoice_items, public.platform_invoice_payments,
  public.platform_billing_audit from public, anon, authenticated;
revoke all on sequence public.platform_invoice_number_seq from public, anon, authenticated;

create or replace function public.platform_billing_data()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if not exists (
    select 1 from public.platform_admins pa
    where pa.user_id = (select auth.uid()) and pa.role = 'owner'
  ) then
    raise exception 'Platform owner access required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'tiers', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.active desc, t.name)
      from public.platform_billing_tiers t
    ), '[]'::jsonb),
    'customers', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.name)
      from (
        select tn.id as tenant_id, tn.name, tn.slug,
          coalesce(a.billing_name, '') as billing_name,
          coalesce(a.billing_email, '') as billing_email,
          coalesce(a.billing_reference, '') as billing_reference,
          coalesce(a.billing_address, '') as billing_address,
          coalesce(a.notes, '') as notes,
          s.tier_id, t.name as tier_name, s.status as subscription_status,
          s.currency, s.monthly_price_minor,
          coalesce(inv.invoice_count, 0) as invoice_count,
          coalesce(inv.outstanding_minor, 0) as outstanding_minor,
          coalesce(inv.paid_minor, 0) as paid_minor
        from public.tenants tn
        left join public.platform_customer_accounts a on a.tenant_id = tn.id
        left join public.platform_customer_subscriptions s on s.tenant_id = tn.id
        left join public.platform_billing_tiers t on t.id = s.tier_id
        left join lateral (
          select count(*) as invoice_count,
            coalesce(sum(greatest(i.subtotal_minor - coalesce(p.paid_minor, 0), 0))
              filter (where i.status = 'issued'), 0) as outstanding_minor,
            coalesce(sum(coalesce(p.paid_minor, 0)), 0) as paid_minor
          from public.platform_invoices i
          left join lateral (
            select sum(pay.amount_minor) as paid_minor
            from public.platform_invoice_payments pay where pay.invoice_id = i.id and pay.reversed_at is null
          ) p on true
          where i.tenant_id = tn.id
        ) inv on true
      ) c
    ), '[]'::jsonb),
    'invoices', coalesce((
      select jsonb_agg(to_jsonb(i) || jsonb_build_object(
        'paid_minor', coalesce(p.paid_minor, 0),
        'items', coalesce(lines.items, '[]'::jsonb),
        'payments', coalesce(payments.rows, '[]'::jsonb)
      ) order by i.issued_at desc)
      from (
        select pi.*, coalesce(a.billing_name, pi.billing_name_snapshot) as customer_name
        from public.platform_invoices pi
        left join public.platform_customer_accounts a on a.tenant_id = pi.tenant_id
        order by pi.issued_at desc limit 200
      ) i
      left join lateral (
        select sum(pay.amount_minor) as paid_minor
        from public.platform_invoice_payments pay where pay.invoice_id = i.id and pay.reversed_at is null
      ) p on true
      left join lateral (
        select jsonb_agg(to_jsonb(it) order by it.id) as items
        from public.platform_invoice_items it where it.invoice_id = i.id
      ) lines on true
      left join lateral (
        select jsonb_agg(to_jsonb(pay) order by pay.paid_at desc) as rows
        from public.platform_invoice_payments pay where pay.invoice_id = i.id
      ) payments on true
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

create or replace function public.platform_billing_save_tier(
  p_id uuid, p_name text, p_description text, p_currency text,
  p_monthly_price_minor bigint, p_setup_fee_minor bigint, p_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved_id uuid;
begin
  if not exists (select 1 from public.platform_admins where user_id = (select auth.uid()) and role = 'owner') then
    raise exception 'Platform owner access required' using errcode = '42501';
  end if;
  if nullif(trim(p_name), '') is null or length(p_name) > 80
    or length(coalesce(p_description, '')) > 1000
    or p_currency not in ('KES', 'USD')
    or p_monthly_price_minor < 0 or p_setup_fee_minor < 0 then
    raise exception 'Invalid tier details' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.platform_billing_tiers(name, description, currency, monthly_price_minor, setup_fee_minor, active)
    values (trim(p_name), coalesce(p_description, ''), p_currency, p_monthly_price_minor, p_setup_fee_minor, p_active)
    returning id into saved_id;
  else
    update public.platform_billing_tiers
    set name = trim(p_name), description = coalesce(p_description, ''), currency = p_currency,
        monthly_price_minor = p_monthly_price_minor, setup_fee_minor = p_setup_fee_minor,
        active = p_active, updated_at = now()
    where id = p_id returning id into saved_id;
    if saved_id is null then raise exception 'Tier not found' using errcode = 'P0002'; end if;
  end if;
  insert into public.platform_billing_audit(actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), case when p_id is null then 'tier_created' else 'tier_updated' end,
    'tier', saved_id::text, jsonb_build_object('name', trim(p_name), 'active', p_active));
  return saved_id;
end;
$$;

create or replace function public.platform_billing_save_account(
  p_tenant_id uuid, p_billing_name text, p_billing_email text,
  p_billing_reference text, p_billing_address text, p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.platform_admins where user_id = (select auth.uid()) and role = 'owner') then
    raise exception 'Platform owner access required' using errcode = '42501';
  end if;
  if length(coalesce(p_billing_name, '')) > 160 or length(coalesce(p_billing_email, '')) > 254
    or length(coalesce(p_billing_reference, '')) > 100 or length(coalesce(p_billing_address, '')) > 1000
    or length(coalesce(p_notes, '')) > 2000 then
    raise exception 'Billing contact details exceed their allowed length' using errcode = '22023';
  end if;
  insert into public.platform_customer_accounts(tenant_id, billing_name, billing_email, billing_reference, billing_address, notes, updated_by, updated_at)
  values (p_tenant_id, coalesce(trim(p_billing_name), ''), coalesce(trim(p_billing_email), ''),
    coalesce(trim(p_billing_reference), ''), coalesce(trim(p_billing_address), ''), coalesce(trim(p_notes), ''),
    (select auth.uid()), now())
  on conflict (tenant_id) do update set
    billing_name = excluded.billing_name, billing_email = excluded.billing_email,
    billing_reference = excluded.billing_reference, billing_address = excluded.billing_address,
    notes = excluded.notes, updated_by = excluded.updated_by, updated_at = now();
  insert into public.platform_billing_audit(actor_id, action, entity_type, entity_id)
  values ((select auth.uid()), 'customer_account_updated', 'tenant', p_tenant_id::text);
  return p_tenant_id;
end;
$$;

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
begin
  if not exists (select 1 from public.platform_admins where user_id = (select auth.uid()) and role = 'owner') then
    raise exception 'Platform owner access required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'Client workspace not found' using errcode = 'P0002';
  end if;
  if p_status not in ('active', 'paused', 'canceled') then raise exception 'Invalid subscription status' using errcode = '22023'; end if;
  select * into existing_subscription from public.platform_customer_subscriptions where tenant_id = p_tenant_id;
  if p_tier_id is null then
    if p_status = 'active' then raise exception 'An active subscription requires a tier' using errcode = '22023'; end if;
    insert into public.platform_customer_subscriptions(tenant_id, tier_id, status, currency, monthly_price_minor, starts_on, ends_on, updated_by, updated_at)
    values (p_tenant_id, null, p_status, 'KES', 0, coalesce(p_starts_on, current_date),
      case when p_status = 'canceled' then current_date else null end, (select auth.uid()), now())
    on conflict (tenant_id) do update set tier_id = null, status = excluded.status, currency = 'KES', monthly_price_minor = 0,
      starts_on = excluded.starts_on, ends_on = excluded.ends_on, updated_by = excluded.updated_by, updated_at = now();
  else
    select * into chosen from public.platform_billing_tiers
    where id = p_tier_id and (active or (existing_subscription.tenant_id = p_tenant_id and existing_subscription.tier_id = p_tier_id));
    if not found then raise exception 'Active tier not found' using errcode = 'P0002'; end if;
    if existing_subscription.tenant_id = p_tenant_id and existing_subscription.tier_id = p_tier_id then
      chosen.currency := existing_subscription.currency;
      chosen.monthly_price_minor := existing_subscription.monthly_price_minor;
    end if;
    insert into public.platform_customer_subscriptions(tenant_id, tier_id, status, currency, monthly_price_minor, starts_on, ends_on, updated_by, updated_at)
    values (p_tenant_id, chosen.id, p_status, chosen.currency, chosen.monthly_price_minor, coalesce(p_starts_on, current_date),
      case when p_status = 'canceled' then current_date else null end, (select auth.uid()), now())
    on conflict (tenant_id) do update set tier_id = excluded.tier_id, status = excluded.status, currency = excluded.currency,
      monthly_price_minor = excluded.monthly_price_minor, starts_on = excluded.starts_on, ends_on = excluded.ends_on,
      updated_by = excluded.updated_by, updated_at = now();
  end if;
  insert into public.platform_billing_audit(actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'subscription_updated', 'tenant', p_tenant_id::text,
    jsonb_build_object('tier_id', p_tier_id, 'status', p_status));
  return p_tenant_id;
end;
$$;

create or replace function public.platform_billing_save_customer(
  p_tenant_id uuid, p_billing_name text, p_billing_email text,
  p_billing_reference text, p_billing_address text, p_notes text,
  p_tier_id uuid, p_subscription_status text, p_starts_on date
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.platform_admins where user_id = (select auth.uid()) and role = 'owner') then
    raise exception 'Platform owner access required' using errcode = '42501';
  end if;
  perform public.platform_billing_save_account(p_tenant_id, p_billing_name, p_billing_email,
    p_billing_reference, p_billing_address, p_notes);
  if p_subscription_status is not null then
    perform public.platform_billing_assign_tier(p_tenant_id, p_tier_id, p_subscription_status, p_starts_on);
  elsif p_tier_id is not null then
    raise exception 'Choose a subscription status when assigning a tier' using errcode = '22023';
  end if;
  return p_tenant_id;
end;
$$;

create or replace function public.platform_billing_issue_invoice(
  p_tenant_id uuid, p_due_on date, p_items jsonb, p_notes text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  tenant_row public.tenants%rowtype;
  account_row public.platform_customer_accounts%rowtype;
  subscription_row public.platform_customer_subscriptions%rowtype;
  invoice_id uuid;
  next_invoice_number text;
  total_minor bigint;
begin
  if not exists (select 1 from public.platform_admins where user_id = (select auth.uid()) and role = 'owner') then
    raise exception 'Platform owner access required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 30
    or length(coalesce(p_notes, '')) > 2000 then
    raise exception 'Add between 1 and 30 invoice lines and keep notes under 2000 characters' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as line(description text, quantity integer, unit_amount_minor bigint)
    where nullif(trim(line.description), '') is null or length(line.description) > 240
      or line.quantity not between 1 and 10000 or line.unit_amount_minor not between 0 and 900000000000
  ) then raise exception 'Invalid invoice line' using errcode = '22023'; end if;
  select sum(line.quantity::bigint * line.unit_amount_minor) into total_minor
  from jsonb_to_recordset(p_items) as line(description text, quantity integer, unit_amount_minor bigint);
  if coalesce(total_minor, 0) <= 0 or total_minor > 9000000000000000 then
    raise exception 'Invoice total must be greater than zero and within the supported range' using errcode = '22023';
  end if;
  select * into tenant_row from public.tenants where id = p_tenant_id;
  if not found then raise exception 'Client workspace not found' using errcode = 'P0002'; end if;
  select * into account_row from public.platform_customer_accounts where tenant_id = p_tenant_id;
  select * into subscription_row from public.platform_customer_subscriptions where tenant_id = p_tenant_id;
  next_invoice_number := 'MW-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.platform_invoice_number_seq')::text, 6, '0');
  insert into public.platform_invoices(invoice_number, tenant_id, tenant_name_snapshot, billing_name_snapshot,
    billing_email_snapshot, billing_reference_snapshot, billing_address_snapshot, currency, subtotal_minor, due_on, notes, created_by)
  values (next_invoice_number, p_tenant_id, tenant_row.name, coalesce(account_row.billing_name, ''),
      coalesce(account_row.billing_email, ''), coalesce(account_row.billing_reference, ''), coalesce(account_row.billing_address, ''),
    coalesce(subscription_row.currency, 'KES'), total_minor, p_due_on, coalesce(p_notes, ''), (select auth.uid()))
  returning id into invoice_id;
  insert into public.platform_invoice_items(invoice_id, description, quantity, unit_amount_minor)
  select invoice_id, line.description, line.quantity, line.unit_amount_minor
  from jsonb_to_recordset(p_items) as line(description text, quantity integer, unit_amount_minor bigint);
  insert into public.platform_billing_audit(actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'invoice_issued', 'invoice', invoice_id::text,
    jsonb_build_object('invoice_number', next_invoice_number, 'tenant_id', p_tenant_id, 'total_minor', total_minor));
  return invoice_id;
end;
$$;

create or replace function public.platform_billing_record_payment(
  p_invoice_id uuid, p_amount_minor bigint, p_method text, p_reference text, p_paid_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  invoice_row public.platform_invoices%rowtype;
  paid_minor bigint;
  payment_id uuid;
begin
  if not exists (select 1 from public.platform_admins where user_id = (select auth.uid()) and role = 'owner') then
    raise exception 'Platform owner access required' using errcode = '42501';
  end if;
  select * into invoice_row from public.platform_invoices where id = p_invoice_id for update;
  if not found or invoice_row.status <> 'issued' then raise exception 'Issued invoice not found' using errcode = 'P0002'; end if;
  if p_amount_minor <= 0 or p_method not in ('mpesa', 'bank_transfer', 'cash', 'card', 'other')
    or length(coalesce(p_reference, '')) > 160 then raise exception 'Invalid payment details' using errcode = '22023'; end if;
  select coalesce(sum(amount_minor), 0) into paid_minor from public.platform_invoice_payments where invoice_id = p_invoice_id and reversed_at is null;
  if p_amount_minor > invoice_row.subtotal_minor - paid_minor then
    raise exception 'Payment exceeds the remaining invoice balance' using errcode = '22023';
  end if;
  insert into public.platform_invoice_payments(invoice_id, amount_minor, method, reference, paid_at, recorded_by)
  values (p_invoice_id, p_amount_minor, p_method, coalesce(trim(p_reference), ''), coalesce(p_paid_at, now()), (select auth.uid()))
  returning id into payment_id;
  insert into public.platform_billing_audit(actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'payment_recorded', 'invoice', p_invoice_id::text,
    jsonb_build_object('payment_id', payment_id, 'amount_minor', p_amount_minor, 'method', p_method, 'reference', coalesce(p_reference, '')));
  return payment_id;
end;
$$;

create or replace function public.platform_billing_reverse_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice_id uuid;
begin
  if not exists (select 1 from public.platform_admins where user_id = (select auth.uid()) and role = 'owner') then
    raise exception 'Platform owner access required' using errcode = '42501';
  end if;
  select pay.invoice_id into v_invoice_id
  from public.platform_invoice_payments pay
  where pay.id = p_payment_id;
  if v_invoice_id is null then raise exception 'Payment not found' using errcode = 'P0002'; end if;
  perform 1 from public.platform_invoices where id = v_invoice_id and status = 'issued' for update;
  if not found then raise exception 'Issued invoice not found' using errcode = 'P0002'; end if;
  if nullif(trim(p_reason), '') is null or length(p_reason) > 500 then
    raise exception 'A short reason is required to reverse a payment' using errcode = '22023';
  end if;
  update public.platform_invoice_payments as pay
  set reversed_at = now(), reversed_by = (select auth.uid()), reversal_reason = trim(p_reason)
  where pay.id = p_payment_id and pay.invoice_id = v_invoice_id and pay.reversed_at is null;
  if not found then raise exception 'Payment was already reversed' using errcode = '22023'; end if;
  insert into public.platform_billing_audit(actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'payment_reversed', 'invoice', v_invoice_id::text,
    jsonb_build_object('payment_id', p_payment_id, 'reason', trim(p_reason)));
end;
$$;

create or replace function public.platform_billing_void_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.platform_admins where user_id = (select auth.uid()) and role = 'owner') then
    raise exception 'Platform owner access required' using errcode = '42501';
  end if;
  perform 1 from public.platform_invoices where id = p_invoice_id and status = 'issued' for update;
  if not found then raise exception 'Issued invoice not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.platform_invoice_payments where invoice_id = p_invoice_id) then
    raise exception 'Invoices with recorded payments cannot be voided' using errcode = '22023';
  end if;
  update public.platform_invoices set status = 'void' where id = p_invoice_id;
  insert into public.platform_billing_audit(actor_id, action, entity_type, entity_id)
  values ((select auth.uid()), 'invoice_voided', 'invoice', p_invoice_id::text);
end;
$$;

revoke all on function public.platform_billing_data() from public, anon;
revoke all on function public.platform_billing_save_tier(uuid, text, text, text, bigint, bigint, boolean) from public, anon;
revoke all on function public.platform_billing_save_account(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.platform_billing_save_customer(uuid, text, text, text, text, text, uuid, text, date) from public, anon;
revoke all on function public.platform_billing_assign_tier(uuid, uuid, text, date) from public, anon, authenticated;
revoke all on function public.platform_billing_issue_invoice(uuid, date, jsonb, text) from public, anon;
revoke all on function public.platform_billing_record_payment(uuid, bigint, text, text, timestamptz) from public, anon;
revoke all on function public.platform_billing_reverse_payment(uuid, text) from public, anon;
revoke all on function public.platform_billing_void_invoice(uuid) from public, anon;
grant execute on function public.platform_billing_data() to authenticated;
grant execute on function public.platform_billing_save_tier(uuid, text, text, text, bigint, bigint, boolean) to authenticated;
grant execute on function public.platform_billing_save_customer(uuid, text, text, text, text, text, uuid, text, date) to authenticated;
grant execute on function public.platform_billing_issue_invoice(uuid, date, jsonb, text) to authenticated;
grant execute on function public.platform_billing_record_payment(uuid, bigint, text, text, timestamptz) to authenticated;
grant execute on function public.platform_billing_reverse_payment(uuid, text) to authenticated;
grant execute on function public.platform_billing_void_invoice(uuid) to authenticated;
