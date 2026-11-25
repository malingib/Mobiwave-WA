-- Restrict the SECURITY DEFINER billing summary to authenticated workspace members.
-- Include invoice line items and verified invoice payments so the customer UI
-- never needs direct access to platform-only billing tables.
create or replace function public.tenant_billing_summary(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  entitlements jsonb;
  account_row public.platform_customer_accounts%rowtype;
  invoices jsonb;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = auth.uid()
  ) then
    raise exception 'Workspace membership required' using errcode = '42501';
  end if;

  entitlements := public.tenant_entitlements(p_tenant_id);
  select * into account_row
  from public.platform_customer_accounts
  where tenant_id = p_tenant_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
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
        and i.due_on < current_date,
      'items', coalesce(item_rows.items, '[]'::jsonb),
      'payments', coalesce(payment_rows.payments, '[]'::jsonb)
    ) order by i.issued_at desc
  ), '[]'::jsonb)
  into invoices
  from public.platform_invoices i
  left join lateral (
    select sum(pay.amount_minor) as paid_minor
    from public.platform_invoice_payments pay
    where pay.invoice_id = i.id
      and pay.reversed_at is null
  ) p on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', line.id,
      'description', line.description,
      'quantity', line.quantity,
      'unit_amount_minor', line.unit_amount_minor,
      'line_total_minor', line.line_total_minor
    ) order by line.id) as items
    from public.platform_invoice_items line
    where line.invoice_id = i.id
  ) item_rows on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', pay.id,
      'amount_minor', pay.amount_minor,
      'method', pay.method,
      'reference', pay.reference,
      'paid_at', pay.paid_at
    ) order by pay.paid_at desc) as payments
    from public.platform_invoice_payments pay
    where pay.invoice_id = i.id
      and pay.reversed_at is null
  ) payment_rows on true
  where i.tenant_id = p_tenant_id;

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
$function$;

revoke all on function public.tenant_billing_summary(uuid) from public;
revoke all on function public.tenant_billing_summary(uuid) from anon;
grant execute on function public.tenant_billing_summary(uuid) to authenticated;
