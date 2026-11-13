-- Aggregate dashboard metrics in Postgres so the UI never derives workspace
-- totals from paginated lists or a capped sample of messages.
create index if not exists messages_tenant_created_at_idx
  on public.messages (tenant_id, created_at);
create index if not exists campaigns_tenant_status_idx
  on public.campaigns (tenant_id, status);

create or replace function public.get_tenant_overview(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  result jsonb;
  today_utc date := (now() at time zone 'UTC')::date;
begin
  if auth.uid() is null or not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid()
  ) then
    raise exception 'Workspace membership required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'contacts', (
      select jsonb_build_object(
        'total', count(*),
        'opted_in', count(*) filter (where consent_status = 'opted_in'),
        'opted_out', count(*) filter (where consent_status = 'opted_out')
      )
      from public.contacts where tenant_id = p_tenant_id
    ),
    'conversations', (
      select jsonb_build_object(
        'total', count(*),
        'open', count(*) filter (where status = 'open'),
        'pending', count(*) filter (where status = 'pending'),
        'resolved', count(*) filter (where status = 'resolved'),
        'unread', count(*) filter (where c.last_message_at is not null and c.last_message_at > coalesce(r.last_read_at, '-infinity'::timestamptz))
      )
      from public.conversations c
      left join public.conversation_reads r on r.tenant_id = c.tenant_id and r.conversation_id = c.id and r.user_id = auth.uid()
      where c.tenant_id = p_tenant_id
    ),
    'unfinished_campaigns', (
      select count(*) from public.campaigns
      where tenant_id = p_tenant_id and status in ('draft', 'scheduled', 'queued', 'running', 'paused')
    ),
    'approved_templates', (
      select count(*) from public.wa_templates
      where tenant_id = p_tenant_id and meta_status = 'approved'
    ),
    'daily_messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', days.day::date::text,
        'label', to_char(days.day::date, 'Mon FMDD'),
        'inbound', coalesce(totals.inbound, 0),
        'outbound', coalesce(totals.outbound, 0)
      ) order by days.day)
      from generate_series(today_utc - 13, today_utc, interval '1 day') as days(day)
      left join (
        select (m.created_at at time zone 'UTC')::date as day,
          count(*) filter (where m.direction = 'inbound') as inbound,
          count(*) filter (where m.direction = 'outbound') as outbound
        from public.messages m
        where m.tenant_id = p_tenant_id
          and m.created_at >= ((today_utc - 13)::timestamp at time zone 'UTC')
          and m.created_at < ((today_utc + 1)::timestamp at time zone 'UTC')
        group by (m.created_at at time zone 'UTC')::date
      ) totals on totals.day = days.day::date
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_tenant_overview(uuid) from public, anon;
grant execute on function public.get_tenant_overview(uuid) to authenticated;
