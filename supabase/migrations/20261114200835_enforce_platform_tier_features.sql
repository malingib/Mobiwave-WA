-- Enforce the existing platform tier feature flags for active subscriptions.
-- Unassigned and non-active billing records retain the existing workspace
-- behavior; billing status alone does not suspend a workspace.

update public.platform_billing_tiers
set feature_flags = '{"inbox":true,"contacts":true,"templates":true,"campaigns":true,"api":true,"webhooks":true}'::jsonb || feature_flags;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.tenant_feature_enabled(p_tenant_id uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_feature = any(array['inbox','contacts','templates','campaigns','api','webhooks']::text[])
    and exists (
      select 1 from public.tenant_members tm
      where tm.tenant_id = p_tenant_id and tm.user_id = (select auth.uid())
    )
    and coalesce((
      select s.status <> 'active'
        or coalesce((t.feature_flags ->> p_feature)::boolean, false)
      from public.platform_customer_subscriptions s
      left join public.platform_billing_tiers t on t.id = s.tier_id
      where s.tenant_id = p_tenant_id
    ), true);
$$;

revoke all on function private.tenant_feature_enabled(uuid, text) from public, anon;
grant execute on function private.tenant_feature_enabled(uuid, text) to authenticated;

create or replace function private.tenant_any_feature_enabled(p_tenant_id uuid, p_features text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(cardinality(p_features) > 0
    and p_features <@ array['inbox','contacts','templates','campaigns','api','webhooks']::text[]
    and exists (
      select 1 from public.tenant_members tm
      where tm.tenant_id = p_tenant_id and tm.user_id = (select auth.uid())
    )
    and coalesce((
      select s.status <> 'active' or exists (
        select 1 from unnest(p_features) as requested(feature)
        where coalesce((t.feature_flags ->> requested.feature)::boolean, false)
      )
      from public.platform_customer_subscriptions s
      left join public.platform_billing_tiers t on t.id = s.tier_id
      where s.tenant_id = p_tenant_id
    ), true), false);
$$;

revoke all on function private.tenant_any_feature_enabled(uuid, text[]) from public, anon;
grant execute on function private.tenant_any_feature_enabled(uuid, text[]) to authenticated;

-- Restrictive policies combine with existing role and membership policies,
-- preserving their access rules while applying the platform tier cap.
create policy tier_feature_contacts_read on public.contacts
  as restrictive for select to authenticated
  using ((select private.tenant_any_feature_enabled(tenant_id, array['contacts','inbox','campaigns'])));

create policy tier_feature_contacts_insert on public.contacts
  as restrictive for insert to authenticated
  with check ((select private.tenant_feature_enabled(tenant_id, 'contacts')));

create policy tier_feature_contacts_update on public.contacts
  as restrictive for update to authenticated
  using ((select private.tenant_feature_enabled(tenant_id, 'contacts')))
  with check ((select private.tenant_feature_enabled(tenant_id, 'contacts')));

create policy tier_feature_contacts_delete on public.contacts
  as restrictive for delete to authenticated
  using ((select private.tenant_feature_enabled(tenant_id, 'contacts')));

create policy tier_feature_contact_consent on public.contact_consent_events
  as restrictive for all to authenticated
  using ((select private.tenant_feature_enabled(tenant_id, 'contacts')))
  with check ((select private.tenant_feature_enabled(tenant_id, 'contacts')));

create policy tier_feature_templates_read on public.wa_templates
  as restrictive for select to authenticated
  using ((select private.tenant_any_feature_enabled(tenant_id, array['templates','inbox','campaigns','api'])));

create policy tier_feature_templates_insert on public.wa_templates
  as restrictive for insert to authenticated
  with check ((select private.tenant_feature_enabled(tenant_id, 'templates')));

create policy tier_feature_templates_update on public.wa_templates
  as restrictive for update to authenticated
  using ((select private.tenant_feature_enabled(tenant_id, 'templates')))
  with check ((select private.tenant_feature_enabled(tenant_id, 'templates')));

create policy tier_feature_templates_delete on public.wa_templates
  as restrictive for delete to authenticated
  using ((select private.tenant_feature_enabled(tenant_id, 'templates')));

create policy tier_feature_campaigns on public.campaigns
  as restrictive for all to authenticated
  using ((select private.tenant_feature_enabled(tenant_id, 'campaigns')))
  with check ((select private.tenant_feature_enabled(tenant_id, 'campaigns')));

create policy tier_feature_campaign_recipients on public.campaign_recipients
  as restrictive for all to authenticated
  using ((select private.tenant_feature_enabled(tenant_id, 'campaigns')))
  with check ((select private.tenant_feature_enabled(tenant_id, 'campaigns')));

create policy tier_feature_conversations on public.conversations
  as restrictive for all to authenticated
  using ((select private.tenant_feature_enabled(tenant_id, 'inbox')))
  with check ((select private.tenant_feature_enabled(tenant_id, 'inbox')));

create policy tier_feature_messages on public.messages
  as restrictive for all to authenticated
  using ((select private.tenant_feature_enabled(tenant_id, 'inbox')))
  with check ((select private.tenant_feature_enabled(tenant_id, 'inbox')));

create policy tier_feature_conversation_reads on public.conversation_reads
  as restrictive for all to authenticated
  using ((select private.tenant_feature_enabled(tenant_id, 'inbox')))
  with check ((select private.tenant_feature_enabled(tenant_id, 'inbox')));

create policy tier_feature_conversation_notes on public.conversation_notes
  as restrictive for all to authenticated
  using ((select private.tenant_feature_enabled(tenant_id, 'inbox')))
  with check ((select private.tenant_feature_enabled(tenant_id, 'inbox')));

create policy tier_feature_api_keys on public.tenant_api_keys
  as restrictive for all to authenticated
  using ((select private.tenant_feature_enabled(tenant_id, 'api')))
  with check ((select private.tenant_feature_enabled(tenant_id, 'api')));

create policy tier_feature_tenant_webhooks on public.tenant_webhooks
  as restrictive for all to authenticated
  using ((select private.tenant_feature_enabled(tenant_id, 'webhooks')))
  with check ((select private.tenant_feature_enabled(tenant_id, 'webhooks')));

create policy tier_feature_webhook_deliveries on public.webhook_deliveries
  as restrictive for all to authenticated
  using ((select private.tenant_feature_enabled(tenant_id, 'webhooks')))
  with check ((select private.tenant_feature_enabled(tenant_id, 'webhooks')));
