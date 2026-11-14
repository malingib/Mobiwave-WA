import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Banknote, Building2, Check, ChevronRight, CircleDollarSign, CreditCard, FileText, LoaderCircle, Pencil, Plus, Printer, Receipt, RefreshCw, Save, ShieldCheck, X } from "lucide-react";
import { supabase } from "./lib/supabase";
import { Empty, KpiCard } from "./components/ui";

type Tier = {
  id: string; name: string; description: string; currency: string;
  monthly_price_minor: number; setup_fee_minor: number; active: boolean;
  slug: string; is_public: boolean; display_order: number; featured: boolean;
  feature_highlights: string[]; feature_flags: Record<string, boolean>;
  max_team_members: number; monthly_message_limit: number; monthly_ai_request_limit: number;
};
type Customer = {
  tenant_id: string; name: string; slug: string; billing_name: string; billing_email: string;
  billing_reference: string; billing_address: string; notes: string; tier_id: string | null;
  tier_name: string | null; subscription_status: string | null; currency: string | null;
  monthly_price_minor: number | null; invoice_count: number; outstanding_minor: number; paid_minor: number;
};
type InvoiceItem = { id: string; description: string; quantity: number; unit_amount_minor: number; line_total_minor: number };
type Payment = { id: string; amount_minor: number; method: string; reference: string; paid_at: string; reversed_at: string | null; reversal_reason: string };
type Invoice = {
  id: string; invoice_number: string; tenant_id: string; tenant_name_snapshot: string;
  customer_name: string; billing_name_snapshot: string; billing_email_snapshot: string;
  billing_reference_snapshot: string; billing_address_snapshot: string; currency: string; subtotal_minor: number; due_on: string;
  status: string; notes: string; issued_at: string; paid_minor: number; items: InvoiceItem[]; payments: Payment[];
};
type BillingData = { tiers: Tier[]; customers: Customer[]; invoices: Invoice[] };
type TierForm = {
  id?: string; name: string; slug: string; description: string; currency: string;
  monthly: string; setup: string; active: boolean; isPublic: boolean; displayOrder: string;
  featured: boolean; highlights: string; featureFlags: Record<string, boolean>;
  maxTeamMembers: string; monthlyMessageLimit: string; monthlyAiRequestLimit: string;
};
type LineForm = { description: string; quantity: string; amount: string };

const emptyData: BillingData = { tiers: [], customers: [], invoices: [] };
const money = (minor: number | string | null | undefined, currency = "KES") => new Intl.NumberFormat("en-KE", {
  style: "currency", currency, maximumFractionDigits: 2,
}).format(Number(minor ?? 0) / 100);
const minor = (amount: string) => Math.round(Number(amount) * 100);
const today = () => new Date().toISOString().slice(0, 10);
const localDate = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });

