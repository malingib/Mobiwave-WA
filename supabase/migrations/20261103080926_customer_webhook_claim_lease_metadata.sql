alter table public.webhook_deliveries
  add column if not exists updated_at timestamptz not null default now();

alter function public.claim_customer_webhook_delivery(uuid) security invoker;
