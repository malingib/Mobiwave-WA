-- Cover platform billing foreign keys used during joins and referential checks.
create index if not exists platform_billing_audit_actor_idx
  on public.platform_billing_audit (actor_id);
create index if not exists platform_customer_accounts_updated_by_idx
  on public.platform_customer_accounts (updated_by);
create index if not exists platform_customer_subscriptions_tier_idx
  on public.platform_customer_subscriptions (tier_id);
create index if not exists platform_customer_subscriptions_updated_by_idx
  on public.platform_customer_subscriptions (updated_by);
create index if not exists platform_invoice_payments_recorded_by_idx
  on public.platform_invoice_payments (recorded_by);
create index if not exists platform_invoice_payments_reversed_by_idx
  on public.platform_invoice_payments (reversed_by);
create index if not exists platform_invoices_created_by_idx
  on public.platform_invoices (created_by);
