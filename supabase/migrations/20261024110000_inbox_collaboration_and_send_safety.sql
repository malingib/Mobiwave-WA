-- Operational safety and inbox collaboration for MobiWave WA.

-- A zero message limit means no fixed platform cap, matching the published plans.
alter table public.tenant_usage_limits alter column monthly_message_limit set default 0;
update public.tenant_usage_limits set monthly_message_limit = 0 where monthly_message_limit = 1000;

alter table public.campaign_recipients
  add column if not exists claimed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

-- Claim queued recipients in one transaction. Concurrent launch requests skip
-- rows already locked by another request, so one recipient cannot be sent twice.
create or replace function public.claim_campaign_recipients(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_limit integer default 10
)
returns table(recipient_id uuid, contact_id uuid)
language sql
security definer
set search_path = public
as $$
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
$$;
revoke all on function public.claim_campaign_recipients(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_campaign_recipients(uuid, uuid, integer) to service_role;

create table if not exists public.conversation_reads (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (tenant_id, conversation_id, user_id)
);
alter table public.conversation_reads enable row level security;
create policy "members can read own conversation read markers" on public.conversation_reads for select to authenticated
using (user_id = (select auth.uid()) and exists (
  select 1 from public.tenant_members tm where tm.tenant_id = conversation_reads.tenant_id and tm.user_id = (select auth.uid())
));
create policy "members can manage own conversation read markers" on public.conversation_reads for all to authenticated
using (user_id = (select auth.uid()) and exists (
  select 1 from public.tenant_members tm where tm.tenant_id = conversation_reads.tenant_id and tm.user_id = (select auth.uid())
))
with check (user_id = (select auth.uid()) and exists (
  select 1 from public.tenant_members tm where tm.tenant_id = conversation_reads.tenant_id and tm.user_id = (select auth.uid())
));
grant select, insert, update on public.conversation_reads to authenticated;

create table if not exists public.conversation_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists conversation_notes_timeline_idx on public.conversation_notes(tenant_id, conversation_id, created_at);
alter table public.conversation_notes enable row level security;
create policy "members can read conversation notes" on public.conversation_notes for select to authenticated
using (exists (select 1 from public.tenant_members tm where tm.tenant_id = conversation_notes.tenant_id and tm.user_id = (select auth.uid())));
create policy "agents can add conversation notes" on public.conversation_notes for insert to authenticated
with check (author_id = (select auth.uid()) and exists (
  select 1 from public.tenant_members tm where tm.tenant_id = conversation_notes.tenant_id and tm.user_id = (select auth.uid()) and tm.role in ('owner','admin','agent')
));
grant select, insert on public.conversation_notes to authenticated;

create table if not exists public.contact_consent_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  previous_status text check (previous_status is null or previous_status in ('unknown','opted_in','opted_out')),
  consent_status text not null check (consent_status in ('unknown','opted_in','opted_out')),
  consent_source text,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists contact_consent_events_timeline_idx on public.contact_consent_events(tenant_id, contact_id, changed_at desc);
alter table public.contact_consent_events enable row level security;
create policy "members can read consent history" on public.contact_consent_events for select to authenticated
using (exists (select 1 from public.tenant_members tm where tm.tenant_id = contact_consent_events.tenant_id and tm.user_id = (select auth.uid())));
grant select on public.contact_consent_events to authenticated;

create or replace function public.log_contact_consent_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.contact_consent_events(tenant_id, contact_id, previous_status, consent_status, consent_source, changed_by)
    values (new.tenant_id, new.id, null, new.consent_status, new.consent_source, auth.uid());
  elsif new.consent_status is distinct from old.consent_status
     or (new.consent_status = 'opted_out' and new.opted_out_at is distinct from old.opted_out_at) then
    insert into public.contact_consent_events(tenant_id, contact_id, previous_status, consent_status, consent_source, changed_by)
    values (new.tenant_id, new.id, old.consent_status, new.consent_status, new.consent_source, auth.uid());
  end if;
  return new;
end;
$$;
drop trigger if exists contacts_log_consent_change on public.contacts;
create trigger contacts_log_consent_change after insert or update of consent_status on public.contacts
for each row execute function public.log_contact_consent_change();

-- Enable Supabase Realtime delivery for the tables used by the shared inbox.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations') then
    alter publication supabase_realtime add table public.conversations;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_notes') then
    alter publication supabase_realtime add table public.conversation_notes;
  end if;
end;
$$;
