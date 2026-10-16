create policy "admins can revoke tenant API keys" on public.tenant_api_keys for update to authenticated
using (exists (select 1 from public.tenant_members tm where tm.tenant_id = tenant_api_keys.tenant_id and tm.user_id = (select auth.uid()) and tm.role in ('owner','admin')))
with check (exists (select 1 from public.tenant_members tm where tm.tenant_id = tenant_api_keys.tenant_id and tm.user_id = (select auth.uid()) and tm.role in ('owner','admin')));
grant update (revoked_at) on public.tenant_api_keys to authenticated;
revoke select (secret_hash) on public.tenant_api_keys from anon, authenticated;
