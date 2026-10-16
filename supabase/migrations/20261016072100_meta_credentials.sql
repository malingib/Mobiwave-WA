-- Integration credential encryption metadata and tenant provisioning support.
alter table public.meta_integrations add column if not exists encrypted_access_token text;
alter table public.meta_integrations add column if not exists last_error_code text;
alter table public.meta_integrations add column if not exists api_version text;
alter table public.meta_integrations add column if not exists verified_name text;
alter table public.meta_integrations alter column token_secret_name drop not null;

-- The integration row is visible only through RLS. Its encrypted token is never selected by the browser app.
-- Explicitly revoke column reads of the encrypted value from client roles.
revoke select (encrypted_access_token) on public.meta_integrations from anon, authenticated;
