-- Store the Meta app secret supplied by each client integration, encrypted.
alter table public.meta_integrations
  add column if not exists encrypted_app_secret text;

-- Replace table-level reads with the status fields the client UI actually uses.
-- This prevents all client roles from selecting either encrypted credential.
revoke select on public.meta_integrations from public, anon, authenticated;
grant select (
  tenant_id,
  phone_number_id,
  waba_id,
  display_phone_number,
  verified,
  enabled,
  last_error_code,
  last_health_check_at,
  verified_name
) on public.meta_integrations to authenticated;
