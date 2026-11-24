import React, { useState, useEffect } from 'react';
import { CalendarClock, CreditCard, MessageSquare, Smartphone, Wallet } from 'lucide-react';
import { supabase as supabaseClient } from './lib/supabase';
import { MarketingChrome } from './components/MarketingChrome';
import { Empty, Status } from './components/ui';

const supabase = supabaseClient!;

interface Invoice {
  id: string;
  invoice_number: string;
  amount: number;
  meta_cost: number;
  total_amount: number;
  status: string;
  due_date: string;
  paid_at?: string;
  created_at: string;
}

interface Payment {
  id: string;
  amount: number;
  currency: string;
  status: string;
  payment_method: string;
  due_date: string;
  paid_at?: string;
  created_at: string;
}

interface Tenant {
  id: string;
  name: string;
  subscription_status: string;
  subscription_period_ends: string;
  tenant_meta_allowance: {
    free_service_remaining: number;
    period_end: string;
    free_service_used: number;
  } | null;
}

interface MpesaConfig {
  id: string;
  consumer_key?: string;
  consumer_secret?: string;
  shortcode?: string;
  passkey?: string;
  callback_url?: string;
  environment: 'sandbox' | 'production';
  is_active: boolean;
}

type BillingPageProps = { tenantId: string; role: string };
const BillingPage: React.FC<BillingPageProps> = ({ tenantId: activeTenantId }) => {
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [mpesaConfig, setMpesaConfig] = useState<MpesaConfig | null>(null);
  const [showMpesaConfig, setShowMpesaConfig] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [processingPayment, setProcessingPayment] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (activeTenantId) void fetchBillingData();
    else { setLoading(false); setTenant(null); setInvoices([]); setPayments([]); }
  }, [activeTenantId]);

  const fetchBillingData = async () => {
    try {
      if (!activeTenantId) throw new Error('Select a business account to view billing.');
      const tenantId = activeTenantId;
      const { data: tenantData, error: tenantError } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', tenantId)
        .single();

      if (tenantError) throw tenantError;

      const { data: allowance, error: allowanceError } = await supabase
        .rpc('tenant_meta_allowance', { p_tenant_id: tenantId });
      if (allowanceError) console.error('Could not load Meta allowance:', allowanceError);

      setTenant({ ...tenantData, tenant_meta_allowance: allowance ?? null });

      // Get invoices
      const { data: invoicesData, error: invoicesError } = await supabase
        .from('platform_invoices')
        .select('*')
        .eq('tenant_id', tenantData.id)
        .order('created_at', { ascending: false });

      if (invoicesError) throw invoicesError;
      setInvoices(invoicesData || []);

      // Get payments
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('platform_payments')
        .select('*')
        .eq('tenant_id', tenantData.id)
        .order('created_at', { ascending: false });

      if (paymentsError) throw paymentsError;
      setPayments(paymentsData || []);

      // Get M-Pesa config
      const { data: mpesaData, error: mpesaError } = await supabase
        .from('mpesa_config')
        .select('*')
        .eq('tenant_id', tenantData.id)
        .eq('is_active', true)
        .single();

      if (!mpesaError && mpesaData) {
        setMpesaConfig(mpesaData);
      }
    } catch (error) {
      console.error('Error fetching billing data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConfigureMpesa = async () => {
    if (!mpesaConfig) {
      // Create new config
      const config = {
        consumer_key: '',
        consumer_secret: '',
        shortcode: '',
        passkey: '',
        callback_url: `${window.location.origin}/api/mpesa-webhook`,
        environment: 'sandbox' as const
      };

      const { error } = await supabase
        .from('mpesa_config')
        .insert([config]);

      if (error) {
        alert('Error saving M-Pesa configuration');
        return;
      }
    }

    setShowMpesaConfig(true);
  };

  const handleSaveMpesaConfig = async () => {
    if (!mpesaConfig) return;

    try {
      const { error } = await supabase
        .from('mpesa_config')
        .update({
          consumer_key: mpesaConfig.consumer_key,
          consumer_secret: mpesaConfig.consumer_secret,
          shortcode: mpesaConfig.shortcode,
          passkey: mpesaConfig.passkey,
          callback_url: mpesaConfig.callback_url,
          environment: mpesaConfig.environment
        })
        .eq('id', mpesaConfig.id);

      if (error) throw error;

      alert('M-Pesa configuration saved successfully');
      setShowMpesaConfig(false);
      fetchBillingData();
    } catch (error) {
      alert('Error saving M-Pesa configuration');
    }
  };

  const handleInitiatePayment = async () => {
    if (!paymentAmount || !phoneNumber) {
      alert('Please fill in all required fields');
      return;
    }

    setProcessingPayment(true);
    setPaymentStatus(null);

    try {
      const amount = parseFloat(paymentAmount);
      const { data, error } = await supabase.functions.invoke('mpesa-integrate', {
        body: {
          action: 'initiate',
          tenant_id: tenant?.id,
          amount,
          phone_number: phoneNumber
        }
      });

      if (error) throw error;

      // Store transaction ID for status checking
      localStorage.setItem('mpesa_transaction_id', data.transaction_id);

      // Show status checking modal
      alert('Payment initiated. Please check your phone and enter M-Pesa PIN to complete the payment.');
      setPaymentStatus({ type: 'success', message: 'Payment initiated successfully' });
      
      // Close modal and refresh data
      setShowPaymentModal(false);
      setPaymentAmount('');
      setPhoneNumber('');
      fetchBillingData();
    } catch (error) {
      setPaymentStatus({ type: 'error', message: (error as Error).message || 'Failed to initiate payment' });
    } finally {
      setProcessingPayment(false);
    }
  };

  const handleCheckPaymentStatus = async () => {
    const transactionId = localStorage.getItem('mpesa_transaction_id');
    if (!transactionId) {
      alert('No active payment transaction found');
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke('mpesa-integrate', {
        body: {
          action: 'status',
          tenant_id: tenant?.id,
          transaction_id: transactionId
        }
      });

      if (error) throw error;

      alert(`Payment status: ${data.status}`);
      fetchBillingData();
    } catch (error) {
      alert('Failed to check payment status');
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: 'KES'
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-KE', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  if (loading) {
    return (
      <MarketingChrome>
        <div className="content">
          <div className="panel flex min-h-[12rem] items-center justify-center gap-2" role="status">
            <span className="animate-spin rounded-full h-5 w-5 border-2 border-brand-200 border-t-brand-600" />
            <span className="muted small">Loading billing information…</span>
          </div>
        </div>
      </MarketingChrome>
    );
  }

  const subscriptionLabel = tenant?.subscription_status
    ? tenant.subscription_status.charAt(0).toUpperCase() + tenant.subscription_status.slice(1)
    : 'None';
  const subscriptionActive = tenant?.subscription_status === 'active';

  return (
    <MarketingChrome>
      <div className="content">
        <div className="page-heading">
          <div>
            <span className="eyebrow">Account</span>
            <h1>Billing &amp; Payments</h1>
            <p className="page-description">Manage your subscription, invoices and M-Pesa payment method.</p>
          </div>
          <div className="flex flex-none flex-wrap items-center gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => void handleCheckPaymentStatus()}>
              Check payment
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setShowPaymentModal(true)}>
              <Wallet size={15} /> Pay now
            </button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <article className="kpi-card panel kpi-tone-success">
            <div className="kpi-body">
              <span className="kpi-icon"><CreditCard size={20} /></span>
              <div className="kpi-copy">
                <span className="kpi-label">Subscription</span>
                <strong className="kpi-value">{subscriptionLabel}</strong>
                <span className="kpi-hint">{subscriptionActive ? 'Workspace billing is up to date' : 'Review your billing settings'}</span>
              </div>
            </div>
          </article>
          <article className="kpi-card panel kpi-tone-brand">
            <div className="kpi-body">
              <span className="kpi-icon"><Wallet size={20} /></span>
              <div className="kpi-copy">
                <span className="kpi-label">Current plan</span>
                <strong className="kpi-value">{tenant?.subscription_status ? 'Active plan' : 'No plan'}</strong>
                <span className="kpi-hint">Platform fee billed separately from Meta</span>
              </div>
            </div>
          </article>
          <article className="kpi-card panel kpi-tone-warning">
            <div className="kpi-body">
              <span className="kpi-icon"><CalendarClock size={20} /></span>
              <div className="kpi-copy">
                <span className="kpi-label">Renewal date</span>
                <strong className="kpi-value">{tenant?.subscription_period_ends ? formatDate(tenant.subscription_period_ends) : 'N/A'}</strong>
                <span className="kpi-hint">Next subscription period</span>
              </div>
            </div>
          </article>
          <article className="kpi-card panel kpi-tone-brand">
            <div className="kpi-body">
              <span className="kpi-icon"><MessageSquare size={20} /></span>
              <div className="kpi-copy">
                <span className="kpi-label">Meta messages left</span>
                <strong className="kpi-value">{(tenant?.tenant_meta_allowance?.free_service_remaining || 0).toLocaleString()}</strong>
                <span className="kpi-hint">
                  Resets {tenant?.tenant_meta_allowance?.period_end ? formatDate(tenant.tenant_meta_allowance.period_end) : 'N/A'}
                </span>
              </div>
            </div>
          </article>
        </div>

        <div className="billing-note">
          <strong>Pricing model:</strong> Your platform fee covers workspace management and team collaboration. Meta message charges are billed separately by WhatsApp according to their published rates.
        </div>

        <div className="panel-grid-2">
          <section className="panel form-panel">
            <div className="section-header">
              <div>
                <h2>Payment method</h2>
                <p>M-Pesa is used to settle invoices and top up your account.</p>
              </div>
              <button type="button" className="secondary-button compact" onClick={() => void handleConfigureMpesa()}>
                {mpesaConfig ? 'Edit M-Pesa' : 'Configure M-Pesa'}
              </button>
            </div>

            {mpesaConfig ? (
              <div className="setup-row">
                <span className="setting-icon"><Smartphone size={18} /></span>
                <div>
                  <strong>M-Pesa</strong>
                  <p>{mpesaConfig.environment === 'sandbox' ? 'Sandbox' : 'Production'} mode · Paybill / shortcode {mpesaConfig.shortcode || 'not set'}</p>
                </div>
                <Status status={mpesaConfig.is_active ? 'active' : 'disabled'} />
              </div>
            ) : (
              <p className="muted small">No payment method configured yet. Add your M-Pesa details to pay invoices from this workspace.</p>
            )}

            {showMpesaConfig && (
              <div className="field-stack">
                <div className="form-grid">
                  <div className="field">
                    <label>Consumer key</label>
                    <input
                      type="text"
                      value={mpesaConfig?.consumer_key || ''}
                      onChange={(e) => setMpesaConfig(prev => prev ? { ...prev, consumer_key: e.target.value } : null)}
                    />
                  </div>
                  <div className="field">
                    <label>Consumer secret</label>
                    <input
                      type="password"
                      value={mpesaConfig?.consumer_secret || ''}
                      onChange={(e) => setMpesaConfig(prev => prev ? { ...prev, consumer_secret: e.target.value } : null)}
                    />
                  </div>
                  <div className="field">
                    <label>Shortcode</label>
                    <input
                      type="text"
                      value={mpesaConfig?.shortcode || ''}
                      onChange={(e) => setMpesaConfig(prev => prev ? { ...prev, shortcode: e.target.value } : null)}
                    />
                  </div>
                  <div className="field">
                    <label>Passkey</label>
                    <input
                      type="password"
                      value={mpesaConfig?.passkey || ''}
                      onChange={(e) => setMpesaConfig(prev => prev ? { ...prev, passkey: e.target.value } : null)}
                    />
                  </div>
                  <div className="field">
                    <label>Environment</label>
                    <select
                      value={mpesaConfig?.environment || 'sandbox'}
                      onChange={(e) => setMpesaConfig(prev => prev ? { ...prev, environment: e.target.value as 'sandbox' | 'production' } : null)}
                    >
                      <option value="sandbox">Sandbox</option>
                      <option value="production">Production</option>
                    </select>
                  </div>
                </div>
                <div className="form-actions">
                  <span className="muted small">Credentials are stored against this business account.</span>
                  <div className="flex items-center gap-2">
                    <button type="button" className="secondary-button" onClick={() => setShowMpesaConfig(false)}>Cancel</button>
                    <button type="button" className="primary-button" onClick={() => void handleSaveMpesaConfig()}>Save configuration</button>
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="panel form-panel">
            <div className="section-header">
              <div>
                <h2>Make a payment</h2>
                <p>Top up your account to keep outbound messaging and campaigns running.</p>
              </div>
            </div>
            <p className="muted small">
              Payments are initiated through M-Pesa STK push. You will receive a prompt on your phone to authorise the amount you enter.
            </p>
            <div className="form-actions">
              <span className="muted small">Settled in Kenyan shillings (KES).</span>
              <button type="button" className="btn btn-primary" onClick={() => setShowPaymentModal(true)}>
                <Wallet size={15} /> Pay with M-Pesa
              </button>
            </div>
          </section>
        </div>

        <div className="section-header">
          <div>
            <h2>Recent invoices</h2>
            <p>Platform fees and Meta message charges for this workspace.</p>
          </div>
        </div>
        <div className="source-list">
          <div className="source-table-head invoice-head">
            <span>Invoice</span><span>Date</span><span>Amount</span><span>Meta cost</span><span>Total</span><span>Status</span>
          </div>
          {invoices.length === 0 ? (
            <Empty icon={<CreditCard size={22} />} title="No invoices yet" text="Invoices will appear here once your workspace is billed." />
          ) : (
            invoices.map((invoice) => (
              <div className="source-row invoice-row" key={invoice.id}>
                <strong>{invoice.invoice_number}</strong>
                <span className="muted small">{formatDate(invoice.created_at)}</span>
                <span>{formatCurrency(invoice.amount)}</span>
                <span>{formatCurrency(invoice.meta_cost)}</span>
                <strong>{formatCurrency(invoice.total_amount)}</strong>
                <span><Status status={invoice.status} /></span>
              </div>
            ))
          )}
        </div>

        <div className="section-header">
          <div>
            <h2>Payment history</h2>
            <p>Completed and pending M-Pesa payments for this workspace.</p>
          </div>
        </div>
        <div className="source-list">
          <div className="source-table-head payment-head">
            <span>Date</span><span>Amount</span><span>Method</span><span>Status</span>
          </div>
          {payments.length === 0 ? (
            <Empty icon={<Wallet size={22} />} title="No payments yet" text="Payments you make will be listed here." />
          ) : (
            payments.map((payment) => (
              <div className="source-row payment-row" key={payment.id}>
                <span>{formatDate(payment.created_at)}</span>
                <strong>{formatCurrency(payment.amount)}</strong>
                <span className="muted small">{payment.payment_method.toUpperCase()}</span>
                <span><Status status={payment.status} /></span>
              </div>
            ))
          )}
        </div>
      </div>

      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(12,36,60,0.45)] p-4">
          <div className="panel w-full max-w-md p-6">
            <div className="section-header">
              <div>
                <h2>Make a payment</h2>
                <p>Enter the amount and the M-Pesa number to charge.</p>
              </div>
              <button type="button" className="icon-btn" aria-label="Close payment dialog" onClick={() => setShowPaymentModal(false)}>
                <span aria-hidden>×</span>
              </button>
            </div>

            {paymentStatus && (
              <p className={paymentStatus.type === 'success' ? 'notice success' : 'notice error'} role="status">
                {paymentStatus.message}
              </p>
            )}

            <div className="flex flex-col gap-4">
              <div className="field">
                <label>Amount (KES)</label>
                <input
                  type="number"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  placeholder="Enter amount"
                />
              </div>
              <div className="field">
                <label>Phone number</label>
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="2547XXXXXXXX"
                />
              </div>
            </div>

            <div className="form-actions">
              <button type="button" className="text-brand-600 hover:text-brand-800 text-sm font-medium" onClick={() => void handleCheckPaymentStatus()}>
                Check payment status
              </button>
              <div className="flex items-center gap-2">
                <button type="button" className="secondary-button" onClick={() => setShowPaymentModal(false)}>Cancel</button>
                <button type="button" className="primary-button" onClick={() => void handleInitiatePayment()} disabled={processingPayment}>
                  {processingPayment ? 'Processing…' : 'Pay with M-Pesa'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </MarketingChrome>
  );
};

export default BillingPage;
