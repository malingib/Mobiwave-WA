-- Complete the client billing contract and keep one-time setup fees on the
-- first subscription invoice only. Existing invoices are not modified.

create or replace function public.platform_billing_data()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
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
        select
          tn.id as tenant_id,
          tn.name,
          tn.slug,
          coalesce(a.billing_name, '') as billing_name,
          coalesce(a.billing_email, '') as billing_email,
          coalesce(owner_email.registration_email, '') as registration_email,
          coalesce(a.billing_reference, '') as billing_reference,
          coalesce(a.billing_address, '') as billing_address,
          coalesce(a.notes, '') as notes,
          s.tier_id,
          t.name as tier_name,
          s.status as subscription_status,
          s.currency,
          s.monthly_price_minor,
          coalesce(inv.invoice_count, 0) as invoice_count,
          coalesce(inv.outstanding_minor, 0) as outstanding_minor,
          coalesce(inv.paid_minor, 0) as paid_minor
        from public.tenants tn
        left join public.platform_customer_accounts a on a.tenant_id = tn.id
        left join public.platform_customer_subscriptions s on s.tenant_id = tn.id
        left join public.platform_billing_tiers t on t.id = s.tier_id
        left join lateral (
          select case
            when count(distinct lower(trim(u.email))) = 1 then min(trim(u.email))
            else null
          end as registration_email
          from public.tenant_members tm
          join auth.users u on u.id = tm.user_id
          where tm.tenant_id = tn.id
            and tm.role = 'owner'
            and u.email_confirmed_at is not null
            and nullif(trim(u.email), '') is not null
        ) owner_email on true
        left join lateral (
          select
            count(*) as invoice_count,
            coalesce(sum(greatest(i.subtotal_minor - coalesce(p.paid_minor, 0), 0))
              filter (where i.status = 'issued'), 0) as outstanding_minor,
            coalesce(sum(coalesce(p.paid_minor, 0)), 0) as paid_minor
          from public.platform_invoices i
          left join lateral (
            select sum(pay.amount_minor) as paid_minor
            from public.platform_invoice_payments pay
            where pay.invoice_id = i.id and pay.reversed_at is null
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
        select pi.*,
          coalesce(nullif(a.billing_name, ''), nullif(pi.billing_name_snapshot, ''), pi.tenant_name_snapshot) as customer_name
        from public.platform_invoices pi
        left join public.platform_customer_accounts a on a.tenant_id = pi.tenant_id
        order by pi.issued_at desc
        limit 200
      ) i
      left join lateral (
        select sum(pay.amount_minor) as paid_minor
        from public.platform_invoice_payments pay
        where pay.invoice_id = i.id and pay.reversed_at is null
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
$function$;

create or replace function public.tenant_billing_summary(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  entitlements jsonb;
  tenant_row public.tenants%rowtype;
  account_row public.platform_customer_accounts%rowtype;
  registration_email text;
  invoices jsonb;
begin
  -- tenant_entitlements performs the authenticated workspace-membership check.
  entitlements := public.tenant_entitlements(p_tenant_id);

  select * into tenant_row
  from public.tenants
  where id = p_tenant_id;

  select * into account_row
  from public.platform_customer_accounts
  where tenant_id = p_tenant_id;

  select case
    when count(distinct lower(trim(u.email))) = 1 then min(trim(u.email))
    else null
  end into registration_email
  from public.tenant_members tm
  join auth.users u on u.id = tm.user_id
  where tm.tenant_id = p_tenant_id
    and tm.role = 'owner'
    and u.email_confirmed_at is not null
    and nullif(trim(u.email), '') is not null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'invoice_number', i.invoice_number,
    'currency', i.currency,
    'subtotal_minor', i.subtotal_minor,
    'paid_minor', coalesce(payments.paid_minor, 0),
    'balance_minor', greatest(i.subtotal_minor - coalesce(payments.paid_minor, 0), 0),
    'due_on', i.due_on,
    'issued_at', i.issued_at,
    'status', i.status,
    'is_overdue', i.status = 'issued'
      and greatest(i.subtotal_minor - coalesce(payments.paid_minor, 0), 0) > 0
      and i.due_on < (now() at time zone 'Africa/Nairobi')::date,
    'items', coalesce(lines.items, '[]'::jsonb),
    'payments', coalesce(payments.rows, '[]'::jsonb)
  ) order by i.issued_at desc), '[]'::jsonb)
  into invoices
  from (
    select pi.*
    from public.platform_invoices pi
    where pi.tenant_id = p_tenant_id
    order by pi.issued_at desc
    limit 36
  ) i
  left join lateral (
    select
      coalesce(sum(pay.amount_minor) filter (where pay.reversed_at is null), 0) as paid_minor,
      jsonb_agg(jsonb_build_object(
        'id', pay.id,
        'amount_minor', pay.amount_minor,
        'method', pay.method,
        'reference', pay.reference,
        'paid_at', pay.paid_at,
        'reversed_at', pay.reversed_at,
        'reversal_reason', pay.reversal_reason
      ) order by pay.paid_at desc) as rows
    from public.platform_invoice_payments pay
    where pay.invoice_id = i.id
  ) payments on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', item.id,
      'description', item.description,
      'quantity', item.quantity,
      'unit_amount_minor', item.unit_amount_minor,
      'line_total_minor', coalesce(item.line_total_minor, item.quantity::bigint * item.unit_amount_minor)
    ) order by item.id) as items
    from public.platform_invoice_items item
    where item.invoice_id = i.id
  ) lines on true;

  return jsonb_build_object(
    'entitlements', entitlements,
    'account', jsonb_build_object(
      'billing_name', coalesce(nullif(account_row.billing_name, ''), tenant_row.name, ''),
      'billing_email', coalesce(nullif(account_row.billing_email, ''), registration_email, ''),
      'billing_reference', coalesce(account_row.billing_reference, ''),
      'billing_address', coalesce(account_row.billing_address, '')
    ),
    'invoices', invoices
  );
