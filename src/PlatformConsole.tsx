import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CircleDollarSign,
  LoaderCircle,
  LogOut,
  Menu,
  MessageCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  X,
  Zap,
} from "lucide-react";
import { supabase } from "./lib/supabase";
import { Brand, Empty, KpiCard } from "./components/ui";
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
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleDateString();
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

export default function PlatformConsole({ user, role, hasClientWorkspace, clientWorkspaceHref, onSignOut }: PlatformConsoleProps) {
  const [tenants, setTenants] = useState<PlatformTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<PlatformTenant | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [section, setSection] = useState<"clients" | "billing">("clients");

  const load = useCallback(async () => {
    if (!supabase) {
      setError("Supabase is not configured for this deployment.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const { data, error: rpcError } = await supabase.rpc("platform_tenant_overview");
    if (rpcError) {
      setError(rpcError.message);
      setLoading(false);
      return;
    }
    setTenants((data ?? []) as PlatformTenant[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

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
    ["Team members", formatCount(selected.member_count)],
    ["Contacts", formatCount(selected.contact_count)],
    ["Open chats", formatCount(selected.open_conversation_count)],
    ["Campaigns", formatCount(selected.campaign_count)],
    ["Approved templates", formatCount(selected.approved_template_count)],
    ["Messages · 30 days", formatCount(selected.message_count_30d)],
  ] : [];

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
          <button type="button" className={"platform-nav-item " + (section === "clients" ? "active" : "")} aria-current={section === "clients" ? "page" : undefined} onClick={() => { setSection("clients"); setNavOpen(false); }}>
            <Building2 size={18} />
            <span>Client workspaces</span>
          </button>
          <button type="button" className={"platform-nav-item " + (section === "billing" ? "active" : "")} aria-current={section === "billing" ? "page" : undefined} disabled={role !== "owner"} title={role === "owner" ? "Manage billing and client accounts" : "Billing is restricted to platform owners"} onClick={() => { setSection("billing"); setNavOpen(false); }}>
            <CircleDollarSign size={18} />
            <span>Billing &amp; accounts</span>
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
              <strong>Read-only aggregate view</strong>
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
              <strong>{section === "billing" ? "Billing & accounts" : "Client workspaces"}</strong>
          </div>
          <div className="platform-top-actions">
            <span className="platform-pill"><ShieldCheck size={13} /> {roleLabel(role)}</span>
            <button type="button" className="icon-btn" aria-label="Refresh platform overview" onClick={() => void load()}>
              <RefreshCw size={17} className={loading ? "spin" : ""} />
            </button>
            <div className="mini-avatar" aria-hidden="true">{user.email?.slice(0, 1).toUpperCase() ?? "P"}</div>
          </div>
        </header>

        <section className="platform-content">
          {section === "billing" ? <PlatformBilling /> : <>
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

          <div className="panel platform-health">
            <div className="platform-health-copy">
              <div className="platform-health-title">
                <span className={connected === tenants.length && tenants.length > 0 ? "footer-dot is-connected" : "footer-dot"} />
                Connection health
              </div>
              <p>{tenants.length ? `${connected} of ${tenants.length} client workspaces have a verified, enabled WhatsApp connection.` : "No client workspaces have been created yet."}</p>
            </div>
            <div className="platform-health-meter">
              <div className="platform-health-bar"><span style={{ transform: `scaleX(${healthPercent / 100})` }} /></div>
              <strong>{healthPercent}%</strong>
            </div>
          </div>

          <div className="platform-toolbar">
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

          <div className="source-list platform-table-wrap">
            <div className="platform-table">
              <div className="platform-table-head">
                <span>WORKSPACE</span>
                <span>TEAM</span>
                <span>CONTACTS</span>
                <span>OPEN CHATS</span>
                <span>MESSAGES · 30D</span>
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
                  <span className="platform-table-number">{formatCount(tenant.member_count)}</span>
                  <span className="platform-table-number">{formatCount(tenant.contact_count)}</span>
                  <span className="platform-table-number">{formatCount(tenant.open_conversation_count)}</span>
                  <span className="platform-table-number">{formatCount(tenant.message_count_30d)}</span>
                  <span className={"platform-connection " + (tenant.whatsapp_connected ? "is-connected" : "is-disconnected")}>
                    <span className="platform-connection-dot" /> {connectionLabel(tenant)}
                  </span>
                  <span className="platform-table-time">{relativeTime(tenant.last_message_at)}</span>
                </button>
              ))}
            </div>
          </div>

          <p className="platform-footnote">
            <ShieldCheck size={14} />
            Client message content and provider credentials stay workspace-scoped. Opening a client workspace requires explicit membership.
          </p>
          </>}
        </section>

        <footer className="footer platform-footer">
          <span>© 2026 MobiWave Innovations Ltd</span>
          <span><span className={connected === tenants.length && tenants.length > 0 ? "footer-dot is-connected" : "footer-dot"} /> Platform operations</span>
        </footer>
      </main>

      {selected && (
        <div className="modal-backdrop" role="presentation" onClick={() => setSelected(null)}>
          <div className="modal-panel platform-detail" role="dialog" aria-modal="true" aria-labelledby="platform-detail-title" onClick={(event) => event.stopPropagation()}>
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
          </div>
        </div>
      )}
    </div>
  );
}
