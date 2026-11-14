-- Support lookups and parent deletes for the tenant-matching foreign keys.
create index if not exists campaign_recipients_tenant_campaign_idx
  on public.campaign_recipients (tenant_id, campaign_id);
create index if not exists campaign_recipients_tenant_contact_idx
  on public.campaign_recipients (tenant_id, contact_id);
create index if not exists campaigns_tenant_template_idx
  on public.campaigns (tenant_id, template_id);
create index if not exists messages_tenant_reply_idx
  on public.messages (tenant_id, reply_to_message_id);
create index if not exists outbound_attempts_tenant_contact_idx
  on public.outbound_send_attempts (tenant_id, contact_id);
create index if not exists outbound_attempts_tenant_conversation_idx
  on public.outbound_send_attempts (tenant_id, conversation_id);
create index if not exists outbound_attempts_tenant_message_idx
  on public.outbound_send_attempts (tenant_id, message_id);
create index if not exists webhook_deliveries_tenant_hook_idx
  on public.webhook_deliveries (tenant_id, webhook_id);
create index if not exists workspace_notification_reads_tenant_notification_idx
  on public.workspace_notification_reads (tenant_id, notification_id);
create index if not exists workspace_notification_reads_user_idx
  on public.workspace_notification_reads (user_id);

-- The platform console uses this SECURITY DEFINER aggregate only for signed-in
-- users. Its function body also verifies platform_admins membership.
revoke all on function public.platform_tenant_overview() from public, anon;
grant execute on function public.platform_tenant_overview() to authenticated;
