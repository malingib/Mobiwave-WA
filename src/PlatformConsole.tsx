import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CircleDollarSign,
  CreditCard,
  Database,
  History,
  LoaderCircle,
  LogOut,
  Menu,
  MessageCircle,
  RefreshCw,
  Receipt,
  Search,
  ShieldAlert,
  ShieldCheck,
  Users,
  X,
  Zap,
} from "lucide-react";
import { supabase } from "./lib/supabase";
import { withTimeout } from "./lib/runtime.js";
import { Brand, Empty, KpiCard, Modal } from "./components/ui";
import PlatformBilling from "./PlatformBilling";

type PlatformTenant = {
  tenant_id: string;
  name: string;
  slug: string;
  created_at: string;
  member_count: number | string;
  contact_count: number | string;
  open_conversation_count: number | string;
  campaign_count: number | string;
  approved_template_count: number | string;
  message_count_30d: number | string;
  last_message_at: string | null;
  whatsapp_connected: boolean;
  whatsapp_verified: boolean;
  display_phone_number: string | null;
  is_member: boolean;
};

type TenantDetail = {
  tenant: { id: string; name: string; slug: string; created_at: string };
  counts: {
    members: number; contacts: number; opted_in: number; open_conversations: number;
    campaigns: number; approved_templates: number; messages_30d: number;
    outcome_unknown_30d: number; last_message_at: string | null;
  };
  integration: {
    connected: boolean; verified: boolean; enabled: boolean;
    display_phone_number: string | null; verified_name: string | null;
    last_error_code: string | null; last_health_check_at: string | null;
    messaging_limit_tier: string | null; quality_rating: string | null;
  };
  delivery_health: { queued: number; failed: number; dead: number; oldest_pending_at: string | null };
  meta_events: { pending: number; dead_letter: number };
  alerts: Array<{ id: string; category: string; severity: string; title: string; created_at: string; read_at: string | null; entity_id: string | null }>;
  recent_deliveries: Array<{ id: string; event_type: string; status: string; attempt_count: number; response_status: number | null; created_at: string }>;
  plan?: { status: string | null; tier_name: string | null; currency: string | null; monthly_price_minor: number | null; starts_on: string | null; ends_on: string | null };
  billing?: { open_invoices: number; outstanding_minor: number; paid_minor: number };
  mpesa?: { configured: boolean; environment: string | null; recent: Array<{ id: string; amount: number; status: string; result_description: string | null; created_at: string }> };
};

type SystemHealth = {
  generated_at: string;
  cron_jobs: Array<{ jobname: string; schedule: string; active: boolean; last_status: string | null; last_start: string | null; last_end: string | null; last_message: string }>;
  queues: {
    meta_events_pending: number; meta_events_dead: number;
    webhook_queued: number; webhook_failed: number; webhook_dead: number;
    oldest_webhook_at: string | null; send_attempts_stuck: number;
    messages_outcome_unknown_7d: number;
  };
  billing: { open_invoices: number; overdue_invoices: number; tenants_without_plan: number; tenants_disconnected: number };
  dunning: { pending: number; failed_7d: number };
};

type AuditLog = {
  total: number;
  offset: number;
  limit: number;
  entries: Array<{ id: number; action: string; entity_type: string; entity_id: string; details: Record<string, unknown>; created_at: string; actor_email: string | null }>;
};

type PlatformSection = "clients" | "health" | "audit" | "billing";

type PlatformConsoleProps = {
  user: User;
  role: string;
  hasClientWorkspace: boolean;
  clientWorkspaceHref?: string;
  onSignOut: () => void;
};

function count(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCount(value: number | string | null | undefined) {
  return new Intl.NumberFormat("en-KE").format(count(value));
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not recorded"
    : date.toLocaleString("en-KE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatMoney(minor: number | string | null | undefined, currency = "KES") {
  return new Intl.NumberFormat("en-KE", {
    style: "currency", currency, maximumFractionDigits: 2,
  }).format(count(minor) / 100);
}

function plural(value: number, singular: string, pluralForm = `${singular}s`) {
  return `${formatCount(value)} ${value === 1 ? singular : pluralForm}`;
}

function relativeTime(value: string | null) {
  if (!value) return "No messages yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function roleLabel(role: string) {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  if (role === "support") return "Support";
  return role ? role.charAt(0).toUpperCase() + role.slice(1) : "Member";
}

function connectionLabel(tenant: PlatformTenant) {
  if (tenant.whatsapp_connected) return "Connected";
  if (tenant.whatsapp_verified) return "Verified";
  return "Not connected";
}

/* RPCs return JSONB objects; a failed or unexpected shape must not be treated
   as real data. */
function asObject<T>(value: unknown): T | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as T : null;
}

/* The shared Status map is domain-oriented (message states), so operational
   vocabulary needs its own mapping instead of silently falling back to neutral. */
const SEVERITY_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  info: "neutral",
  warning: "warning",
  error: "danger",
  critical: "danger",
};

