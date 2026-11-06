import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CheckCircle2, Clock3, FileText, LoaderCircle, Plus, RefreshCw, Search, XCircle } from "lucide-react";
import { supabase } from "./lib/supabase";
import "./templates.css";

type Template = {
  id: string;
  meta_template_name: string;
  language_code: string;
  category: string;
  meta_status: string;
  components: Array<Record<string, any>>;
  meta_template_id?: string | null;
  rejection_reason?: string | null;
  synced_at?: string | null;
  created_at: string;
};

type Props = { tenantId: string; isAdmin: boolean; metaConnected: boolean; onNotice: (message: string) => void };

const statusLabel: Record<string, string> = {
  approved: "Approved", pending: "Pending review", rejected: "Rejected",
  paused: "Paused by Meta", disabled: "Disabled", draft: "Draft",
};

function statusTone(status: string) {
  if (status === "approved") return "success";
  if (status === "pending") return "warning";
  if (status === "rejected" || status === "disabled") return "danger";
  return "neutral";
}

function StatusIcon({ status }: { status: string }) {
  if (status === "approved") return <CheckCircle2 size={14}/>;
  if (status === "rejected" || status === "disabled") return <XCircle size={14}/>;
  return <Clock3 size={14}/>;
}

export default function TemplatesPage({ tenantId, isAdmin, metaConnected, onNotice }: Props) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("UTILITY");
  const [language, setLanguage] = useState("en");
  const [header, setHeader] = useState("");
  const [body, setBody] = useState("");
  const [examples, setExamples] = useState("");
  const [footer, setFooter] = useState("");
  const [quickReply, setQuickReply] = useState("");
  const [securityRecommendation, setSecurityRecommendation] = useState(true);
  const [expirationMinutes, setExpirationMinutes] = useState("");

  const loadTemplates = async () => {
    if (!supabase || !tenantId) { setTemplates([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from("wa_templates")
      .select("id,meta_template_name,language_code,category,meta_status,components,meta_template_id,rejection_reason,synced_at,created_at")
      .eq("tenant_id", tenantId).order("updated_at", { ascending: false });
    if (error) onNotice("Could not load templates: " + error.message);
    else setTemplates((data ?? []) as Template[]);
    setLoading(false);
  };

  useEffect(() => { void loadTemplates(); }, [tenantId]);

  useEffect(() => {
    if (!supabase || !tenantId) return;
    const channel = supabase.channel("template-status-" + tenantId)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "workspace_notifications",
        filter: "tenant_id=eq." + tenantId,
      }, (payload) => {
        if ((payload.new as { entity_type?: string }).entity_type === "template") void loadTemplates();
      }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenantId]);

  const filtered = useMemo(() => templates.filter((template) => {
    const matchesSearch = (template.meta_template_name + " " + template.category + " " + template.language_code).toLowerCase().includes(search.toLowerCase());
    return matchesSearch && (statusFilter === "all" || template.meta_status === statusFilter);
  }), [templates, search, statusFilter]);

  const counts = useMemo(() => ({
    all: templates.length,
    approved: templates.filter((t) => t.meta_status === "approved").length,
    pending: templates.filter((t) => t.meta_status === "pending").length,
    rejected: templates.filter((t) => t.meta_status === "rejected").length,
  }), [templates]);

  const preview = useMemo(() => {
    const values = examples.split(",").map((value) => value.trim()).filter(Boolean);
    return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (match, rawIndex: string) => values[Number(rawIndex) - 1] || match);
  }, [body, examples]);

  async function syncTemplates() {
    if (!supabase || !tenantId) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("meta-sync-templates", { body: { tenant_id: tenantId } });
    setBusy(false);
    if (error || data?.error || !Number.isFinite(Number(data?.synced))) {
      onNotice(data?.error ?? error?.message ?? "Meta did not confirm template synchronization.");
      return;
    }
    onNotice("Meta template sync completed: " + Number(data.synced) + " template(s) checked.");
    await loadTemplates();
  }

  async function submitTemplate(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !tenantId) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("meta-create-template", {
      body: {
        tenant_id: tenantId,
        name: name.trim().toLowerCase(),
        category,
        language,
        header: header.trim(),
        body: body.trim(),
        examples: examples.split(",").map((value) => value.trim()).filter(Boolean),
        footer: footer.trim(),
        quick_reply: quickReply.trim(),
        add_security_recommendation: securityRecommendation,
        code_expiration_minutes: expirationMinutes,
      },
    });
    setBusy(false);
    if (error || data?.error || data?.ok !== true || !data?.template?.id) {
      onNotice(data?.error ?? error?.message ?? "Meta did not confirm template submission.");
      return;
    }
    onNotice("Template submitted to Meta. Its status will change when Meta completes review.");
    setShowComposer(false);
    setName(""); setCategory("UTILITY"); setLanguage("en"); setHeader(""); setBody(""); setExamples(""); setFooter(""); setQuickReply(""); setSecurityRecommendation(true); setExpirationMinutes("");
    await loadTemplates();
  }

  return <section className="content">
    <div className="template-page-heading">
      <div><div className="eyebrow">WHATSAPP CONTENT</div><h1>Templates</h1><p>Create WhatsApp message templates and track Meta's review decisions from your workspace.</p></div>
      <div className="row-actions">
        <button type="button" className="secondary-button" onClick={() => void syncTemplates()} disabled={busy || !isAdmin || !metaConnected}><RefreshCw size={15}/> Sync Meta</button>
        {isAdmin && <button type="button" className="primary-button" onClick={() => setShowComposer((value) => !value)} disabled={!metaConnected}><Plus size={15}/> Create template</button>}
      </div>
    </div>

    {!metaConnected && <div className="inline-notice template-connection-notice" role="status">Connect and verify your WhatsApp Cloud API in Integrations before creating or synchronizing templates.</div>}

    <div className="template-management-stats">
      <button type="button" className={statusFilter === "all" ? "template-stat active" : "template-stat"} onClick={() => setStatusFilter("all")}><strong>{counts.all}</strong><span>All templates</span></button>
      <button type="button" className={statusFilter === "approved" ? "template-stat active" : "template-stat"} onClick={() => setStatusFilter("approved")}><strong>{counts.approved}</strong><span>Approved</span></button>
      <button type="button" className={statusFilter === "pending" ? "template-stat active" : "template-stat"} onClick={() => setStatusFilter("pending")}><strong>{counts.pending}</strong><span>Pending review</span></button>
      <button type="button" className={statusFilter === "rejected" ? "template-stat active" : "template-stat"} onClick={() => setStatusFilter("rejected")}><strong>{counts.rejected}</strong><span>Rejected</span></button>
    </div>

    {showComposer && isAdmin && <form className="panel form-panel template-composer" onSubmit={submitTemplate}>
      <div className="section-header"><div><h2>Create a message template</h2><p>Submission goes directly to Meta for review. MobiWave cannot approve templates.</p></div><button type="button" className="icon-btn" aria-label="Close template editor" onClick={() => setShowComposer(false)}>×</button></div>
      <div className="form-grid">
        <div className="field"><label>Template name *</label><input required pattern="[a-z0-9_]+" maxLength={512} value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} placeholder="order_update"/></div>
        <div className="field"><label>Category *</label><select value={category} onChange={(e) => setCategory(e.target.value)}><option value="UTILITY">Utility</option><option value="MARKETING">Marketing</option><option value="AUTHENTICATION">Authentication</option></select></div>
        <div className="field"><label>Language code *</label><input required value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="en or en_US" pattern="[a-z]{2,3}(_[A-Z]{2})?"/></div>
        {category !== "AUTHENTICATION" && <div className="field"><label>Header (optional)</label><input maxLength={60} value={header} onChange={(e) => setHeader(e.target.value)} placeholder="Your order update"/></div>}
      </div>
      {category === "AUTHENTICATION" ? <div className="authentication-template-options">
        <p>Meta supplies the verification-code wording and requires an OTP copy-code button. You configure only these optional additions.</p>
        <label className="checkbox-line"><input type="checkbox" checked={securityRecommendation} onChange={(e) => setSecurityRecommendation(e.target.checked)}/> Add the security recommendation</label>
        <div className="field"><label>Code expiry in minutes (optional)</label><input type="number" min={1} max={90} step={1} value={expirationMinutes} onChange={(e) => setExpirationMinutes(e.target.value)} placeholder="10"/><small className="muted">Choose a value from 1 to 90 minutes.</small></div>
      </div> : <>
      <div className="field"><label>Message body *</label><textarea required rows={5} maxLength={1024} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Hello {{1}}, your order {{2}} is ready for collection."/></div>
      <div className="field"><label>Example values for body variables</label><input value={examples} onChange={(e) => setExamples(e.target.value)} placeholder="Jane, ORD-1042"/><small className="muted">Provide one sample value for each numbered variable, in order. Example: Jane, ORD-1042.</small></div>
      <div className="form-grid">
        <div className="field"><label>Footer (optional)</label><input maxLength={60} value={footer} onChange={(e) => setFooter(e.target.value)} placeholder="Thank you for choosing us"/></div>
        <div className="field"><label>Quick reply button (optional)</label><input maxLength={25} value={quickReply} onChange={(e) => setQuickReply(e.target.value)} placeholder="Contact support"/></div>
      </div>
      </>}
      <div className="template-preview">
        <div className="template-preview-heading"><strong>WhatsApp preview</strong><span>Preview only</span></div>
        <div className="template-preview-message">
          {category !== "AUTHENTICATION" && header && <strong className="block mb-2">{header}</strong>}
          <p>{category === "AUTHENTICATION" ? preview : preview || "Your message will appear here."}</p>
          {category !== "AUTHENTICATION" && footer && <small>{footer}</small>}
          {category === "AUTHENTICATION" ? <div className="template-preview-button">Copy code</div> : quickReply && <div className="template-preview-button">{quickReply}</div>}
        </div>
      </div>
      <div className="form-actions"><span className="muted small">Meta review time and outcome are controlled by Meta.</span><button type="submit" className="primary-button" disabled={busy || !metaConnected || !name.trim() || (category !== "AUTHENTICATION" && !body.trim())}>{busy ? <LoaderCircle size={15} className="spin"/> : <Plus size={15}/>} Submit to Meta</button></div>
    </form>}

    <div className="panel template-list-panel">
      <div className="section-toolbar"><div><strong>Workspace templates</strong><p className="muted small">Approval status is synchronized from Meta.</p></div><div className="search-field"><Search size={14}/><input aria-label="Search templates" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search templates"/></div></div>
      {loading ? <div className="empty-state"><LoaderCircle size={18} className="spin"/> Loading templates…</div> : filtered.length === 0 ? <div className="empty-state"><FileText size={24}/><strong>No templates found</strong><span>{templates.length ? "Try a different filter or search." : "Create your first template or sync templates already in Meta."}</span></div> : <div className="template-table">
        <div className="template-table-head"><span>NAME</span><span>CATEGORY</span><span>LANGUAGE</span><span>STATUS</span><span>UPDATED</span></div>
        {filtered.map((template) => <article className="template-table-row" key={template.id}>
          <div className="template-table-name"><strong>{template.meta_template_name}</strong><small>{template.meta_template_id ? "Meta ID: " + template.meta_template_id : "Not yet submitted to Meta"}</small>{template.rejection_reason && <small className="template-rejection">Meta feedback: {template.rejection_reason}</small>}</div>
          <span>{template.category}</span><span>{template.language_code}</span>
          <span className={"template-status " + statusTone(template.meta_status)}><StatusIcon status={template.meta_status}/>{statusLabel[template.meta_status] ?? template.meta_status}</span>
          <time>{new Date(template.synced_at ?? template.created_at).toLocaleDateString()}</time>
        </article>)}
      </div>}
    </div>
    <p className="muted small template-meta-note">For automatic review updates, subscribe to <code>message_template_status_update</code> in your Meta app Webhooks configuration. Meta is the final authority for approval, rejection, pausing and disabling. Only approved templates are available in campaigns and outbound template messages.</p>
  </section>;
}
