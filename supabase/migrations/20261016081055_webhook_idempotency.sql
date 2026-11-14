alter table public.webhook_deliveries add column if not exists event_key text;
create unique index if not exists webhook_deliveries_event_idempotency_idx
  on public.webhook_deliveries(webhook_id, event_key);
