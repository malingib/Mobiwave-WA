update public.dunning_notification_templates
set subject = 'FINAL NOTICE: Your MobiWave subscription will be suspended tomorrow',
    body = 'Dear {{tenant_name}},\n\nYour MobiWave subscription invoice {{invoice_number}} for KES {{amount}} remains unpaid and is now in its final grace-period day. The 2-day grace period ends tomorrow. If the outstanding balance is not received before the grace period ends, your subscription will be suspended automatically.\n\nPlease pay through the Billing page in your MobiWave WA dashboard. If you have already paid, allow time for the payment confirmation or contact support.\n\nBest regards,\nThe MobiWave Team',
    updated_at = now()
where template_name = 'payment_grace_period';
