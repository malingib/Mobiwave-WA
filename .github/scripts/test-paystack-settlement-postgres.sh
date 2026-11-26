#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point to the disposable CI PostgreSQL service}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
migration="$repo_root/supabase/migrations/20261125180004_explicit_subscription_admin_override.sql"
tmpfile="$(mktemp)"
tmpdir="$(mktemp -d)"
trap 'rm -f "$tmpfile"; rm -rf "$tmpdir"' EXIT

cat > "$tmpfile" <<'SQL'
create schema if not exists auth;
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;

create table public.platform_invoices (
  id uuid primary key,
  tenant_id uuid not null,
  invoice_number text not null,
  status text not null,
  subtotal_minor bigint not null,
  currency text not null
);
create table public.platform_paystack_transactions (
  id uuid primary key,
  tenant_id uuid not null,
  invoice_id uuid not null,
  reference text not null unique,
  amount_minor bigint not null,
  currency text not null,
  customer_email text not null,
  status text not null,
  gateway_transaction_id text,
  gateway_response jsonb not null default '{}'::jsonb,
  failure_reason text,
  paid_at timestamptz,
  updated_at timestamptz
);
create unique index platform_paystack_gateway_transaction_uidx
  on public.platform_paystack_transactions(gateway_transaction_id)
  where gateway_transaction_id is not null;
create table public.platform_invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null,
  amount_minor bigint not null,
  method text not null,
  reference text not null default '',
  paid_at timestamptz not null default now(),
  recorded_by uuid,
  reversal_reason text not null default '',
  reversed_at timestamptz
);
create unique index platform_invoice_payments_paystack_reference_uidx
  on public.platform_invoice_payments(reference)
  where method = 'paystack' and reference <> '';
create table public.platform_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null,
  description text not null
);
create table public.platform_customer_subscriptions (
  tenant_id uuid primary key,
  tier_id uuid,
  status text not null,
  admin_override boolean not null default false,
  starts_on date not null default current_date,
  ends_on date,
  suspended_at timestamptz,
  canceled_at timestamptz,
  grace_ends_on date,
  last_status_change_at timestamptz,
  updated_at timestamptz
);
create table public.platform_billing_tiers (
  id uuid primary key,
  monthly_message_limit integer
);
create table public.tenant_usage_limits (
  tenant_id uuid primary key,
  monthly_message_limit integer,
  updated_at timestamptz
);
create table public.platform_billing_audit (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  details jsonb not null
);
SQL

# Execute the exact settlement function shipped in the production migration.
awk '
  /^create or replace function public\.platform_paystack_settle_invoice\(/ { printing = 1 }
  printing { print }
  printing && /^\$function\$;/ { exit }
' "$migration" >> "$tmpfile"

if ! grep -q '^\$function\$;' "$tmpfile"; then
  echo "Could not extract platform_paystack_settle_invoice from $migration" >&2
  exit 1
fi

cat >> "$tmpfile" <<'SQL'
insert into public.platform_billing_tiers(id, monthly_message_limit)
values ('00000000-0000-0000-0000-000000002001', 1000);

insert into public.platform_invoices(id, tenant_id, invoice_number, status, subtotal_minor, currency) values
  ('00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000000001', 'TEST-001', 'issued', 20000, 'KES'),
  ('00000000-0000-0000-0000-000000001002', '00000000-0000-0000-0000-000000000002', 'TEST-002', 'issued', 10000, 'KES'),
  ('00000000-0000-0000-0000-000000001003', '00000000-0000-0000-0000-000000000003', 'TEST-003', 'issued', 7000, 'KES'),
  ('00000000-0000-0000-0000-000000001004', '00000000-0000-0000-0000-000000000004', 'TEST-004', 'issued', 10000, 'KES'),
  ('00000000-0000-0000-0000-000000001005', '00000000-0000-0000-0000-000000000005', 'TEST-005', 'issued', 30000, 'KES');

insert into public.platform_invoice_items(invoice_id, description) values
  ('00000000-0000-0000-0000-000000001001', 'Growth monthly subscription'),
  ('00000000-0000-0000-0000-000000001002', 'Growth monthly subscription'),
  ('00000000-0000-0000-0000-000000001003', 'Assisted onboarding setup'),
  ('00000000-0000-0000-0000-000000001004', 'Growth monthly subscription'),
  ('00000000-0000-0000-0000-000000001005', 'Growth monthly subscription');

insert into public.platform_invoice_payments(invoice_id, amount_minor, method, reference)
values ('00000000-0000-0000-0000-000000001001', 5000, 'bank_transfer', 'MANUAL-001');

insert into public.platform_customer_subscriptions(
  tenant_id, tier_id, status, admin_override, starts_on, ends_on
) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000002001', 'suspended', false, current_date - 30, null),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000002001', 'suspended', false, current_date - 30, null),
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000002001', 'suspended', false, current_date - 30, null),
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000002001', 'active', true, current_date - 30, current_date + 10),
  ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000002001', 'suspended', false, current_date - 30, null);

