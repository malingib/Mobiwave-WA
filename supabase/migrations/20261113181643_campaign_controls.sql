create or replace function public.claim_campaign_recipients(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_limit integer default 10
)
returns table(recipient_id uuid, contact_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  campaign_status text;
begin
  select c.status into campaign_status
  from public.campaigns c
  where c.tenant_id = p_tenant_id and c.id = p_campaign_id
  for update;

  if not found or campaign_status <> 'running' then
    return;
  end if;

  return query
  with candidates as (
    select cr.id
    from public.campaign_recipients cr
    where cr.tenant_id = p_tenant_id
      and cr.campaign_id = p_campaign_id
      and cr.status = 'queued'
    order by cr.created_at, cr.id
    limit greatest(1, least(coalesce(p_limit, 10), 10))
    for update skip locked
  ), claimed as (
    update public.campaign_recipients cr
    set status = 'sending', claimed_at = now(), updated_at = now(), attempts = attempts + 1
    from candidates
    where cr.id = candidates.id
    returning cr.id, cr.contact_id
  )
  select claimed.id, claimed.contact_id from claimed;
end;
$$;

revoke all on function public.claim_campaign_recipients(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_campaign_recipients(uuid, uuid, integer) to service_role;

create or replace function public.control_campaign(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_action text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_status text;
  next_status text;
begin
  if p_action is null or p_action not in ('pause', 'cancel') then
    raise exception 'Unsupported campaign action';
  end if;

  select c.status into current_status
  from public.campaigns c
  where c.tenant_id = p_tenant_id and c.id = p_campaign_id
  for update;

  if not found then
    raise exception 'Campaign not found';
  end if;

  if p_action = 'pause' then
    if current_status not in ('running', 'paused') then
      raise exception 'Only a running campaign can be paused';
    end if;
    next_status := 'paused';
  else
    if current_status not in ('draft', 'scheduled', 'queued', 'running', 'paused', 'cancelled') then
      raise exception 'Campaign cannot be cancelled from its current state';
    end if;
    next_status := 'cancelled';
  end if;

  if current_status <> next_status then
    update public.campaigns
    set status = next_status, finished_at = case when next_status = 'cancelled' then now() else null end, updated_at = now()
    where tenant_id = p_tenant_id and id = p_campaign_id;
  end if;

  if next_status = 'cancelled' then
    update public.campaign_recipients
    set status = 'skipped', error_code = 'campaign_cancelled',
        error_detail = 'Campaign cancelled by a workspace administrator.', updated_at = now()
    where tenant_id = p_tenant_id and campaign_id = p_campaign_id and status = 'queued';
  end if;

  return next_status;
end;
$$;

revoke all on function public.control_campaign(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.control_campaign(uuid, uuid, text) to service_role;

create or replace function public.release_campaign_recipients(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_recipient_ids uuid[]
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  campaign_status text;
begin
  select c.status into campaign_status
  from public.campaigns c
  where c.tenant_id = p_tenant_id and c.id = p_campaign_id
  for update;

  if not found then
    raise exception 'Campaign not found';
  end if;

  if campaign_status = 'cancelled' then
    update public.campaign_recipients
    set status = 'skipped', error_code = 'campaign_cancelled',
        error_detail = 'Campaign cancelled by a workspace administrator.', claimed_at = null, updated_at = now()
    where tenant_id = p_tenant_id and campaign_id = p_campaign_id
      and id = any(coalesce(p_recipient_ids, '{}'::uuid[])) and status = 'sending';
  elsif campaign_status in ('running', 'paused') then
    update public.campaign_recipients
    set status = 'queued', error_code = null, error_detail = null, claimed_at = null, updated_at = now()
    where tenant_id = p_tenant_id and campaign_id = p_campaign_id
      and id = any(coalesce(p_recipient_ids, '{}'::uuid[])) and status = 'sending';
  end if;

  return campaign_status;
end;
$$;

revoke all on function public.release_campaign_recipients(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.release_campaign_recipients(uuid, uuid, uuid[]) to service_role;
