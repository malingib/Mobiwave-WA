-- Standard subscription invoices must never include optional assisted-onboarding fees.
-- The tier setup_fee_minor remains a quote/reference value for separately approved work.

CREATE OR REPLACE FUNCTION public.platform_billing_save_customer(p_tenant_id uuid, p_billing_name text, p_billing_email text, p_billing_reference text, p_billing_address text, p_notes text, p_tier_id uuid, p_subscription_status text, p_starts_on date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  previous_tier_id uuid;
  previous_status text;
  chosen public.platform_billing_tiers%rowtype;
  invoice_marker text;
  invoice_notes text;
  invoice_items jsonb;
  invoice_total bigint;
begin
  if not exists (
    select 1 from public.platform_admins
    where user_id = (select auth.uid()) and role = 'owner'
  ) then
    raise exception 'Platform owner access required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));

  select tier_id, status into previous_tier_id, previous_status
  from public.platform_customer_subscriptions
  where tenant_id = p_tenant_id;

  perform public.platform_billing_save_account(
    p_tenant_id, p_billing_name, p_billing_email,
    p_billing_reference, p_billing_address, p_notes
  );

  if p_subscription_status is not null then
    perform public.platform_billing_assign_tier(
      p_tenant_id, p_tier_id, p_subscription_status, p_starts_on
    );
  elsif p_tier_id is not null then
    raise exception 'Choose a subscription status when assigning a tier' using errcode = '22023';
  end if;

  if p_subscription_status = 'active' and p_tier_id is not null then
    select * into chosen from public.platform_billing_tiers where id = p_tier_id;
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

    if (previous_tier_id is distinct from p_tier_id
        or previous_status is distinct from 'active')
       and not exists (
         select 1 from public.platform_invoices
         where tenant_id = p_tenant_id and notes like '%' || invoice_marker || '%'
       ) then
      invoice_items := jsonb_build_array();
      -- Assisted onboarding is never part of a standard subscription invoice.
      -- It must be requested, quoted and approved as a separate service.
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
        invoice_notes := 'Initial subscription invoice. Monthly subscription only. Optional assisted onboarding is billed separately only after client approval. ' || invoice_marker;
        perform public.platform_billing_issue_invoice(
          p_tenant_id, current_date + 14, invoice_items, invoice_notes
        );
      end if;
    end if;
  end if;

  return p_tenant_id;
end;
$function$
;
