-- Dunning System Schema for MobiWave WA
-- This migration adds support for automated dunning and payment reminders

-- Add payment reminders table
CREATE TABLE payment_reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
    owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    payment_id UUID REFERENCES platform_payments(id) ON DELETE CASCADE,
    reminder_type VARCHAR(20) NOT NULL CHECK (reminder_type IN ('pre_due', 'past_due', 'grace')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    sent_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    failure_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add notification templates for dunning
CREATE TABLE dunning_notification_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_name VARCHAR(50) NOT NULL UNIQUE,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default dunning notification templates
INSERT INTO dunning_notification_templates (template_name, subject, body) VALUES
('payment_pre_due_3_days', 'Payment Reminder - Your subscription is due in 3 days', 
 'Dear {{tenant_name}}, 

This is a reminder that your MobiWave subscription payment of KES {{amount}} is due in 3 days (due on {{due_date}}).

Please ensure your payment is processed to avoid any service interruption. You can make payments through your MobiWave dashboard.

If you have any questions about your subscription, please contact our support team.

Best regards,
The MobiWave Team'),

('payment_pre_due_1_day', 'URGENT: Payment Reminder - Your subscription is due tomorrow', 
 'Dear {{tenant_name}}, 

This is an urgent reminder that your MobiWave subscription payment of KES {{amount}} is due tomorrow (due on {{due_date}}).

Please ensure your payment is processed immediately to avoid any service interruption. You can make payments through your MobiWave dashboard.

If you have any questions about your subscription, please contact our support team.

Best regards,
The MobiWave Team'),

('payment_past_due', 'Your MobiWave subscription payment is now past due', 
 'Dear {{tenant_name}}, 

Your MobiWave subscription payment of KES {{amount}} was due on {{due_date}} and is now past due.

Please make your payment immediately to restore full access to your account. You can make payments through your MobiWave dashboard.

If payment is not received within 2 days, your account will be temporarily suspended and you will lose access to all MobiWave services including inbound message visibility.

If you have any questions about your subscription, please contact our support team.

Best regards,
The MobiWave Team'),

('payment_grace_period', 'FINAL NOTICE: Your account will be suspended in 2 days', 
 'Dear {{tenant_name}}, 

This is a final notice that your MobiWave subscription payment of KES {{amount}} is now past due and your account will be suspended in 2 days.

After suspension, you will lose access to all MobiWave services including inbound message visibility. All campaigns will be paused and no messages will be sent or received.

Please make your payment immediately to avoid suspension. You can make payments through your MobiWave dashboard.

If you have any questions about your subscription, please contact our support team.

Best regards,
The MobiWave Team'),

('payment_suspended', 'Your MobiWave account has been suspended', 
 'Dear {{tenant_name}}, 

Your MobiWave account has been suspended due to non-payment of KES {{amount}} that was due on {{due_date}}.

You currently have no access to any MobiWave services. To reactivate your account, please make the outstanding payment through your MobiWave dashboard. Once payment is received, your account will be automatically reactivated within 1 hour.

If you believe this is an error or need to discuss alternative payment arrangements, please contact our support team.

Best regards,
The MobiWave Team');

-- Add indexes for performance
CREATE INDEX idx_payment_reminders_tenant ON payment_reminders(tenant_id);
CREATE INDEX idx_payment_reminders_payment ON payment_reminders(payment_id);
CREATE INDEX idx_payment_reminders_status ON payment_reminders(status);
CREATE INDEX idx_payment_reminders_created ON payment_reminders(created_at);

-- Add RLS policies
ALTER TABLE payment_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE dunning_notification_templates ENABLE ROW LEVEL SECURITY;

-- RLS policies for payment_reminders
CREATE POLICY "Tenants can view their payment reminders" ON payment_reminders
    FOR SELECT USING (auth.uid() = payment_reminders.owner_id OR tenant_id IN (
        SELECT tenant_id FROM team_members WHERE user_id = auth.uid()
    ));

CREATE POLICY "System can manage payment reminders" ON payment_reminders
    FOR ALL USING (true);

-- RLS policies for dunning_notification_templates
CREATE POLICY "Admins can manage dunning templates" ON dunning_notification_templates
    FOR ALL USING (auth.uid() in (select user_id from public.platform_admins));

-- Add function to get active dunning templates
CREATE OR REPLACE FUNCTION get_active_dunning_templates()
RETURNS TABLE (
    id UUID,
    template_name VARCHAR(50),
    subject TEXT,
    body TEXT
) AS $$
BEGIN
    RETURN QUERY SELECT 
        id, template_name, subject, body 
    FROM dunning_notification_templates 
    WHERE is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;