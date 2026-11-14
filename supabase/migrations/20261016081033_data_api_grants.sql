-- Explicit Data API privileges; RLS policies remain the row-level authorization boundary.
grant select on public.tenants, public.tenant_members, public.knowledge_sources, public.knowledge_documents,
  public.knowledge_chunks, public.ai_memory_items, public.source_ingestion_runs,
  public.tenant_settings, public.contacts, public.wa_templates, public.campaigns,
  public.campaign_recipients, public.conversations, public.messages, public.meta_integrations
to authenticated;

grant insert, update, delete on public.knowledge_sources to authenticated;
grant insert, update, delete on public.ai_memory_items to authenticated;
grant insert, update, delete on public.contacts to authenticated;
grant insert, update, delete on public.wa_templates to authenticated;
grant insert, update, delete on public.campaigns to authenticated;
grant insert, update, delete on public.campaign_recipients to authenticated;
grant insert, update, delete on public.conversations to authenticated;
grant insert on public.messages to authenticated;
grant update on public.tenant_settings to authenticated;
grant update on public.meta_integrations to authenticated;

-- Column-level credential secrecy takes precedence over table-level SELECT.
revoke select (encrypted_access_token) on public.meta_integrations from anon, authenticated;
