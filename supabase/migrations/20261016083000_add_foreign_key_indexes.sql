-- Add indexes for foreign keys identified by Supabase's performance advisor.
CREATE INDEX IF NOT EXISTS ai_memory_items_approved_by_idx ON public.ai_memory_items (approved_by);
CREATE INDEX IF NOT EXISTS ai_memory_items_created_by_idx ON public.ai_memory_items (created_by);
CREATE INDEX IF NOT EXISTS campaign_recipients_contact_id_idx ON public.campaign_recipients (contact_id);
CREATE INDEX IF NOT EXISTS campaigns_created_by_idx ON public.campaigns (created_by);
CREATE INDEX IF NOT EXISTS campaigns_template_id_idx ON public.campaigns (template_id);
CREATE INDEX IF NOT EXISTS conversations_assigned_to_idx ON public.conversations (assigned_to);
CREATE INDEX IF NOT EXISTS conversations_contact_id_idx ON public.conversations (contact_id);
CREATE INDEX IF NOT EXISTS knowledge_documents_source_id_idx ON public.knowledge_documents (source_id);
CREATE INDEX IF NOT EXISTS knowledge_sources_created_by_idx ON public.knowledge_sources (created_by);
CREATE INDEX IF NOT EXISTS messages_conversation_id_idx ON public.messages (conversation_id);
CREATE INDEX IF NOT EXISTS messages_reply_to_message_id_idx ON public.messages (reply_to_message_id);
CREATE INDEX IF NOT EXISTS source_ingestion_runs_source_id_idx ON public.source_ingestion_runs (source_id);
CREATE INDEX IF NOT EXISTS tenant_api_keys_created_by_idx ON public.tenant_api_keys (created_by);
CREATE INDEX IF NOT EXISTS tenant_members_user_id_idx ON public.tenant_members (user_id);
CREATE INDEX IF NOT EXISTS tenant_webhooks_created_by_idx ON public.tenant_webhooks (created_by);
CREATE INDEX IF NOT EXISTS webhook_deliveries_tenant_id_idx ON public.webhook_deliveries (tenant_id);
CREATE INDEX IF NOT EXISTS webhook_events_tenant_id_idx ON public.webhook_events (tenant_id);