export default function PlatformBilling() {
  const [data, setData] = useState<BillingData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<"customers" | "tiers" | "invoices">("customers");
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [search, setSearch] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [tierForm, setTierForm] = useState<TierForm | null>(null);
  const [invoiceCustomer, setInvoiceCustomer] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [invoiceNotes, setInvoiceNotes] = useState("");
  const [lines, setLines] = useState<LineForm[]>([{ description: "Monthly subscription", quantity: "1", amount: "" }]);
  const [payInvoice, setPayInvoice] = useState<Invoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("mpesa");
  const [paymentReference, setPaymentReference] = useState("");
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);

  const load = useCallback(async () => {
    if (!supabase) { setError("Supabase is not configured for this deployment."); setLoading(false); return; }
    setLoading(true); setError("");
    const { data: response, error: rpcError } = await supabase.rpc("platform_billing_data");
    if (rpcError) { setError(rpcError.message); setLoading(false); return; }
    setData((response ?? emptyData) as unknown as BillingData);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const customers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return data.customers;
    return data.customers.filter((item) => `${item.name} ${item.slug} ${item.billing_name} ${item.billing_email} ${item.tier_name ?? ""}`.toLowerCase().includes(term));
  }, [data.customers, search]);
  const openInvoices = data.invoices.filter((invoice) => invoice.status === "issued" && Number(invoice.paid_minor) < Number(invoice.subtotal_minor));
  const outstanding = openInvoices.reduce((sum, invoice) => sum + Number(invoice.subtotal_minor) - Number(invoice.paid_minor), 0);
  const paid = data.invoices.reduce((sum, invoice) => sum + Number(invoice.paid_minor), 0);
  const activeSubscriptions = data.customers.filter((item) => item.subscription_status === "active").length;

  const finishMutation = async (rpc: string, args: Record<string, unknown>, success: string) => {
    if (!supabase) return false;
    setBusy(true); setError(""); setNotice("");
    const { error: rpcError } = await supabase.rpc(rpc, args as never);
    if (rpcError) { setError(rpcError.message); setBusy(false); return false; }
    setNotice(success); setBusy(false); await load(); return true;
  };

  const saveTier = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!tierForm) return;
    const ok = await finishMutation("platform_billing_save_tier_catalog", {
      p_id: tierForm.id ?? null, p_name: tierForm.name.trim(), p_slug: tierForm.slug.trim(), p_description: tierForm.description.trim(),
      p_currency: tierForm.currency, p_monthly_price_minor: minor(tierForm.monthly),
      p_setup_fee_minor: minor(tierForm.setup), p_active: tierForm.active,
      p_is_public: tierForm.isPublic, p_display_order: Number(tierForm.displayOrder), p_featured: tierForm.featured,
      p_feature_highlights: tierForm.highlights.split("\n").map((line) => line.trim()).filter(Boolean),
      p_feature_flags: tierForm.featureFlags, p_max_team_members: Number(tierForm.maxTeamMembers),
      p_monthly_message_limit: Number(tierForm.monthlyMessageLimit), p_monthly_ai_request_limit: Number(tierForm.monthlyAiRequestLimit),
    }, "Tier saved.");
    if (ok) setTierForm(null);
  };

  const saveCustomer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!customer) return;
    const form = new FormData(event.currentTarget);
    const selectedTier = String(form.get("tier") ?? "");
    const requestedStatus = String(form.get("subscription_status") ?? "");
    const status = requestedStatus || (selectedTier && selectedTier !== customer.tier_id ? (customer.subscription_status ?? "active") : "");
    const ok = await finishMutation("platform_billing_save_customer", {
      p_tenant_id: customer.tenant_id,
      p_billing_name: String(form.get("billing_name") ?? ""),
      p_billing_email: String(form.get("billing_email") ?? ""),
      p_billing_reference: String(form.get("billing_reference") ?? ""),
      p_billing_address: String(form.get("billing_address") ?? ""),
      p_notes: String(form.get("notes") ?? ""),
      p_tier_id: status ? (selectedTier || null) : null,
      p_subscription_status: status || null,
      p_starts_on: String(form.get("starts_on") || today()),
    }, "Client billing account saved.");
    if (ok) setCustomer(null);
  };

  const issueInvoice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validLines = lines.map((line) => ({
      description: line.description.trim(), quantity: Number(line.quantity), unit_amount_minor: minor(line.amount),
    }));
    if (!invoiceCustomer || validLines.some((line) => !line.description || line.quantity < 1 || line.unit_amount_minor < 0)) {
      setError("Choose a client and complete each invoice line."); return;
    }
    const selectedCustomer = data.customers.find((item) => item.tenant_id === invoiceCustomer);
    const ok = await finishMutation("platform_billing_issue_invoice", {
      p_tenant_id: invoiceCustomer, p_due_on: dueOn, p_items: validLines, p_notes: invoiceNotes,
    }, `Invoice issued to ${selectedCustomer?.name ?? "client"}.`);
    if (ok) { setInvoiceCustomer(""); setDueOn(""); setInvoiceNotes(""); setLines([{ description: "Monthly subscription", quantity: "1", amount: "" }]); setShowIssueForm(false); }
  };

  const recordPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!payInvoice) return;
    const ok = await finishMutation("platform_billing_record_payment", {
      p_invoice_id: payInvoice.id, p_amount_minor: minor(paymentAmount), p_method: paymentMethod,
      p_reference: paymentReference.trim(), p_paid_at: new Date().toISOString(),
    }, "Payment recorded.");
    if (ok) { setPayInvoice(null); setPaymentAmount(""); setPaymentReference(""); }
  };

  const voidInvoice = async (invoice: Invoice) => {
    if (!window.confirm(`Void ${invoice.invoice_number}? This is available only when no payments are recorded.`)) return;
    await finishMutation("platform_billing_void_invoice", { p_invoice_id: invoice.id }, "Invoice voided.");
  };

  const reversePayment = async (payment: Payment) => {
    const reason = window.prompt("Why are you reversing this payment entry? This will restore the invoice balance.");
    if (!reason?.trim()) return;
    const ok = await finishMutation("platform_billing_reverse_payment", { p_payment_id: payment.id, p_reason: reason.trim() }, "Payment entry reversed; the invoice balance has been restored.");
    if (ok) setPreviewInvoice(null);
  };

  return (
    <div className="billing-page">
      <div className="platform-heading">
        <div>
          <div className="eyebrow"><CircleDollarSign size={12} /> REVENUE OPERATIONS</div>
          <h1>Billing &amp; accounts</h1>
          <p>Manage client billing profiles, contract tiers, invoices and manually recorded payments.</p>
        </div>
        <div className="platform-heading-actions">
          <span className="billing-mode"><ShieldCheck size={14} /> Owner only · manual ledger</span>
          <button type="button" className="btn btn-secondary" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      <div className="billing-tabs" role="tablist" aria-label="Billing sections">
        {(["customers", "tiers", "invoices"] as const).map((item) => (
          <button type="button" key={item} role="tab" aria-selected={view === item} className={view === item ? "is-active" : ""} onClick={() => setView(item)}>
            {item === "customers" ? <Building2 size={15} /> : item === "tiers" ? <CreditCard size={15} /> : <Receipt size={15} />}
            {item === "customers" ? "Clients" : item === "tiers" ? "Tiers" : "Invoices"}
          </button>
        ))}
      </div>

      {error && <div className="inline-notice" role="alert">{error}</div>}
      {notice && <div className="billing-success" role="status"><Check size={15} /> {notice}</div>}

      <div className="platform-kpi-grid billing-kpis">
        <KpiCard label="Client accounts" value={String(data.customers.length)} icon={<Building2 size={16} />} hint="Across all workspaces" />
        <KpiCard label="Active tier records" value={String(activeSubscriptions)} icon={<CreditCard size={16} />} hint="Commercial records only" />
        <KpiCard label="Unpaid balance" value={money(outstanding)} icon={<Receipt size={16} />} hint={`${openInvoices.length} open invoice(s)`} />
        <KpiCard label="Payments recorded" value={money(paid)} icon={<Banknote size={16} />} hint="Not gateway collected" />
      </div>

      {loading ? <div className="panel billing-loading"><LoaderCircle size={20} className="spin" /> Loading billing records…</div> : (
        <>
          {view === "customers" && <section className="panel billing-section">
            <div className="platform-toolbar">
              <div><h2>Client accounts</h2><p>Billing contacts and assigned commercial tiers</p></div>
              <div className="search-field platform-search"><Building2 size={15} /><input aria-label="Search billing accounts" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search client or billing contact…" /></div>
            </div>
            <div className="billing-table-wrap"><table className="billing-table"><thead><tr><th>CLIENT</th><th>PLAN / STATUS</th><th>OPEN BALANCE</th><th>PAID TO DATE</th><th>INVOICES</th><th /></tr></thead><tbody>
              {customers.map((item) => <tr key={item.tenant_id}>
                <td><strong>{item.billing_name || item.name}</strong><small>{item.billing_email || item.slug}</small></td>
                <td>{item.tier_name ? <><strong>{item.tier_name}</strong><small>{item.subscription_status} · {money(item.monthly_price_minor, item.currency ?? "KES")}/mo</small></> : <span className="billing-muted">No tier assigned</span>}</td>
                <td className={Number(item.outstanding_minor) > 0 ? "billing-amount-due" : ""}>{money(item.outstanding_minor)}</td>
                <td>{money(item.paid_minor)}</td><td>{item.invoice_count}</td>
                <td><button type="button" className="btn btn-secondary billing-small-btn" onClick={() => setCustomer(item)}><Pencil size={13} /> Manage <ChevronRight size={13} /></button></td>
              </tr>)}
              {customers.length === 0 && <tr><td colSpan={6}><Empty icon={<Building2 size={22} />} title={search ? "No client matches" : "No client accounts"} text={search ? "Try another client or billing contact." : "Client workspaces will appear here when they are created."} /></td></tr>}
            </tbody></table></div>
            <p className="billing-footnote"><ShieldCheck size={14} /> Active tier assignments apply configured message and team limits and gate campaign/API sending. Billing status does not automatically suspend a workspace.</p>
          </section>}

          {view === "tiers" && <section className="billing-section">
            <div className="platform-toolbar"><div><h2>Plans &amp; tiers</h2><p>Published plan details also power the public pricing page and workspace plan view.</p></div><button type="button" className="btn btn-primary" onClick={() => setTierForm({ name: "", slug: "", description: "", currency: "KES", monthly: "", setup: "0", active: true, isPublic: false, displayOrder: "100", featured: false, highlights: "", featureFlags: { inbox: true, contacts: true, templates: true, campaigns: true, api: true, webhooks: true }, maxTeamMembers: "0", monthlyMessageLimit: "0", monthlyAiRequestLimit: "0" })}><Plus size={15} /> New tier</button></div>
            {data.tiers.length === 0 ? <div className="panel"><Empty icon={<CreditCard size={22} />} title="No tiers configured" text="Create a tier after confirming its name, currency, price and terms." /></div> : <div className="billing-tier-grid">
              {data.tiers.map((tier) => <article className="panel billing-tier-card" key={tier.id}>
                <div className="billing-tier-top"><span className={tier.active ? "billing-status is-active" : "billing-status"}>{tier.active ? "Active" : "Archived"}</span><button type="button" className="icon-btn" aria-label={`Edit ${tier.name}`} onClick={() => setTierForm({ id: tier.id, name: tier.name, slug: tier.slug, description: tier.description, currency: tier.currency, monthly: (tier.monthly_price_minor / 100).toFixed(2), setup: (tier.setup_fee_minor / 100).toFixed(2), active: tier.active, isPublic: tier.is_public, displayOrder: String(tier.display_order), featured: tier.featured, highlights: (tier.feature_highlights ?? []).join("\n"), featureFlags: tier.feature_flags, maxTeamMembers: String(tier.max_team_members), monthlyMessageLimit: String(tier.monthly_message_limit), monthlyAiRequestLimit: String(tier.monthly_ai_request_limit) })}><Pencil size={15} /></button></div>
                <h3>{tier.name}</h3><p>{tier.description || "No description"}</p><strong className="billing-tier-price">{money(tier.monthly_price_minor, tier.currency)} <small>/ month</small></strong><div className="billing-tier-setup">Setup fee: {money(tier.setup_fee_minor, tier.currency)}</div>
                <div className="billing-tier-setup">{tier.is_public && tier.active ? "Published on pricing page" : "Hidden from pricing page"} · {tier.max_team_members > 0 ? `${tier.max_team_members} team members` : "No team cap"} · {tier.monthly_message_limit > 0 ? `${new Intl.NumberFormat("en-KE").format(tier.monthly_message_limit)} messages / month` : "No message cap"}</div>
                <ul className="billing-tier-highlights">{(tier.feature_highlights ?? []).map((feature) => <li key={feature}>{feature}</li>)}</ul>
              </article>)}
            </div>}
            <p className="billing-footnote"><ShieldCheck size={14} /> Publishing updates the public and client-facing catalog. Checkout, automatic renewals and automatic suspension are not enabled.</p>
          </section>}

          {view === "invoices" && <section className="panel billing-section">
            <div className="platform-toolbar"><div><h2>Invoices &amp; payments</h2><p>Issue an invoice, print it, then record an external payment or void an unpaid invoice.</p></div><button type="button" className="btn btn-primary" onClick={() => { setDueOn(today()); setShowIssueForm(true); }}><Plus size={15} /> New invoice</button></div>
            <div className="billing-table-wrap"><table className="billing-table"><thead><tr><th>INVOICE</th><th>CLIENT</th><th>ISSUED / DUE</th><th>TOTAL</th><th>PAID</th><th>STATUS</th><th /></tr></thead><tbody>
              {data.invoices.map((invoice) => {
                const balance = Number(invoice.subtotal_minor) - Number(invoice.paid_minor);
                const overdue = invoice.status === "issued" && balance > 0 && invoice.due_on < today();
                const status = invoice.status === "void" ? "Voided" : balance <= 0 ? "Paid" : overdue ? "Overdue" : Number(invoice.paid_minor) > 0 ? "Part paid" : "Due";
                return <tr key={invoice.id}><td><strong>{invoice.invoice_number}</strong><small>{invoice.items.length} line item(s)</small></td><td><strong>{invoice.customer_name || invoice.tenant_name_snapshot}</strong><small>{invoice.billing_email_snapshot || "No billing email on file"}</small></td><td>{localDate(invoice.issued_at.slice(0, 10))}<small>Due {localDate(invoice.due_on)}</small></td><td>{money(invoice.subtotal_minor, invoice.currency)}</td><td>{money(invoice.paid_minor, invoice.currency)}</td><td><span className={`billing-status ${status === "Paid" ? "is-active" : status === "Overdue" ? "is-overdue" : status === "Voided" ? "is-void" : ""}`}>{status}</span></td><td><div className="billing-row-actions"><button type="button" className="btn btn-secondary billing-small-btn" onClick={() => setPreviewInvoice(invoice)}>View</button>{invoice.status === "issued" && balance > 0 && <button type="button" className="btn btn-secondary billing-small-btn" onClick={() => { setPayInvoice(invoice); setPaymentAmount((balance / 100).toFixed(2)); }}>Record payment</button>}{invoice.status === "issued" && Number(invoice.paid_minor) === 0 && <button type="button" className="billing-text-button" onClick={() => voidInvoice(invoice)}>Void</button>}</div></td></tr>;
              })}
              {data.invoices.length === 0 && <tr><td colSpan={7}><Empty icon={<FileText size={22} />} title="No invoices yet" text="Create an invoice from the client’s agreed tier or another approved charge." /></td></tr>}
            </tbody></table></div>
          </section>}
        </>
      )}

      {view === "invoices" && !loading && showIssueForm && <section className="panel billing-issue-panel">
        <div className="platform-toolbar"><div><h2>Issue an invoice</h2><p>Invoice totals and customer details are saved as a point-in-time record.</p></div><button type="button" className="icon-btn" aria-label="Close invoice form" onClick={() => setShowIssueForm(false)}><X size={16} /></button></div>
        <form className="billing-form" onSubmit={issueInvoice}>
          <div className="form-grid"><div className="field"><label htmlFor="billing-invoice-customer">Client *</label><select id="billing-invoice-customer" value={invoiceCustomer} onChange={(event) => { const id = event.target.value; const client = data.customers.find((item) => item.tenant_id === id); setInvoiceCustomer(id); if (client?.tier_name && client.monthly_price_minor !== null) setLines((current) => [{ ...current[0], description: `${client.tier_name} monthly subscription`, amount: (Number(client.monthly_price_minor) / 100).toFixed(2) }, ...current.slice(1)]); }} required><option value="">Choose client…</option>{data.customers.map((item) => <option value={item.tenant_id} key={item.tenant_id}>{item.name}{item.billing_email ? ` · ${item.billing_email}` : ""}</option>)}</select></div><div className="field"><label htmlFor="billing-invoice-due">Due date *</label><input id="billing-invoice-due" type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} required /></div></div>
          <div className="billing-lines"><div className="billing-lines-head"><strong>Line items</strong><button type="button" className="billing-text-button" onClick={() => setLines((current) => [...current, { description: "", quantity: "1", amount: "" }])}><Plus size={14} /> Add line</button></div>{lines.map((line, index) => <div className="billing-line-form" key={index}><div className="field"><label htmlFor={`line-desc-${index}`}>Description</label><input id={`line-desc-${index}`} value={line.description} onChange={(event) => setLines((current) => current.map((item, i) => i === index ? { ...item, description: event.target.value } : item))} maxLength={240} required /></div><div className="field"><label htmlFor={`line-qty-${index}`}>Qty</label><input id={`line-qty-${index}`} type="number" min="1" max="10000" step="1" value={line.quantity} onChange={(event) => setLines((current) => current.map((item, i) => i === index ? { ...item, quantity: event.target.value } : item))} required /></div><div className="field"><label htmlFor={`line-amount-${index}`}>Unit price (currency units)</label><input id={`line-amount-${index}`} type="number" min="0" step="0.01" inputMode="decimal" value={line.amount} onChange={(event) => setLines((current) => current.map((item, i) => i === index ? { ...item, amount: event.target.value } : item))} required /></div>{lines.length > 1 && <button type="button" className="icon-btn billing-remove-line" aria-label="Remove line" onClick={() => setLines((current) => current.filter((_, i) => i !== index))}><X size={15} /></button>}</div>)}</div>
          <div className="field"><label htmlFor="billing-invoice-notes">Invoice notes</label><textarea id="billing-invoice-notes" value={invoiceNotes} onChange={(event) => setInvoiceNotes(event.target.value)} maxLength={2000} rows={2} placeholder="Payment instructions, agreed terms or tax detail…" /></div>
          <div className="billing-form-footer"><span>Tax is not calculated automatically. Include any agreed tax as an invoice line.</span><button type="submit" className="btn btn-primary" disabled={busy || !data.customers.length}><Receipt size={15} /> {busy ? "Issuing…" : "Issue invoice"}</button></div>
        </form>
      </section>}

      {customer && <div className="modal-backdrop" role="presentation" onClick={() => setCustomer(null)}><div className="modal-panel billing-modal" role="dialog" aria-modal="true" aria-labelledby="billing-customer-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head"><div className="modal-head-copy"><div className="eyebrow"><Building2 size={12} /> CLIENT ACCOUNT</div><h2 id="billing-customer-title">{customer.name}</h2><p>{customer.slug}</p></div><button type="button" className="icon-btn" aria-label="Close" onClick={() => setCustomer(null)}><X size={17} /></button></div>
        <form className="billing-form" onSubmit={saveCustomer}>
          <div className="field"><label htmlFor="billing-name">Legal / billing name</label><input id="billing-name" name="billing_name" defaultValue={customer.billing_name} maxLength={160} /></div>
          <div className="field"><label htmlFor="billing-email">Billing email</label><input id="billing-email" name="billing_email" type="email" defaultValue={customer.billing_email} maxLength={254} /></div>
          <div className="field"><label htmlFor="billing-reference">Customer / tax reference</label><input id="billing-reference" name="billing_reference" defaultValue={customer.billing_reference} maxLength={100} /></div>
          <div className="field"><label htmlFor="billing-address">Billing address</label><textarea id="billing-address" name="billing_address" defaultValue={customer.billing_address} maxLength={1000} rows={2} /></div>
          <div className="billing-form-rule" />
          <div className="form-grid"><div className="field"><label htmlFor="billing-tier">Commercial tier</label><select id="billing-tier" name="tier" defaultValue={customer.tier_id ?? ""}><option value="">No tier</option>{data.tiers.filter((item) => item.active || item.id === customer.tier_id).map((item) => <option value={item.id} key={item.id}>{item.name} · {money(item.monthly_price_minor, item.currency)}/mo</option>)}</select></div><div className="field"><label htmlFor="billing-subscription-status">Agreement status</label><select id="billing-subscription-status" name="subscription_status" defaultValue=""><option value="">Keep current agreement</option><option value="active">Active</option><option value="paused">Paused</option><option value="canceled">Canceled</option></select></div></div>
          <div className="field"><label htmlFor="billing-start-date">Agreement start date</label><input id="billing-start-date" name="starts_on" type="date" defaultValue={today()} /></div>
          <div className="field"><label htmlFor="billing-account-notes">Internal account notes</label><textarea id="billing-account-notes" name="notes" defaultValue={customer.notes} maxLength={2000} rows={3} /></div>
          <p className="billing-form-help">Agreement status is a billing record. It does not suspend or unlock the client workspace.</p>
          <div className="modal-actions"><span className="modal-action-hint">Only platform owners can view or change billing records.</span><button type="submit" className="btn btn-primary" disabled={busy}><Save size={14} /> Save client</button></div>
        </form>
      </div></div>}

      {tierForm && <div className="modal-backdrop" role="presentation" onClick={() => setTierForm(null)}><div className="modal-panel billing-modal" role="dialog" aria-modal="true" aria-labelledby="billing-tier-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head"><div className="modal-head-copy"><div className="eyebrow"><CreditCard size={12} /> BILLING CATALOG</div><h2 id="billing-tier-title">{tierForm.id ? "Edit tier" : "Create tier"}</h2><p>Define the commercial amount used for client agreements and invoices.</p></div><button type="button" className="icon-btn" aria-label="Close" onClick={() => setTierForm(null)}><X size={17} /></button></div>
        <form className="billing-form" onSubmit={saveTier}>
          <div className="form-grid"><div className="field"><label htmlFor="tier-name">Plan name *</label><input id="tier-name" value={tierForm.name} onChange={(event) => setTierForm({ ...tierForm, name: event.target.value, slug: tierForm.id ? tierForm.slug : event.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") })} required maxLength={80} /></div><div className="field"><label htmlFor="tier-slug">Plan URL key *</label><input id="tier-slug" value={tierForm.slug} onChange={(event) => setTierForm({ ...tierForm, slug: event.target.value })} required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={100} /></div></div>
          <div className="field"><label htmlFor="tier-description">Description</label><textarea id="tier-description" value={tierForm.description} onChange={(event) => setTierForm({ ...tierForm, description: event.target.value })} rows={3} maxLength={1000} /></div>
          <div className="form-grid"><div className="field"><label htmlFor="tier-currency">Currency</label><select id="tier-currency" value={tierForm.currency} onChange={(event) => setTierForm({ ...tierForm, currency: event.target.value })}><option value="KES">KES — Kenyan shilling</option><option value="USD">USD — US dollar</option></select></div><div className="field"><label htmlFor="tier-monthly">Monthly price *</label><input id="tier-monthly" type="number" min="0" step="0.01" value={tierForm.monthly} onChange={(event) => setTierForm({ ...tierForm, monthly: event.target.value })} required /></div><div className="field"><label htmlFor="tier-setup">Setup fee</label><input id="tier-setup" type="number" min="0" step="0.01" value={tierForm.setup} onChange={(event) => setTierForm({ ...tierForm, setup: event.target.value })} required /></div></div>
          <div className="form-grid"><div className="field"><label htmlFor="tier-display-order">Pricing page order</label><input id="tier-display-order" type="number" min="0" step="1" value={tierForm.displayOrder} onChange={(event) => setTierForm({ ...tierForm, displayOrder: event.target.value })} required /></div><div className="field"><label htmlFor="tier-team-limit">Maximum workspace members (0 = no cap)</label><input id="tier-team-limit" type="number" min="0" step="1" value={tierForm.maxTeamMembers} onChange={(event) => setTierForm({ ...tierForm, maxTeamMembers: event.target.value })} required /></div><div className="field"><label htmlFor="tier-message-limit">Monthly platform messages (0 = no cap)</label><input id="tier-message-limit" type="number" min="0" step="1" value={tierForm.monthlyMessageLimit} onChange={(event) => setTierForm({ ...tierForm, monthlyMessageLimit: event.target.value })} required /></div><div className="field"><label htmlFor="tier-ai-limit">Monthly AI request allowance</label><input id="tier-ai-limit" type="number" min="0" step="1" value={tierForm.monthlyAiRequestLimit} onChange={(event) => setTierForm({ ...tierForm, monthlyAiRequestLimit: event.target.value })} required /><small className="field-hint">Saved for upcoming AI usage enforcement.</small></div></div>
          <div className="form-grid"><label className="billing-check"><input type="checkbox" checked={tierForm.active} onChange={(event) => setTierForm({ ...tierForm, active: event.target.checked })} /> Available for new client agreements</label><label className="billing-check"><input type="checkbox" checked={tierForm.isPublic} onChange={(event) => setTierForm({ ...tierForm, isPublic: event.target.checked })} /> Publish on pricing page and show to clients</label><label className="billing-check"><input type="checkbox" checked={tierForm.featured} onChange={(event) => setTierForm({ ...tierForm, featured: event.target.checked })} /> Mark as most popular</label></div>
          <div className="field"><label>Tier gated capabilities</label><div className="form-grid">{[["campaigns", "Campaign sending"], ["api", "Developer API sending"]].map(([key, label]) => <label className="billing-check" key={key}><input type="checkbox" checked={tierForm.featureFlags[key] ?? false} onChange={(event) => setTierForm({ ...tierForm, featureFlags: { ...tierForm.featureFlags, [key]: event.target.checked } })} /> {label}</label>)}</div></div>
          <div className="field"><label htmlFor="tier-highlights">Public plan features (one per line)</label><textarea id="tier-highlights" value={tierForm.highlights} onChange={(event) => setTierForm({ ...tierForm, highlights: event.target.value })} rows={5} maxLength={2200} placeholder="Official WhatsApp Business API\nShared inbox" /></div>
          <p className="billing-form-help">Published descriptions and prices update the public and client-facing plan catalog. Assigned client prices remain as agreed. Campaign launch and API message sending enforce their feature switches. Other product capabilities remain available across tiers.</p>
          <div className="modal-actions"><span className="modal-action-hint">Tier changes are audit logged.</span><button type="submit" className="btn btn-primary" disabled={busy}><Save size={14} /> Save tier</button></div>
        </form>
      </div></div>}

      {payInvoice && <div className="modal-backdrop" role="presentation" onClick={() => setPayInvoice(null)}><div className="modal-panel billing-modal" role="dialog" aria-modal="true" aria-labelledby="billing-payment-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head"><div className="modal-head-copy"><div className="eyebrow"><Banknote size={12} /> PAYMENT ENTRY</div><h2 id="billing-payment-title">Record payment</h2><p>{payInvoice.invoice_number} · balance {money(Number(payInvoice.subtotal_minor) - Number(payInvoice.paid_minor), payInvoice.currency)}</p></div><button type="button" className="icon-btn" aria-label="Close" onClick={() => setPayInvoice(null)}><X size={17} /></button></div>
        <form className="billing-form" onSubmit={recordPayment}><div className="field"><label htmlFor="payment-amount">Amount received *</label><input id="payment-amount" type="number" min="0.01" max={((Number(payInvoice.subtotal_minor) - Number(payInvoice.paid_minor)) / 100).toFixed(2)} step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} required /></div><div className="field"><label htmlFor="payment-method">Payment method *</label><select id="payment-method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="mpesa">M-Pesa — recorded externally</option><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="card">Card — recorded externally</option><option value="other">Other</option></select></div><div className="field"><label htmlFor="payment-reference">Receipt / transaction reference</label><input id="payment-reference" value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} maxLength={160} /></div><p className="billing-form-help">This records a payment already received. It does not contact a bank, M-Pesa or card processor.</p><div className="modal-actions"><span className="modal-action-hint">Payment entries cannot be edited or deleted.</span><button type="submit" className="btn btn-primary" disabled={busy}><Check size={14} /> Record payment</button></div></form>
      </div></div>}

      {previewInvoice && <div className="modal-backdrop billing-preview-backdrop" role="presentation" onClick={() => setPreviewInvoice(null)}><div className="billing-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="invoice-preview-title" onClick={(event) => event.stopPropagation()}>
        <div className="billing-preview-actions"><button type="button" className="btn btn-secondary" onClick={() => window.print()}><Printer size={14} /> Print / save PDF</button><button type="button" className="icon-btn" aria-label="Close invoice preview" onClick={() => setPreviewInvoice(null)}><X size={17} /></button></div>
        <article className="billing-invoice-paper">
          <header><div><BrandMark /><p>MobiWave Innovations Ltd</p><small>Kenya</small></div><div className="billing-invoice-title"><span>INVOICE</span><h2 id="invoice-preview-title">{previewInvoice.invoice_number}</h2><p>{previewInvoice.status === "void" ? "VOID" : "Issued"}</p></div></header>
          <div className="billing-invoice-meta"><div><span>BILL TO</span><strong>{previewInvoice.billing_name_snapshot || previewInvoice.tenant_name_snapshot}</strong><small>{previewInvoice.billing_email_snapshot}</small><small>{previewInvoice.billing_reference_snapshot}</small><small>{previewInvoice.billing_address_snapshot}</small></div><div><span>ISSUED</span><strong>{localDate(previewInvoice.issued_at.slice(0, 10))}</strong><span>DUE</span><strong>{localDate(previewInvoice.due_on)}</strong></div></div>
          <table><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>{previewInvoice.items.map((item) => <tr key={item.id}><td>{item.description}</td><td>{item.quantity}</td><td>{money(item.unit_amount_minor, previewInvoice.currency)}</td><td>{money(item.line_total_minor, previewInvoice.currency)}</td></tr>)}</tbody></table>
          <div className="billing-invoice-total"><span>Invoice total</span><strong>{money(previewInvoice.subtotal_minor, previewInvoice.currency)}</strong></div>
          <div className="billing-invoice-paid"><span>Payments recorded</span><strong>{money(previewInvoice.paid_minor, previewInvoice.currency)}</strong></div>
          {previewInvoice.payments.length > 0 && <div className="billing-payment-history"><strong>Payment history</strong>{previewInvoice.payments.map((payment) => <div key={payment.id} className={payment.reversed_at ? "is-reversed" : ""}><span>{localDate(payment.paid_at.slice(0, 10))} · {payment.method}{payment.reference ? ` · ${payment.reference}` : ""}{payment.reversed_at ? ` · Reversed: ${payment.reversal_reason}` : ""}</span><strong>{money(payment.amount_minor, previewInvoice.currency)}</strong>{!payment.reversed_at && previewInvoice.status === "issued" && <button type="button" className="billing-text-button no-print" onClick={() => void reversePayment(payment)}>Reverse</button>}</div>)}</div>}
          {previewInvoice.notes && <div className="billing-invoice-notes"><span>NOTES</span><p>{previewInvoice.notes}</p></div>}
          <footer>Payment is handled according to the agreed terms. Keep your payment receipt and quote {previewInvoice.invoice_number} as the reference.</footer>
        </article>
      </div></div>}
    </div>
  );
}

function BrandMark() {
  return <div className="billing-invoice-brand"><span>MW</span><strong>MobiWave</strong></div>;
}
