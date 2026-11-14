-- Keep broad member SELECT access in one policy per table. Separate write
-- policies avoid evaluating the same row visibility through overlapping
-- permissive SELECT policies, while retaining the original role boundaries.

drop policy if exists "admins can manage campaign recipients" on public.campaign_recipients;
create policy "admins can insert campaign recipients" on public.campaign_recipients
  for insert to authenticated with check (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = campaign_recipients.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin')
  ));
create policy "admins can update campaign recipients" on public.campaign_recipients
  for update to authenticated using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = campaign_recipients.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin')
  )) with check (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = campaign_recipients.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin')
  ));
create policy "admins can delete campaign recipients" on public.campaign_recipients
  for delete to authenticated using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = campaign_recipients.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin')
  ));

drop policy if exists "admins can manage campaigns" on public.campaigns;
create policy "admins can insert campaigns" on public.campaigns
  for insert to authenticated with check (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = campaigns.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin')
  ));
create policy "admins can update campaigns" on public.campaigns
  for update to authenticated using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = campaigns.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin')
  )) with check (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = campaigns.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin')
  ));
create policy "admins can delete campaigns" on public.campaigns
  for delete to authenticated using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = campaigns.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin')
  ));

drop policy if exists "agents can manage contacts" on public.contacts;
create policy "agents can insert contacts" on public.contacts
  for insert to authenticated with check (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = contacts.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin', 'agent')
  ));
create policy "agents can update contacts" on public.contacts
  for update to authenticated using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = contacts.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin', 'agent')
  )) with check (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = contacts.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin', 'agent')
  ));
create policy "agents can delete contacts" on public.contacts
  for delete to authenticated using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = contacts.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin', 'agent')
  ));

drop policy if exists "members can read own conversation read markers" on public.conversation_reads;

drop policy if exists "agents can manage conversations" on public.conversations;
create policy "agents can insert conversations" on public.conversations
  for insert to authenticated with check (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = conversations.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin', 'agent')
  ));
create policy "agents can update conversations" on public.conversations
  for update to authenticated using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = conversations.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin', 'agent')
  )) with check (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = conversations.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin', 'agent')
  ));
create policy "agents can delete conversations" on public.conversations
  for delete to authenticated using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = conversations.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin', 'agent')
  ));

drop policy if exists "admins can manage knowledge sources" on public.knowledge_sources;
create policy "admins can insert knowledge sources" on public.knowledge_sources
  for insert to authenticated with check (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = knowledge_sources.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin')
  ));
create policy "admins can update knowledge sources" on public.knowledge_sources
  for update to authenticated using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = knowledge_sources.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin')
  )) with check (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = knowledge_sources.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin')
  ));
create policy "admins can delete knowledge sources" on public.knowledge_sources
  for delete to authenticated using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = knowledge_sources.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin')
  ));

drop policy if exists "admins can manage meta integration status" on public.meta_integrations;
create policy "admins can insert meta integration status" on public.meta_integrations
  for insert to authenticated with check (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = meta_integrations.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin')
  ));
create policy "admins can update meta integration status" on public.meta_integrations
  for update to authenticated using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = meta_integrations.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin')
  )) with check (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = meta_integrations.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin')
  ));
create policy "admins can delete meta integration status" on public.meta_integrations
  for delete to authenticated using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = meta_integrations.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin')
  ));

drop policy if exists "admins can manage tenant settings" on public.tenant_settings;
create policy "admins can insert tenant settings" on public.tenant_settings
  for insert to authenticated with check (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = tenant_settings.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin')
  ));
create policy "admins can update tenant settings" on public.tenant_settings
  for update to authenticated using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = tenant_settings.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin')
  )) with check (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = tenant_settings.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin')
  ));
create policy "admins can delete tenant settings" on public.tenant_settings
  for delete to authenticated using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = tenant_settings.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin')
  ));

drop policy if exists "admins can manage templates" on public.wa_templates;
create policy "admins can insert templates" on public.wa_templates
  for insert to authenticated with check (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = wa_templates.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin')
  ));
create policy "admins can update templates" on public.wa_templates
  for update to authenticated using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = wa_templates.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin')
  )) with check (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = wa_templates.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin')
  ));
create policy "admins can delete templates" on public.wa_templates
  for delete to authenticated using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = wa_templates.tenant_id and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'admin')
  ));
