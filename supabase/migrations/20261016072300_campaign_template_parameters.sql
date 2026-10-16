alter table public.campaigns add column if not exists template_parameters jsonb not null default '[]'::jsonb;