end;
$function$;

create or replace function public.platform_billing_save_customer(
  p_tenant_id uuid,
  p_billing_name text,
  p_billing_email text,
  p_billing_reference text,
  p_billing_address text,
  p_notes text,
  p_tier_id uuid,
  p_subscription_status text,
  p_starts_on date
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  previous_tier_id uuid;
  previous_status text;
  chosen public.platform_billing_tiers%rowtype;
  tenant_name text;
  registration_email text;
  invoice_marker text;
  invoice_notes text;
  invoice_items jsonb;
  invoice_total bigint;
  setup_fee_already_invoiced boolean := false;
begin
  if not exists (
    select 1 from public.platform_admins
    where user_id = (select auth.uid()) and role = 'owner'
  ) then
    raise exception 'Platform owner access required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));

  select tn.name into tenant_name
  from public.tenants tn
  where tn.id = p_tenant_id;
  if not found then
    raise exception 'Client workspace not found' using errcode = 'P0002';
  end if;

  select case
    when count(distinct lower(trim(u.email))) = 1 then min(trim(u.email))
    else null
  end into registration_email
  from public.tenant_members tm
  join auth.users u on u.id = tm.user_id
  where tm.tenant_id = p_tenant_id
    and tm.role = 'owner'
    and u.email_confirmed_at is not null
    and nullif(trim(u.email), '') is not null;

  select tier_id, status into previous_tier_id, previous_status
  from public.platform_customer_subscriptions
  where tenant_id = p_tenant_id;

  perform public.platform_billing_save_account(
    p_tenant_id,
    coalesce(nullif(trim(p_billing_name), ''), tenant_name),
    coalesce(nullif(trim(p_billing_email), ''), registration_email, ''),
    p_billing_reference,
    p_billing_address,
    p_notes
  );

  if p_subscription_status is not null then
    perform public.platform_billing_assign_tier(
      p_tenant_id, p_tier_id, p_subscription_status, p_starts_on
    );
  elsif p_tier_id is not null then
    raise exception 'Choose a subscription status when assigning a tier' using errcode = '22023';
  end if;

  if p_subscription_status in ('active', 'suspended') and p_tier_id is not null then
    select * into chosen
    from public.platform_billing_tiers
    where id = p_tier_id;
    if not found then
      raise exception 'Selected billing tier not found' using errcode = 'P0002';
    end if;

    update public.platform_customer_subscriptions
    set currency = chosen.currency,
        monthly_price_minor = chosen.monthly_price_minor,
        updated_at = now()
    where tenant_id = p_tenant_id;

    invoice_marker := '[subscription-initial:' || p_tenant_id::text || ':' ||
      coalesce(p_starts_on, current_date)::text || ']';

    if (
      previous_tier_id is distinct from p_tier_id
      or previous_status is null
      or previous_status = 'canceled'
    ) and not exists (
      select 1 from public.platform_invoices
      where tenant_id = p_tenant_id and notes like '%' || invoice_marker || '%'
    ) then
      invoice_items := '[]'::jsonb;

      -- A setup fee is one-time per workspace, not a monthly renewal charge.
      select exists (
        select 1
        from public.platform_invoices existing_invoice
        join public.platform_invoice_items existing_item on existing_item.invoice_id = existing_invoice.id
        where existing_invoice.tenant_id = p_tenant_id
          and existing_invoice.status <> 'void'
          and existing_item.description ilike '% one-time setup fee'
      ) into setup_fee_already_invoiced;

      if chosen.setup_fee_minor > 0 and not setup_fee_already_invoiced then
        invoice_items := invoice_items || jsonb_build_array(jsonb_build_object(
          'description', chosen.name || ' one-time setup fee',
          'quantity', 1,
          'unit_amount_minor', chosen.setup_fee_minor
        ));
      end if;

      if chosen.monthly_price_minor > 0 then
        invoice_items := invoice_items || jsonb_build_array(jsonb_build_object(
          'description', chosen.name || ' monthly subscription',
          'quantity', 1,
          'unit_amount_minor', chosen.monthly_price_minor
        ));
      end if;

      select coalesce(sum((line->>'unit_amount_minor')::bigint *
        (line->>'quantity')::integer), 0) into invoice_total
      from jsonb_array_elements(invoice_items) line;

      if invoice_total > 0 then
        invoice_notes := 'Initial subscription invoice. Any configured one-time setup fee is charged once per workspace; later renewal invoices contain the monthly subscription only. ' ||
          'Paid plans remain suspended until verified payment unless a platform administrator explicitly activates them. ' ||
          invoice_marker;
        perform public.platform_billing_issue_invoice(
          p_tenant_id,
          (now() at time zone 'Africa/Nairobi')::date + 14,
          invoice_items,
          invoice_notes
        );
      end if;
    end if;
  end if;

  return p_tenant_id;
end;
$function$;

revoke all on function public.platform_billing_data() from public, anon;
grant execute on function public.platform_billing_data() to authenticated;
revoke all on function public.tenant_billing_summary(uuid) from public, anon;
grant execute on function public.tenant_billing_summary(uuid) to authenticated;
revoke all on function public.platform_billing_save_customer(uuid, text, text, text, text, text, uuid, text, date) from public, anon;
grant execute on function public.platform_billing_save_customer(uuid, text, text, text, text, text, uuid, text, date) to authenticated;
