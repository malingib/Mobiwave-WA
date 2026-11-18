-- Performance Optimization Migration for MobiWave WA Commercial Layer
-- Adds indexes for frequently queried columns and audit logging tables

-- Add payment audit logs table for comprehensive audit trail
CREATE TABLE IF NOT EXISTS payment_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
    event VARCHAR(50) NOT NULL,
    details JSONB,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for payment audit logs
CREATE INDEX IF NOT EXISTS idx_payment_audit_logs_tenant ON payment_audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payment_audit_logs_event ON payment_audit_logs(event);
CREATE INDEX IF NOT EXISTS idx_payment_audit_logs_timestamp ON payment_audit_logs(timestamp);

-- Add indexes for tenants table for faster lookups

-- Add indexes for platform_invoices for faster billing queries
CREATE INDEX IF NOT EXISTS idx_platform_invoices_tenant ON platform_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_status ON platform_invoices(status);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_created_at ON platform_invoices(created_at);

-- Add indexes for platform_payments for faster payment lookups
CREATE INDEX IF NOT EXISTS idx_platform_payments_tenant ON platform_payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_platform_payments_status ON platform_payments(status);
CREATE INDEX IF NOT EXISTS idx_platform_payments_mpesa_tx ON platform_payments(mpesa_transaction_id);
CREATE INDEX IF NOT EXISTS idx_platform_payments_due_date ON platform_payments(due_date);
CREATE INDEX IF NOT EXISTS idx_platform_payments_created_at ON platform_payments(created_at);

-- Add indexes for mpesa_transactions for faster status lookups
CREATE INDEX IF NOT EXISTS idx_mpesa_transactions_tenant ON mpesa_transactions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mpesa_transactions_status ON mpesa_transactions(status);
CREATE INDEX IF NOT EXISTS idx_mpesa_transactions_checkout_request_id ON mpesa_transactions(checkout_request_id);
CREATE INDEX IF NOT EXISTS idx_mpesa_transactions_created_at ON mpesa_transactions(created_at);

-- Add indexes for team_members for faster access control
CREATE INDEX IF NOT EXISTS idx_team_members_tenant ON team_members(tenant_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_role ON team_members(role);

-- Add indexes for payment_reminders for dunning system
CREATE INDEX IF NOT EXISTS idx_payment_reminders_tenant ON payment_reminders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payment_reminders_payment ON payment_reminders(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_reminders_status ON payment_reminders(status);
CREATE INDEX IF NOT EXISTS idx_payment_reminders_created ON payment_reminders(created_at);
CREATE INDEX IF NOT EXISTS idx_payment_reminders_type ON payment_reminders(reminder_type);

-- Add indexes for messages for faster conversation lookups
CREATE INDEX IF NOT EXISTS idx_messages_tenant ON messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);

-- Add indexes for campaigns for faster campaign queries
CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON campaigns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_created_at ON campaigns(created_at);

-- Add indexes for templates for faster template lookups
CREATE INDEX IF NOT EXISTS idx_wa_templates_tenant ON wa_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_wa_templates_category ON wa_templates(category);

-- Add indexes for workspace_notifications for faster notification queries
CREATE INDEX IF NOT EXISTS idx_workspace_notifications_tenant ON workspace_notifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_workspace_notifications_category ON workspace_notifications(category);
CREATE INDEX IF NOT EXISTS idx_workspace_notifications_created_at ON workspace_notifications(created_at);

-- Add RLS policies for payment_audit_logs
ALTER TABLE payment_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenants can view their payment audit logs" ON payment_audit_logs
    FOR SELECT USING (tenant_id IN (
        SELECT tenant_id FROM team_members WHERE user_id = auth.uid()
    ));

CREATE POLICY "System can insert payment audit logs" ON payment_audit_logs
    FOR INSERT WITH CHECK (true);

-- Functions will be added in a separate migration to avoid syntax conflicts

-- Add comment on tables for documentation
COMMENT ON TABLE payment_audit_logs IS 'Audit log for all payment-related events';
COMMENT ON COLUMN payment_audit_logs.event IS 'Type of payment event (payment_successful, payment_initiated, past_due_notification_sent, account_suspended, etc.)';
COMMENT ON COLUMN payment_audit_logs.details IS 'Additional event details stored as JSONB';