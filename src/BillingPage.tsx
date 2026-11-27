import React, { useEffect, useState } from 'react';
import { CalendarClock, CreditCard, MessageSquare, Wallet } from 'lucide-react';
import { supabase as supabaseClient } from './lib/supabase';
import { MarketingChrome } from './components/MarketingChrome';
import { Empty, Status } from './components/ui';

const supabase = supabaseClient!;

interface Invoice {
  id: string;
  invoice_number: string;
  currency: string;
  subtotal_minor: number;
  paid_minor: number;
  balance_minor: number;
  due_on: string;
  issued_at: string;
  status: string;
  is_overdue: boolean;
  items?: Array<{ id: string; description: string; quantity: number; unit_amount_minor: number; line_total_minor: number }>;
  payments?: Array<{ id: string; amount_minor: number; method: string; reference: string | null; paid_at: string; reversed_at?: string | null; reversal_reason?: string | null }>;
}
interface BillingAccount {
  billing_name: string;
  billing_email: string;
  billing_reference: string;
  billing_address: string;
}
interface Tenant {
  id: string;
  name: string;
  subscription_status: string | null;
  subscription_tier_name: string | null;
  subscription_monthly_price_minor: number | null;
  subscription_currency: string | null;
  subscription_period_ends: string | null;
  tenant_meta_allowance: { free_service_remaining: number; period_end: string; free_service_used: number } | null;
}
interface BillingEntitlements {
  subscription_status?: string | null;
  currency?: string | null;
  monthly_price_minor?: number | null;
  starts_on?: string | null;
  ends_on?: string | null;
  tier?: { name?: string | null } | null;
}