function severityTone(severity: string) {
  return SEVERITY_TONE[severity.toLowerCase()] ?? "neutral";
}

function jobTone(status: string | null) {
  if (status === "succeeded") return "success";
  if (status === "failed") return "danger";
  return "neutral";
}

function Pill({ tone, label }: { tone: "success" | "warning" | "danger" | "neutral"; label: string }) {
  return (
    <span className={"status-pill " + tone}>
      <span />
      {label.replaceAll("_", " ")}
    </span>
  );
}

export default function PlatformConsole({ user, role, hasClientWorkspace, clientWorkspaceHref, onSignOut }: PlatformConsoleProps) {
  const [tenants, setTenants] = useState<PlatformTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<PlatformTenant | null>(null);
  const [detail, setDetail] = useState<TenantDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [section, setSection] = useState<PlatformSection>("clients");
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [healthError, setHealthError] = useState("");
  const [healthLoading, setHealthLoading] = useState(false);
  const [audit, setAudit] = useState<AuditLog | null>(null);
  const [auditError, setAuditError] = useState("");
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditPage, setAuditPage] = useState(0);

  const canManage = role === "owner";
  const auditPageSize = 50;

  const load = useCallback(async () => {
    if (!supabase) {
      setError("Supabase is not configured for this deployment.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { data, error: rpcError } = await withTimeout(supabase.rpc("platform_tenant_overview"), "Loading client workspaces");
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      setTenants(Array.isArray(data) ? data as PlatformTenant[] : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The platform overview request failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHealth = useCallback(async () => {
    if (!supabase) { setHealthError("Supabase is not configured for this deployment."); return; }
    setHealthLoading(true);
    setHealthError("");
    try {
      const { data, error: rpcError } = await withTimeout(supabase.rpc("platform_system_health"), "Loading service health");
      if (rpcError) { setHealthError(rpcError.message); setHealth(null); return; }
      const parsed = asObject<SystemHealth>(data);
      if (!parsed) { setHealthError("Service health returned an unexpected response."); setHealth(null); return; }
      setHealth(parsed);
    } catch (cause) {
      setHealthError(cause instanceof Error ? cause.message : "The service health request failed.");
      setHealth(null);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const loadAudit = useCallback(async (page: number) => {
    if (!supabase) { setAuditError("Supabase is not configured for this deployment."); return; }
    setAuditLoading(true);
    setAuditError("");
    try {
      const { data, error: rpcError } = await withTimeout(
        supabase.rpc("platform_billing_audit_log", { p_limit: auditPageSize, p_offset: page * auditPageSize }),
        "Loading the audit log",
      );
      if (rpcError) { setAuditError(rpcError.message); setAudit(null); return; }
      const parsed = asObject<AuditLog>(data);
      if (!parsed) { setAuditError("The audit log returned an unexpected response."); setAudit(null); return; }
      setAudit(parsed);
    } catch (cause) {
      setAuditError(cause instanceof Error ? cause.message : "The audit log request failed.");
      setAudit(null);
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (section === "health") void loadHealth();
    if (section === "audit") void loadAudit(auditPage);
  }, [section, auditPage, loadHealth, loadAudit]);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    if (!supabase) {
      setDetailError("Supabase is not configured for this deployment.");
      setDetailLoading(false);
      return;
    }
    withTimeout(supabase.rpc("platform_tenant_detail", { p_tenant_id: selected.tenant_id }), "Loading workspace detail")
      .then(({ data, error: rpcError }: { data?: any; error?: any }) => {
        if (!active) return;
        if (rpcError) { setDetailError(rpcError.message); return; }
        const parsed = asObject<TenantDetail>(data);
        if (!parsed) { setDetailError("Operational detail is unavailable for this workspace."); return; }
        setDetail(parsed);
      })
      .catch((cause: unknown) => {
        if (active) setDetailError(cause instanceof Error ? cause.message : "The workspace detail request failed.");
      })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = original;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selected]);

  useEffect(() => {
    if (!navOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [navOpen]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return tenants;
    return tenants.filter((tenant) =>
      `${tenant.name} ${tenant.slug} ${tenant.display_phone_number ?? ""}`.toLowerCase().includes(term),
    );
  }, [search, tenants]);

  const connected = tenants.filter((tenant) => tenant.whatsapp_connected).length;
  const openConversations = tenants.reduce((total, tenant) => total + count(tenant.open_conversation_count), 0);
  const messages30d = tenants.reduce((total, tenant) => total + count(tenant.message_count_30d), 0);
  const healthPercent = tenants.length ? Math.round((connected / tenants.length) * 100) : 0;

  const selectedConnection = selected ? connectionLabel(selected) : "";
  const detailStats = selected ? [
    ["Team members", formatCount(detail?.counts.members ?? selected.member_count)],
    ["Contacts", formatCount(detail?.counts.contacts ?? selected.contact_count)],
    ["Open chats", formatCount(detail?.counts.open_conversations ?? selected.open_conversation_count)],
    ["Campaigns", formatCount(detail?.counts.campaigns ?? selected.campaign_count)],
    ["Approved templates", formatCount(detail?.counts.approved_templates ?? selected.approved_template_count)],
    ["Messages · 30 days", formatCount(detail?.counts.messages_30d ?? selected.message_count_30d)],
  ] : [];

  const sectionTitle = section === "billing" ? "Billing & accounts" : section === "health" ? "Service health" : section === "audit" ? "Audit log" : "Client workspaces";

  function openSection(next: PlatformSection) {
    setSection(next);
    setNavOpen(false);
    if (next === "audit") setAuditPage(0);
  }

  return (
    <div className="platform-shell">
      {navOpen && (
        <button
          type="button"
          className="platform-backdrop"
          aria-label="Close platform navigation"
          onClick={() => setNavOpen(false)}
        />
      )}

      <aside className={"platform-sidebar " + (navOpen ? "is-open" : "")} aria-label="Platform navigation">
        <div className="platform-sidebar-head">
          <div className="platform-brand-row">
            <Brand />
            <span className="platform-badge">Platform</span>
            <button type="button" className="icon-btn platform-nav-close" aria-label="Close platform navigation" onClick={() => setNavOpen(false)}>
              <X size={17} />
            </button>
          </div>
          <p className="platform-sidebar-caption">Service operator console</p>
        </div>

        <div className="platform-operator">
          <div className="platform-operator-row">
            <div className="platform-operator-avatar">{user.email?.slice(0, 1).toUpperCase() ?? "P"}</div>
            <div className="platform-operator-copy">
              <strong>{user.email ?? "Platform owner"}</strong>
              <span>{roleLabel(role)} access</span>
            </div>
          </div>
          <div className="platform-operator-meta"><ShieldCheck size={13} /> Separate from client workspace roles</div>
        </div>

        <nav className="platform-nav" aria-label="Platform sections">
          <div className="platform-nav-label">Platform</div>
          <button type="button" className={"platform-nav-item " + (section === "clients" ? "active" : "")} aria-current={section === "clients" ? "page" : undefined} onClick={() => openSection("clients")}>
            <Building2 size={18} />
            <span>Client workspaces</span>
          </button>
          <button type="button" className={"platform-nav-item " + (section === "health" ? "active" : "")} aria-current={section === "health" ? "page" : undefined} onClick={() => openSection("health")}>
            <Activity size={18} />
            <span>Service health</span>
          </button>
          <button type="button" className={"platform-nav-item " + (section === "billing" ? "active" : "")} aria-current={section === "billing" ? "page" : undefined} disabled={!canManage} title={canManage ? "Manage billing and client accounts" : "Billing is restricted to platform owners"} onClick={() => openSection("billing")}>
            <CircleDollarSign size={18} />
            <span>Billing &amp; accounts</span>
          </button>
          <button type="button" className={"platform-nav-item " + (section === "audit" ? "active" : "")} aria-current={section === "audit" ? "page" : undefined} disabled={!canManage} title={canManage ? "Every billing and settlement change" : "The audit log is restricted to platform owners"} onClick={() => openSection("audit")}>
            <History size={18} />
            <span>Audit log</span>
          </button>
          <div className="platform-nav-label">Account</div>
          {hasClientWorkspace && (
            <a className="platform-nav-item" href={clientWorkspaceHref ?? "/dashboard"} onClick={() => setNavOpen(false)}>
              <ArrowLeft size={18} />
              <span>Client workspace</span>
            </a>
          )}
          <button type="button" className="platform-nav-item" onClick={onSignOut}>
            <LogOut size={18} />
            <span>Sign out</span>
          </button>
        </nav>

        <div className="platform-sidebar-foot">
          <div className="platform-security-note">
            <ShieldCheck size={16} />
            <p>
              <strong>Aggregate view by default</strong>
              <span>Message content and Meta credentials stay inside each client workspace.</span>
            </p>
          </div>
        </div>
      </aside>

      <main className="platform-main">
        <header className="platform-topbar">
          <button
            type="button"
            className="icon-btn platform-menu-button"
            aria-label="Open platform navigation"
            aria-expanded={navOpen}
            onClick={() => setNavOpen(true)}
          >
            <Menu size={19} />
          </button>
          <div className="platform-breadcrumbs">
            <span>MobiWave Platform</span>
            <span className="crumb-sep">/</span>
            <strong>{sectionTitle}</strong>
          </div>
          <div className="platform-top-actions">
            <span className="platform-pill"><ShieldCheck size={13} /> {roleLabel(role)}</span>
            <button
              type="button"
              className="icon-btn"
              aria-label="Refresh platform data"
              onClick={() => {
                if (section === "health") void loadHealth();
                else if (section === "audit") void loadAudit(auditPage);
                else void load();
              }}
            >
              <RefreshCw size={17} className={loading || healthLoading || auditLoading ? "spin" : ""} />
            </button>
            <div className="mini-avatar" aria-hidden="true">{user.email?.slice(0, 1).toUpperCase() ?? "P"}</div>
          </div>
        </header>

        <section className="platform-content">
          {section === "billing" ? <PlatformBilling /> : section === "health" ? (
            <>
              <div className="platform-heading">
                <div>
                  <div className="eyebrow"><Activity size={12} /> PLATFORM OPERATIONS</div>
                  <h1>Service health</h1>
                  <p>Worker schedules, delivery queues and settlement backlogs across every client workspace.</p>
                </div>
                <div className="platform-heading-actions">
                  <button type="button" className="btn btn-primary" onClick={() => void loadHealth()} disabled={healthLoading}>
                    <RefreshCw size={15} className={healthLoading ? "spin" : ""} /> Refresh
                  </button>
                </div>
              </div>

              {healthError && <div className="inline-notice" role="alert">Could not load service health: {healthError}</div>}

              {healthLoading && !health ? (
                <div className="panel billing-loading"><LoaderCircle size={20} className="spin" /> Loading service health…</div>
              ) : health ? (
                <>
                  <div className="platform-kpi-grid">
                    <KpiCard label="Meta events pending" value={formatCount(health.queues.meta_events_pending)} icon={<MessageCircle size={16} />} hint={`${formatCount(health.queues.meta_events_dead)} dead-lettered`} tone={health.queues.meta_events_dead > 0 ? "danger" : "brand"} />
                    <KpiCard label="Webhook deliveries" value={formatCount(health.queues.webhook_queued + health.queues.webhook_failed)} icon={<Zap size={16} />} hint={`${formatCount(health.queues.webhook_failed)} failed · ${formatCount(health.queues.webhook_dead)} dead`} tone={health.queues.webhook_dead > 0 ? "danger" : "success"} />
                    <KpiCard label="Stuck sends" value={formatCount(health.queues.send_attempts_stuck)} icon={<ShieldAlert size={16} />} hint={`${formatCount(health.queues.messages_outcome_unknown_7d)} outcome unknown · 7d`} tone={health.queues.send_attempts_stuck > 0 ? "warning" : "success"} />
                    <KpiCard label="Unplanned workspaces" value={formatCount(health.billing.tenants_without_plan)} icon={<CreditCard size={16} />} hint={`${formatCount(health.billing.tenants_disconnected)} not connected to Meta`} tone={health.billing.tenants_without_plan > 0 ? "warning" : "success"} />
                  </div>

                  <div className="platform-attention">
                    {[
                      { label: "Overdue invoices", value: health.billing.overdue_invoices, hint: "Past the due date", tone: health.billing.overdue_invoices > 0 ? "is-danger" : "is-ok", icon: <Receipt size={16} /> },
                      { label: "Dead-lettered events", value: health.queues.meta_events_dead, hint: "Exhausted retries", tone: health.queues.meta_events_dead > 0 ? "is-danger" : "is-ok", icon: <MessageCircle size={16} /> },
                      { label: "Stuck sends", value: health.queues.send_attempts_stuck, hint: "No update in 10 min", tone: health.queues.send_attempts_stuck > 0 ? "is-warning" : "is-ok", icon: <ShieldAlert size={16} /> },
                      { label: "Dunning failures", value: health.dunning.failed_7d, hint: "Failed in the last 7 days", tone: health.dunning.failed_7d > 0 ? "is-warning" : "is-ok", icon: <History size={16} /> },
                    ].map((item) => (
                      <div className={"platform-attention-item " + item.tone} key={item.label}>
                        <span className="platform-attention-icon">{item.icon}</span>
                        <div>
                          <strong>{formatCount(item.value)}</strong>
                          <span>{item.label} · {item.hint}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="platform-footnote">
                    <Activity size={14} />
                    Snapshot generated {formatDateTime(health.generated_at)}. Queues are polled every minute by the scheduled workers.
                  </p>

                  <div className="platform-toolbar">
                    <div><h2>Worker schedules</h2><p>pg_cron jobs and their most recent run</p></div>
                  </div>
                  <div className="source-list platform-table-wrap">
                    <div className="platform-table platform-health-table">
                      <div className="platform-table-head platform-health-grid">
                        <span>JOB</span><span>STATE</span><span>LAST RUN</span><span>RESULT</span><span>MESSAGE</span>
                      </div>
                      {health.cron_jobs.length === 0 ? (
                        <Empty icon={<Database size={24} />} title="No scheduled jobs" text="Worker schedules will appear once pg_cron jobs are registered." />
                      ) : health.cron_jobs.map((job) => (
                        <div className="platform-table-row platform-health-grid platform-row-static" key={job.jobname}>
                          <span className="platform-job-cell">
                            <strong>{job.jobname}</strong>
                            <code>{job.schedule}</code>
                          </span>
                          <span data-label="State"><Pill tone={job.active ? "success" : "neutral"} label={job.active ? "active" : "paused"} /></span>
                          <span className="platform-table-time" data-label="Last run">{job.last_start ? relativeTime(job.last_start) : "Never run"}</span>
                          <span data-label="Result"><Pill tone={jobTone(job.last_status)} label={job.last_status ?? "never run"} /></span>
                          <span className="platform-table-time platform-health-message" data-label="Message">{job.last_message || "—"}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="platform-toolbar">
                    <div><h2>Settlement and dunning</h2><p>Billing state that needs an operator decision</p></div>
                  </div>
                  <div className="dead-letter-grid">
                    {[
                      ["Open invoices", health.billing.open_invoices, "Issued and unpaid"],
                      ["Overdue invoices", health.billing.overdue_invoices, "Past the due date"],
                      ["Dunning pending", health.dunning.pending, "Reminders not yet sent"],
                      ["Dunning failures", health.dunning.failed_7d, "Failed in the last 7 days"],
                      ["Oldest webhook", health.queues.oldest_webhook_at ? relativeTime(health.queues.oldest_webhook_at) : "None", "Oldest undelivered queue item"],
                      ["Dead-lettered events", health.queues.meta_events_dead, "Meta events that exhausted retries"],
                    ].map(([label, value, hint]) => (
                      <div className="panel platform-detail-stat" key={String(label)}>
                        <span>{label}</span>
                        <strong>{typeof value === "number" ? formatCount(value) : value}</strong>
                        <small className="platform-stat-hint">{hint}</small>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </>
          ) : section === "audit" ? (
            <>
              <div className="platform-heading">
                <div>
                  <div className="eyebrow"><History size={12} /> REVENUE OPERATIONS</div>
                  <h1>Audit log</h1>
                  <p>Append-only record of every tier, invoice, payment and settlement change.</p>
                </div>
                <div className="platform-heading-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => void loadAudit(auditPage)} disabled={auditLoading}>
                    <RefreshCw size={14} className={auditLoading ? "spin" : ""} /> Refresh
                  </button>
                </div>
              </div>

              {auditError && <div className="inline-notice" role="alert">Could not load the audit log: {auditError}</div>}

              {auditLoading && !audit ? (
                <div className="panel billing-loading"><LoaderCircle size={20} className="spin" /> Loading audit entries…</div>
              ) : audit && audit.entries.length > 0 ? (
                <>
                  <div className="panel audit-list">
                    {audit.entries.map((entry) => (
                      <article className="audit-entry" key={entry.id}>
                        <div className="audit-icon"><History size={14} /></div>
                        <div className="audit-copy">
                          <div className="audit-heading">
                            <strong>{entry.action.replaceAll("_", " ")}</strong>
                            <time>{formatDateTime(entry.created_at)}</time>
                          </div>
                          <p>
                            {entry.entity_type} · <code>{entry.entity_id}</code>
                            {entry.actor_email ? <> · by {entry.actor_email}</> : <> · by system</>}
                          </p>
                          {Object.keys(entry.details ?? {}).length > 0 && (
                            <div className="audit-details">
                              {Object.entries(entry.details).map(([key, value]) => (
                                <span key={key}>
                                  <em>{key.replaceAll("_", " ")}</em>
                                  <b>{typeof value === "object" ? JSON.stringify(value) : String(value)}</b>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                  <div className="pagination-controls">
                    <button className="secondary-button compact" disabled={auditPage === 0} onClick={() => setAuditPage((page) => Math.max(0, page - 1))}>Previous</button>
                    <span>Page {auditPage + 1} · {formatCount(audit.total)} entries</span>
                    <button className="secondary-button compact" disabled={(auditPage + 1) * auditPageSize >= audit.total} onClick={() => setAuditPage((page) => page + 1)}>Next</button>
                  </div>
                </>
              ) : (
                <div className="panel">
                  <Empty icon={<History size={24} />} title="No audit entries yet" text="Billing, invoice, payment and settlement changes will be recorded here." />
                </div>
              )}
            </>
          ) : (
          <>
          <div className="platform-heading">
            <div>
              <div className="eyebrow"><Activity size={12} /> PLATFORM OPERATIONS</div>
              <h1>Client workspaces</h1>
              <p>Cross-tenant service overview. Client message content and credentials stay inside each workspace.</p>
            </div>
            <div className="platform-heading-actions">
              {hasClientWorkspace && (
                <a className="btn btn-secondary" href={clientWorkspaceHref ?? "/dashboard"}>
                  <ArrowLeft size={14} /> Client workspace
                </a>
              )}
              <button type="button" className="btn btn-primary" onClick={() => void load()} disabled={loading}>
                <RefreshCw size={15} className={loading ? "spin" : ""} /> Refresh
              </button>
            </div>
          </div>

          {error && <div className="inline-notice" role="alert">Could not load the platform overview: {error}</div>}

          <div className="platform-kpi-grid">
            <KpiCard label="Client workspaces" value={formatCount(tenants.length)} icon={<Building2 size={16} />} hint="Tenant-scoped accounts" />
            <KpiCard label="Connected to Meta" value={formatCount(connected)} icon={<ShieldCheck size={16} />} hint={`${Math.max(0, tenants.length - connected)} awaiting connection`} />
            <KpiCard label="Open conversations" value={formatCount(openConversations)} icon={<MessageCircle size={16} />} hint="Across all client workspaces" />
            <KpiCard label="Messages · 30 days" value={formatCount(messages30d)} icon={<Zap size={16} />} hint="Inbound and outbound" />
          </div>

          <div className="platform-split">
            <section className="panel platform-workspaces">
              <div className="platform-toolbar platform-workspaces-head">
                <div>
                  <h2>Workspaces</h2>
                  <p>{filtered.length} of {tenants.length} client workspace(s)</p>
                </div>
                <div className="search-field platform-search">
                  <Search size={16} />
                  <input
                    aria-label="Search client workspaces"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search name, slug or number…"
                  />
                </div>
              </div>

              <div className="platform-table-wrap">
                <div className="platform-table platform-workspace-table">
                  <div className="platform-table-head">
                    <span>WORKSPACE</span>
                    <span>TEAM</span>
                    <span>CONTACTS</span>
                    <span>OPEN CHATS</span>
                    <span>WHATSAPP</span>
                    <span>LAST ACTIVITY</span>
                  </div>
                  {loading ? (
                    <Empty icon={<LoaderCircle size={22} className="spin" />} title="Loading client workspaces" text="Aggregate platform metrics will appear here." />
                  ) : filtered.length === 0 ? (
                    <Empty
                      icon={<Building2 size={24} />}
                      title={search.trim() ? "No matching workspaces" : "No client workspaces yet"}
                      text={search.trim() ? "Try a different name, slug or phone number." : "Client workspaces will appear here after they are created."}
                    />
                  ) : filtered.map((tenant) => (
                    <button
                      type="button"
                      className="platform-table-row"
                      key={tenant.tenant_id}
                      aria-label={`Open workspace ${tenant.name}`}
                      onClick={() => setSelected(tenant)}
                    >
                      <span className="platform-workspace-cell">
                        <span className="platform-workspace-avatar">{tenant.name.slice(0, 2).toUpperCase()}</span>
                        <span className="platform-workspace-copy">
                          <strong>{tenant.name}</strong>
                          <small>{tenant.slug}{tenant.display_phone_number ? ` · ${tenant.display_phone_number}` : ""}</small>
                        </span>
                      </span>
                      <span className="platform-table-number" data-label="Team">{formatCount(tenant.member_count)}</span>
                      <span className="platform-table-number" data-label="Contacts">{formatCount(tenant.contact_count)}</span>
                      <span className="platform-table-number" data-label="Open chats">{formatCount(tenant.open_conversation_count)}</span>
                      <span data-label="WhatsApp">
                        <span className={"platform-connection " + (tenant.whatsapp_connected ? "is-connected" : "is-disconnected")}>
                          <span className="platform-connection-dot" /> {connectionLabel(tenant)}
                        </span>
                      </span>
                      <span className="platform-table-time" data-label="Last activity">{relativeTime(tenant.last_message_at)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <div className="platform-target">
              <div className="platform-target-head">
                <strong>Connection health</strong>
                <span className="platform-target-badge">Live</span>
              </div>
              <p className="platform-target-sub">
                {tenants.length
                  ? `${connected} of ${tenants.length} client workspaces have a verified, enabled WhatsApp connection.`
                  : "No client workspaces have been created yet."}
              </p>
              <div className="platform-target-gauge">
                <svg viewBox="0 0 120 68" aria-hidden="true">
                  <path d="M12 60a48 48 0 0 1 96 0" fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="8" strokeLinecap="round" />
                  <path
                    d="M12 60a48 48 0 0 1 96 0"
                    fill="none" stroke="var(--color-surface)" strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={`${(healthPercent / 100) * 151} 151`}
                  />
                </svg>
                <div className="platform-target-gauge-label">
                  <strong>{healthPercent}%</strong>
                  <span>{connected} connected</span>
                </div>
              </div>
              <p className="platform-target-note">
                {tenants.length
                  ? `${plural(Math.max(0, tenants.length - connected), "workspace")} ${tenants.length - connected === 1 ? "still needs" : "still need"} a verified Meta connection before campaigns can send.`
                  : "Create a client workspace to start the platform connection overview."}
              </p>
              <div className="platform-target-stats">
                <div><strong>{formatCount(connected)}</strong><span>Connected</span></div>
                <div><strong>{formatCount(Math.max(0, tenants.length - connected))}</strong><span>Pending</span></div>
                <div><strong>{formatCount(tenants.length)}</strong><span>Total</span></div>
              </div>
            </div>
          </div>

          <p className="platform-footnote">
            <ShieldCheck size={14} />
            Client message content and provider credentials stay workspace-scoped. Opening a client workspace requires explicit membership.
          </p>
          </>)}
        </section>

        <footer className="footer platform-footer">
          <span>© 2026 MobiWave Innovations Ltd</span>
          <span><span className={connected === tenants.length && tenants.length > 0 ? "footer-dot is-connected" : "footer-dot"} /> Platform operations</span>
        </footer>
      </main>

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} labelledBy="platform-detail-title" className="platform-detail">
        {selected && <>
            <div className="modal-head">
              <div className="modal-head-copy">
                <div className="eyebrow"><Building2 size={12} /> CLIENT WORKSPACE</div>
                <h2 id="platform-detail-title">{selected.name}</h2>
                <p>{selected.slug} · Created {formatDate(selected.created_at)}</p>
              </div>
              <div className="modal-head-actions">
                <button type="button" className="icon-btn" aria-label="Close workspace details" onClick={() => setSelected(null)}>
                  <X size={17} />
                </button>
              </div>
            </div>

            <div className="platform-detail-connection">
              <span className={"platform-connection " + (selected.whatsapp_connected ? "is-connected" : "is-disconnected")}>
                <span className="platform-connection-dot" /> {selectedConnection}
              </span>
              <span>{selected.display_phone_number ?? "No WhatsApp number connected"}</span>
            </div>

            <div className="platform-detail-grid">
              {detailStats.map(([label, value]) => (
                <div className="platform-detail-stat" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>

            {detailLoading ? (
              <p className="platform-detail-loading"><LoaderCircle size={15} className="spin" /> Loading operational detail…</p>
            ) : detailError ? (
              <div className="inline-notice" role="alert">Operational detail is unavailable: {detailError}</div>
            ) : detail ? (
              <>
                <section className="platform-detail-section">
                  <h3>Integration and delivery</h3>
                  <div className="platform-detail-kv">
                    <span>WhatsApp integration</span>
                    <strong>{detail.integration.connected ? "Enabled and verified" : detail.integration.verified ? "Verified, not enabled" : "Not connected"}</strong>
                  </div>
                  <div className="platform-detail-kv">
                    <span>Verified name</span>
                    <strong>{detail.integration.verified_name || "Not recorded"}</strong>
                  </div>
                  <div className="platform-detail-kv">
                    <span>Last health check</span>
                    <strong>{relativeTime(detail.integration.last_health_check_at)}</strong>
                  </div>
                  <div className="platform-detail-kv">
                    <span>Quality rating / limit tier</span>
                    <strong>{detail.integration.quality_rating || "Unknown"} · {detail.integration.messaging_limit_tier || "Unknown"}</strong>
                  </div>
                  {detail.integration.last_error_code && (
                    <div className="platform-detail-kv is-warning">
                      <span>Last integration error</span>
                      <strong>{detail.integration.last_error_code}</strong>
                    </div>
                  )}
                  <div className="platform-detail-kv">
                    <span>Customer webhook queue</span>
                    <strong>{formatCount(detail.delivery_health.queued)} queued · {formatCount(detail.delivery_health.failed)} failed · {formatCount(detail.delivery_health.dead)} dead</strong>
                  </div>
                  <div className="platform-detail-kv">
                    <span>Meta events pending</span>
                    <strong>{formatCount(detail.meta_events.pending)} pending · {formatCount(detail.meta_events.dead_letter)} dead-lettered</strong>
                  </div>
                  <div className="platform-detail-kv">
                    <span>Outcome-unknown messages · 30d</span>
                    <strong>{formatCount(detail.counts.outcome_unknown_30d)}</strong>
                  </div>
                </section>

                {detail.plan && (
                  <section className="platform-detail-section">
                    <h3>Plan and billing</h3>
                    <div className="platform-detail-kv">
                      <span>Plan</span>
                      <strong>{detail.plan.tier_name ? `${detail.plan.tier_name}${detail.plan.status ? ` · ${detail.plan.status}` : ""}` : "No plan assigned"}</strong>
                    </div>
                    {detail.plan.tier_name && (
                      <>
                        <div className="platform-detail-kv">
                          <span>Agreed amount</span>
                          <strong>{detail.plan.monthly_price_minor === null ? "—" : `${formatMoney(detail.plan.monthly_price_minor, detail.plan.currency ?? "KES")}/mo`}</strong>
                        </div>
                        <div className="platform-detail-kv">
                          <span>Agreement dates</span>
                          <strong>{detail.plan.starts_on ? formatDate(detail.plan.starts_on) : "Not recorded"}{detail.plan.ends_on ? ` → ${formatDate(detail.plan.ends_on)}` : ""}</strong>
                        </div>
                      </>
                    )}
                    {detail.billing && (
                      <div className="platform-detail-kv">
                        <span>Invoices</span>
                        <strong>{formatCount(detail.billing.open_invoices)} open · {formatMoney(detail.billing.outstanding_minor)} outstanding · {formatMoney(detail.billing.paid_minor)} paid</strong>
                      </div>
                    )}
                    {detail.mpesa && (
                      <div className="platform-detail-kv">
                        <span>M-Pesa</span>
                        <strong>{detail.mpesa.configured ? `Configured (${detail.mpesa.environment ?? "unknown"}) · ${formatCount(detail.mpesa.recent.length)} recent transaction(s)` : "Not configured"}</strong>
                      </div>
                    )}
                  </section>
                )}

                <section className="platform-detail-section">
                  <h3>Recent alerts</h3>
                  {detail.alerts.length === 0 ? (
                    <p className="platform-detail-empty">No workspace alerts recorded.</p>
                  ) : detail.alerts.map((alert) => (
                    <article className="platform-alert-row" key={alert.id}>
                      <Pill tone={severityTone(alert.severity)} label={alert.severity} />
                      <div>
                        <strong>{alert.title}</strong>
                        <small>{alert.category.replaceAll("_", " ")} · {relativeTime(alert.created_at)}</small>
                      </div>
                    </article>
                  ))}
                </section>

                <section className="platform-detail-section">
                  <h3>Recent webhook deliveries</h3>
                  {detail.recent_deliveries.length === 0 ? (
                    <p className="platform-detail-empty">No customer webhook deliveries recorded.</p>
                  ) : detail.recent_deliveries.map((delivery) => (
                    <div className="platform-detail-kv" key={delivery.id}>
                      <span>{delivery.event_type}</span>
                      <strong>{delivery.status} · {formatCount(delivery.attempt_count)} attempt(s){delivery.response_status ? ` · HTTP ${delivery.response_status}` : ""} · {relativeTime(delivery.created_at)}</strong>
                    </div>
                  ))}
                </section>
              </>
            ) : null}

            <div className="platform-detail-note">
              <Users size={15} />
              <p>Last message activity: <strong>{relativeTime(selected.last_message_at)}</strong>. This view exposes aggregate counts only; customer names, phone numbers, message bodies and Meta credentials are not returned.</p>
            </div>

            <div className="modal-actions">
              <span className="modal-action-hint">{selected.is_member ? "You are a member of this workspace." : "This platform account is not a member of this workspace."}</span>
              {selected.is_member ? (
                <a className="btn btn-primary" href={`/dashboard?tenant=${selected.tenant_id}`}>
                  Open client workspace <ArrowUpRight size={14} />
                </a>
              ) : (
                <button type="button" className="btn btn-secondary" onClick={() => setSelected(null)}>Close</button>
              )}
            </div>
        </>}
      </Modal>
    </div>
  );
}
