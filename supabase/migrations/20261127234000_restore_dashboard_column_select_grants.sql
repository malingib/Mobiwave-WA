-- Restore only the newly introduced metadata columns required by the dashboard.
-- Existing RLS policies continue to enforce tenant membership and admin-only API-key visibility.
-- Sensitive credential columns remain excluded from authenticated SELECT access.
grant select (client_id) on table public.tenant_api_keys to authenticated;
grant select (webhook_verification_source) on table public.meta_integrations to authenticated;