type BillingPageProps = { tenantId: string; role: string };
const BillingPage: React.FC<BillingPageProps> = ({ tenantId }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [account, setAccount] = useState<BillingAccount | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [checkoutInvoiceId, setCheckoutInvoiceId] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!tenantId) { setTenant(null); setInvoices([]); setAccount(null); setLoading(false); return; }
      setLoading(true);
      setError(null);
      try {
        const [{ data: tenantData, error: tenantError }, { data: allowance, error: allowanceError }, { data: summary, error: summaryError }] = await Promise.all([
          supabase.from('tenants').select('id,name').eq('id', tenantId).single(),
          supabase.rpc('tenant_meta_allowance', { p_tenant_id: tenantId }),
          supabase.rpc('tenant_billing_summary', { p_tenant_id: tenantId }),
        ]);
        if (tenantError) throw tenantError;
        if (summaryError) throw summaryError;
        if (allowanceError) console.warn('Meta allowance unavailable:', allowanceError);
        if (cancelled) return;
        const billing = summary as { entitlements?: BillingEntitlements; invoices?: Invoice[]; account?: BillingAccount } | null;
        const entitlement = billing?.entitlements;
        setTenant({
          id: tenantData.id,
          name: tenantData.name,
          subscription_status: entitlement?.subscription_status ?? null,
          subscription_tier_name: entitlement?.tier?.name ?? null,
          subscription_monthly_price_minor: entitlement?.monthly_price_minor ?? null,
          subscription_currency: entitlement?.currency ?? null,
          subscription_period_ends: entitlement?.ends_on ?? null,
          tenant_meta_allowance: allowance ?? null,
        });
        setInvoices(Array.isArray(billing?.invoices) ? billing.invoices : []);
        setAccount(billing?.account ?? null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Billing information could not be loaded.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [tenantId]);

  const startCheckout = async (invoice: Invoice) => {
    setCheckoutInvoiceId(invoice.id);
    setCheckoutError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('create-subscription-checkout', {
        body: { invoice_id: invoice.id },
      });
      if (invokeError) throw invokeError;
      if (!data?.authorization_url || typeof data.authorization_url !== 'string') {
        throw new Error(data?.error || 'Paystack did not return a checkout link.');
      }
      window.location.assign(data.authorization_url);
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Could not start payment checkout.');
      setCheckoutInvoiceId(null);
    }
  };

  const money = (minor: number, currency = 'KES') => new Intl.NumberFormat('en-KE', { style: 'currency', currency }).format(Number(minor || 0) / 100);
  const date = (value?: string | null) => value ? new Date(value).toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
  const subscriptionLabel = tenant?.subscription_status ? tenant.subscription_status.replace(/_/g, ' ') : 'Not assigned';
  const outstandingByCurrency = invoices.reduce<Record<string, number>>((totals, invoice) => {
    if (invoice.status === 'void') return totals;
    totals[invoice.currency] = (totals[invoice.currency] || 0) + Math.max(0, invoice.balance_minor || 0);
    return totals;
  }, {});
  const outstandingLabel = Object.entries(outstandingByCurrency).filter(([, amount]) => amount > 0).map(([currency, amount]) => money(amount, currency)).join(' · ') || money(0, invoices[0]?.currency || 'KES');

  if (loading) return <MarketingChrome><div className="content"><div className="panel flex min-h-[12rem] items-center justify-center" role="status">Loading billing information…</div></div></MarketingChrome>;

  return (
    <MarketingChrome>
      <div className="content">
        <div className="page-heading">
          <div><span className="eyebrow">Account</span><h1>Billing &amp; Payments</h1><p className="page-description">View your MobiWave WA subscription, invoices and verified payments.</p></div>
        </div>
        {error && <div className="notice error" role="alert">{error}</div>}
        {checkoutError && <div className="notice error" role="alert">{checkoutError}</div>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <article className="kpi-card panel kpi-tone-success"><div className="kpi-body"><span className="kpi-icon"><CreditCard size={20} /></span><div className="kpi-copy"><span className="kpi-label">Subscription</span><strong className="kpi-value">{subscriptionLabel}</strong><span className="kpi-hint">Workspace subscription status</span></div></div></article>
          <article className="kpi-card panel kpi-tone-brand"><div className="kpi-body"><span className="kpi-icon"><Wallet size={20} /></span><div className="kpi-copy"><span className="kpi-label">Current plan</span><strong className="kpi-value">{tenant?.subscription_tier_name ?? 'No plan'}</strong><span className="kpi-hint">{tenant?.subscription_monthly_price_minor != null ? money(tenant.subscription_monthly_price_minor, tenant.subscription_currency || 'KES') + ' / month' : 'Contact MobiWave to select a plan'}</span></div></div></article>
          <article className="kpi-card panel kpi-tone-warning"><div className="kpi-body"><span className="kpi-icon"><CalendarClock size={20} /></span><div className="kpi-copy"><span className="kpi-label">Renewal date</span><strong className="kpi-value">{date(tenant?.subscription_period_ends)}</strong><span className="kpi-hint">Current subscription period end</span></div></div></article>
          <article className="kpi-card panel kpi-tone-brand"><div className="kpi-body"><span className="kpi-icon"><MessageSquare size={20} /></span><div className="kpi-copy"><span className="kpi-label">Meta messages left</span><strong className="kpi-value">{(tenant?.tenant_meta_allowance?.free_service_remaining || 0).toLocaleString()}</strong><span className="kpi-hint">Resets {date(tenant?.tenant_meta_allowance?.period_end)}</span></div></div></article>
        </div>
        <div className="billing-note"><strong>Subscription billing:</strong> Your monthly platform subscription is billed by MobiWave. Meta messaging charges are separate and billed by WhatsApp according to Meta’s published rates. Optional integration assistance is billed only if you request it and approve a separate quote.</div>
        <section className="panel form-panel mt-6" aria-labelledby="billing-contact-title">
          <div className="section-header"><div><h2 id="billing-contact-title">Billing contact</h2><p>Invoices use your saved billing details, or your verified workspace registration email when no separate billing email is recorded.</p></div></div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <div><span className="muted small">Billing name</span><strong className="block">{account?.billing_name || tenant?.name || '—'}</strong></div>
            <div><span className="muted small">Billing email</span><strong className="block break-all">{account?.billing_email || 'Not available'}</strong></div>
            <div><span className="muted small">Customer reference</span><strong className="block">{account?.billing_reference || '—'}</strong></div>
          </div>
          {account?.billing_address && <p className="muted small mt-3">{account.billing_address}</p>}
        </section>
        <div className="section-header"><div><h2>Invoices</h2><p>Review invoice totals, payments received and outstanding balances.</p></div><strong>{outstandingLabel} outstanding</strong></div>
        <div className="source-list">
          <div className="source-table-head invoice-head"><span>Invoice</span><span>Issued</span><span>Due</span><span>Total</span><span>Paid</span><span>Balance</span><span>Status</span></div>
          {invoices.length === 0 ? <Empty icon={<CreditCard size={22} />} title="No invoices yet" text="Your invoices will appear here when MobiWave assigns a subscription or issues a renewal." /> : invoices.map((invoice) => (
            <div className="invoice-record" key={invoice.id}>
              <div className="source-row invoice-row">
                <strong>{invoice.invoice_number}</strong><span className="muted small">{date(invoice.issued_at)}</span><span className="muted small">{date(invoice.due_on)}</span><strong>{money(invoice.subtotal_minor, invoice.currency)}</strong><span>{money(invoice.paid_minor, invoice.currency)}</span><strong>{money(invoice.balance_minor, invoice.currency)}</strong><span className="flex flex-col items-start gap-2"><Status status={invoice.is_overdue ? 'overdue' : invoice.status} />{invoice.status === 'issued' && invoice.balance_minor > 0 && <button type="button" className="btn btn-primary btn-sm" onClick={() => void startCheckout(invoice)} disabled={checkoutInvoiceId !== null}>{checkoutInvoiceId === invoice.id ? 'Preparing…' : 'Pay invoice'}</button>}</span>
              </div>
              {((invoice.items?.length || 0) > 0 || (invoice.payments?.length || 0) > 0) && <details className="px-4 py-3 text-sm">
                <summary className="cursor-pointer font-medium text-brand-700">View invoice details and payment records</summary>
                {invoice.items?.length ? <div className="mt-3"><strong>Invoice items</strong>{invoice.items.map((item) => <div className="flex justify-between gap-4 border-b border-ink-100 py-2" key={item.id}><span>{item.description} · {item.quantity} × {money(item.unit_amount_minor, invoice.currency)}</span><strong>{money(item.line_total_minor, invoice.currency)}</strong></div>)}</div> : null}
                {invoice.payments?.length ? <div className="mt-3"><strong>Payment history</strong>{invoice.payments.map((payment) => <div className="flex flex-wrap justify-between gap-3 border-b border-ink-100 py-2" key={payment.id}><span>{date(payment.paid_at)} · {(payment.method || 'payment').toUpperCase()}{payment.reference ? ' · ' + payment.reference : ''}{payment.reversed_at ? ' · Reversed' + (payment.reversal_reason ? ': ' + payment.reversal_reason : '') : ''}</span><strong>{money(payment.amount_minor, invoice.currency)}</strong></div>)}</div> : null}
              </details>}
            </div>
          ))}
        </div>
        <div className="panel form-panel mt-6">
          <div className="section-header"><div><h2>Paystack payments</h2><p>Secure online payments for your MobiWave WA subscription.</p></div></div>
          <p className="muted small">Pay issued subscription invoices directly through Paystack. The amount and currency are calculated by MobiWave, and payment is confirmed server-side before your invoice is marked paid or your subscription is activated.</p>
          <p className="muted small">No separate payment integration or mobile-money setup is required in your workspace. Your subscription payments are handled by MobiWave through Paystack.</p>
        </div>
      </div>
    </MarketingChrome>
  );
};

export default BillingPage;
