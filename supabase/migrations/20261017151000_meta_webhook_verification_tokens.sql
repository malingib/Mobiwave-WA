alter table public.meta_integrations
  add column if not exists webhook_verify_token_hash text;

create index if not exists meta_integrations_webhook_verify_token_hash_idx
  on public.meta_integrations (webhook_verify_token_hash)
  where webhook_verify_token_hash is not null;
