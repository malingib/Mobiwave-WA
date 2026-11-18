-- M-Pesa Integration Schema for MobiWave WA
-- This migration adds support for M-Pesa Daraja API integration

-- Add M-Pesa configuration table
CREATE TABLE mpesa_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
    owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    consumer_key TEXT NOT NULL,
    consumer_secret TEXT NOT NULL,
    shortcode TEXT NOT NULL,
    passkey TEXT NOT NULL,
    callback_url TEXT NOT NULL,
    environment VARCHAR(20) NOT NULL DEFAULT 'sandbox',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add M-Pesa transactions table
CREATE TABLE mpesa_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
    owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    transaction_id TEXT UNIQUE NOT NULL,
    checkout_request_id TEXT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    phone_number TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    result_code INTEGER,
    result_description TEXT,
    merchant_request_id TEXT,
    response_code TEXT,
    response_description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add platform payments table
CREATE TABLE platform_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
    owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    invoice_id UUID REFERENCES platform_invoices(id) ON DELETE SET NULL,
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'KES',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    mpesa_transaction_id TEXT REFERENCES mpesa_transactions(transaction_id),
    payment_method VARCHAR(20) NOT NULL,
    due_date TIMESTAMPTZ NOT NULL,
    paid_at TIMESTAMPTZ,
    failure_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add team members table
CREATE TABLE team_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'editor')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, user_id)
);

-- Add indexes for performance
CREATE INDEX idx_mpesa_config_tenant ON mpesa_config(tenant_id);
CREATE INDEX idx_mpesa_transactions_tenant ON mpesa_transactions(tenant_id);
CREATE INDEX idx_mpesa_transactions_status ON mpesa_transactions(status);
CREATE INDEX idx_platform_payments_tenant ON platform_payments(tenant_id);
CREATE INDEX idx_platform_payments_status ON platform_payments(status);
CREATE INDEX idx_team_members_tenant ON team_members(tenant_id);
CREATE INDEX idx_team_members_user ON team_members(user_id);

-- Add RLS policies
ALTER TABLE mpesa_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpesa_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

-- RLS policies for mpesa_config
CREATE POLICY "Tenants can view their M-Pesa config" ON mpesa_config
    FOR SELECT USING (auth.uid() = mpesa_config.owner_id OR tenant_id IN (
        SELECT tenant_id FROM team_members WHERE user_id = auth.uid()
    ));

CREATE POLICY "Tenants can manage their M-Pesa config" ON mpesa_config
    FOR ALL USING (auth.uid() = mpesa_config.owner_id);

-- RLS policies for mpesa_transactions
CREATE POLICY "Tenants can view their M-Pesa transactions" ON mpesa_transactions
    FOR SELECT USING (auth.uid() = mpesa_transactions.owner_id OR tenant_id IN (
        SELECT tenant_id FROM team_members WHERE user_id = auth.uid()
    ));

-- RLS policies for platform_payments
CREATE POLICY "Tenants can view their payments" ON platform_payments
    FOR SELECT USING (auth.uid() = platform_payments.owner_id OR tenant_id IN (
        SELECT tenant_id FROM team_members WHERE user_id = auth.uid()
    ));

CREATE POLICY "Tenants can create payments" ON platform_payments
    FOR INSERT WITH CHECK (auth.uid() = platform_payments.owner_id OR tenant_id IN (
        SELECT tenant_id FROM team_members WHERE user_id = auth.uid()
    ));

-- RLS policies for team_members
CREATE POLICY "Tenants can view team members" ON team_members
    FOR SELECT USING (auth.uid() = team_members.user_id OR tenant_id IN (
        SELECT tenant_id FROM team_members WHERE user_id = auth.uid()
    ));

CREATE POLICY "Tenants can manage team members" ON team_members
    FOR ALL USING (auth.uid() = team_members.user_id);

-- Add function to check if user is team member
CREATE OR REPLACE FUNCTION is_team_member(tenant_id UUID, user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM team_members 
        WHERE tenant_id = is_team_member.tenant_id 
        AND user_id = is_team_member.user_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add function to check if user has admin role in tenant
CREATE OR REPLACE FUNCTION is_tenant_admin(tenant_id UUID, user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM team_members 
        WHERE tenant_id = is_tenant_admin.tenant_id 
        AND user_id = is_tenant_admin.user_id
        AND role = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;