alter table public.tenant_api_keys
  add column if not exists client_id text;
update public.tenant_api_keys
set client_id = 'mw_client_' || replace(gen_random_uuid()::text, '-', '')
where client_id is null;
alter table public.tenant_api_keys alter column client_id set not null;
alter table public.tenant_api_keys alter column client_id set default ('mw_client_' || replace(gen_random_uuid()::text, '-', ''));
create unique index if not exists tenant_api_keys_client_id_uidx on public.tenant_api_keys(client_id);

create table if not exists public.tenant_api_rate_limits (
  api_key_id uuid not null references public.tenant_api_keys(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (api_key_id, window_started_at)
);
alter table public.tenant_api_rate_limits enable row level security;
revoke all on public.tenant_api_rate_limits from anon, authenticated;
grant all on public.tenant_api_rate_limits to service_role;

create or replace function public.claim_tenant_api_rate_limit(
  p_api_key_id uuid,
  p_limit integer default 120
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz := date_trunc('minute', now());
  v_count integer;
begin
  insert into public.tenant_api_rate_limits(api_key_id, window_started_at, request_count)
  values (p_api_key_id, v_window, 1)
  on conflict (api_key_id, window_started_at)
  do update set request_count = public.tenant_api_rate_limits.request_count + 1
  returning request_count into v_count;
  return v_count <= greatest(1, least(coalesce(p_limit, 120), 1200));
end;
$$;
revoke all on function public.claim_tenant_api_rate_limit(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_tenant_api_rate_limit(uuid, integer) to service_role;

-- Keep only recent rate-limit buckets; run opportunistically from API traffic.
