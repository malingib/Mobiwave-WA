update public.dunning_notification_templates
set subject = replace(subject, 'KES {{amount}}', '{{amount}}'),
    body = replace(body, 'KES {{amount}}', '{{amount}}'),
    updated_at = now()
where template_name in (
  'payment_pre_due_3_days',
  'payment_pre_due_1_day',
  'payment_past_due',
  'payment_grace_period',
  'payment_suspended'
);
