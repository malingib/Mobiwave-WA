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
  payments?: Array<{ id: string; amount_minor: number; method: string; reference: string | null; paid_at: string }>;
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
  const [tenant, setTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!tenantId) { setTenant(null); setInvoices([]); setLoading(false); return; }
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
        const billing = summary as { entitlements?: BillingEntitlements; invoices?: Invoice[] } | null;
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
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Billing information could not be loaded.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [tenantId]);

  const money = (minor: number, currency = 'KES') => new Intl.NumberFormat('en-KE', { style: 'currency', currency }).format(Number(minor || 0) / 100);
  const date = (value?: string | null) => value ? new Date(value).toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
  const subscriptionLabel = tenant?.subscription_status ? tenant.subscription_status.replace(/_/g, ' ') : 'Not assigned';
  const outstandingByCurrency = invoices.reduce<Record<string, number>>((totals, invoice) => {
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
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <article className="kpi-card panel kpi-tone-success"><div className="kpi-body"><span className="kpi-icon"><CreditCard size={20} /></span><div className="kpi-copy"><span className="kpi-label">Subscription</span><strong className="kpi-value">{subscriptionLabel}</strong><span className="kpi-hint">Workspace subscription status</span></div></div></article>
          <article className="kpi-card panel kpi-tone-brand"><div className="kpi-body"><span className="kpi-icon"><Wallet size={20} /></span><div className="kpi-copy"><span className="kpi-label">Current plan</span><strong className="kpi-value">{tenant?.subscription_tier_name ?? 'No plan'}</strong><span className="kpi-hint">{tenant?.subscription_monthly_price_minor != null ? money(tenant.subscription_monthly_price_minor, tenant.subscription_currency || 'KES') + ' / month' : 'Contact MobiWave to select a plan'}</span></div></div></article>
          <article className="kpi-card panel kpi-tone-warning"><div className="kpi-body"><span className="kpi-icon"><CalendarClock size={20} /></span><div className="kpi-copy"><span className="kpi-label">Renewal date</span><strong className="kpi-value">{date(tenant?.subscription_period_ends)}</strong><span className="kpi-hint">Current subscription period end</span></div></div></article>
          <article className="kpi-card panel kpi-tone-brand"><div className="kpi-body"><span className="kpi-icon"><MessageSquare size={20} /></span><div className="kpi-copy"><span className="kpi-label">Meta messages left</span><strong className="kpi-value">{(tenant?.tenant_meta_allowance?.free_service_remaining || 0).toLocaleString()}</strong><span className="kpi-hint">Resets {date(tenant?.tenant_meta_allowance?.period_end)}</span></div></div></article>
        </div>
        <div className="billing-note"><strong>Subscription billing:</strong> Your monthly platform subscription is billed by MobiWave. Meta messaging charges are separate and billed by WhatsApp according to Meta’s published rates. Optional integration assistance is billed only if you request it and approve a separate quote.</div>
        <div className="section-header"><div><h2>Invoices</h2><p>Review invoice totals, payments received and outstanding balances.</p></div><strong>{outstandingLabel} outstanding</strong></div>
        <div className="source-list">
          <div className="source-table-head invoice-head"><span>Invoice</span><span>Issued</span><span>Due</span><span>Total</span><span>Paid</span><span>Balance</span><span>Status</span></div>
          {invoices.length === 0 ? <Empty icon={<CreditCard size={22} />} title="No invoices yet" text="Your invoices will appear here when MobiWave assigns a subscription or issues a renewal." /> : invoices.map((invoice) => (
            <div className="invoice-record" key={invoice.id}>
              <div className="source-row invoice-row">
                <strong>{invoice.invoice_number}</strong><span className="muted small">{date(invoice.issued_at)}</span><span className="muted small">{date(invoice.due_on)}</span><strong>{money(invoice.subtotal_minor, invoice.currency)}</strong><span>{money(invoice.paid_minor, invoice.currency)}</span><strong>{money(invoice.balance_minor, invoice.currency)}</strong><span><Status status={invoice.is_overdue ? 'overdue' : invoice.status} /></span>
              </div>
              {((invoice.items?.length || 0) > 0 || (invoice.payments?.length || 0) > 0) && <details className="px-4 py-3 text-sm">
                <summary className="cursor-pointer font-medium text-brand-700">View invoice details and payment records</summary>
                {invoice.items?.length ? <div className="mt-3"><strong>Invoice items</strong>{invoice.items.map((item) => <div className="flex justify-between gap-4 border-b border-ink-100 py-2" key={item.id}><span>{item.description} · {item.quantity} × {money(item.unit_amount_minor, invoice.currency)}</span><strong>{money(item.line_total_minor, invoice.currency)}</strong></div>)}</div> : null}
                {invoice.payments?.length ? <div className="mt-3"><strong>Verified payments</strong>{invoice.payments.map((payment) => <div className="flex flex-wrap justify-between gap-3 border-b border-ink-100 py-2" key={payment.id}><span>{date(payment.paid_at)} · {(payment.method || 'payment').toUpperCase()}{payment.reference ? ' · ' + payment.reference : ''}</span><strong>{money(payment.amount_minor, invoice.currency)}</strong></div>)}</div> : null}
              </details>}
            </div>
          ))}
        </div>
        <div className="panel form-panel mt-6">
          <div className="section-header"><div><h2>Payment processing</h2><p>Secure online invoice payments are being connected through Paystack.</p></div></div>
          <p className="muted small">Payments will be initiated against an issued invoice balance. The amount and invoice reference will be validated by MobiWave’s server before checkout. Your workspace’s own M-Pesa integration settings are separate and are not used for subscription billing.</p>
          <p className="muted small">To settle an outstanding invoice while online checkout is being enabled, contact MobiWave and quote the invoice number. Your subscription is activated only after payment is verified.</p>
        </div>
      </div>
    </MarketingChrome>
  );
};

export default BillingPage;
