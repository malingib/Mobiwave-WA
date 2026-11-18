-- Add functions for demo workspace management

-- Function to check if user has platform admin access
create or replace function public.check_platform_admin(p_user_id uuid)
returns table (
  user_id uuid,
  email text,
  role text
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select 
    u.id as user_id,
    u.email,
    pa.role
  from auth.users u
  join public.platform_admins pa on pa.user_id = u.id
  where u.id = p_user_id
  and u.deleted_at is null;
$$;

revoke all on function public.check_platform_admin(uuid) from public, anon;
grant execute on function public.check_platform_admin(uuid) to authenticated;

-- Add demo flags to existing tables
alter table public.tenants add column if not exists is_demo boolean default false;
alter table public.tenant_members add column if not exists is_demo boolean default false;
alter table public.tenant_settings add column if not exists is_demo boolean default false;
alter table public.tenant_usage_limits add column if not exists is_demo boolean default false;
alter table public.platform_customer_subscriptions add column if not exists is_demo boolean default false;
alter table public.platform_customer_subscriptions add column if not exists demo_ends_on date null;

-- Add index for demo workspace filtering
create index if not exists tenants_is_demo_idx on public.tenants (is_demo) where is_demo = true;