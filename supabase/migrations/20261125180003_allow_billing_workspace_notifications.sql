alter table public.workspace_notifications
  drop constraint if exists workspace_notifications_category_check;

alter table public.workspace_notifications
  add constraint workspace_notifications_category_check
  check (category = any (array[
    'message_status'::text,
    'send_error'::text,
    'campaign_error'::text,
    'integration_error'::text,
    'system'::text,
    'billing'::text
  ]));