insert into public.tenant_usage_limits(tenant_id, monthly_message_limit)
select tenant_id, 0 from public.platform_customer_subscriptions;

insert into public.platform_paystack_transactions(
  id, tenant_id, invoice_id, reference, amount_minor, currency, customer_email, status
) values
  ('00000000-0000-0000-0000-000000003001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001001', 'MWPAY-00000000-0000-0000-0000-000000000001', 15000, 'KES', 'one@example.test', 'pending'),
  ('00000000-0000-0000-0000-000000003002', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001002', 'MWPAY-00000000-0000-0000-0000-000000000002', 10000, 'KES', 'two@example.test', 'pending'),
  ('00000000-0000-0000-0000-000000003003', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001003', 'MWPAY-00000000-0000-0000-0000-000000000003', 7000, 'KES', 'three@example.test', 'pending'),
  ('00000000-0000-0000-0000-000000003004', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001004', 'MWPAY-00000000-0000-0000-0000-000000000004', 10000, 'KES', 'four@example.test', 'pending'),
  ('00000000-0000-0000-0000-000000003005', '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001005', 'MWPAY-00000000-0000-0000-0000-000000000005', 30000, 'KES', 'five@example.test', 'pending');
SQL

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$tmpfile"

# Exercise settlement rules against the extracted production function.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
set request.jwt.claims = '{"role":"service_role"}';

do $$
declare
  result jsonb;
  saved_end date;
  payment_count integer;
begin
  -- Outstanding balance must be calculated correctly after an earlier manual payment.
  result := public.platform_paystack_settle_invoice(
    'MWPAY-00000000-0000-0000-0000-000000000001',
    'gateway-transaction-001', 15000, 'KES', 'one@example.test',
    '{"status":"success"}'::jsonb
  );
  if result->>'ok' <> 'true' or result->>'duplicate' <> 'false' or result->>'subscription_activated' <> 'true' then
    raise exception 'Valid monthly invoice settlement failed: %', result;
  end if;
  if (select status from public.platform_invoices where id='00000000-0000-0000-0000-000000001001') <> 'paid' then
    raise exception 'Valid settlement did not mark invoice paid';
  end if;
  if (select count(*) from public.platform_invoice_payments where reference='MWPAY-00000000-0000-0000-0000-000000000001' and method='paystack') <> 1 then
    raise exception 'Valid settlement did not create exactly one Paystack ledger entry';
  end if;
  if (select status from public.platform_customer_subscriptions where tenant_id='00000000-0000-0000-0000-000000000001') <> 'active'
     or (select admin_override from public.platform_customer_subscriptions where tenant_id='00000000-0000-0000-0000-000000000001') then
    raise exception 'Verified monthly payment did not reactivate subscription correctly';
  end if;
  if (select monthly_message_limit from public.tenant_usage_limits where tenant_id='00000000-0000-0000-0000-000000000001') <> 1000 then
    raise exception 'Verified monthly payment did not restore tier usage limit';
  end if;

  select ends_on into saved_end from public.platform_customer_subscriptions where tenant_id='00000000-0000-0000-0000-000000000001';
  result := public.platform_paystack_settle_invoice(
    'MWPAY-00000000-0000-0000-0000-000000000001',
    'gateway-transaction-001', 15000, 'KES', 'one@example.test',
    '{"status":"success"}'::jsonb
  );
  if result->>'duplicate' <> 'true' then raise exception 'Duplicate webhook was not acknowledged idempotently: %', result; end if;
  select count(*) into payment_count from public.platform_invoice_payments where reference='MWPAY-00000000-0000-0000-0000-000000000001' and method='paystack';
  if payment_count <> 1 then raise exception 'Duplicate settlement created % payment ledger rows', payment_count; end if;
  if (select ends_on from public.platform_customer_subscriptions where tenant_id='00000000-0000-0000-0000-000000000001') <> saved_end then
    raise exception 'Duplicate settlement extended the subscription more than once';
  end if;

  -- Mismatched verified amount must be quarantined and must not grant access.
  result := public.platform_paystack_settle_invoice(
    'MWPAY-00000000-0000-0000-0000-000000000002',
    'gateway-transaction-002', 9999, 'KES', 'two@example.test',
    '{"status":"success"}'::jsonb
  );
  if result->>'ok' <> 'false' or result->>'error' <> 'verified_transaction_mismatch' then
    raise exception 'Amount mismatch was not rejected: %', result;
  end if;
  if (select status from public.platform_paystack_transactions where reference='MWPAY-00000000-0000-0000-0000-000000000002') <> 'review'
     or (select status from public.platform_invoices where id='00000000-0000-0000-0000-000000001002') <> 'issued'
     or (select status from public.platform_customer_subscriptions where tenant_id='00000000-0000-0000-0000-000000000002') <> 'suspended'
     or exists (select 1 from public.platform_invoice_payments where reference='MWPAY-00000000-0000-0000-0000-000000000002') then
    raise exception 'Mismatched payment changed invoice, ledger, or subscription state';
  end if;

  -- Assisted-onboarding-only invoices must not activate a subscription.
  result := public.platform_paystack_settle_invoice(
    'MWPAY-00000000-0000-0000-0000-000000000003',
    'gateway-transaction-003', 7000, 'KES', 'three@example.test',
    '{"status":"success"}'::jsonb
  );
  if result->>'ok' <> 'true' or result->>'subscription_activated' <> 'false' then
    raise exception 'Setup-only invoice settlement result was incorrect: %', result;
  end if;
  if (select status from public.platform_customer_subscriptions where tenant_id='00000000-0000-0000-0000-000000000003') <> 'suspended' then
    raise exception 'Setup-only invoice incorrectly activated a subscription';
  end if;

  -- A verified subscription payment clears a prior explicit admin override.
  result := public.platform_paystack_settle_invoice(
    'MWPAY-00000000-0000-0000-0000-000000000004',
    'gateway-transaction-004', 10000, 'KES', 'four@example.test',
    '{"status":"success"}'::jsonb
  );
  if result->>'ok' <> 'true'
     or (select status from public.platform_customer_subscriptions where tenant_id='00000000-0000-0000-0000-000000000004') <> 'active'
     or (select admin_override from public.platform_customer_subscriptions where tenant_id='00000000-0000-0000-0000-000000000004') then
    raise exception 'Verified payment did not clear the prior admin override correctly';
  end if;

  -- Authorization is checked inside the SECURITY DEFINER function.
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  begin
    perform public.platform_paystack_settle_invoice(
      'MWPAY-00000000-0000-0000-0000-000000000005',
      'gateway-transaction-005', 30000, 'KES', 'five@example.test',
      '{"status":"success"}'::jsonb
    );
    raise exception 'Non-service role unexpectedly settled a payment';
  exception when insufficient_privilege then
    null;
  end;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end;
$$;

select 'Paystack settlement rules passed: balance, verified amount, idempotency, subscription activation, setup-only invoice, admin override, and service-role gate.' as result;
SQL

# Race independent webhook workers for the same successful reference. The
# transaction row lock must allow exactly one settlement and one ledger row.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
create or replace function public.test_paystack_payment_insert_delay()
returns trigger language plpgsql as $$
begin
  perform pg_sleep(0.2);
  return new;
end;
$$;
create trigger test_paystack_payment_insert_delay
before insert on public.platform_invoice_payments
for each row when (new.reference = 'MWPAY-00000000-0000-0000-0000-000000000005')
execute function public.test_paystack_payment_insert_delay();
SQL

for i in $(seq 1 12); do
  (
    psql "$DATABASE_URL" -qAt -v ON_ERROR_STOP=1 -c "
      set request.jwt.claims = '{\"role\":\"service_role\"}';
      select public.platform_paystack_settle_invoice(
        'MWPAY-00000000-0000-0000-0000-000000000005',
        'gateway-transaction-005', 30000, 'KES', 'five@example.test',
        '{\"status\":\"success\"}'::jsonb
      );
    " > "$tmpdir/concurrent-$i"
  ) &
done
wait

successes="$(grep -h -Eo '"duplicate"[[:space:]]*:[[:space:]]*false' "$tmpdir"/concurrent-* | wc -l | tr -d ' ')"
duplicates="$(grep -h -Eo '"duplicate"[[:space:]]*:[[:space:]]*true' "$tmpdir"/concurrent-* | wc -l | tr -d ' ')"
if [[ "$successes" -ne 1 || "$duplicates" -ne 11 ]]; then
  echo "Expected 1 settlement and 11 duplicate acknowledgements; got $successes settlements and $duplicates duplicates." >&2
  cat "$tmpdir"/concurrent-* >&2
  exit 1
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if (select count(*) from public.platform_invoice_payments where reference='MWPAY-00000000-0000-0000-0000-000000000005' and method='paystack') <> 1 then
    raise exception 'Concurrent duplicate webhooks created more than one payment ledger row';
  end if;
  if (select status from public.platform_paystack_transactions where reference='MWPAY-00000000-0000-0000-0000-000000000005') <> 'success' then
    raise exception 'Concurrent settlement did not leave transaction successful';
  end if;
  if (select status from public.platform_customer_subscriptions where tenant_id='00000000-0000-0000-0000-000000000005') <> 'active' then
    raise exception 'Concurrent settlement did not activate subscription';
  end if;
end;
$$;
SQL

echo "Paystack settlement concurrency passed: 1/12 settlement; 11/12 idempotent duplicates."
