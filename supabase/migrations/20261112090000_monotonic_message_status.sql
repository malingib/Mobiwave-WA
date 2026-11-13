create or replace function public.apply_meta_message_status(
  p_tenant_id uuid,
  p_meta_message_id text,
  p_status text,
  p_provider_timestamp timestamptz,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  incoming_rank integer;
begin
  incoming_rank := case p_status
    when 'accepted' then 0
    when 'sent' then 1
    when 'failed' then 2
    when 'delivered' then 3
    when 'read' then 4
    else null
  end;
  if incoming_rank is null then
    raise exception 'Unsupported Meta message status';
  end if;

  update public.messages
  set status = p_status,
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb)
  where tenant_id = p_tenant_id
    and meta_message_id = p_meta_message_id
    and incoming_rank >= case status
      when 'accepted' then 0 when 'sent' then 1 when 'failed' then 2
      when 'delivered' then 3 when 'read' then 4 else -1 end;

  update public.campaign_recipients
  set status = p_status,
      error_code = case when p_status in ('sent', 'delivered', 'read') then null else error_code end,
      error_detail = case when p_status in ('sent', 'delivered', 'read') then null else error_detail end,
      sent_at = case when p_status = 'sent' then coalesce(p_provider_timestamp, now()) else sent_at end,
      delivered_at = case when p_status = 'delivered' then coalesce(p_provider_timestamp, now()) else delivered_at end,
      read_at = case when p_status = 'read' then coalesce(p_provider_timestamp, now()) else read_at end,
      updated_at = now()
  where tenant_id = p_tenant_id
    and meta_message_id = p_meta_message_id
    and incoming_rank >= case status
      when 'accepted' then 0 when 'sent' then 1 when 'failed' then 2
      when 'delivered' then 3 when 'read' then 4 else -1 end;
end;
$$;

revoke all on function public.apply_meta_message_status(uuid, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.apply_meta_message_status(uuid, text, text, timestamptz, jsonb) to service_role;

-- Serialize monthly quota claims per workspace and month. Send attempts are
-- inserted before this call, so concurrent requests reserve quota atomically.
create or replace function public.claim_monthly_message_quota(
  p_tenant_id uuid,
  p_attempt_id uuid,
  p_month_start date
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  monthly_limit integer;
  already_used bigint;
  in_flight bigint;
  period_start timestamptz := p_month_start::timestamp at time zone 'UTC';
  period_end timestamptz := (p_month_start + interval '1 month')::timestamp at time zone 'UTC';
begin
  if p_month_start is null or extract(day from p_month_start) <> 1 then
    raise exception 'Quota period must start on the first day of a month';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant_id::text || ':' || p_month_start::text, 0)
  );

  -- A prepared attempt has not contacted Meta. Release it if its worker died
  -- before submission. Submitting and outcome_unknown are kept reserved.
  update public.outbound_send_attempts
  set status = 'rejected', error_code = 'prepared_attempt_expired',
      error_detail = 'The send was not submitted because its preparation expired.',
      updated_at = now()
  where tenant_id = p_tenant_id and status = 'prepared'
    and created_at < now() - interval '5 minutes';

  select coalesce(l.monthly_message_limit, 0)
    into monthly_limit
  from (select 1) seed
  left join public.tenant_usage_limits l on l.tenant_id = p_tenant_id;

  if monthly_limit <= 0 then
    return true;
  end if;

  select coalesce(sum(u.quantity), 0)::bigint
    into already_used
  from public.usage_events u
  where u.tenant_id = p_tenant_id
    and u.event_type = 'message_submitted'
    and u.occurred_at >= period_start
    and u.occurred_at < period_end;

  select count(*)::bigint
    into in_flight
  from public.outbound_send_attempts a
  where a.tenant_id = p_tenant_id
    and a.id <> p_attempt_id
    and a.updated_at >= period_start
    and a.updated_at < period_end
    and (
      a.status in ('prepared', 'submitting', 'outcome_unknown')
      or (a.status = 'accepted' and not exists (
        select 1
        from public.usage_events u
        where u.tenant_id = a.tenant_id
          and u.event_type = 'message_submitted'
          and (u.reference_id = a.meta_message_id
            or u.metadata ->> 'outbound_attempt_id' = a.id::text)
      ))
    );

  return already_used + in_flight < monthly_limit;
end;
$$;

revoke all on function public.claim_monthly_message_quota(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.claim_monthly_message_quota(uuid, uuid, date) to service_role;

-- Existing single-column foreign keys do not prove that related rows share a
-- tenant. These composite keys enforce tenant ownership for every new write;
-- validate the historical rows after checking for pre-existing mismatches.
create unique index if not exists contacts_tenant_id_id_uidx on public.contacts(tenant_id, id);
create unique index if not exists templates_tenant_id_id_uidx on public.wa_templates(tenant_id, id);
create unique index if not exists campaigns_tenant_id_id_uidx on public.campaigns(tenant_id, id);
create unique index if not exists conversations_tenant_id_id_uidx on public.conversations(tenant_id, id);
create unique index if not exists messages_tenant_id_id_uidx on public.messages(tenant_id, id);
create unique index if not exists tenant_webhooks_tenant_id_id_uidx on public.tenant_webhooks(tenant_id, id);
create unique index if not exists knowledge_sources_tenant_id_id_uidx on public.knowledge_sources(tenant_id, id);
create unique index if not exists knowledge_documents_tenant_id_id_uidx on public.knowledge_documents(tenant_id, id);

alter table public.campaigns add constraint campaigns_template_same_tenant_fk
  foreign key (tenant_id, template_id) references public.wa_templates(tenant_id, id) not valid;
alter table public.campaign_recipients add constraint campaign_recipients_campaign_same_tenant_fk
  foreign key (tenant_id, campaign_id) references public.campaigns(tenant_id, id) not valid;
alter table public.campaign_recipients add constraint campaign_recipients_contact_same_tenant_fk
  foreign key (tenant_id, contact_id) references public.contacts(tenant_id, id) not valid;
alter table public.conversations add constraint conversations_contact_same_tenant_fk
  foreign key (tenant_id, contact_id) references public.contacts(tenant_id, id) not valid;
-- Assignments must point to someone who is actually a member of this same
-- workspace, including writes made through the authenticated Data API.
create index if not exists conversations_tenant_assignee_idx
  on public.conversations(tenant_id, assigned_to) where assigned_to is not null;
alter table public.conversations add constraint conversations_assignee_same_tenant_fk
  foreign key (tenant_id, assigned_to) references public.tenant_members(tenant_id, user_id)
  on delete set null (assigned_to) not valid;
alter table public.messages add constraint messages_conversation_same_tenant_fk
  foreign key (tenant_id, conversation_id) references public.conversations(tenant_id, id) not valid;
alter table public.messages add constraint messages_reply_same_tenant_fk
  foreign key (tenant_id, reply_to_message_id) references public.messages(tenant_id, id) not valid;
alter table public.conversation_reads add constraint conversation_reads_same_tenant_fk
  foreign key (tenant_id, conversation_id) references public.conversations(tenant_id, id) not valid;
create index if not exists conversation_reads_tenant_user_idx
  on public.conversation_reads(tenant_id, user_id);
alter table public.conversation_reads add constraint conversation_reads_member_same_tenant_fk
  foreign key (tenant_id, user_id) references public.tenant_members(tenant_id, user_id)
  on delete cascade not valid;
alter table public.conversation_notes add constraint conversation_notes_same_tenant_fk
  foreign key (tenant_id, conversation_id) references public.conversations(tenant_id, id) not valid;
alter table public.contact_consent_events add constraint consent_events_contact_same_tenant_fk
  foreign key (tenant_id, contact_id) references public.contacts(tenant_id, id) not valid;
alter table public.webhook_deliveries add constraint webhook_deliveries_hook_same_tenant_fk
  foreign key (tenant_id, webhook_id) references public.tenant_webhooks(tenant_id, id) not valid;
alter table public.outbound_send_attempts add constraint outbound_attempt_contact_same_tenant_fk
  foreign key (tenant_id, contact_id) references public.contacts(tenant_id, id) not valid;
alter table public.outbound_send_attempts add constraint outbound_attempt_conversation_same_tenant_fk
  foreign key (tenant_id, conversation_id) references public.conversations(tenant_id, id) not valid;
alter table public.outbound_send_attempts add constraint outbound_attempt_message_same_tenant_fk
  foreign key (tenant_id, message_id) references public.messages(tenant_id, id) not valid;
create index if not exists outbound_send_attempts_quota_idx
  on public.outbound_send_attempts(tenant_id, updated_at)
  where status in ('prepared', 'submitting', 'outcome_unknown', 'accepted');
alter table public.knowledge_documents add constraint knowledge_documents_source_same_tenant_fk
  foreign key (tenant_id, source_id) references public.knowledge_sources(tenant_id, id) not valid;
alter table public.knowledge_chunks add constraint knowledge_chunks_document_same_tenant_fk
  foreign key (tenant_id, document_id) references public.knowledge_documents(tenant_id, id) not valid;
alter table public.source_ingestion_runs add constraint ingestion_runs_source_same_tenant_fk
  foreign key (tenant_id, source_id) references public.knowledge_sources(tenant_id, id) not valid;
