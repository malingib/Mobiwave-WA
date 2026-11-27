import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Session, User } from "@supabase/supabase-js";
import {
  Activity, ArrowLeft, ArrowUpRight, Bell, Check, ChevronDown, ChevronRight, CreditCard,
  LayoutDashboard, LogOut, MessageCircle, Menu, Plus, RefreshCw, Search,
  Send, Settings2, ShieldCheck, Trash2, Users, UserRound, Settings as SettingsIcon, X, Zap, LoaderCircle, Eye, EyeOff, LockKeyhole, Mail, FileText,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import { clearWorkspaceUiState, readWorkspaceUiState, withTimeout, writeWorkspaceUiState } from "./lib/runtime.js";
import { clearUserMediaCache } from "./lib/mediaCache";
import { ErrorPage } from "./ErrorPages";
import type { DailyMessagePoint, OverviewMetrics } from "./dashboard/Overview";

const TemplatesPage = lazy(() => import("./TemplatesPage"));
const Overview = lazy(() => import("./dashboard/Overview"));
const PlatformConsole = lazy(() => import("./PlatformConsole"));
const LandingPage = lazy(() => import("./LandingPage"));
const PricingPage = lazy(() => import("./PricingPage"));
const ContactCsvImport = lazy(() => import("./ContactCsvImport"));
const BillingPage = lazy(() => import("./BillingPage"));
const TeamPage = lazy(() => import("./TeamPage"));
const UsagePage = lazy(() => import("./UsagePage"));
import { Brand, Empty, Modal, PageHeading, SetupRow, Status, useConfirm } from "./components/ui";

// Canonical public origin used for user-facing callback URLs (e.g. the Meta
// webhook). The webhook is served by the Vercel edge function deployed on the
// production domain, so it must never be derived from window.location.origin —
// doing so would show http://localhost:5173/... during local development.
const PUBLIC_APP_ORIGIN = "https://wap.mobiwave.co.ke";
const PUBLIC_API_BASE_URL = `${PUBLIC_APP_ORIGIN}/api/v1`;
const META_WEBHOOK_CALLBACK_URL = `${PUBLIC_APP_ORIGIN}/api/webhooks/whatsapp`;

type View = "Overview" | "Inbox" | "Contacts" | "Templates" | "Campaigns" | "Alerts" | "Integrations" | "Billing" | "Team" | "Usage" | "Profile" | "Settings";
type TierFeature = "inbox" | "contacts" | "templates" | "campaigns" | "api" | "webhooks";
const viewTierFeature: Partial<Record<View, TierFeature>> = {
  Inbox: "inbox", Contacts: "contacts", Templates: "templates", Campaigns: "campaigns",
};
type Tenant = { id: string; name: string; slug: string; role: string };
type TenantPlan = {
  subscription_status: string | null;
  /** Mirrors the `state` key returned by public.platform_tenant_plan. */
  state?: "exempt" | "unassigned" | "active" | "trialing" | "grace" | "past_due" | "suspended" | "paused" | "canceled";
  can_send?: boolean;
  trial_ends_on?: string | null;
  grace_ends_on?: string | null;
  days_remaining?: number | null;
  currency?: string;
  monthly_price_minor?: number;
  monthly_messages_used?: number;
  starts_on?: string;
  tier: null | {
    name: string; description: string; feature_highlights: string[];
    feature_flags: Record<string, boolean>; max_team_members: number; monthly_message_limit: number;
  };
};
type MetaAllowance = {
  connected: boolean;
  phone_number_id?: string;
  waba_timezone?: string;
  period_start?: string;
  period_end?: string;
  free_limit: number;
  free_service_used?: number;
  free_service_remaining?: number;
  billable_delivered?: number;
  billable_by_category?: Record<string, number>;
  unknown_pricing?: number;
  has_pricing_data?: boolean;
  messaging_limit_tier?: string | null;
  quality_rating?: string | null;
  last_capability_update_at?: string | null;
};
type Contact = { id: string; phone_e164: string; display_name?: string; consent_status: string; consent_source?: string; consent_at?: string; opted_out_at?: string };
type Template = { id: string; meta_template_name: string; language_code: string; category: string; meta_status: string; components?: any[] };
type Campaign = { id: string; name: string; status: string; created_at: string; scheduled_at?: string | null; template_id?: string; template_parameters?: Array<{ type: string; parameters?: Array<{ type: string; text?: string }> }> };
type CampaignFailure = { id: string; error_code?: string; error_detail?: string; contacts?: { display_name?: string; phone_e164?: string } | null };
type Conversation = { id: string; status: string; assigned_to?: string | null; unread?: boolean; last_message_at?: string; contacts?: { display_name?: string; phone_e164: string } };
type TeamMember = { user_id: string; role: string; name: string; email: string };
type ConsentEvent = { id: string; previous_status?: string | null; consent_status: string; consent_source?: string | null; changed_at: string };
type ApiKey = { id: string; client_id?: string; name: string; key_prefix: string; scopes?: string[]; last_used_at?: string; expires_at?: string; revoked_at?: string; created_at: string };
type TenantWebhook = { id: string; name: string; endpoint_url: string; events: string[]; enabled: boolean; last_delivery_at?: string; last_status?: string; last_error?: string; created_at: string };
type WebhookDelivery = { id: string; webhook_id: string; event_type: string; status: string; attempt_count: number; response_status?: number; last_error?: string; created_at: string; delivered_at?: string };
type WorkspaceNotification = { id: string; category: string; severity: string; title: string; body: string; entity_type?: string | null; entity_id?: string | null; metadata?: Record<string, any>; created_at: string; read_at?: string | null };
type ChatMessage = { id: string; direction: string; actor_type: string; body?: string; status: string; created_at: string; is_note?: boolean; author_id?: string; message_type?: string; media_id?: string; filename?: string };
type TemplatePart = { componentIndex: number; type: string; text: string; variables: string[]; buttonIndex?: number };
function getTemplateParts(template?: Template): TemplatePart[] {
  return (template?.components ?? []).flatMap((component, componentIndex) => {
    const type = String(component?.type ?? "").toLowerCase();
    if (["body", "header"].includes(type) && typeof component?.text === "string") {
      const variables = [...component.text.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((match) => match[1]);
      return variables.length ? [{ componentIndex, type, text: component.text, variables }] : [];
    }
    if (type === "buttons") return (component.buttons ?? []).flatMap((button: any, buttonIndex: number) => {
      if (String(button?.type).toUpperCase() !== "URL" || typeof button?.url !== "string") return [];
      const variables = [...button.url.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((match) => match[1]);
      return variables.length ? [{ componentIndex, type: "button", text: button.url, variables, buttonIndex }] : [];
    });
    return [];
  });
}
function getTemplateParameters(parts: TemplatePart[], values: Record<string, string>) {
  return parts.map((part) => ({
    type: part.type === "button" ? "button" : part.type,
    ...(part.type === "button" ? { sub_type: "url", index: String(part.buttonIndex ?? 0) } : {}),
    parameters: part.variables.map((_, index) => ({ type: "text", text: values[`${part.componentIndex}:${index}`] ?? "" })),
  }));
}
/* Renders the stored campaign parameter values into its template components. */
function campaignPreview(campaign: Campaign, template?: Template) {
  let parameterIndex = 0;
  const parameterComponent = (text: string) => {
    if (!/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/.test(text)) return text;
    const parameters = campaign.template_parameters?.[parameterIndex]?.parameters ?? [];
    parameterIndex += 1;
    let index = 0;
    return text.replace(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g, () => parameters[index++]?.text || "—");
  };
  const parts: Array<{ label: string; text: string }> = [];
  for (const component of template?.components ?? []) {
    const type = String(component?.type ?? "").toLowerCase();
    if (["header", "body", "footer"].includes(type) && typeof component?.text === "string") {
      parts.push({ label: type.toUpperCase(), text: parameterComponent(component.text) });
    }
    if (type === "buttons") {
      for (const button of component.buttons ?? []) {
        const label = String(button?.type ?? "button").replaceAll("_", " ").toUpperCase();
        const text = [button?.text, button?.url].filter(Boolean).join(" · ");
        parts.push({ label, text: text ? parameterComponent(text) : "—" });
      }
    }
  }
  return parts;
}
function MessageMedia({ mediaId, type, filename, tenantId, userId }: { mediaId: string; type: string; filename?: string; tenantId: string; userId: string }) {
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => { if (source) URL.revokeObjectURL(source); }, [source]);

  async function openMedia() {
    if (!supabase || loading || source) return;
    setLoading(true);
    setError("");
    try {
      const cacheKey = { tenantId, userId, mediaId };
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) throw new Error("Your session has expired. Sign in again.");
      const cached = await import("./lib/mediaCache").then(({ getCachedMedia }) => getCachedMedia(cacheKey));
      if (cached) {
        // Re-check current tenant membership before serving a browser-local copy.
        const { data: membership, error: membershipError } = await supabase
          .from("tenant_members").select("tenant_id")
          .eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();
        if (membershipError || !membership) throw new Error("You no longer have access to this workspace attachment.");
        setSource(URL.createObjectURL(cached));
        return;
      }
      const endpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-media`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + session.access_token,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tenant_id: tenantId, media_id: mediaId, filename }),
      });
      if (!response.ok) {
        let detail = "Attachment could not be retrieved.";
        try { detail = (await response.json()).error || detail; } catch { /* retain generic message */ }
        throw new Error(detail);
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error("Meta returned an empty attachment.");
      const contentType = response.headers.get("content-type") || blob.type || "application/octet-stream";
      const mediaBlob = blob.type ? blob : new Blob([blob], { type: contentType });
      const { cacheMedia } = await import("./lib/mediaCache");
      await cacheMedia({ ...cacheKey, blob: mediaBlob });
      setSource(URL.createObjectURL(mediaBlob));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Attachment could not be retrieved.");
    } finally {
      setLoading(false);
    }
  }

  if (source && type === "image") return <img className="message-media-image" src={source} alt={filename || "WhatsApp attachment"}/>;
  if (source && type === "video") return <video className="message-media-video" controls preload="metadata" src={source}/>;
  if (source && type === "audio") return <audio controls preload="metadata" src={source}/>;
  if (source) return <a className="message-media-download" href={source} download={filename || "WhatsApp attachment"}>{filename || "Download attachment"}</a>;
  return <div className="message-media-placeholder">
    <button type="button" className="secondary-button compact" onClick={() => void openMedia()} disabled={loading}>
      {loading ? "Loading attachment…" : type === "image" ? "View image" : type === "audio" ? "Load audio" : type === "video" ? "Load video" : "Download attachment"}
    </button>
    {error && <small className="media-error" role="status">{error}</small>}
  </div>;
}
function planStateLabel(plan: TenantPlan | null) {
  switch (plan?.state) {
    case "exempt": return "Legacy access · no plan assigned";
    case "trialing": return plan.days_remaining === 0 ? "Trial ends today" : `Trial · ${plan.days_remaining ?? 0} day(s) left`;
    case "grace": return plan.days_remaining === 0 ? "Grace period ends today" : `Payment grace · ${plan.days_remaining ?? 0} day(s) left`;
    case "active": return "Active subscription";
    case "past_due": return "Payment overdue · sending paused";
    case "suspended": return "Sending paused · suspended";
    case "paused": return "Sending paused · plan paused";
    case "canceled": return "Subscription canceled";
    case "unassigned": return "No subscription assigned";
    default: return plan?.subscription_status ?? "No plan assigned";
  }
}

/* Every dashboard view has a URL. The path is the source of truth, so a
   teammate can be sent straight to the Inbox or a campaign and the browser
   back button works. */
const VIEW_PATHS: Record<View, string> = {
  Overview: "/dashboard",
  Inbox: "/dashboard/inbox",
  Contacts: "/dashboard/contacts",
  Templates: "/dashboard/templates",
  Campaigns: "/dashboard/campaigns",
  Alerts: "/dashboard/alerts",
  Integrations: "/dashboard/integrations",
  Billing: "/dashboard/billing",
  Team: "/dashboard/team",
  Usage: "/dashboard/usage",
  Profile: "/dashboard/profile",
  Settings: "/dashboard/settings",
};

function viewFromPath(pathname: string): View | null {
  const normalised = pathname.replace(/\/+$/, "") || "/";
  const match = (Object.entries(VIEW_PATHS) as [View, string][]).find(([, path]) => path === normalised);
  return match ? match[0] : null;
}

const navigation: { section: string; items: { label: View; icon: typeof MessageCircle }[] }[] = [
  { section: "Workspace", items: [{ label: "Overview", icon: LayoutDashboard }] },
  {
    section: "Messaging",
    items: [
      { label: "Inbox", icon: MessageCircle },
      { label: "Contacts", icon: Users },
      { label: "Templates", icon: FileText },
      { label: "Campaigns", icon: Zap },
    ],
  },
  { section: "Administration", items: [{ label: "Integrations", icon: Settings2 }] },
  {
    section: "Account",
    items: [
      { label: "Profile", icon: UserRound },
      { label: "Team", icon: Users },
      { label: "Usage", icon: Activity },
      { label: "Billing", icon: CreditCard },
      { label: "Settings", icon: SettingsIcon },
    ],
  },
];

/* Adds one realtime message event to an existing 14-day series. */
function bumpDailyMessageSeries(series: DailyMessagePoint[], row: { direction?: string; created_at?: string }): DailyMessagePoint[] {
  if (!row.direction || !row.created_at) return series;
  const key = new Date(row.created_at).toISOString().slice(0, 10);
  const index = series.findIndex((day) => day.date === key);
  if (index === -1) return series;
  const next = series.slice();
  const day = next[index];
  next[index] = row.direction === "inbound"
    ? { ...day, inbound: day.inbound + 1 }
    : row.direction === "outbound"
      ? { ...day, outbound: day.outbound + 1 }
      : day;
  return next;
}

/* Compact relative timestamp used by the inbox conversation list. */
function relativeTime(value?: string): string {
  if (!value) return "No messages";
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString();
}
export default function App() {
  // Restored once per mount. sessionStorage survives a reload of this tab (for
  // example after the browser discards and restores it) without leaking the
  // workspace position into other tabs.
  const restoredUi = useMemo(() => readWorkspaceUiState(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [routeVersion, setRouteVersion] = useState(0);
  const navigate = useCallback((path: string) => {
    if (window.location.pathname + window.location.search === path) return;
    window.history.pushState({}, "", path);
    setRouteVersion((value) => value + 1);
  }, []);
  const [authMode, setAuthMode] = useState<"signin" | "signup">(() => new URLSearchParams(window.location.search).get("mode") === "signup" ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState<string>(() => typeof restoredUi.tenantId === "string" ? restoredUi.tenantId : "");
  const [tenantLoading, setTenantLoading] = useState(true);
  const [tenantError, setTenantError] = useState("");
  const [tenantPlan, setTenantPlan] = useState<TenantPlan | null>(null);
  const [tenantPlanLoading, setTenantPlanLoading] = useState(false);
  const [metaAllowance, setMetaAllowance] = useState<MetaAllowance | null>(null);
  const [platformRole, setPlatformRole] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [alertsDropdownOpen, setAlertsDropdownOpen] = useState(false);
  // The URL is the source of truth for which screen is open. `routeVersion`
  // is bumped on pushState and popstate so the memo re-reads location.
  const pathname = useMemo(() => window.location.pathname.replace(/\/+$/, "") || "/", [routeVersion]);
  const routedView = useMemo(() => viewFromPath(pathname), [pathname]);
  const view: View = routedView ?? "Overview";
  const goTo = useCallback((next: View) => {
    navigate(VIEW_PATHS[next]);
    setMobileNavOpen(false);
    setAlertsDropdownOpen(false);
  }, [navigate]);
  const [desktopNav, setDesktopNav] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setDesktopNav(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  useEffect(() => {
    if (!mobileNavOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileNavOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileNavOpen]);
  
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (alertsDropdownOpen && !(event.target as Element).closest('.alerts-dropdown') && !(event.target as Element).closest('button[aria-label="Open alerts"]')) {
        setAlertsDropdownOpen(false);
      }
    };
    
    if (alertsDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [alertsDropdownOpen]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const { confirm, confirmElement } = useConfirm();
  const noticeIsError = /(^could not\b|^failed\b|^error\b|^unable\b|^invalid\b|^not found\b|^not configured\b|^not allowed\b|^a background request failed\b|\b(?:rejected|denied|unavailable|could not|cannot|not allowed|not configured|not found|invalid|permission denied|duplicate|violates|did not|was not|not confirmed|no changes|edge function returned|non-2xx|network|unauthorized|forbidden|bad request|conflict|request failed|function invocation failed|failed to|fetch error|internal server error)\b|\b[1-9]\d* failed\b)/i.test(notice);
  useEffect(() => {
    if (!notice) return;
    // Only messages that ask the user to *do* something stay on screen.
    // Matching broad nouns such as "record" or "consent" kept harmless
    // confirmations ("Opt-in recorded and added to the consent history")
    // visible forever.
    const needsManualAttention = /^(could not|failed|error|unable|invalid|not found|not configured|not allowed|enter|select|record)\b|copy it now|copy the signing secret|copy the value|select and copy|will not be shown again|won't be shown again|record how and when|edge function|non-2xx|unauthorized|forbidden|network error/i.test(notice);
    if (needsManualAttention) return;
    const timeout = window.setTimeout(() => setNotice(""), noticeIsError ? 15000 : 8000);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  const [workspaceName, setWorkspaceName] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [totalContacts, setTotalContacts] = useState(0);
  const [contactPage, setContactPage] = useState(() => Number.isInteger(restoredUi.contactPage) && (restoredUi.contactPage ?? 0) >= 0 ? restoredUi.contactPage as number : 0);
  const [contactHasMore, setContactHasMore] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [campaignCounts, setCampaignCounts] = useState<{ total: number; queued: number; failed: number } | null>(null);
  const [campaignCountsLoading, setCampaignCountsLoading] = useState(false);
  const [campaignCountsError, setCampaignCountsError] = useState("");
  const [campaignFailures, setCampaignFailures] = useState<CampaignFailure[]>([]);
  const [dailyMessages, setDailyMessages] = useState<DailyMessagePoint[]>([]);
  const [overviewMetrics, setOverviewMetrics] = useState<OverviewMetrics | null>(null);
  const [overviewMetricsLoading, setOverviewMetricsLoading] = useState(false);
  const [overviewMetricsError, setOverviewMetricsError] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationLimit, setConversationLimit] = useState(100);
  const [conversationHasMore, setConversationHasMore] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [conversationStatusFilter, setConversationStatusFilter] = useState(() => typeof restoredUi.statusFilter === "string" ? restoredUi.statusFilter : "open");
  const [conversationAssigneeFilter, setConversationAssigneeFilter] = useState(() => typeof restoredUi.assigneeFilter === "string" ? restoredUi.assigneeFilter : "all");
  const [conversationSearch, setConversationSearch] = useState("");
  const [debouncedConversationSearch, setDebouncedConversationSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedConversationSearch(conversationSearch), 300);
    return () => clearTimeout(timer);
  }, [conversationSearch]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageHasMore, setMessageHasMore] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const scrollToLatestMessage = useRef(false);
  const tenantRequestId = useRef(0);
  const contactsRequestId = useRef(0);
  const workspaceRequestId = useRef(0);
  const inboxRequestId = useRef(0);
  const notificationRequestId = useRef(0);
  const messageRequestId = useRef(0);
  const overviewRequestId = useRef(0);
  const [selectedConversation, setSelectedConversation] = useState(() => typeof restoredUi.selectedConversation === "string" ? restoredUi.selectedConversation : "");
  useEffect(() => {
    writeWorkspaceUiState({
      tenantId,
      selectedConversation,
      statusFilter: conversationStatusFilter,
      assigneeFilter: conversationAssigneeFilter,
      contactPage,
    });
  }, [tenantId, selectedConversation, conversationStatusFilter, conversationAssigneeFilter, contactPage]);
  // The workspace search bar, the contact list and the campaign recipient
  // picker each own their query. A single shared value leaked the campaign
  // search term into the contact list when the user navigated back.
  const [contactSearch, setContactSearch] = useState("");
  const [debouncedContactSearch, setDebouncedContactSearch] = useState("");
  const [campaignSearch, setCampaignSearch] = useState("");
  const [debouncedCampaignSearch, setDebouncedCampaignSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedContactSearch(contactSearch), 300);
    return () => clearTimeout(timer);
  }, [contactSearch]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedCampaignSearch(campaignSearch), 300);
    return () => clearTimeout(timer);
  }, [campaignSearch]);
  const [contactPhone, setContactPhone] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactOptIn, setContactOptIn] = useState(false);
  const [contactConsentSource, setContactConsentSource] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [campaignTemplate, setCampaignTemplate] = useState("");
  const [campaignVariableValues, setCampaignVariableValues] = useState<Record<string, string>>({});
  const [campaignContacts, setCampaignContacts] = useState<string[]>([]);
  const [campaignScheduledAt, setCampaignScheduledAt] = useState("");
  const [replyText, setReplyText] = useState("");
  const [pendingSendKey, setPendingSendKey] = useState<{ fingerprint: string; key: string } | null>(null);
  const [composerMode, setComposerMode] = useState<"reply" | "note">("reply");
  const [searchContactHistory, setSearchContactHistory] = useState<{ contact: Contact; events: ConsentEvent[] } | null>(null);
  const [consentTarget, setConsentTarget] = useState("");
  const [consentRecordSource, setConsentRecordSource] = useState("");
  const [metaPhoneId, setMetaPhoneId] = useState("");
  const [metaWabaId, setMetaWabaId] = useState("");
  const [metaWabaTimezone, setMetaWabaTimezone] = useState("Africa/Nairobi");
  const [metaToken, setMetaToken] = useState("");
  const [metaAppSecret, setMetaAppSecret] = useState("");
  const [metaAppSecretSaved, setMetaAppSecretSaved] = useState(false);
  const [metaTokenSaved, setMetaTokenSaved] = useState(false);
  const [metaStatus, setMetaStatus] = useState<any>(null);
  const [metaWebhookToken, setMetaWebhookToken] = useState("");
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [apiKeyName, setApiKeyName] = useState("Production integration");
  const [apiKeyScopes, setApiKeyScopes] = useState<string[]>(["messages:send"]);
  const [newApiKey, setNewApiKey] = useState("");
  const [newApiKeyClientId, setNewApiKeyClientId] = useState("");
  const [webhooks, setWebhooks] = useState<TenantWebhook[]>([]);
  const [webhookDeliveries, setWebhookDeliveries] = useState<WebhookDelivery[]>([]);
  const [notifications, setNotifications] = useState<WorkspaceNotification[]>([]);
  const [notificationUnread, setNotificationUnread] = useState(0);
  const [webhookName, setWebhookName] = useState("Support event receiver");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEvents, setWebhookEvents] = useState<string[]>(["message.inbound","message.status"]);
  const [newWebhookSecret, setNewWebhookSecret] = useState("");
  // Supabase Auth emits SIGNED_IN again whenever a tab is refocused (its
  // `_recoverAndRefresh` runs on `visibilitychange`). Replacing the `user`
  // object on every event would cascade into a full tenant + workspace reload.
  // Only a genuine identity change should invalidate workspace state.
  const signedInUserIdRef = useRef<string | null>(null);
  const applyAuthState = useCallback((next: Session | null) => {
    setSession((previous) => (
      previous?.access_token === next?.access_token
      && previous?.refresh_token === next?.refresh_token
      && previous?.expires_at === next?.expires_at
        ? previous
        : next
    ));
    const nextUserId = next?.user?.id ?? null;
    if (nextUserId !== signedInUserIdRef.current) {
      signedInUserIdRef.current = nextUserId;
      setUser(next?.user ?? null);
    }
  }, []);
  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => { applyAuthState(data.session); setAuthLoading(false); }).catch((error: unknown) => { console.error("MobiWave WA session check failed:", error); setNotice("We could not verify your session. Check your connection and reload the page."); setAuthLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      applyAuthState(next);
      if (event === "SIGNED_OUT" && !next && window.location.pathname !== "/login") navigate("/login");
    });
    const onPopState = () => setRouteVersion((value) => value + 1);
    window.addEventListener("popstate", onPopState);
    const onRejection = (event: PromiseRejectionEvent) => {
      // A failed background request should warn, never blank the entire app.
      console.error("MobiWave WA background request failed:", event.reason);
      setNotice("A background request failed. Refresh if something looks out of date.");
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      listener.subscription.unsubscribe();
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [applyAuthState, navigate]);
  // Legacy dashboard paths redirect to the overview.
  useEffect(() => {
    if (pathname === "/workspace" || pathname === "/settings") navigate("/dashboard");
  }, [pathname, navigate]);
  // The browser tab title follows the open screen.
  useEffect(() => {
    document.title = view === "Overview" ? "MobiWave WA" : `${view} · MobiWave WA`;
  }, [view]);
  const loadTenants = useCallback(async () => {
    const requestId = ++tenantRequestId.current;
    if (!supabase || !user) {
      setTenants([]);
      setTenantId("");
      setPlatformRole(null);
      setTenantError("");
      setTenantLoading(false);
      return;
    }
    setTenantLoading(true);
    setTenantError("");
    try {
      const [membershipResult, platformResult] = await withTimeout(Promise.all([
        supabase.from("tenant_members").select("tenant_id,role").eq("user_id", user.id),
        supabase.from("platform_admins").select("role").eq("user_id", user.id).limit(1),
      ]), "Loading business accounts");
      if (requestId !== tenantRequestId.current) return;
      if (platformResult.error) console.warn("Platform access lookup unavailable:", platformResult.error.message);
      setPlatformRole(platformResult.data?.[0]?.role ?? null);
      if (membershipResult.error) {
        setTenantError(membershipResult.error.message);
        setNotice("Could not load business accounts: " + membershipResult.error.message);
        setTenantLoading(false);
        return;
      }
      const memberships = membershipResult.data ?? [];
      const tenantIds = [...new Set(memberships.map((row: any) => row.tenant_id))];
      const tenantResult = tenantIds.length
        ? await withTimeout(supabase.from("tenants").select("id,name,slug").in("id", tenantIds), "Loading business accounts")
        : { data: [], error: null };
      if (requestId !== tenantRequestId.current) return;
      if (tenantResult.error) {
        setTenantError(tenantResult.error.message);
        setNotice("Could not load business accounts: " + tenantResult.error.message);
        setTenantLoading(false);
        return;
      }
      const tenantsById = new Map((tenantResult.data ?? []).map((tenant: any) => [tenant.id, tenant]));
      const mapped = memberships.flatMap((membership: any) => {
        const tenant = tenantsById.get(membership.tenant_id);
        return tenant ? [{ ...tenant, role: membership.role }] : [];
      }) as Tenant[];
      const requestedTenant = new URLSearchParams(window.location.search).get("tenant");
      setTenants(mapped);
      setTenantId((current) => {
        const preferred = requestedTenant && mapped.some((t) => t.id === requestedTenant) ? requestedTenant : current;
        return mapped.some((t) => t.id === preferred) ? preferred : mapped[0]?.id ?? "";
      });
      setTenantLoading(false);
    } catch (error) {
      if (requestId !== tenantRequestId.current) return;
      console.error("MobiWave WA business account lookup failed:", error);
      const message = error instanceof Error ? error.message : "Network request failed.";
      setTenantError(message);
      setNotice("Could not load business accounts: " + message);
      setTenantLoading(false);
    }
  }, [user]);
  // Wait for the session check: running with a not-yet-loaded user would clear
  // the restored tenant and force a second full workspace load on every mount.
  useEffect(() => { if (!authLoading) void loadTenants(); }, [loadTenants, authLoading]);
  useEffect(() => { setProfileName(String(user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? "")); }, [user]);
  const previousTenantRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousTenantRef.current;
    previousTenantRef.current = tenantId;
    // On the first run after a reload `tenantId` is the restored value, so
    // there is nothing to clear. Only an actual workspace switch resets state.
    // Only a genuine switch between two real workspaces resets the view state.
    if (!previous || !tenantId || previous === tenantId) return;
    setNewApiKey(""); setNewWebhookSecret(""); setMetaWebhookToken(""); setMetaAppSecret(""); setMetaAppSecretSaved(false); setContactPage(0); setContactSearch(""); setCampaignSearch(""); setCampaignRecipientsPage(0); setConsentTarget(""); setSearchContactHistory(null); setSelectedConversation(""); setConversationLimit(100); setConversationHasMore(false); setConversations([]); setMessages([]); setDailyMessages([]); setSelectedCampaign(null); setCampaignCounts(null); setCampaignFailures([]);
  }, [tenantId]);
  useEffect(() => {
    let current = true;
    if (!supabase || !tenantId) { setTenantPlan(null); return; }
    setTenantPlanLoading(true);
    withTimeout(supabase.rpc("platform_tenant_plan", { p_tenant_id: tenantId }), "Loading plan")
      .then(({ data, error }: { data?: any; error?: any }) => {
        if (!current) return;
        setTenantPlan(error ? null : data as TenantPlan);
        setTenantPlanLoading(false);
      })
      .catch(() => { if (current) { setTenantPlan(null); setTenantPlanLoading(false); } });
    return () => { current = false; };
  }, [tenantId]);
  useEffect(() => {
    let current = true;
    if (!supabase || !tenantId) { setMetaAllowance(null); return; }
    withTimeout(supabase.rpc("tenant_meta_allowance", { p_tenant_id: tenantId }), "Loading message allowance")
      .then(({ data, error }: { data?: any; error?: any }) => {
        if (!current) return;
        setMetaAllowance(error ? null : data as MetaAllowance);
      })
      .catch(() => { if (current) setMetaAllowance(null); });
    return () => { current = false; };
  }, [tenantId]);
  const activeTenant = tenants.find((t) => t.id === tenantId);
  const isAdmin = activeTenant ? ["owner", "admin"].includes(activeTenant.role) : false;
  const canAgent = activeTenant ? ["owner", "admin", "agent"].includes(activeTenant.role) : false;
  const tierFeatureAvailable = useCallback((feature: TierFeature) => {
    // Mirror private.tenant_feature_enabled exactly, so the navigation never
    // offers a screen the database would refuse to load.
    if (tenantPlanLoading || !tenantPlan) return true;
    if (tenantPlan.state === "exempt") return true;
    if (!tenantPlan.state || !["active", "trialing", "grace", "past_due"].includes(tenantPlan.state)) return false;
    return tenantPlan.tier?.feature_flags?.[feature] === true;
  }, [tenantPlan, tenantPlanLoading]);
  useEffect(() => {
    const feature = viewTierFeature[view];
    if (feature && !tierFeatureAvailable(feature)) {
      navigate("/dashboard");
      setNotice("That capability is not included in this workspace’s active tier.");
    }
  }, [view, tierFeatureAvailable, navigate]);
  const loadContacts = useCallback(async () => {
    const requestId = ++contactsRequestId.current;
    if (!supabase || !tenantId) { setContacts([]); setContactHasMore(false); setTotalContacts(0); setContactsLoading(false); return; }
    setContactsLoading(true);
    const start = contactPage * 100;
    let query = supabase.from("contacts").select("id,phone_e164,display_name,consent_status,consent_source,consent_at,opted_out_at", { count: "exact" }).eq("tenant_id", tenantId).order("created_at", { ascending: false }).range(start, start + 99);
    const term = debouncedContactSearch.trim().replace(/[(),.*%_\\]/g, " ").trim();
    if (term) query = query.or(`display_name.ilike.%${term}%,phone_e164.ilike.%${term}%`);
    try {
      const { data, error, count } = await withTimeout(query, "Loading contacts");
      if (requestId !== contactsRequestId.current) return;
      if (error) { setNotice("Could not load contacts: " + error.message); return; }
      setContacts((data ?? []) as Contact[]);
      setTotalContacts(count ?? 0);
      setContactHasMore(start + (data?.length ?? 0) < (count ?? 0));
    } catch (cause) {
      if (requestId !== contactsRequestId.current) return;
      console.error("MobiWave WA contact load failed:", cause);
      setNotice(cause instanceof Error ? cause.message : "Contacts could not be loaded. Check your connection and refresh.");
      setContacts([]);
      setTotalContacts(0);
      setContactHasMore(false);
    } finally {
      if (requestId === contactsRequestId.current) setContactsLoading(false);
    }
  }, [tenantId, contactPage, debouncedContactSearch]);
  useEffect(() => { void loadContacts(); }, [loadContacts]);
  // The campaign composer needs its own list: only contacts with recorded
  // opt-in are eligible, and it must not be affected by the contact list's
  // search term or page.
  const [campaignRecipients, setCampaignRecipients] = useState<Contact[]>([]);
  const [campaignRecipientsTotal, setCampaignRecipientsTotal] = useState(0);
  const [campaignRecipientsHasMore, setCampaignRecipientsHasMore] = useState(false);
  const [campaignRecipientsPage, setCampaignRecipientsPage] = useState(0);
  const [campaignRecipientsLoading, setCampaignRecipientsLoading] = useState(false);
  const campaignRecipientsRequestId = useRef(0);
  const loadCampaignRecipients = useCallback(async () => {
    const requestId = ++campaignRecipientsRequestId.current;
    if (!supabase || !tenantId) {
      setCampaignRecipients([]);
      setCampaignRecipientsTotal(0);
      setCampaignRecipientsHasMore(false);
      setCampaignRecipientsLoading(false);
      return;
    }
    setCampaignRecipientsLoading(true);
    const start = campaignRecipientsPage * 100;
    let query = supabase
      .from("contacts")
      .select("id,phone_e164,display_name,consent_status", { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("consent_status", "opted_in")
      .order("created_at", { ascending: false })
      .range(start, start + 99);
    const term = debouncedCampaignSearch.trim().replace(/[(),.*%_\\]/g, " ").trim();
    if (term) query = query.or(`display_name.ilike.%${term}%,phone_e164.ilike.%${term}%`);
    try {
      const { data, error, count } = await withTimeout(query, "Loading campaign recipients");
      if (requestId !== campaignRecipientsRequestId.current) return;
      if (error) { setNotice("Could not load campaign recipients: " + error.message); return; }
      setCampaignRecipients((data ?? []) as Contact[]);
      setCampaignRecipientsTotal(count ?? 0);
      setCampaignRecipientsHasMore(start + (data?.length ?? 0) < (count ?? 0));
    } catch (cause) {
      if (requestId !== campaignRecipientsRequestId.current) return;
      console.error("MobiWave WA campaign recipient load failed:", cause);
      setNotice(cause instanceof Error ? cause.message : "Campaign recipients could not be loaded. Check your connection and refresh.");
      setCampaignRecipients([]);
    } finally {
      if (requestId === campaignRecipientsRequestId.current) setCampaignRecipientsLoading(false);
    }
  }, [tenantId, campaignRecipientsPage, debouncedCampaignSearch]);
  useEffect(() => { void loadCampaignRecipients(); }, [loadCampaignRecipients]);
  const loadOverviewMetrics = useCallback(async () => {
    const requestId = ++overviewRequestId.current;
    if (!supabase || !tenantId) { setOverviewMetrics(null); setOverviewMetricsError(""); setDailyMessages([]); setOverviewMetricsLoading(false); return; }
    setOverviewMetricsLoading(true);
    try {
      const { data, error } = await withTimeout(supabase.rpc("get_tenant_overview", { p_tenant_id: tenantId }), "Loading dashboard metrics");
      if (requestId !== overviewRequestId.current) return;
      const result = data as (OverviewMetrics & { daily_messages?: Array<{ date: string; label: string; inbound: number; outbound: number }> }) | null;
      if (error || !result || !result.contacts || !result.conversations || !Array.isArray(result.daily_messages)) {
        setOverviewMetrics(null);
        setOverviewMetricsError("Dashboard metrics could not be loaded. Refresh or ask an administrator to check database access.");
        setDailyMessages([]);
        console.error("MobiWave WA overview metrics failed:", error?.message ?? "Invalid metric response");
        return;
      }
      const values = [result.contacts.total, result.contacts.opted_in, result.contacts.opted_out, result.conversations.total, result.conversations.open, result.conversations.pending, result.conversations.resolved, result.conversations.unread, result.unfinished_campaigns, result.approved_templates, ...result.daily_messages.flatMap((day) => [day.inbound, day.outbound])];
      if (!values.every((value) => Number.isFinite(Number(value)))) {
        setOverviewMetrics(null); setOverviewMetricsError("Dashboard metrics returned invalid values. Refresh or ask an administrator to check database access."); setDailyMessages([]); return;
      }
      setOverviewMetrics({
        contacts: { total: Number(result.contacts.total), opted_in: Number(result.contacts.opted_in), opted_out: Number(result.contacts.opted_out) },
        conversations: { total: Number(result.conversations.total), open: Number(result.conversations.open), pending: Number(result.conversations.pending), resolved: Number(result.conversations.resolved), unread: Number(result.conversations.unread) },
        unfinished_campaigns: Number(result.unfinished_campaigns),
        approved_templates: Number(result.approved_templates),
      });
      setDailyMessages(result.daily_messages.map((day) => ({ date: day.date, label: day.label, inbound: Number(day.inbound), outbound: Number(day.outbound) })));
      setOverviewMetricsError("");
    } catch (cause) {
      if (requestId !== overviewRequestId.current) return;
      console.error("MobiWave WA overview metrics request failed:", cause);
      setOverviewMetrics(null); setOverviewMetricsError("Dashboard metrics could not be loaded. Refresh or ask an administrator to check database access."); setDailyMessages([]);
    } finally {
      if (requestId === overviewRequestId.current) setOverviewMetricsLoading(false);
    }
  }, [tenantId]);
  const validatedRestoredConversationRef = useRef(false);
  const loadWorkspace = useCallback(async () => {
    const requestId = ++workspaceRequestId.current;
    if (!supabase || !tenantId) {
      overviewRequestId.current++;
      setContacts([]); setTemplates([]); setCampaigns([]); setConversations([]); setTeamMembers([]);
      setMetaStatus(null); setMetaPhoneId(""); setMetaWabaId(""); setMetaWabaTimezone("Africa/Nairobi"); setMetaWebhookToken(""); setApiKeys([]); setWebhooks([]); setWebhookDeliveries([]); setDailyMessages([]); setOverviewMetrics(null); setOverviewMetricsError(""); return;
    }
    setOverviewMetrics(null);
    setOverviewMetricsError("");
    const overviewPromise = loadOverviewMetrics();
    setLoading(true);
    try {
      const results = await withTimeout(Promise.all([
        supabase.from("wa_templates").select("id,meta_template_name,language_code,category,meta_status,components").eq("tenant_id", tenantId).order("meta_template_name"),
        supabase.from("campaigns").select("id,name,status,created_at,scheduled_at,template_id,template_parameters").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(100),
        supabase.from("conversations").select("id,status,assigned_to,last_message_at,contacts!conversations_contact_same_tenant_fk(display_name,phone_e164)").eq("tenant_id", tenantId).order("last_message_at", { ascending: false }).limit(100),
        supabase.from("meta_integrations").select("phone_number_id,waba_id,display_phone_number,verified,enabled,verified_name,last_error_code,last_health_check_at,webhook_verified_at,webhook_verification_source,waba_timezone,messaging_limit_tier,quality_rating").eq("tenant_id", tenantId).maybeSingle(),
        supabase.from("tenant_api_keys").select("id,client_id,name,key_prefix,scopes,last_used_at,expires_at,revoked_at,created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
        supabase.from("tenant_webhooks").select("id,name,endpoint_url,events,enabled,last_delivery_at,last_status,last_error,created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
      ]), "Loading workspace");
      if (requestId !== workspaceRequestId.current) return;
      const [t, ca, co, mi, ak, wh] = results;
      if (t.error || ca.error || co.error || mi.error || ak.error || wh.error) setNotice("Could not load business account data. Please refresh and try again.");
      setTemplates((t.data ?? []) as Template[]);
      setCampaigns((ca.data ?? []) as Campaign[]);
      const [teamResponse, readResponse] = await withTimeout(Promise.all([
        supabase.functions.invoke("team-members", { body: { tenant_id: tenantId } }),
        user ? supabase.from("conversation_reads").select("conversation_id,last_read_at").eq("tenant_id", tenantId).eq("user_id", user.id) : Promise.resolve({ data: [], error: null }),
      ]), "Loading collaboration details");
      if (requestId !== workspaceRequestId.current) return;
      const readAt = new Map<string, number>((readResponse.data ?? []).map((row: any) => [String(row.conversation_id), new Date(row.last_read_at).getTime()]));
      setTeamMembers((teamResponse.data?.members ?? []) as TeamMember[]);
      const freshConversations = ((co.data ?? []) as any[]).map((conversation: any) => ({
        ...conversation,
        unread: Boolean(conversation.last_message_at && new Date(conversation.last_message_at).getTime() > (readAt.get(conversation.id) ?? 0)),
      })) as Conversation[];
      setConversations((current) => {
        const rows = [...freshConversations, ...current.filter((row) => !freshConversations.some((fresh) => fresh.id === row.id))];
        return [...new Map(rows.map((row) => [row.id, row])).values()].sort((a, b) => new Date(b.last_message_at ?? 0).getTime() - new Date(a.last_message_at ?? 0).getTime()).slice(0, Math.max(100, current.length));
      });
      setConversationHasMore((current) => current || (co.data?.length ?? 0) === 100);
      if (teamResponse.error || readResponse.error) setNotice("Inbox collaboration details could not be loaded. Refresh and try again.");
      setMetaStatus(mi.data);
      setMetaPhoneId(mi.data?.phone_number_id ?? "");
      setMetaWabaId(mi.data?.waba_id ?? "");
      setMetaWabaTimezone(mi.data?.waba_timezone ?? "Africa/Nairobi");
      setApiKeys((ak.data ?? []) as ApiKey[]);
      setWebhooks((wh.data ?? []) as TenantWebhook[]);
      const { data: deliveryRows, error: deliveryError } = await withTimeout(supabase.from("webhook_deliveries").select("id,webhook_id,event_type,status,attempt_count,response_status,last_error,created_at,delivered_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(50), "Loading webhook history");
      if (requestId !== workspaceRequestId.current) return;
      if (deliveryError) setNotice("Could not load webhook delivery history: " + deliveryError.message);
      setWebhookDeliveries((deliveryRows ?? []) as WebhookDelivery[]);
      if (!validatedRestoredConversationRef.current) {
        validatedRestoredConversationRef.current = true;
        setSelectedConversation((current: any) => current && freshConversations.some((fresh) => fresh.id === current) ? current : "");
      }
      await overviewPromise;
    } catch (cause) {
      if (requestId !== workspaceRequestId.current) return;
      console.error("MobiWave WA workspace load failed:", cause);
      setNotice(cause instanceof Error ? cause.message : "We could not load business account data. Check your connection and refresh.");
    } finally {
      if (requestId === workspaceRequestId.current) setLoading(false);
    }
  }, [tenantId, user, loadOverviewMetrics]);
  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);
  useEffect(() => {
    if (!supabase || !tenantId || !isAdmin) { setMetaAppSecretSaved(false); setMetaTokenSaved(false); return; }
    let active = true;
    withTimeout(supabase.functions.invoke("meta-config", { body: { tenant_id: tenantId, action: "status" } }), "Loading connection status")
      .then(({ data, error }: { data?: any; error?: any }) => {
        if (active && !error && data?.ok === true) {
          setMetaAppSecretSaved(data.app_secret_configured === true);
          setMetaTokenSaved(data.access_token_configured === true);
        }
      })
      .catch(() => { if (active) { setMetaAppSecretSaved(false); setMetaTokenSaved(false); } });
    return () => { active = false; };
  }, [tenantId, isAdmin]);
  const loadNotifications = useCallback(async () => {
    const requestId = ++notificationRequestId.current;
    if (!supabase || !tenantId) { setNotifications([]); setNotificationUnread(0); return; }
    try {
      const { data, error } = await withTimeout(supabase.functions.invoke("notification-center", { body: { tenant_id: tenantId, action: "list", limit: 50 } }), "Loading alerts");
      if (requestId !== notificationRequestId.current) return;
      if (error || data?.error) { setNotice(data?.error ?? error?.message ?? "Could not load workspace alerts."); return; }
      setNotifications((data?.notifications ?? []) as WorkspaceNotification[]);
      setNotificationUnread(Number(data?.unread_count ?? 0));
    } catch (cause) {
      if (requestId !== notificationRequestId.current) return;
      console.error("MobiWave WA alert load failed:", cause);
      setNotice(cause instanceof Error ? cause.message : "Could not load workspace alerts.");
    }
  }, [tenantId]);
  useEffect(() => { void loadNotifications(); }, [loadNotifications]);
  useEffect(() => {
    if (!supabase || !tenantId) return;
    const client = supabase;
    const channel = client.channel(`workspace-alerts-${tenantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "workspace_notifications", filter: `tenant_id=eq.${tenantId}` }, () => {
        void loadNotifications();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "workspace_notification_reads", filter: `tenant_id=eq.${tenantId}` }, () => {
        void loadNotifications();
      })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [tenantId, loadNotifications]);
  async function markNotificationRead(id: string) {
    if (!supabase || !tenantId) return;
    const { data, error } = await supabase.functions.invoke("notification-center", { body: { tenant_id: tenantId, action: "mark_read", notification_id: id } });
    if (error || data?.error || !Array.isArray(data?.notifications) || !Number.isFinite(Number(data?.unread_count))) { setNotice(data?.error ?? error?.message ?? "Alert acknowledgement was not confirmed. Refresh the alerts list before retrying."); return; }
    await loadNotifications();
  }
  async function markAllNotificationsRead() {
    if (!supabase || !tenantId) return;
    const { data, error } = await supabase.functions.invoke("notification-center", { body: { tenant_id: tenantId, action: "mark_all_read" } });
    if (error || data?.error || !Array.isArray(data?.notifications) || !Number.isFinite(Number(data?.unread_count))) { setNotice(data?.error ?? error?.message ?? "Bulk alert acknowledgement was not confirmed. Refresh the alerts list before retrying."); return; }
    await loadNotifications();
    setAlertsDropdownOpen(false);
  }
  
  const handleViewAllAlerts = () => {
    goTo("Alerts");
    setAlertsDropdownOpen(false);
  };
  
  const handleMarkAsRead = () => {
    if (notificationUnread > 0) {
      markAllNotificationsRead();
    }
  };
  const loadInbox = useCallback(async (limit = conversationLimit, append = false) => {
    const requestId = ++inboxRequestId.current;
    if (!supabase || !tenantId || !user) return;
    const start = append ? Math.max(0, limit - 100) : 0;
    const pageSize = limit - start;
    try {
      const [conversationResult] = await withTimeout(Promise.all([
        supabase.from("conversations").select("id,status,assigned_to,last_message_at,contacts!conversations_contact_same_tenant_fk(display_name,phone_e164)").eq("tenant_id", tenantId).order("last_message_at", { ascending: false }).range(start, limit),
      ]), "Refreshing the inbox");
      if (requestId !== inboxRequestId.current) return;
      if (conversationResult.error) { setNotice("Could not refresh the inbox. Check your connection and retry."); return; }
      const pageRows = (conversationResult.data ?? []).slice(0, pageSize) as any[];
      setConversationHasMore((conversationResult.data?.length ?? 0) > pageSize);
      const { data: readRows, error: readError } = pageRows.length
        ? await withTimeout(supabase.from("conversation_reads").select("conversation_id,last_read_at").eq("tenant_id", tenantId).eq("user_id", user.id).in("conversation_id", pageRows.map((row) => row.id)), "Refreshing inbox read state")
        : { data: [], error: null };
      if (requestId !== inboxRequestId.current) return;
      if (readError) { setNotice("Could not refresh inbox read state. Check your connection and retry."); return; }
      const readAt = new Map<string, number>((readRows ?? []).map((row: any) => [String(row.conversation_id), new Date(row.last_read_at).getTime()]));
      const loaded = pageRows.map((conversation: any) => ({
        ...conversation,
        unread: Boolean(conversation.last_message_at && new Date(conversation.last_message_at).getTime() > (readAt.get(conversation.id) ?? 0)),
      })) as Conversation[];
      setConversations((current) => {
        const rows = append ? [...current, ...loaded] : [...loaded, ...current.filter((row) => !loaded.some((fresh) => fresh.id === row.id))];
        return [...new Map(rows.map((row) => [row.id, row])).values()].sort((a, b) => new Date(b.last_message_at ?? 0).getTime() - new Date(a.last_message_at ?? 0).getTime()).slice(0, limit);
      });
    } catch (cause) {
      if (requestId !== inboxRequestId.current) return;
      console.error("MobiWave WA inbox refresh failed:", cause);
      setNotice(cause instanceof Error ? cause.message : "Could not refresh the inbox. Check your connection and retry.");
    }
  }, [tenantId, user?.id, conversationLimit]);
  const loadMessages = useCallback(async () => {
    const requestId = ++messageRequestId.current;
    setLoadingOlderMessages(false);
    if (!supabase || !tenantId || !selectedConversation) { setMessages([]); setMessageHasMore(false); return; }
    try {
      const [messageResult, noteResult] = await withTimeout(Promise.all([
        supabase.from("messages").select("id,direction,actor_type,body,status,created_at,message_type,metadata").eq("tenant_id", tenantId).eq("conversation_id", selectedConversation).order("created_at", { ascending: false }).limit(200),
        supabase.from("conversation_notes").select("id,body,author_id,created_at").eq("tenant_id", tenantId).eq("conversation_id", selectedConversation).order("created_at", { ascending: false }).limit(200),
      ]), "Loading conversation history");
      if (requestId !== messageRequestId.current) return;
      if (messageResult.error || noteResult.error) setNotice(messageResult.error?.message ?? noteResult.error?.message ?? "Could not load conversation history.");
      setMessageHasMore((messageResult.data?.length ?? 0) === 200 || (noteResult.data?.length ?? 0) === 200);
      const messageRows = (messageResult.data ?? []).reverse().map((message: any) => ({ ...message, is_note: false, media_id: message.metadata?.media_id, filename: message.metadata?.filename })) as ChatMessage[];
      const noteRows = (noteResult.data ?? []).reverse().map((note: any) => ({ ...note, direction: "inbound", actor_type: "Internal note", status: "", is_note: true })) as ChatMessage[];
      scrollToLatestMessage.current = true;
      setMessages([...messageRows, ...noteRows].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()));
    } catch (cause) {
      if (requestId !== messageRequestId.current) return;
      console.error("MobiWave WA conversation load failed:", cause);
      setNotice(cause instanceof Error ? cause.message : "Could not load conversation history. Check your connection and retry.");
      setMessages([]);
      setMessageHasMore(false);
    }
  }, [tenantId, selectedConversation]);
  useEffect(() => {
    if (!scrollToLatestMessage.current || !chatMessagesRef.current) return;
    chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    scrollToLatestMessage.current = false;
  }, [messages]);
  const loadOlderMessages = useCallback(async () => {
    if (!supabase || !tenantId || !selectedConversation || !messages.length || loadingOlderMessages) return;
    const requestId = ++messageRequestId.current;
    setLoadingOlderMessages(true);
    const before = messages[0].created_at;
    try {
      const [messageResult, noteResult] = await withTimeout(Promise.all([
        supabase.from("messages").select("id,direction,actor_type,body,status,created_at,message_type,metadata").eq("tenant_id", tenantId).eq("conversation_id", selectedConversation).lt("created_at", before).order("created_at", { ascending: false }).limit(200),
        supabase.from("conversation_notes").select("id,body,author_id,created_at").eq("tenant_id", tenantId).eq("conversation_id", selectedConversation).lt("created_at", before).order("created_at", { ascending: false }).limit(200),
      ]), "Loading earlier messages");
      if (requestId !== messageRequestId.current) return;
      if (messageResult.error || noteResult.error) setNotice(messageResult.error?.message ?? noteResult.error?.message ?? "Could not load earlier conversation history.");
      const messageRows = (messageResult.data ?? []).reverse().map((message: any) => ({ ...message, is_note: false, media_id: message.metadata?.media_id, filename: message.metadata?.filename })) as ChatMessage[];
      const noteRows = (noteResult.data ?? []).reverse().map((note: any) => ({ ...note, direction: "inbound", actor_type: "Internal note", status: "", is_note: true })) as ChatMessage[];
      setMessages((current) => [...messageRows, ...noteRows, ...current].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()));
      setMessageHasMore((messageResult.data?.length ?? 0) === 200 || (noteResult.data?.length ?? 0) === 200);
    } catch (cause) {
      if (requestId !== messageRequestId.current) return;
      console.error("MobiWave WA earlier-message load failed:", cause);
      setNotice(cause instanceof Error ? cause.message : "Could not load earlier conversation history. Check your connection and retry.");
    } finally {
      if (requestId === messageRequestId.current) setLoadingOlderMessages(false);
    }
  }, [tenantId, selectedConversation, messages, loadingOlderMessages]);
  useEffect(() => { void loadMessages(); }, [loadMessages]);
  // The subscription is scoped to the tenant only. Keeping selectedConversation
  // out of the dependency list avoids tearing down and re-subscribing the whole
  // channel on every conversation click; refs give handlers the latest values.
  const selectedConversationRef = useRef(selectedConversation);
  selectedConversationRef.current = selectedConversation;
  const loadInboxRef = useRef(loadInbox);
  loadInboxRef.current = loadInbox;
  const loadOverviewMetricsRef = useRef(loadOverviewMetrics);
  loadOverviewMetricsRef.current = loadOverviewMetrics;
  const loadMessagesRef = useRef(loadMessages);
  loadMessagesRef.current = loadMessages;
  const markConversationReadRef = useRef<(id: string) => void>(() => {});
  markConversationReadRef.current = markConversationRead;
  const realtimeRefreshTimer = useRef<number | null>(null);
  const scheduleRealtimeRefresh = useCallback(() => {
    if (realtimeRefreshTimer.current !== null) window.clearTimeout(realtimeRefreshTimer.current);
    realtimeRefreshTimer.current = window.setTimeout(() => {
      realtimeRefreshTimer.current = null;
      void loadInboxRef.current();
      void loadOverviewMetricsRef.current();
    }, 250);
  }, []);
  useEffect(() => {
    if (!supabase || !tenantId) return;
    const client = supabase;
    const channel = client.channel(`inbox-${tenantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `tenant_id=eq.${tenantId}` }, () => { scheduleRealtimeRefresh(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `tenant_id=eq.${tenantId}` }, (payload) => {
        const row = payload.new as { conversation_id?: string; direction?: string; created_at?: string };
        if (payload.eventType === "INSERT") setDailyMessages((series) => bumpDailyMessageSeries(series, row));
        scheduleRealtimeRefresh();
        const currentId = selectedConversationRef.current;
        if (row?.conversation_id === currentId) { void loadMessagesRef.current(); void markConversationReadRef.current(currentId); }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "contacts", filter: `tenant_id=eq.${tenantId}` }, () => { void loadOverviewMetricsRef.current(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "campaigns", filter: `tenant_id=eq.${tenantId}` }, () => { void loadOverviewMetricsRef.current(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "wa_templates", filter: `tenant_id=eq.${tenantId}` }, () => { void loadOverviewMetricsRef.current(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_reads", filter: `tenant_id=eq.${tenantId}` }, () => { void loadOverviewMetricsRef.current(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_notes", filter: `tenant_id=eq.${tenantId}` }, (payload) => {
        const row = payload.new as { conversation_id?: string };
        if (row?.conversation_id === selectedConversationRef.current) void loadMessagesRef.current();
      })
      .subscribe();
    return () => {
      if (realtimeRefreshTimer.current !== null) window.clearTimeout(realtimeRefreshTimer.current);
      void client.removeChannel(channel);
    };
  }, [tenantId, scheduleRealtimeRefresh]);
  useEffect(() => { if (selectedConversation) void markConversationRead(selectedConversation); }, [selectedConversation, tenantId, user?.id]);
  useEffect(() => { window.scrollTo(0, 0); }, [view]);
  async function signIn(event: FormEvent) {
    event.preventDefault(); if (!supabase) return;
    setBusy(true); setNotice("");
    try {
      const result = authMode === "signin"
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await supabase.auth.signUp({ email: email.trim(), password });
      if (result.error) setNotice(result.error.message);
      else if (authMode === "signup" && !result.data.session) setNotice("Check your email to confirm your account, then sign in.");
      else {
        setNotice(authMode === "signup" ? "Account created." : "Signed in.");
        navigate("/dashboard");
      }
    } catch (error) {
      console.error("MobiWave WA sign-in request failed:", error);
      setNotice("Could not reach the authentication service. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  async function sendPasswordReset(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !email.trim()) { setNotice("Enter your account email address first."); return; }
    setBusy(true); setNotice("");
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin + "/login",
    });
    setBusy(false);
    setNotice(error ? error.message : "If an account exists for that email, a password-reset link will be sent.");
  }
  async function createWorkspace(event: FormEvent) {
    event.preventDefault(); if (!supabase) return;
    const name = workspaceName.trim();
    const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    if (slug.length < 3) { setNotice("Use a business name that produces at least 3 URL characters."); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("create-workspace", { body: { name, slug } });
    setBusy(false);
    if (error || data?.error || data?.ok !== true || !data?.tenant?.id) { setNotice(data?.error ?? error?.message ?? "Business setup did not return a confirmed workspace. Refresh and check your accounts before retrying."); return; }
    setWorkspaceName(""); setNotice("Business account created."); await loadTenants();
  }
  async function addContact(event: FormEvent) {
    event.preventDefault(); if (!supabase) return;
    if (contactOptIn && !contactConsentSource.trim()) { setNotice("Record how and when consent was obtained before marking a contact opted in."); return; }
    setBusy(true);
    const { error } = await supabase.from("contacts").insert({
      tenant_id: tenantId, phone_e164: contactPhone.trim(), display_name: contactName.trim() || null,
      consent_status: contactOptIn ? "opted_in" : "unknown", consent_source: contactOptIn ? contactConsentSource.trim() : null,
      consent_at: contactOptIn ? new Date().toISOString() : null,
    });
    setBusy(false);
    if (error) setNotice(error.message); else { setContactPhone(""); setContactName(""); setContactOptIn(false); setContactConsentSource(""); setNotice("Contact added."); }
    await loadWorkspace();
  }
  async function optOut(contact: Contact) {
    if (!supabase) return;
    const confirmed = await confirm({
      title: "Suppress this contact?",
      description: `${contact.display_name || contact.phone_e164} will be excluded from every campaign and their consent status becomes opted out.`,
      confirmLabel: "Suppress contact",
      destructive: true,
    });
    if (!confirmed) return;
    const { data, error } = await supabase.rpc("record_contact_consent", {
      p_tenant_id: tenantId, p_contact_id: contact.id, p_status: "opted_out",
      p_source: "Suppressed by business account user",
    }).maybeSingle();
    setNotice(error ? error.message : data ? "Contact opted out and suppressed from campaigns." : "Contact was not found in this workspace; no changes were made."); await loadWorkspace();
  }
  async function recordOptIn(contact: Contact, event: FormEvent) {
    event.preventDefault();
    if (!supabase || !tenantId || !consentRecordSource.trim()) return;
    const { data, error } = await supabase.rpc("record_contact_consent", {
      p_tenant_id: tenantId, p_contact_id: contact.id, p_status: "opted_in",
      p_source: consentRecordSource.trim(),
    }).maybeSingle();
    setNotice(error ? "Could not record consent: " + error.message : data ? "Opt-in recorded and added to the consent history." : "Contact was not found in this workspace; no consent change was made.");
    setConsentTarget(""); setConsentRecordSource(""); await loadWorkspace();
  }
  async function showConsentHistory(contact: Contact) {
    if (!supabase || !tenantId) return;
    const { data, error } = await supabase.from("contact_consent_events").select("id,previous_status,consent_status,consent_source,changed_at").eq("tenant_id", tenantId).eq("contact_id", contact.id).order("changed_at", { ascending: false }).limit(50);
    if (error) { setNotice("Could not load consent history: " + error.message); return; }
    setSearchContactHistory({ contact, events: (data ?? []) as ConsentEvent[] });
  }
  async function createCampaign(event: FormEvent) {
    event.preventDefault(); if (!supabase || !user) return;
    const chosen = campaignContacts;
    if (!chosen.length) { setNotice("Select at least one contact with recorded opt-in consent."); return; }
    if (!campaignTemplate) { setNotice("Select an approved Meta template."); return; }
    const selected = templates.find((template) => template.id === campaignTemplate);
    if (selected?.components?.some((component) => String(component?.type).toLowerCase() === "header" && component?.format && String(component.format).toUpperCase() !== "TEXT")) {
      setNotice("This template uses a media header. Uploading template header media is not available in this campaign composer yet."); return;
    }
    const parts = getTemplateParts(selected);
    if (parts.some((part) => part.variables.some((_, index) => !campaignVariableValues[`${part.componentIndex}:${index}`]?.trim()))) {
      setNotice("Fill in every template variable before saving this campaign."); return;
    }
    const parameters = getTemplateParameters(parts, campaignVariableValues);
    const scheduledAt = campaignScheduledAt ? new Date(campaignScheduledAt) : null;
    if (scheduledAt && Number.isNaN(scheduledAt.getTime())) { setNotice("Choose a valid schedule date and time."); return; }
    setBusy(true);
    const { data: campaign, error } = await supabase.from("campaigns").insert({ tenant_id: tenantId, name: campaignName.trim(), template_id: campaignTemplate, template_parameters: parameters, created_by: user.id, status: "draft", scheduled_at: scheduledAt ? scheduledAt.toISOString() : null }).select("id").single();
    if (error) { setBusy(false); setNotice(error.message); return; }
    const { error: recipientError } = await supabase.from("campaign_recipients").insert(chosen.map((contactId) => ({ tenant_id: tenantId, campaign_id: campaign.id, contact_id: contactId, status: "queued" })));
    if (recipientError) {
      // Do not leave a misleading, empty draft when the recipient batch failed.
      const { error: rollbackError } = await supabase.from("campaigns").delete().eq("tenant_id", tenantId).eq("id", campaign.id);
      setBusy(false);
      setNotice(rollbackError
        ? "Recipients could not be added and the incomplete draft could not be removed. Contact support before retrying: " + recipientError.message
        : "Recipients could not be added. The incomplete campaign draft was removed: " + recipientError.message);
    } else {
      setBusy(false);
      setCampaignName("");
      setCampaignContacts([]);
      setCampaignVariableValues({});
      setCampaignScheduledAt("");
      setNotice(scheduledAt
        ? "Campaign scheduled for " + scheduledAt.toLocaleString() + " with " + chosen.length + " selected contacts. It will start automatically and send in batches."
        : "Campaign draft created with " + chosen.length + " selected contacts. Consent is checked again immediately before sending.");
    }
    await loadWorkspace();
  }
  async function launchCampaign(campaignId: string) {
    if (!supabase) return;
    const confirmed = await confirm({
      title: "Send this campaign now?",
      description: "The next batch is sent with the selected approved Meta template. Consent is re-checked immediately before every delivery.",
      confirmLabel: "Send batch",
    });
    if (!confirmed) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("campaign-launch", { body: { tenant_id: tenantId, campaign_id: campaignId } });
    setBusy(false);
    if (error || data?.error || data?.ok !== true || !["running", "paused", "cancelled", "completed", "failed"].includes(String(data?.status)) || !["sent", "skipped", "failed", "remaining"].every((key) => Number.isFinite(Number(data?.[key])))) {
      setNotice(data?.error ?? error?.message ?? "Campaign launch did not return a confirmed result. Refresh campaign details before retrying.");
    } else {
      const notices: string[] = [];
      if (data.status === "paused" || data.status === "cancelled") notices.push(`Campaign is ${data.status}. ${Number(data.remaining)} recipients remain queued.`);
      if (data.quota_exhausted) notices.push("Monthly message limit reached. Remaining recipients stay queued for a later batch.");
      if (data.time_budget_reached) notices.push("This batch reached its safe time budget. Remaining recipients stay queued for the next batch.");
      if (Number(data.persistence_warnings ?? 0) > 0) notices.push(Number(data.persistence_warnings) + " accepted send(s) need a message-history or usage check. Review Alerts; do not resend.");
      notices.push("Campaign batch: " + Number(data.sent) + " accepted, " + Number(data.skipped) + " skipped, " + Number(data.failed) + " failed. " + Number(data.remaining) + " remain queued or in progress.");
      setNotice(notices.join(" "));
    }
    await loadWorkspace();
    if (selectedCampaign?.id === campaignId) {
      const nextStatus = !error && !data?.error && data?.ok === true && data?.status ? String(data.status) : selectedCampaign.status;
      const refreshed = { ...selectedCampaign, status: nextStatus };
      void openCampaign(refreshed);
    }
  }
  async function controlCampaign(campaignId: string, action: "pause" | "cancel") {
    if (!supabase) return;
    const confirmed = await confirm({
      title: action === "pause" ? "Pause this campaign?" : "Cancel this campaign?",
      description: action === "pause"
        ? "The campaign pauses after the current recipient finishes. Remaining recipients stay queued."
        : "Queued recipients are skipped and cannot be sent by continuing this campaign.",
      confirmLabel: action === "pause" ? "Pause campaign" : "Cancel campaign",
      destructive: action === "cancel",
    });
    if (!confirmed) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("campaign-control", { body: { tenant_id: tenantId, campaign_id: campaignId, action } });
    setBusy(false);
    if (error || data?.error || data?.ok !== true || !["paused", "cancelled"].includes(String(data?.status))) {
      setNotice(data?.error ?? error?.message ?? `Campaign ${action} did not return a confirmed result.`);
      return;
    }
    setNotice(`Campaign ${data.status}.`);
    await loadWorkspace();
    if (selectedCampaign?.id === campaignId) void openCampaign({ ...selectedCampaign, status: String(data.status) });
  }
  async function openCampaign(campaign: Campaign) {
    setSelectedCampaign(campaign);
    setCampaignCounts(null);
    setCampaignFailures([]);
    setCampaignCountsError("");
    if (!supabase || !tenantId) return;
    const client = supabase;
    setCampaignCountsLoading(true);
    const baseCount = () => client.from("campaign_recipients").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("campaign_id", campaign.id);
    try {
      const [total, queued, needsReview, failures] = await Promise.all([
        baseCount(),
        baseCount().eq("status", "queued"),
        baseCount().in("status", ["failed", "outcome_unknown"]),
        client.from("campaign_recipients")
          .select("id,error_code,error_detail,contacts!campaign_recipients_contact_same_tenant_fk(display_name,phone_e164)")
          .eq("tenant_id", tenantId).eq("campaign_id", campaign.id).in("status", ["failed", "outcome_unknown"])
          .order("updated_at", { ascending: false }).limit(5),
      ]);
      const queryError = total.error ?? queued.error ?? needsReview.error ?? failures.error;
      if (queryError) {
        // A failed count must not masquerade as "no recipients queued".
        setCampaignCountsError("Recipient counts could not be loaded: " + queryError.message);
        return;
      }
      setCampaignCounts({ total: total.count ?? 0, queued: queued.count ?? 0, failed: needsReview.count ?? 0 });
      setCampaignFailures((failures.data ?? []) as CampaignFailure[]);
    } catch (cause) {
      console.error("MobiWave WA campaign detail load failed:", cause);
      setCampaignCountsError(cause instanceof Error ? cause.message : "Recipient counts could not be loaded. Close and reopen this campaign to retry.");
    } finally {
      setCampaignCountsLoading(false);
    }
  }
  async function sendReply(event: FormEvent) {
    event.preventDefault(); if (!supabase || !selectedConversation || !replyText.trim()) return;
    if (composerMode === "note") {
      setBusy(true);
      const { error } = await supabase.from("conversation_notes").insert({ tenant_id: tenantId, conversation_id: selectedConversation, author_id: user?.id, body: replyText.trim() });
      setBusy(false);
      if (error) setNotice("Could not add internal note: " + error.message);
      else { setReplyText(""); setNotice("Internal note added for your team."); }
      await loadMessages(); return;
    }
    const conversation = conversations.find((c) => c.id === selectedConversation);
    if (!conversation?.contacts?.phone_e164) { setNotice("Contact phone number not found."); return; }
    const messageText = replyText.trim();
    const fingerprintInput = JSON.stringify([tenantId, selectedConversation, conversation.contacts.phone_e164, messageText]);
    const fingerprintDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprintInput)));
    const fingerprint = [...fingerprintDigest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const pendingStorageKey = "mobiwave:pending-send:" + tenantId + ":" + selectedConversation;
    let persistedKeys: Record<string, string> = {};
    try { const stored = JSON.parse(localStorage.getItem(pendingStorageKey) ?? "{}"); if (stored && typeof stored === "object" && !Array.isArray(stored)) persistedKeys = stored as Record<string, string>; } catch { persistedKeys = {}; }
    const idempotencyKey = pendingSendKey?.fingerprint === fingerprint ? pendingSendKey.key : (persistedKeys[fingerprint] ?? crypto.randomUUID());
    persistedKeys[fingerprint] = idempotencyKey;
    while (Object.keys(persistedKeys).length > 50) delete persistedKeys[Object.keys(persistedKeys)[0]];
    try { localStorage.setItem(pendingStorageKey, JSON.stringify(persistedKeys)); } catch { /* in-memory key still protects this page session */ }
    setPendingSendKey({ fingerprint, key: idempotencyKey });
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("meta-send", {
      headers: { "Idempotency-Key": idempotencyKey },
      body: { tenant_id: tenantId, to: conversation.contacts.phone_e164, type: "text", text: messageText, idempotency_key: idempotencyKey },
    });
    setBusy(false);
    let resultData: any = data;
    const failureContext = (error as { context?: unknown } | null)?.context;
    const responseStatus = failureContext instanceof Response ? failureContext.status : 0;
    if (!resultData && failureContext instanceof Response) {
      try { resultData = await failureContext.clone().json(); } catch { resultData = null; }
    }
    if (responseStatus === 429) {
      delete persistedKeys[fingerprint];
      try { localStorage.setItem(pendingStorageKey, JSON.stringify(persistedKeys)); } catch { /* server rejection is definitive */ }
      setPendingSendKey(null);
    }
    if (error || resultData?.error || resultData?.ok !== true || resultData?.status !== "accepted" || typeof resultData?.message_id !== "string" || !resultData.message_id) {
      // Preserve the key after uncertain results so retrying cannot duplicate a provider submission.
      setNotice(resultData?.error ?? error?.message ?? "Send outcome could not be confirmed. Retry this same message to check its recorded outcome.");
    } else {
      setPendingSendKey(null);
      delete persistedKeys[fingerprint];
      try { localStorage.setItem(pendingStorageKey, JSON.stringify(persistedKeys)); } catch { /* server history remains authoritative */ }
      setReplyText("");
      setNotice(resultData.persistence_warning
        ? "Meta accepted the message, but MobiWave could not confirm all history or usage writes. Review Alerts; do not resend. Delivery confirmation will arrive separately."
        : "Message accepted by Meta. Delivery confirmation will arrive separately.");
    }
    await loadMessages(); await loadWorkspace();
  }
  async function resolveConversation(conversation: Conversation) {
    if (!supabase) return;
    const { data, error } = await supabase.functions.invoke("conversation-control", { body: { tenant_id: tenantId, conversation_id: conversation.id, action: "resolve" } });
    setNotice(error || data?.error || data?.ok !== true || data?.conversation?.status !== "resolved" ? (data?.error ?? error?.message ?? "Conversation resolution was not confirmed. Refresh the inbox and try again.") : "Conversation resolved."); await loadWorkspace();
  }
  async function assignConversation(conversation: Conversation, assignedTo: string) {
    if (!supabase) return;
    const { data, error } = await supabase.functions.invoke("conversation-control", { body: { tenant_id: tenantId, conversation_id: conversation.id, action: "assign", assigned_to: assignedTo || null } });
    if (error || data?.error || data?.ok !== true || data?.conversation?.id !== conversation.id) { setNotice(data?.error ?? error?.message ?? "Conversation assignment was not confirmed. Refresh the inbox and try again."); return; }
    setConversations((rows) => rows.map((row) => row.id === conversation.id ? { ...row, assigned_to: data.conversation.assigned_to ?? null } : row));
  }
  async function markConversationRead(conversationId: string) {
    if (!supabase || !user || !tenantId || !conversationId) return;
    const now = new Date().toISOString();
    const { error } = await supabase.from("conversation_reads").upsert({ tenant_id: tenantId, conversation_id: conversationId, user_id: user.id, last_read_at: now }, { onConflict: "tenant_id,conversation_id,user_id" });
    if (error) { setNotice("Could not update unread status: " + error.message); return; }
    setConversations((rows) => rows.map((row) => row.id === conversationId ? { ...row, unread: false } : row));
    void loadOverviewMetrics();
  }
  async function copyIntegrationValue(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setNotice(label + " copied."); }
    catch { setNotice("Clipboard unavailable. Select and copy the value manually."); }
  }
  async function generateMetaWebhookToken() {
    if (!supabase || !tenantId) return;
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const raw = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("meta-webhook-config", { body: { tenant_id: tenantId, verification_token: raw } });
    setBusy(false);
    if (error || data?.error || data?.ok !== true) { setNotice(data?.error ?? error?.message ?? "Meta webhook verification token was not saved. Try again."); return; }
    setMetaWebhookToken(raw);
    setMetaStatus((current: any) => current ? { ...current, webhook_verified_at: null, webhook_verification_source: null } : current);
    setNotice("New verification token saved. The previous callback verification has been reset; paste this token into Meta and verify the callback again.");
  }
  async function saveMeta(event: FormEvent) {
    event.preventDefault(); if (!supabase) return; setBusy(true);
    const { data, error } = await supabase.functions.invoke("meta-config", { body: { tenant_id: tenantId, phone_number_id: metaPhoneId.trim(), waba_id: metaWabaId.trim(), waba_timezone: metaWabaTimezone.trim(), access_token: metaToken.trim(), app_secret: metaAppSecret.trim() } });
    setBusy(false);
    if (error || data?.error || data?.ok !== true) setNotice(data?.error ?? error?.message ?? "Meta credentials were not confirmed as saved. Try again.");
    else { setMetaToken(""); setMetaAppSecret(""); setMetaAppSecretSaved(true); setMetaTokenSaved(true); setNotice("Client Meta credentials encrypted and saved. Verify the connection next."); await loadWorkspace(); }
  }
  async function verifyMeta() {
    if (!supabase || !tenantId) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("meta-verify", { body: { tenant_id: tenantId } });
    setBusy(false);
    if (error || data?.error || data?.ok !== true || data?.verified !== true || data?.enabled !== true) {
      setNotice(data?.error ?? error?.message ?? "Meta did not confirm an enabled connection. Check the credentials and try again.");
    } else {
      setNotice("Meta connection verified and messaging enabled.");
    }
    await loadWorkspace();
  }
  async function syncTemplates() {
    if (!supabase || !tenantId) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("meta-sync-templates", { body: { tenant_id: tenantId } });
    setBusy(false);
    if (error || data?.error || !Number.isFinite(Number(data?.synced))) {
      setNotice(data?.error ?? error?.message ?? "Template sync did not return a confirmed result. Check the Meta connection and try again.");
    } else {
      setNotice("Templates synced successfully: " + Number(data.synced) + " template(s).");
    }
    await loadWorkspace();
  }
  async function createWebhook(event: FormEvent) {
    event.preventDefault(); if (!supabase) return; setBusy(true); setNewWebhookSecret("");
    const { data, error } = await supabase.functions.invoke("manage-webhook", { body: { tenant_id: tenantId, action: "create", name: webhookName.trim(), endpoint_url: webhookUrl.trim(), events: webhookEvents } });
    setBusy(false);
    if (error || data?.error || data?.ok !== true || !data?.signing_secret || !data?.webhook?.id) setNotice(data?.error ?? error?.message ?? "Webhook creation was not confirmed. Check the webhook list before retrying.");
    else { setNewWebhookSecret(data.signing_secret); setWebhookUrl(""); setWebhookName("Support event receiver"); setNotice("Webhook created. Copy the signing secret now."); await loadWorkspace(); }
  }
  async function manageWebhook(webhook: TenantWebhook, action: "enable" | "disable" | "delete") {
    if (!supabase) return;
    if (action === "delete") {
      const deletionConfirmed = await confirm({
        title: "Delete this webhook?",
        description: "The subscription and its delivery history are removed. Events will no longer be delivered to this endpoint.",
        confirmLabel: "Delete webhook",
        destructive: true,
      });
      if (!deletionConfirmed) return;
    }
    const { data, error } = await supabase.functions.invoke("manage-webhook", { body: { tenant_id: tenantId, action, webhook_id: webhook.id } });
    const confirmed = action === "delete" ? data?.deleted === true : data?.enabled === (action === "enable");
    setNotice(error || data?.error || data?.ok !== true || !confirmed ? (data?.error ?? error?.message ?? "Webhook change was not confirmed. Refresh the list before retrying.") : action === "delete" ? "Webhook deleted." : "Webhook updated.");
    await loadWorkspace();
  }
  async function testWebhook(hook: TenantWebhook) {
    if (!supabase) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("manage-webhook", { body: { tenant_id: tenantId, action: "test", webhook_id: hook.id } });
    setBusy(false);
    setNotice(error || data?.error || data?.ok !== true || !data?.delivery_id ? (data?.error ?? error?.message ?? "Webhook test did not return a confirmed delivery result.") : data?.message ?? "Webhook test delivered successfully.");
    await loadWorkspace();
  }
  async function retryWebhookDelivery(delivery: WebhookDelivery) {
    if (!supabase) return;
    const confirmed = await confirm({
      title: "Retry this delivery?",
      description: "The event is queued and delivered again. If the endpoint already processed it, the receiver must deduplicate on X-MobiWave-Delivery.",
      confirmLabel: "Retry delivery",
    });
    if (!confirmed) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("manage-webhook", { body: { tenant_id: tenantId, action: "retry", delivery_id: delivery.id } });
    setBusy(false);
    setNotice(error || data?.error || data?.ok !== true || !data?.delivery_id ? (data?.error ?? error?.message ?? "Webhook retry did not return a confirmed delivery result.") : data?.message ?? "Webhook delivery retry completed successfully.");
    await loadWorkspace();
  }
  async function copyWebhookSecret() {
    try { await navigator.clipboard.writeText(newWebhookSecret); setNotice("Webhook signing secret copied."); }
    catch { setNotice("Clipboard unavailable. Select and copy the signing secret manually."); }
  }
  async function createApiKey(event: FormEvent) {
    event.preventDefault(); if (!supabase) return; setBusy(true); setNewApiKey("");
    const { data, error } = await supabase.functions.invoke("create-api-key", { body: { tenant_id: tenantId, name: apiKeyName.trim(), scopes: apiKeyScopes } });
    setBusy(false);
    if (error || data?.error || data?.ok !== true || typeof data?.api_key !== "string" || !data.api_key) setNotice(data?.error ?? error?.message ?? "API key creation was not confirmed. Check the key list before retrying.");
    else { setNewApiKey(data.api_key); setNewApiKeyClientId(data.key?.client_id ?? ""); setApiKeyName("Production integration"); setNotice("API key created. Copy it now; the secret will not be shown again."); await loadWorkspace(); }
  }
  async function revokeApiKey(key: ApiKey) {
    if (!supabase) return;
    const confirmed = await confirm({
      title: `Revoke “${key.name}”?`,
      description: "Requests using this key stop working immediately. The key cannot be restored.",
      confirmLabel: "Revoke key",
      destructive: true,
    });
    if (!confirmed) return;
    const { data, error } = await supabase.from("tenant_api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", key.id).eq("tenant_id", tenantId).select("id").maybeSingle();
    setNotice(error ? error.message : data ? "API key revoked." : "API key was not found in this workspace; no changes were made."); await loadWorkspace();
  }
  async function copyApiKey() {
    if (!newApiKey) return;
    try { await navigator.clipboard.writeText(newApiKey); setNotice("API key copied to clipboard."); }
    catch { setNotice("Copy is unavailable. Select and copy the displayed key manually."); }
  }
  async function saveProfile(event: FormEvent) {
    event.preventDefault(); if (!supabase) return;
    setBusy(true);
    const updates: { data?: Record<string, unknown>; password?: string } = { data: { full_name: profileName.trim() } };
    if (newPassword.trim()) updates.password = newPassword;
    const { error } = await supabase.auth.updateUser(updates);
    setBusy(false);
    if (error) { setNotice("Could not update profile: " + error.message); return; }
    setNewPassword(""); setNotice("Profile updated successfully.");
    const { data } = await supabase.auth.getUser(); if (data.user) setUser(data.user);
  }
  async function signOut() {
    if (!supabase) return;
    const signedOutUserId = user?.id;
    const { error } = await supabase.auth.signOut();
    if (error) { setNotice("Could not sign out: " + error.message); return; }
    if (signedOutUserId) await clearUserMediaCache(signedOutUserId);
    clearWorkspaceUiState();
    setTenants([]);
    setTenantId("");
    setPlatformRole(null);
    setTenantLoading(false);
  }
  const filteredContacts = contacts;
  const unreadCount = conversations.filter((conversation) => conversation.unread).length;
  const pageConsent = contacts.reduce<Record<string, number>>((counts, contact) => {
    counts[contact.consent_status] = (counts[contact.consent_status] ?? 0) + 1;
    return counts;
  }, {});
  const filteredConversations = useMemo(() => conversations.filter((conversation) => {
    const matchesStatus = conversationStatusFilter === "all" || (conversationStatusFilter === "unread" ? Boolean(conversation.unread) : conversation.status === conversationStatusFilter);
    const matchesAssignee = conversationAssigneeFilter === "all" || (conversationAssigneeFilter === "mine" ? conversation.assigned_to === user?.id : conversationAssigneeFilter === "unassigned" ? !conversation.assigned_to : conversationAssigneeFilter === conversationAssigneeFilter ? conversation.assigned_to === conversationAssigneeFilter : true);
    const haystack = `${conversation.contacts?.display_name ?? ""} ${conversation.contacts?.phone_e164 ?? ""}`.toLowerCase();
    return matchesStatus && matchesAssignee && haystack.includes(debouncedConversationSearch.toLowerCase());
  }), [conversations, conversationStatusFilter, conversationAssigneeFilter, debouncedConversationSearch, user?.id]);
  const approvedTemplates = templates.filter((t) => t.meta_status === "approved");
  const selectedTemplate = templates.find((template) => template.id === campaignTemplate);
  const selectedTemplateParts = getTemplateParts(selectedTemplate);
  const unsupportedMediaHeader = Boolean(selectedTemplate?.components?.some((component) => String(component?.type).toLowerCase() === "header" && component?.format && String(component.format).toUpperCase() !== "TEXT"));
  // Public routes are available without authentication; account access starts at /login.
  if (pathname === "/pricing") return <Suspense fallback={<div className="auth-screen" role="status">Loading pricing…</div>}><PricingPage /></Suspense>;
  if (pathname === "/") return <Suspense fallback={<div className="auth-screen" role="status">Loading MobiWave WA…</div>}><LandingPage /></Suspense>;
  const knownRoute = pathname === "/login"
    || pathname === "/dashboard"
    || (pathname.startsWith("/dashboard/") && routedView !== null)
    || pathname === "/admin"
    || pathname.startsWith("/admin/");
  if (!knownRoute) return <ErrorPage kind="not-found" />;
  if (!isSupabaseConfigured) return <div className="auth-screen"><div className="auth-card"><Brand/><h1 className="mt-6 text-[24px] font-extrabold text-text">Connect your account</h1><p className="mt-2 text-sm leading-relaxed text-text-muted">Configure the Supabase URL and publishable/anon key in <code className="rounded-md bg-raised px-1.5 py-0.5 text-[13px] text-text">.env.local</code> before running the dashboard.</p><pre className="mt-4 overflow-x-auto rounded-xl bg-midnight-950 p-4 text-[12.5px] leading-relaxed text-brand-200">{`VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-key`}</pre><a className="btn btn-primary mt-5" href="https://github.com/malingib/Mobiwave-WA/blob/main/docs/environment-and-deployment.md">Deployment guide <ArrowUpRight size={14} /></a></div></div>;
  if (authLoading) return <div className="auth-screen" role="status"><LoaderCircle className="spin text-brand-400" size={26} /><span className="text-sm text-text-muted">Loading secure session…</span></div>;
  if (!session || !user) {
    if (window.location.pathname !== "/login") return <Suspense fallback={<div className="auth-screen" role="status">Loading MobiWave WA…</div>}><LandingPage /></Suspense>;
    return <div className="auth-page">
      <a className="auth-back-home" href="/" aria-label="Back to MobiWave WA home"><ArrowLeft size={15}/> Back to website</a>
      <div className="auth-layout">
        <section className="auth-story">
          <a className="auth-story-brand" href="/" aria-label="MobiWave WA home"><img src="/branding/mw-logo.svg" alt="MobiWave" /></a>
          <div className="auth-story-content">
            <h1>Better conversations.<br/><em>Stronger relationships.</em></h1>
            <p>Manage customer conversations from one official WhatsApp number, organize contacts and send approved-template campaigns.</p>
          </div>
          <div className="auth-story-footer"><ShieldCheck size={15}/> Official Meta Cloud API connectivity <span>·</span> Built by MobiWave Innovations Ltd</div>
        </section>
        <section className="auth-form-side">
          <form className="auth-form-card" onSubmit={forgotMode ? sendPasswordReset : signIn}>
            <div className="auth-mobile-brand"><Brand /></div>
            <h2>{forgotMode ? "Reset your password" : authMode === "signin" ? "Welcome back" : "Create your account"}</h2>
            <p className="auth-form-description">{forgotMode ? "Enter the email address linked to your account and we’ll send a password-reset link if it exists." : authMode === "signin" ? "Pick up where your team left off." : "Create an account to set up your business account."}</p>
            <label htmlFor="auth-email">Work email</label>
            <div className="auth-input-wrap"><Mail size={17}/><input id="auth-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required placeholder="you@company.co.ke" /></div>
            {!forgotMode && <>
              <div className="auth-password-label"><label htmlFor="auth-password">Password</label>{authMode === "signin" && <button type="button" className="auth-text-link" onClick={() => { setForgotMode(true); setNotice(""); }}>Forgot password?</button>}</div>
              <div className="auth-input-wrap"><LockKeyhole size={17}/><input id="auth-password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} minLength={authMode === "signup" ? 8 : undefined} autoComplete={authMode === "signin" ? "current-password" : "new-password"} required placeholder={authMode === "signin" ? "Enter your password" : "At least 8 characters"} /><button type="button" className="auth-password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div>
            </>}
            <button className="auth-submit" disabled={busy}>{busy ? "Please wait…" : forgotMode ? "Send reset link" : authMode === "signin" ? "Sign in securely" : "Create account"} <ArrowUpRight size={16}/></button>
            {notice && <div className="auth-feedback" role="status">{notice}</div>}
            {forgotMode ? <button type="button" className="auth-mode-switch" onClick={() => { setForgotMode(false); setNotice(""); }}> <ArrowLeft size={14}/> Back to sign in</button> : <div className="auth-mode-prompt"><span>{authMode === "signin" ? "New to MobiWave WA?" : "Already have an account?"}</span><button type="button" className="auth-text-link" onClick={() => { setAuthMode(authMode === "signin" ? "signup" : "signin"); setNotice(""); setForgotMode(false); }}>{authMode === "signin" ? "Create an account" : "Sign in instead"}</button></div>}
            <div className="auth-assurance"><ShieldCheck size={15}/><span>Your business account is protected by authenticated access and separate account data.</span></div>
          </form>
          <div className="auth-form-legal"><a href="/">MobiWave WA</a><span>·</span><a href="https://mobiwave.co.ke/">MobiWave Innovations</a><span>·</span><span>© 2026</span></div>
        </section>
      </div>
    </div>;
  }
  if (tenantLoading) return <div className="auth-screen" role="status"><LoaderCircle className="spin" /><span>Loading your inbox…</span></div>;
  const isPlatformRoute = pathname === "/admin" || pathname.startsWith("/admin/");
  if (isPlatformRoute && !platformRole) return <ErrorPage kind="forbidden" />;
  if (platformRole && (isPlatformRoute || !tenants.length)) return <Suspense fallback={<div className="auth-screen" role="status">Loading platform console…</div>}><PlatformConsole
    user={user}
    role={platformRole}
    hasClientWorkspace={tenants.length > 0}
    clientWorkspaceHref={tenants[0] ? `/dashboard?tenant=${tenants[0].id}` : undefined}
    onSignOut={() => void signOut()}
  /></Suspense>;
  if (tenantError) return <div className="auth-screen"><div className="auth-card"><Brand /><h1>Could not load your account</h1><p>We couldn’t verify your business access. Your account setup has not been changed.</p><div className="inline-notice" role="alert">{tenantError}</div><button type="button" className="primary-button full" onClick={() => void loadTenants()}>Try again</button><button type="button" className="auth-switch" onClick={() => void signOut()}>Sign out</button></div></div>;
  if (!tenants.length) return <div className="auth-screen"><form className="auth-card" onSubmit={createWorkspace}><Brand /><div className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-600">First-time setup</div><h1>Set up your business</h1><p>Create your business account to keep contacts, WhatsApp connection, campaigns and team access separate.</p><label htmlFor="workspace-name">Business name</label><input id="workspace-name" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} required minLength={2} maxLength={160} placeholder="e.g. MobiWave Demo" /><button className="primary-button full" disabled={busy}>{busy ? "Setting up…" : "Set up business"}</button>{notice && <div className="inline-notice" role="status">{notice}</div>}<button type="button" className="auth-switch" onClick={signOut}>Sign out</button></form></div>;
  return <div className="app-shell">
    {mobileNavOpen && <button type="button" className="fixed inset-0 z-30 bg-[color:var(--color-midnight-950)]/35 backdrop-blur-sm lg:hidden" aria-label="Close navigation menu" onClick={() => setMobileNavOpen(false)} />}
    <aside
      id="primary-navigation"
      ref={(node) => { navRef.current = node; if (node) node.inert = !desktopNav && !mobileNavOpen; }}
      className={
        "fixed inset-y-0 left-0 z-40 flex h-dvh w-[250px] shrink-0 flex-col border-r border-hairline bg-surface transition-transform duration-200 ease-out lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 " +
        (mobileNavOpen ? "translate-x-0 shadow-raised" : "-translate-x-full")
      }
    >
      <div className="flex items-center justify-between gap-2 px-5 pb-3 pt-5">
        <Brand />
        <button type="button" className="icon-btn lg:hidden" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}>
          <X size={17} />
        </button>
      </div>

      <div className="px-4 py-2">
        {tenants.length > 1 ? (
          <div className="relative flex items-center gap-2 rounded-lg border border-hairline bg-raised p-2">
            <div className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-brand-600 text-[11px] font-bold text-white">
              {activeTenant?.name.slice(0, 2).toUpperCase() ?? "MW"}
            </div>
            <select
              className="h-9 w-full min-w-0 appearance-none rounded-lg border border-hairline-strong bg-surface px-2 pr-7 text-[12.5px] font-medium text-text"
              value={tenantId}
              onChange={(e) => { setTenantId(e.target.value); setSelectedConversation(""); }}
              aria-label="Switch business account"
            >
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-4 text-text-faint" />
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-hairline bg-raised p-2">
            <div className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-brand-600 text-[11px] font-bold text-white">
              {activeTenant?.name.slice(0, 2).toUpperCase() ?? "MW"}
            </div>
            <div className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-semibold text-text">{activeTenant?.name ?? "MobiWave WA"}</span>
              <span className="block text-[10.5px] text-text-faint">Business account</span>
            </div>
            <span className="flex-none rounded bg-brand-50 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.08em] text-brand-700">{activeTenant?.role ?? "Member"}</span>
          </div>
        )}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-4 pb-4" aria-label="Workspace navigation">
        {navigation.map(({ section, items }) => (
          <div key={section} className="nav-section">
            <div className="nav-heading">{section}</div>
            {items.map((item) => {
              const feature = viewTierFeature[item.label];
              const available = !feature || tierFeatureAvailable(feature);
              return <button
                key={item.label}
                type="button"
                className={(view === item.label ? "nav-item active mt-0.5" : "nav-item mt-0.5") + (available ? "" : " is-unavailable")}
                aria-label={item.label}
                aria-current={view === item.label ? "page" : undefined}
                aria-disabled={!available}
                title={available ? undefined : `${item.label} is not included in this active tier`}
                onClick={() => {
                  if (!available) { setNotice(`${item.label} is not included in this workspace’s active tier.`); return; }
                  goTo(item.label);
                }}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
                {item.label === "Inbox" && unreadCount > 0 && (
                  <span className="nav-count">{unreadCount}</span>
                )}
                {!available && <LockKeyhole className="ml-auto" size={13} aria-label="Not included in tier" />}
              </button>;
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-hairline px-4 py-3">
        {platformRole && <a href="/admin" className="platform-console-link">
          <ShieldCheck size={16} className="flex-none" />
          <span className="min-w-0 flex-1"><strong>Platform console</strong><small>Service operator view</small></span>
          <ArrowUpRight size={14} className="flex-none" />
        </a>}
        <a
          href="/pricing"
          className="upgrade-card mb-2 block rounded-xl border border-brand-100 bg-brand-50 p-3 transition-colors hover:bg-brand-100"
        >
          <strong className="block font-display text-[13px] font-bold text-text">Upgrade to Pro</strong>
          <span className="mt-1 block text-[11px] leading-relaxed text-text-muted">
            Unlock more messages, advanced analytics and priority support.
          </span>
          <span className="btn btn-primary btn-pill mt-3 h-8 w-full text-[11.5px]">
            Upgrade Now <ArrowUpRight size={13} />
          </span>
        </a>
        <div className="flex items-center gap-2.5 rounded-lg border border-hairline bg-raised p-2">
          <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-brand-600 text-[12px] font-bold text-white">
            {user.email?.slice(0, 1).toUpperCase() ?? "U"}
          </div>
          <div className="min-w-0 flex-1">
            <strong className="block truncate text-[11.5px] font-semibold text-text">{user.email}</strong>
            <span className="block text-[10.5px] capitalize text-text-muted">{activeTenant?.role ?? "Member"}</span>
          </div>
          <button type="button" className="icon-btn" onClick={() => void signOut()} aria-label="Sign out"><LogOut size={16} /></button>
        </div>
      </div>
    </aside>

    <main className="main">
      <header className="topbar">
        <button
          type="button"
          className="icon-btn lg:hidden"
          aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
          aria-controls="primary-navigation"
          aria-expanded={mobileNavOpen}
          onClick={() => setMobileNavOpen((open) => !open)}
        >
          <Menu size={19} />
        </button>
        <div className="topbar-search">
          <Search size={15}/>
          <input
            aria-label="Search contacts"
            value={contactSearch}
            onChange={(e) => { setContactSearch(e.target.value); setContactPage(0); if (view !== "Contacts") goTo("Contacts"); }}
            placeholder="Search contacts…"
          />
        </div>
        <span className="topbar-status-pill">
          {metaStatus?.enabled && metaStatus?.verified ? "Open conversations" : "Setup required"}
          <strong>{unreadCount ?? 0}</strong>
        </span>
        <div className="top-actions">
          <span className={metaStatus?.enabled && metaStatus?.verified ? "environment is-connected" : "environment is-disconnected"}>
            <span className="status-dot" /> {metaStatus?.enabled ? "WhatsApp connected" : "WhatsApp not connected"}
          </span>
          <div className="relative">
            <button 
              type="button" 
              className="icon-btn relative" 
              aria-label="Open alerts" 
              onClick={() => setAlertsDropdownOpen(!alertsDropdownOpen)}
            >
              <Bell size={17} />
              {notificationUnread > 0 && (
                <span className="absolute right-1 top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-danger px-1 text-[8.5px] font-bold text-white">
                  {notificationUnread}
                </span>
              )}
            </button>
            
            {alertsDropdownOpen && (
              <div className="alerts-dropdown">
                <div className="alerts-dropdown-header">
                  <div className="alerts-dropdown-title">
                    <Bell size={14} />
                    <span>Notifications</span>
                  </div>
                  <div className="alerts-dropdown-count">
                    {notificationUnread > 0 && (
                      <span className="alert-count">{notificationUnread} alerts</span>
                    )}
                  </div>
                </div>
                
                <div className="alerts-dropdown-content">
                  {notificationUnread > 0 && (
                    <div className="alerts-section">
                      <div className="alerts-section-title">Alerts</div>
                      {notifications.slice(0, 3).map((notification) => (
                        <div 
                          key={notification.id} 
                          className={`alert-item ${notification.read_at ? "read" : "unread"}`}
                          onClick={() => {
                            if (!notification.read_at) {
                              markNotificationRead(notification.id);
                            }
                          }}
                        >
                          <div className="alert-content">
                            <div className="alert-text">{notification.body}</div>
                            <div className="alert-time">{new Date(notification.created_at).toLocaleDateString()}</div>
                          </div>
                        </div>
                      ))}
                      {notifications.length > 3 && (
                        <div className="alert-view-all">
                          <button onClick={handleViewAllAlerts}>View all alerts</button>
                        </div>
                      )}
                    </div>
                  )}
                  

                  
                  {notificationUnread === 0 && (
                    <div className="no-alerts">
                      <p>No new notifications</p>
                    </div>
                  )}
                </div>
                
                <div className="alerts-dropdown-footer">
                  <button 
                    className="alerts-dropdown-action" 
                    onClick={handleMarkAsRead}
                    disabled={notificationUnread === 0}
                  >
                    <Check size={14} />
                    Mark all read
                  </button>
                  <button className="alerts-dropdown-action" onClick={handleViewAllAlerts}>
                    View all
                  </button>
                </div>
              </div>
            )}
          </div>
          <button type="button" className="icon-btn" aria-label="Refresh" onClick={() => void loadWorkspace()}>
            <RefreshCw size={17} className={loading ? "spin" : ""} />
          </button>
          <button type="button" className="topbar-profile" aria-label="Open profile" onClick={() => goTo("Profile")}>
            <span className="topbar-profile-copy">
              <strong>{user.email?.split("@")[0] ?? "Account"}</strong>
              <small className="capitalize">{activeTenant?.role ?? "Member"}</small>
            </span>
            <span className="mini-avatar">{user.email?.slice(0, 1).toUpperCase()}</span>
          </button>
        </div>
      </header>
      <div className="page-crumbs" aria-label="Breadcrumb">
        <span>Home</span>
        <ChevronRight aria-hidden />
        {activeTenant && <><span>{activeTenant.name}</span><ChevronRight aria-hidden /></>}
        <strong>{view}</strong>
      </div>
      {view === "Overview" && <section className="content"><Suspense fallback={<div className="panel" role="status">Loading overview…</div>}>
        <Overview
          conversations={conversations}
          dailyMessages={dailyMessages}
          metrics={overviewMetrics}
          metricsError={overviewMetricsError}
          metricsLoading={overviewMetricsLoading}
          metaStatus={metaStatus}
          onNavigate={(next) => goTo(next as View)}
          onOpenConversation={(conversationId) => { setSelectedConversation(conversationId); goTo("Inbox"); }}
        />
      </Suspense></section>}
      {view === "Contacts" && <section className="content"><PageHeading eyebrow="CUSTOMER DATA" title="Contacts" description="Store consent and suppression status before using contacts for campaigns."/>
        <div className="consent-summary">
          <span className="consent-summary-label">This page</span>
          {(["opted_in", "opted_out", "unknown"] as const).map((status) => (
            <span className="consent-summary-chip" key={status}><Status status={status}/><b>{pageConsent[status] ?? 0}</b></span>
          ))}
          <span className="consent-summary-note">Only opted-in contacts are eligible for campaign delivery.</span>
        </div>
        {isAdmin&&<div className="panel-grid-2"><Suspense fallback={<div className="panel" role="status">Loading contact import…</div>}><ContactCsvImport tenantId={tenantId} onImported={() => void loadWorkspace()}/></Suspense>
        <form className="panel form-panel" onSubmit={addContact}><h2>Add contact</h2><div className="form-grid"><div className="field"><label htmlFor="contact-phone">Phone number (E.164) *</label><input id="contact-phone" value={contactPhone} onChange={(e)=>setContactPhone(e.target.value)} required pattern="\+[1-9][0-9]{7,14}" placeholder="+2547XXXXXXXX"/></div><div className="field"><label htmlFor="contact-name">Display name</label><input id="contact-name" value={contactName} onChange={(e)=>setContactName(e.target.value)} placeholder="Customer name"/></div></div><label className="checkbox-line"><input type="checkbox" checked={contactOptIn} onChange={(e)=>setContactOptIn(e.target.checked)}/> I have verifiable permission to send WhatsApp messages to this contact.</label>{contactOptIn&&<div className="field"><label htmlFor="contact-consent-source">Consent source / record *</label><input id="contact-consent-source" value={contactConsentSource} onChange={(e)=>setContactConsentSource(e.target.value)} required placeholder="e.g. website signup form, 2026-10-16"/></div>}<div className="form-actions"><span className="muted small">Unconfirmed contacts are not eligible for campaigns.</span><button className="primary-button" disabled={busy}><Plus size={15}/> Add contact</button></div></form></div>}
        <div className="section-header">
          <div><h2>Contact list</h2><p>{contacts.length ? `Showing ${contactPage * 100 + 1}–${contactPage * 100 + contacts.length} of ${totalContacts} contact(s)` : `${totalContacts} contact(s)`}</p></div>
          <div className="search-field"><Search size={16}/><input aria-label="Search contacts" value={contactSearch} onChange={(e)=>{setContactSearch(e.target.value);setContactPage(0);}} placeholder="Search all contacts…"/></div>
        </div>
        <div className="source-list">
          <div className="source-table-head contact-head"><span>CONTACT</span><span>CONSENT</span><span>SOURCE</span><span>HISTORY / ACTION</span></div>
          {contactsLoading?<Empty icon={<LoaderCircle size={22} className="spin"/>} title={contactSearch.trim()?"Searching contacts":"Loading contacts"} text="Contact results will appear here."/>:filteredContacts.length===0?<Empty icon={<Users size={24}/>} title={contactSearch.trim()?"No matching contacts":"No contacts yet"} text={contactSearch.trim()?"Try a different name or phone number.":"Add a contact to start building your consent based audience."}/>:filteredContacts.map(c=><div className="source-row contact-row" key={c.id}>
            <div className="source-main"><div className="source-icon"><Users size={17}/></div><div className="source-text"><strong>{c.display_name||"Unnamed contact"}</strong><span className="contact-phone">{c.phone_e164}</span></div></div>
            <div><Status status={c.consent_status}/></div><div className="source-added">{c.consent_source||"No consent record"}</div>
            <div className="row-actions contact-actions">
              <button type="button" className="secondary-button compact" onClick={()=>void showConsentHistory(c)}>History</button>
              {isAdmin&&c.consent_status!=="opted_in"&&<button type="button" className="secondary-button compact" onClick={()=>{setConsentTarget(consentTarget===c.id?"":c.id);setConsentRecordSource("");}}>Record opt-in</button>}
              {isAdmin&&c.consent_status!=="opted_out"&&<button type="button" className="secondary-button compact" onClick={()=>void optOut(c)}>Suppress</button>}
              {consentTarget===c.id&&<form className="consent-inline" onSubmit={(event)=>void recordOptIn(c,event)}><label htmlFor="consent-evidence">Evidence or source *</label><input id="consent-evidence" required value={consentRecordSource} onChange={(event)=>setConsentRecordSource(event.target.value)} placeholder="Form, date, or recorded request"/><button className="primary-button compact">Save opt-in</button></form>}
            </div>
          </div>)}
        </div>
        <div className="pagination-controls"><button className="secondary-button compact" disabled={contactPage===0} onClick={()=>setContactPage((page)=>Math.max(0,page-1))}>Previous</button><span>Page {contactPage+1}</span><button className="secondary-button compact" disabled={!contactHasMore} onClick={()=>setContactPage((page)=>page+1)}>Next</button></div>
        {searchContactHistory&&<div className="panel form-panel consent-history"><div className="section-header"><div><h2>Consent history · {searchContactHistory.contact.display_name||searchContactHistory.contact.phone_e164}</h2><p>Latest 50 opt-in and opt-out changes</p></div><button className="secondary-button compact" onClick={()=>setSearchContactHistory(null)}>Close</button></div>{searchContactHistory.events.length?searchContactHistory.events.map(event=><div className="consent-event" key={event.id}><Status status={event.consent_status}/><span>{event.previous_status?event.previous_status+" → ":""}{event.consent_status}</span><span>{event.consent_source||"No source recorded"}</span><time>{new Date(event.changed_at).toLocaleString()}</time></div>):<p className="muted small">No consent changes have been recorded.</p>}</div>}
      </section>}
      {view === "Alerts" && <section className="content">
        <PageHeading eyebrow="WORKSPACE MONITORING" title="Alerts" description="Delivery failures and operational issues reported by the official WhatsApp Cloud API."/>
        <div className="panel">
          <div className="section-toolbar"><div><strong>{notificationUnread} unread alerts</strong><p className="muted small">Alerts are scoped to this business account and your workspace membership.</p></div><div className="row-actions"><button className="secondary-button compact" onClick={()=>void loadNotifications()}><RefreshCw size={14}/> Refresh</button><button className="secondary-button compact" onClick={()=>void markAllNotificationsRead()} disabled={notificationUnread===0}>Mark all read</button></div></div>
          {notifications.length===0 ? <Empty icon={<Bell size={22}/>} title="No alerts yet" text="Billing reminders, subscription updates, provider delivery failures and send errors will appear here."/> : <div className="notification-list" role="list" aria-label="Workspace alerts">{notifications.map((item)=><article role="listitem" className={"notification-item "+(item.read_at?"is-read":"is-unread")} key={item.id}><div className={"notification-severity "+item.severity}>{item.severity}</div><div className="notification-copy"><div className="notification-heading"><strong>{item.title}</strong><time>{new Date(item.created_at).toLocaleString()}</time></div><p>{item.body}</p>{item.metadata?.error_code&&<small>Error code: {String(item.metadata.error_code)}</small>}{item.metadata?.error_title&&<small>{String(item.metadata.error_title)}</small>}{item.entity_id&&<small>Reference: {item.entity_id}</small>}</div>{!item.read_at&&<button className="secondary-button compact" onClick={()=>void markNotificationRead(item.id)}>Mark read</button>}</article>)}</div>}
        </div>
      </section>}
      {view === "Templates" && <Suspense fallback={<section className="content"><div className="panel" role="status">Loading templates…</div></section>}><TemplatesPage tenantId={tenantId} isAdmin={isAdmin} metaConnected={Boolean(metaStatus?.enabled && metaStatus?.verified)} onNotice={setNotice}/></Suspense>}
      {view === "Campaigns" && <section className="content"><PageHeading eyebrow="OUTBOUND MESSAGING" title="Campaigns" description="Campaigns use only Meta-approved templates and contacts with recorded opt-in consent."/>
        {isAdmin&&<form className="panel form-panel" onSubmit={createCampaign}>
          <h2>Create campaign</h2>
          <div className="form-grid">
            <div className="field"><label htmlFor="campaign-name">Campaign name *</label><input id="campaign-name" value={campaignName} onChange={(e)=>setCampaignName(e.target.value)} required maxLength={180} placeholder="October customer update"/></div>
            <div className="field"><label htmlFor="campaign-schedule">Schedule (optional)</label><input id="campaign-schedule" type="datetime-local" value={campaignScheduledAt} onChange={(e)=>setCampaignScheduledAt(e.target.value)}/><small className="muted">Leave blank for a manual draft. Scheduled campaigns send in 10-recipient batches.</small></div>
          </div>
          <div className="field"><label htmlFor="campaign-template">Approved template *</label><select id="campaign-template" value={campaignTemplate} onChange={(e)=>{setCampaignTemplate(e.target.value);setCampaignVariableValues({});}} required><option value="">Choose template…</option>{approvedTemplates.map(t=><option value={t.id} key={t.id}>{t.meta_template_name} · {t.language_code}</option>)}</select>{approvedTemplates.length===0&&<small className="muted">No approved templates found. Connect Meta and sync templates in Integrations.</small>}</div>
          {unsupportedMediaHeader&&<div className="inline-notice" role="status">This template has a media header. The campaign composer currently supports text headers, body variables, and URL button variables.</div>}
          {selectedTemplateParts.length>0&&<div className="template-variable-panel"><strong>Personalize this template</strong><p>These values will be the same for every selected recipient.</p>{selectedTemplateParts.map(part=><div className="template-variable-part" key={part.componentIndex}><small>{part.type.toUpperCase()} preview</small><p>{(()=>{let placeholderIndex=0;return part.text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,(match)=>campaignVariableValues[part.componentIndex+":"+(placeholderIndex++)]?.trim()||match);})()}</p>{part.variables.map((variable,index)=><div className="field" key={part.componentIndex+":"+index}><label htmlFor={`campaign-variable-${part.componentIndex}-${index}`}>{part.type==="body"?"Body":part.type==="header"?"Header":"Button URL"} · {'{{'+variable+'}}'}</label><input id={`campaign-variable-${part.componentIndex}-${index}`} required value={campaignVariableValues[part.componentIndex+":"+index]??""} onChange={(e)=>setCampaignVariableValues((values)=>({...values,[part.componentIndex+":"+index]:e.target.value}))} placeholder={'Value for '+variable}/></div>)}</div>)}</div>}
          <div className="field campaign-recipient-field"><label htmlFor="campaign-recipient-search">Find opted-in recipients</label><p className="field-hint">Only contacts with recorded opt-in are listed. Selected contacts stay selected as you move between pages.</p><div className="search-field"><Search size={16}/><input id="campaign-recipient-search" aria-label="Search opted-in recipients" value={campaignSearch} onChange={(e)=>{setCampaignSearch(e.target.value);setCampaignRecipientsPage(0);}} placeholder="Search name or phone"/></div><div className="contact-select">{campaignRecipientsLoading?<div className="contact-search-state"><LoaderCircle size={15} className="spin"/> Loading recipients…</div>:campaignRecipients.map(c=><label key={c.id} className="checkbox-line"><input type="checkbox" checked={campaignContacts.includes(c.id)} onChange={(e)=>setCampaignContacts(list=>e.target.checked?[...list,c.id]:list.filter(id=>id!==c.id))}/><span className="campaign-contact-name">{c.display_name||"Unnamed contact"}<small>{c.phone_e164}</small></span></label>)}{!campaignRecipientsLoading&&campaignRecipients.length===0&&<div className="contact-search-state">{campaignSearch.trim()?"No opted-in contacts match this search.":"No opted-in contacts on this page."}</div>}</div><div className="pagination-controls compact-pagination"><button type="button" className="secondary-button compact" disabled={campaignRecipientsPage===0} onClick={()=>setCampaignRecipientsPage(page=>Math.max(0,page-1))}>Previous</button><span>Page {campaignRecipientsPage+1} of {Math.max(1, Math.ceil(campaignRecipientsTotal/100))} · {campaignRecipientsTotal} eligible</span><button type="button" className="secondary-button compact" disabled={!campaignRecipientsHasMore} onClick={()=>setCampaignRecipientsPage(page=>page+1)}>Next</button></div></div>
          <div className="form-actions"><span className="muted small">{campaignContacts.length} recipient(s) selected</span><button className="primary-button" disabled={busy}><Plus size={15}/> Save draft</button></div>
        </form>}
        <div className="section-header"><div><h2>Campaign history</h2><p>Batches send automatically in groups of 10 until the campaign finishes.</p></div></div>
        <div className="campaign-safety-chips"><span><ShieldCheck size={12}/> Approved templates only</span><span><Users size={12}/> Opted-in audience</span><span><RefreshCw size={12}/> Auto-batched sending</span></div>
        <div className="source-list"><div className="source-table-head campaign-head"><span>CAMPAIGN</span><span>STATUS</span><span>CREATED</span><span/></div>{campaigns.length===0?<Empty icon={<Zap size={24}/>} title="No campaigns" text="Create a campaign draft above."/>:campaigns.map(c=><div className="source-row campaign-row" key={c.id}><div className="source-main"><div className="source-icon"><Zap size={17}/></div><div className="source-text"><button type="button" className="campaign-name-button" onClick={()=>void openCampaign(c)}>{c.name}</button><small>{templates.find(t=>t.id===c.template_id)?.meta_template_name||"Template unavailable"}</small></div></div><div><Status status={c.status==="draft"&&c.scheduled_at?"scheduled":c.status}/></div><div className="source-added">{c.status==="draft"&&c.scheduled_at?new Date(c.scheduled_at).toLocaleString():new Date(c.created_at).toLocaleDateString()}</div><div className="row-actions"><button className="secondary-button compact" onClick={()=>void openCampaign(c)}>Details</button>{isAdmin&&["draft","paused","running"].includes(c.status)&&<button className="secondary-button compact" aria-label={`${c.status==="running"?"Continue":"Send"} campaign batch: ${c.name}`} onClick={()=>void launchCampaign(c.id)} disabled={busy || tenantPlan?.can_send === false}>{c.status==="running"?"Continue batch":"Send batch"} <ArrowUpRight size={13}/></button>}</div></div>)}</div>
      </section>}
      {view === "Inbox" && <section className="content inbox-content">
        <div className="inbox-page-header"><div><h1>Inbox</h1><p>{metaStatus?.display_phone_number ? `WhatsApp conversations for ${metaStatus.display_phone_number}` : "Conversations with your WhatsApp contacts"}</p></div>{metaStatus?.enabled && <span className="inbox-number-pill"><span className="status-dot"/>{metaStatus.display_phone_number || "WhatsApp number connected"}</span>}</div>
        <div className={selectedConversation ? "inbox-layout has-selection" : "inbox-layout"}>
          <div className="conversation-list">
            <div className="inbox-list-title"><strong>Conversations</strong><span>{filteredConversations.length} loaded · {unreadCount} unread loaded</span></div>
            <div className="inbox-filters">
              <div className="search-field"><Search size={14}/><input aria-label="Search conversations" value={conversationSearch} onChange={e=>setConversationSearch(e.target.value)} placeholder="Search name or phone"/></div>
              <div className="inbox-filter-row">
                <div className="inbox-status-tabs" role="group" aria-label="Filter by status">
                  {[["open", "Open"], ["pending", "Pending"], ["resolved", "Resolved"], ["unread", "Unread"], ["all", "All"]].map(([value, label]) => (
                    <button key={value} type="button" className={conversationStatusFilter === value ? "active" : ""} aria-pressed={conversationStatusFilter === value} onClick={() => setConversationStatusFilter(value)}>{label}</button>
                  ))}
                </div>
                <select aria-label="Filter by assignee" value={conversationAssigneeFilter} onChange={e=>setConversationAssigneeFilter(e.target.value)}><option value="all">All assignments</option><option value="mine">Assigned to me</option><option value="unassigned">Unassigned</option>{teamMembers.map(member=><option key={member.user_id} value={member.user_id}>{member.name}</option>)}</select>
              </div>
            </div>
            {filteredConversations.length===0?<Empty icon={<MessageCircle size={22}/>} title={conversations.length?"No matching conversations":"No conversations yet"} text={conversations.length?"Try changing your search or filters.":isAdmin&&metaStatus?.enabled&&!metaAppSecretSaved?"This number is connected, but inbound messages are rejected until this account's Meta app secret is saved in Integrations.":metaStatus?.enabled?"New messages from your contacts will appear here.":"Connect your WhatsApp number to see messages here."}/>:filteredConversations.map(c=>{
              const assignee=teamMembers.find(member=>member.user_id===c.assigned_to);
              return <div className="conversation-row" key={c.id}>
                <button className={selectedConversation===c.id?"conversation-item selected":"conversation-item"} onClick={()=>setSelectedConversation(c.id)}>
                  <div className="conversation-avatar">{(c.contacts?.display_name||c.contacts?.phone_e164||"?").slice(0,1).toUpperCase()}</div>
                  <div className="conversation-summary">
                    <div className="conversation-summary-top"><strong>{c.contacts?.display_name||c.contacts?.phone_e164||"Unknown contact"}</strong><span className="conversation-aside">{c.unread&&<i className="unread-indicator" aria-label="Unread"/>}<small className="conversation-time">{relativeTime(c.last_message_at)}</small></span></div>
                    <div className="conversation-meta"><span className={"conversation-status is-"+c.status}>{c.status}{c.unread?" · unread":""}</span><small>{assignee?"With "+assignee.name:"Unassigned"}</small></div>
                  </div>
                </button>
              </div>;
            })}
            {conversationHasMore&&<button type="button" className="secondary-button compact inbox-load-more" onClick={()=>{const next=conversationLimit+100;setConversationLimit(next);void loadInbox(next,true);}}>Load 100 older conversations</button>}
          </div>
          <div className="chat-panel">
            {!selectedConversation?<div className="empty-chat"><div className="empty-chat-icon"><MessageCircle size={26}/></div><strong>Choose a conversation</strong><span>Select a contact to read and reply to their messages.</span><div className="empty-chat-tips"><span>Assign an owner</span><span>Reply inside 24h</span><span>Leave a private note</span></div></div>:<>
              <div className="chat-header"><button type="button" className="inbox-back-button" onClick={()=>setSelectedConversation("")}><ArrowLeft size={16}/> Conversations</button><div className="chat-contact-heading"><strong>{conversations.find(c=>c.id===selectedConversation)?.contacts?.display_name||conversations.find(c=>c.id===selectedConversation)?.contacts?.phone_e164}</strong><span>{conversations.find(c=>c.id===selectedConversation)?.contacts?.phone_e164}</span></div>{(()=>{const c=conversations.find(x=>x.id===selectedConversation);return c?<div className="chat-head-actions"><span className={"chat-status is-"+c.status}>{c.status}</span>{(isAdmin||activeTenant?.role==="agent")&&<label className="assignment-control"><span>Assigned to</span><select aria-label="Assign conversation" value={c.assigned_to||""} onChange={e=>void assignConversation(c,e.target.value)}><option value="">Unassigned</option>{teamMembers.map(member=><option key={member.user_id} value={member.user_id}>{member.name}</option>)}</select></label>}{canAgent&&c.status!=="resolved"&&<button className="secondary-button compact" onClick={()=>void resolveConversation(c)}>Resolve</button>}</div>:null})()}</div>
              <div ref={chatMessagesRef} className="chat-messages" role="log" aria-label="Conversation messages" aria-live="polite" aria-relevant="additions text">{messageHasMore&&<button type="button" className="secondary-button compact" onClick={()=>void loadOlderMessages()} disabled={loadingOlderMessages}>{loadingOlderMessages?"Loading earlier messages…":"Load earlier messages"}</button>}{messages.length===0?<div className="chat-empty"><MessageCircle size={22}/><strong>No messages yet</strong><span>Incoming and outgoing WhatsApp messages will appear here.</span></div>:messages.map(m=><div key={m.id} className={m.is_note?"message-bubble internal-note":m.direction==="outbound"?"message-bubble outbound":"message-bubble inbound"}>{m.body&&<p>{m.body}</p>}{m.media_id&&m.message_type&&<MessageMedia mediaId={m.media_id} type={m.message_type} filename={m.filename} tenantId={tenantId} userId={user?.id ?? ""}/>}<small>{m.is_note?"Internal note · "+(m.author_id===user?.id?"You":"Teammate"):m.actor_type}{m.status?" · "+m.status:""} · {new Date(m.created_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</small></div>)}</div>
              {canAgent?<><div className="composer-tabs"><button type="button" className={composerMode==="reply"?"active":""} onClick={()=>setComposerMode("reply")}>Reply</button><button type="button" className={composerMode==="note"?"active":""} onClick={()=>setComposerMode("note")}>Internal note</button></div><form className="chat-reply" onSubmit={sendReply}><div className="chat-reply-body"><textarea aria-label={composerMode==="note"?"Internal note":"Message reply"} value={replyText} onChange={e=>setReplyText(e.target.value)} placeholder={composerMode==="note"?"Write a note for your team…":"Reply within the 24-hour service window…"} required/><small className="composer-hint">{composerMode==="note"?"Private note · only your team can see this.":"Official Cloud API · replies require an open 24-hour service window."}<span>{replyText.length}</span></small></div><button className="primary-button" disabled={busy}>{composerMode==="note"?"Add note":"Send"} <Send size={15}/></button></form></>:<p className="read-only-inbox">Your account role has read-only inbox access.</p>}
            </>}
          </div>
        </div>
      </section>}
      {view === "Integrations" && <section className="content">
        <PageHeading eyebrow="WHATSAPP & DEVELOPER TOOLS" title="Integrations" description="Connect one WhatsApp Business number to this business account, then configure developer access only if needed."/>
        <div className="integration-health">
          {[
            { label: "WhatsApp number", value: metaStatus?.enabled && metaStatus?.verified ? "Connected" : metaStatus?.verified ? "Verify token" : "Not connected", hint: metaStatus?.display_phone_number || "Official Meta Cloud API", tone: metaStatus?.enabled && metaStatus?.verified ? "success" : "warning", href: "#integration-connection" },
            { label: "Approved templates", value: String(approvedTemplates.length), hint: `${templates.length} synced from Meta`, tone: approvedTemplates.length ? "success" : "warning", href: "#integration-connection" },
            ...(tierFeatureAvailable("api") ? [{ label: "Active API keys", value: String(apiKeys.filter((key) => !key.revoked_at).length), hint: "Workspace-scoped server access", tone: apiKeys.some((key) => !key.revoked_at) ? "success" : "neutral", href: "#integration-api" }] : []),
            ...(tierFeatureAvailable("webhooks") ? [{ label: "Customer webhooks", value: String(webhooks.filter((webhook) => webhook.enabled).length), hint: `${webhooks.length} endpoint(s) configured`, tone: webhooks.some((webhook) => webhook.enabled) ? "success" : "neutral", href: "#integration-customer-webhooks" }] : []),
          ].map((card) => (
            <a className={"integration-health-card is-" + card.tone} href={card.href} key={card.label}>
              <span className="integration-health-label">{card.label}</span>
              <strong>{card.value}</strong>
              <small>{card.hint}</small>
            </a>
          ))}
        </div>
        <div className="integration-card" id="integration-connection">
          <div className="integration-head"><div className="integration-logo"><MessageCircle size={24}/></div><div><strong>WhatsApp Business Platform</strong><p>Official Meta Cloud API</p></div><Status status={metaStatus?.enabled&&metaStatus?.verified?"connected":metaStatus?.verified?"verified":"not connected"}/></div>
          {isAdmin&&metaStatus&&!metaAppSecretSaved&&<div className="inline-notice" role="alert">Meta signs every webhook with this account's app secret, and inbound events are rejected without it. Save the secret below to receive messages.</div>}
          <div className="checklist">
            <SetupRow done={Boolean(metaStatus?.phone_number_id)} label="Business number details saved" detail="Phone Number ID and WABA ID are stored for this business account."/>
            <SetupRow done={metaAppSecretSaved} label="This account's Meta app secret saved" detail="Used to verify signed webhooks for this client's Meta app."/>
            <SetupRow done={Boolean(metaStatus?.verified)} label="Credentials verified" detail="MobiWave successfully checked the number with Meta Graph API."/>
            <SetupRow done={Boolean(metaStatus?.webhook_verified_at)} label="Meta webhook callback verified" detail={metaStatus?.webhook_verified_at ? `Meta GET handshake recorded ${new Date(metaStatus.webhook_verified_at).toLocaleString()} via ${metaStatus.webhook_verification_source === "platform_legacy_token" ? "the platform token (attributed to this sole active workspace)" : "this workspace's verification token"}.` : "Awaiting Meta's GET verification handshake. If the callback uses the platform legacy token, verify and save it again in Meta; MobiWave can attribute that handshake only while this is the sole active integration."}/>
            <SetupRow done={Boolean(metaStatus?.enabled&&metaStatus?.verified)} label="Meta app subscribed to this WABA" detail="Connection verification subscribes this app to the saved WhatsApp Business Account for webhook events."/>
            <SetupRow done={Boolean(metaStatus?.enabled&&metaStatus?.verified)} label="Messaging enabled" detail="Messaging is enabled after credentials are verified and WABA event delivery is subscribed."/>
          </div>
          <p className="muted small">This business account's Meta access token and app secret are encrypted server-side and never returned to the browser. Saving credentials does not itself verify or enable the connection.</p>
          {isAdmin&&<form onSubmit={saveMeta} className="integration-form">
            <h2>1. Connect your WhatsApp number</h2>
            <div className="form-grid"><div className="field"><label htmlFor="meta-phone-id">Phone Number ID *</label><input id="meta-phone-id" value={metaPhoneId} onChange={(e)=>setMetaPhoneId(e.target.value)} required pattern="[0-9]{5,30}" placeholder="Numeric ID from Meta"/></div><div className="field"><label htmlFor="meta-waba-id">WhatsApp Business Account ID *</label><input id="meta-waba-id" value={metaWabaId} onChange={(e)=>setMetaWabaId(e.target.value)} required pattern="[0-9]{5,30}" placeholder="Numeric WABA ID"/></div></div>
            <div className="field"><label htmlFor="meta-waba-timezone">Messaging-account timezone</label><input id="meta-waba-timezone" value={metaWabaTimezone} onChange={(e)=>setMetaWabaTimezone(e.target.value)} maxLength={64} placeholder="Africa/Nairobi"/><small>Used for the monthly Meta service-message allowance reset. Match the timezone shown in WhatsApp Manager.</small></div>
            <div className="field"><label htmlFor="client-meta-access-token">Meta access token{metaTokenSaved ? "" : " *"}</label><input id="client-meta-access-token" type="password" value={metaToken} onChange={(e)=>setMetaToken(e.target.value)} required={!metaTokenSaved} minLength={metaToken ? 40 : undefined} autoComplete="off" placeholder={metaTokenSaved ? "Leave blank to keep the saved token" : "Paste Meta access token"}/><small>{metaTokenSaved ? "A token is saved for this business. Leave blank to keep it, or enter a replacement." : "Required for first setup."} The saved value is never shown again.</small></div>
            <div className="field"><label htmlFor="client-meta-app-secret">This client's Meta app secret{metaAppSecretSaved ? "" : " *"}</label><input id="client-meta-app-secret" type="password" value={metaAppSecret} onChange={(e)=>setMetaAppSecret(e.target.value)} required={!metaAppSecretSaved} minLength={metaAppSecret ? 32 : undefined} maxLength={32} pattern="[A-Fa-f0-9]{32}" autoComplete="new-password" spellCheck={false} placeholder="32-character secret from this client's Meta app"/><small>{metaAppSecretSaved ? "A secret is saved for this business. Leave blank to keep it, or enter a replacement." : "Enter the app secret from the Meta Developer app connected to this business. It is required for first setup."} The saved value is never shown again.</small></div>
            <div className="form-actions"><button className="primary-button" disabled={busy}>{busy?"Saving…":"Encrypt and save credentials"}</button><button type="button" className="secondary-button" onClick={()=>void verifyMeta()} disabled={busy}><ShieldCheck size={15}/> Verify connection</button><button type="button" className="secondary-button" onClick={()=>void syncTemplates()} disabled={busy}><RefreshCw size={15}/> Sync templates</button></div>
          </form>}
          {metaStatus?.display_phone_number&&<div className="connected-detail"><Check size={15}/> Connected number: {metaStatus.display_phone_number}{metaStatus.verified_name?" · "+metaStatus.verified_name:""}</div>}
        </div>
        {metaAllowance?.connected && <div className="panel form-panel" id="integration-allowance">
          <h2>Meta service-message allowance</h2>
          <p className="muted small">
            The first <strong>{new Intl.NumberFormat("en-KE").format(metaAllowance.free_limit ?? 1000)}</strong> delivered service messages
            each month are free for this business phone number. Marketing, utility and authentication templates are billed from the first
            delivered message. This allowance is separate from your MobiWave plan.
          </p>
          <div className="form-grid">
            <div className="field">
              <span className="field-label">Free service messages used</span>
              <strong>{new Intl.NumberFormat("en-KE").format(metaAllowance.free_service_used ?? 0)} / {new Intl.NumberFormat("en-KE").format(metaAllowance.free_limit ?? 1000)}</strong>
              <small className="muted small">{new Intl.NumberFormat("en-KE").format(metaAllowance.free_service_remaining ?? 0)} free service message(s) remaining</small>
            </div>
            <div className="field">
              <span className="field-label">Billable delivered this month</span>
              <strong>{new Intl.NumberFormat("en-KE").format(metaAllowance.billable_delivered ?? 0)}</strong>
              <small className="muted small">{Object.keys(metaAllowance.billable_by_category ?? {}).length ? Object.entries(metaAllowance.billable_by_category ?? {}).map(([category, count]) => `${category}: ${new Intl.NumberFormat("en-KE").format(Number(count))}`).join(" · ") : "No billable template deliveries recorded"}</small>
            </div>
            <div className="field">
              <span className="field-label">Messaging limit</span>
              <strong>{metaAllowance.messaging_limit_tier ?? "Not reported yet"}</strong>
              <small className="muted small">Number quality: {metaAllowance.quality_rating ?? "Not reported yet"}</small>
            </div>
          </div>
          <div aria-hidden style={{ height: 8, background: "var(--color-hairline)", borderRadius: 999, overflow: "hidden", marginTop: 8 }}>
            <div style={{ width: `${Math.min(100, Math.round(((metaAllowance.free_service_used ?? 0) / Math.max(1, metaAllowance.free_limit ?? 1000)) * 100))}%`, height: "100%", background: "var(--color-success)" }} />
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            {metaAllowance.has_pricing_data === false
              ? "No delivered message with Meta pricing details has been recorded yet. Send a test message and check again."
              : `Resets ${metaAllowance.period_end ? new Date(metaAllowance.period_end).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "at the start of next month"} (${metaAllowance.waba_timezone ?? "Africa/Nairobi"}).`}
            {metaAllowance.unknown_pricing ? ` ${metaAllowance.unknown_pricing} delivered message(s) did not include pricing details.` : ""}
          </p>
          <p className="muted small">Without a payment method on the WhatsApp Business Account, Meta stops delivery after the free service-message allowance. Keep a valid payment method in Meta Billing.</p>
        </div>}
        <div className="panel form-panel" id="integration-webhook">
          <h2>2. Configure Meta's webhook callback</h2>
          <p className="muted small">Meta requires a callback URL and verification token. Configure these in your Meta app and subscribe to the messages field before verifying the connection. The token is stored as a hash and shown only when generated; it cannot be retrieved after leaving this screen.</p>
          <div className="field"><span className="field-label">Callback URL</span><div className="copyable-value"><code>{META_WEBHOOK_CALLBACK_URL}</code><button type="button" className="secondary-button compact" onClick={()=>void copyIntegrationValue(META_WEBHOOK_CALLBACK_URL,"Callback URL")}>Copy URL</button></div></div>
          <div className="field"><span className="field-label">Webhook verification token</span>{metaWebhookToken?<div className="copyable-value"><code>{metaWebhookToken}</code><button type="button" className="secondary-button compact" onClick={()=>void copyIntegrationValue(metaWebhookToken,"Verification token")}>Copy token</button></div>:<p className="muted small">Generate this token before or after saving your Meta phone credentials. It is shown only once; copy it before leaving this screen.</p>}</div>
          {isAdmin&&<div className="form-actions"><button type="button" className="primary-button" onClick={()=>void generateMetaWebhookToken()} disabled={busy}><ShieldCheck size={15}/>{metaWebhookToken?"Generate replacement token":"Generate verification token"}</button></div>}
          <ol className="setup-steps">
            <li>Open your app in Meta for Developers and select <strong>Webhooks</strong>.</li>
            <li>Choose the WhatsApp Business Account object, then paste the callback URL and verification token above.</li>
            <li>Verify and save the callback, then subscribe to the <code>messages</code> field and <code>message_template_status_update</code> where available.</li>
            <li>After configuring the callback and subscribing to the <code>messages</code> field, verify the connection above. MobiWave will subscribe this Meta app to the saved WhatsApp Business Account automatically.</li>
            <li>Send a WhatsApp message to the connected Cloud API business number and confirm it appears in Inbox.</li>
          </ol>
          <p className="muted small">Webhook verification uses the Meta App Secret saved in this business account's WhatsApp connection. Each client account keeps its own app secret alongside its own access token and webhook verification token.</p>
        </div>
        {tierFeatureAvailable("api") && <div className="panel form-panel" id="integration-api">
          <h2>Developer API</h2><p className="muted small">Use business-account-scoped keys for server-to-server integrations. Never put API keys in browser code or public repositories.</p><p className="muted small">API base URL: <code>{PUBLIC_API_BASE_URL}</code> · <a href="/api-docs/" target="_blank" rel="noreferrer">Read API documentation and code examples <ArrowUpRight size={13}/></a></p>
          {isAdmin&&<form onSubmit={createApiKey} className="api-key-create"><div className="field"><label htmlFor="api-key-name">Integration name</label><input id="api-key-name" value={apiKeyName} onChange={(e)=>setApiKeyName(e.target.value)} required minLength={2} maxLength={120}/></div><div className="field"><label>Permissions</label><div className="webhook-event-options">{[["messages:send","Send messages"],["messages:read","Read messages"],["contacts:read","Read contacts"],["contacts:write","Manage contacts and consent"],["templates:read","Read templates"],["campaigns:read","Read campaigns"],["campaigns:write","Create and control campaigns"]].map(([scope,label])=><label key={scope} className="checkbox-line"><input type="checkbox" checked={apiKeyScopes.includes(scope)} onChange={(e)=>setApiKeyScopes(current=>e.target.checked?[...current,scope]:current.filter(item=>item!==scope))}/>{label}</label>)}</div><small className="muted small">Grant only the permissions this integration needs.</small></div><button className="primary-button" disabled={busy || apiKeyScopes.length===0}><Plus size={15}/> Create API key</button></form>}
          {newApiKey&&<div className="new-key-box"><strong>Copy your new key now</strong><code>{newApiKey}</code>{newApiKeyClientId&&<><small>Client ID</small><code>{newApiKeyClientId}</code></>}<button className="secondary-button" onClick={()=>void copyApiKey()}>Copy key</button><small>The secret will not be shown again. Store it securely on your server.</small></div>}
          <div className="api-key-list">{apiKeys.length===0?<p className="muted small">No API keys created.</p>:apiKeys.map(key=><div className="api-key-row" key={key.id}><div><strong>{key.name}</strong><code>{key.key_prefix}…</code><small>{key.client_id ? key.client_id+" · " : ""}Created {new Date(key.created_at).toLocaleDateString()} · {key.scopes?.length ? "Scopes: "+key.scopes.join(", ")+" · " : ""}{key.last_used_at?"Last used "+new Date(key.last_used_at).toLocaleString():"Not used yet"}{key.expires_at?" · Expires "+new Date(key.expires_at).toLocaleDateString():""}</small></div><Status status={key.revoked_at?"revoked":"active"}/>{isAdmin&&!key.revoked_at&&<button className="secondary-button compact" onClick={()=>void revokeApiKey(key)}>Revoke</button>}</div>)}</div>
          <div className="api-example"><strong>Send an approved template (API v1)</strong><pre>{`POST ${PUBLIC_API_BASE_URL}/messages
Authorization: Bearer YOUR_MOBIWAVE_API_KEY
Idempotency-Key: YOUR_UNIQUE_REQUEST_KEY
Content-Type: application/json
{"to":"+2547XXXXXXXX","type":"template","template":{"name":"approved_template","language":"en","parameters":[]}}`}</pre><small className="muted small">Use the MobiWave endpoint above. Direct Supabase function URLs are not a supported integration surface.</small></div>
        </div>}
        {tierFeatureAvailable("webhooks") && <details className="panel form-panel" id="integration-customer-webhooks">
          <summary><strong>Advanced: customer event webhooks</strong><span className="muted small"> Send MobiWave events to your own HTTPS endpoints</span></summary>
          <p className="muted small">This is separate from the Meta callback above. Customer webhooks send signed MobiWave events to your server; they do not receive Meta's inbound WhatsApp webhook.</p>
          {isAdmin&&<form className="webhook-create" onSubmit={createWebhook}><div className="form-grid"><div className="field"><label htmlFor="webhook-name">Webhook name</label><input id="webhook-name" value={webhookName} onChange={(e)=>setWebhookName(e.target.value)} required minLength={2} maxLength={120}/></div><div className="field"><label htmlFor="webhook-url">HTTPS endpoint URL</label><input id="webhook-url" type="url" value={webhookUrl} onChange={(e)=>setWebhookUrl(e.target.value)} required placeholder="https://api.yourbusiness.co.ke/hooks/mobiwave"/></div></div><div className="webhook-event-options">{[["message.inbound","Inbound message"],["message.status","Delivery status"],["message.outbound","Outbound message"],["campaign.completed","Campaign completed"],["conversation.updated","Conversation updated"]].map(([value,label])=><label key={value} className="checkbox-line"><input type="checkbox" checked={webhookEvents.includes(value)} onChange={(e)=>setWebhookEvents(current=>e.target.checked?[...current,value]:current.filter(item=>item!==value))}/>{label}</label>)}</div><div className="form-actions"><span className="muted small">HTTPS only · public host required</span><button className="primary-button" disabled={busy}><Plus size={15}/> Add webhook</button></div></form>}
          {newWebhookSecret&&<div className="new-key-box"><strong>Copy your webhook signing secret now</strong><code>{newWebhookSecret}</code><button className="secondary-button" onClick={()=>void copyWebhookSecret()}>Copy secret</button><small>Use this secret to verify X-MobiWave-Signature. It cannot be retrieved again.</small></div>}
          <div className="api-key-list">{webhooks.length===0?<p className="muted small">No customer webhooks configured.</p>:webhooks.map(h=><div className="api-key-row" key={h.id}><div><strong>{h.name}</strong><code>{h.endpoint_url}</code><small>Events: {h.events.join(", ")}</small>{h.last_error&&<small className="error-text">{h.last_error}</small>}{h.last_delivery_at&&<small>Last delivery: {new Date(h.last_delivery_at).toLocaleString()}</small>}</div><Status status={h.enabled?(h.last_status||"active"):"disabled"}/>{isAdmin&&h.enabled&&<button className="secondary-button compact" onClick={()=>void testWebhook(h)} disabled={busy}>Send test</button>}{isAdmin&&<button className="secondary-button compact" onClick={()=>void manageWebhook(h,h.enabled?"disable":"enable")}>{h.enabled?"Disable":"Enable"}</button>}{isAdmin&&<button className="icon-button" onClick={()=>void manageWebhook(h,"delete")} aria-label="Delete webhook"><Trash2 size={15}/></button>}</div>)}</div>
          <div className="section-header"><div><h3>Recent delivery history</h3><p>Latest 50 attempts across this business account.</p></div></div>
          <div className="api-key-list">{webhookDeliveries.length===0?<p className="muted small">No webhook deliveries yet. Use Send test to validate an endpoint.</p>:webhookDeliveries.map(delivery=><div className="api-key-row" key={delivery.id}><div><strong>{delivery.event_type}</strong><small>{new Date(delivery.created_at).toLocaleString()} · Attempt {delivery.attempt_count}{delivery.response_status?" · HTTP "+delivery.response_status:""}</small>{delivery.last_error&&<small className="error-text">{delivery.last_error}</small>}</div><Status status={delivery.status}/>{isAdmin&&["failed","dead"].includes(delivery.status)&&<button className="secondary-button compact" onClick={()=>void retryWebhookDelivery(delivery)} disabled={busy}>Retry</button>}</div>)}</div>
          <div className="muted small">Signatures use HMAC-SHA256 over the exact raw JSON body. Use X-MobiWave-Delivery for idempotency.</div>
        </details>}
      </section>}
      {view === "Profile" && <section className="content"><PageHeading eyebrow="ACCOUNT" title="Your profile" description="Manage your profile name and update your sign-in password."/>
        <div className="account-banner">
          <div className="account-banner-avatar">{(profileName.trim() || user.email || "U").slice(0,1).toUpperCase()}</div>
          <div className="account-banner-copy"><strong>{profileName.trim() || "Workspace member"}</strong><span>{user.email}</span></div>
          <div className="account-banner-meta"><span className="account-role">{activeTenant?.role ?? "Member"}</span><span>{activeTenant?.name ?? "No workspace"}</span></div>
          <button type="button" className="secondary-button compact" onClick={()=>void signOut()}>Sign out</button>
        </div>
        <form className="panel form-panel profile-form" onSubmit={saveProfile}><h2>Personal details</h2><div className="field"><label htmlFor="profile-name">Full name</label><input id="profile-name" value={profileName} onChange={(e)=>setProfileName(e.target.value)} maxLength={120} placeholder="Your name"/></div><div className="field"><label htmlFor="profile-email">Email address</label><input id="profile-email" value={user.email ?? ""} readOnly aria-readonly="true"/><small className="muted small">Your sign-in email is managed by your authentication account.</small></div><div className="field"><label htmlFor="profile-password">New password <span className="muted small">(optional)</span></label><input id="profile-password" type="password" value={newPassword} onChange={(e)=>setNewPassword(e.target.value)} minLength={8} autoComplete="new-password" placeholder="At least 8 characters"/></div><div className="form-actions"><span className="muted small">Leave the password blank to keep it unchanged.</span><button className="primary-button" disabled={busy}>{busy?"Saving…":"Save profile"}</button></div></form><div className="privacy-note"><ShieldCheck size={18}/><div><strong>Account security</strong><p>Use a unique password. Your profile is stored with your authenticated account and does not change workspace permissions.</p></div></div></section>}
      {view === "Billing" && <Suspense fallback={<section className="content"><div className="panel" role="status">Loading billing…</div></section>}><BillingPage tenantId={tenantId as string} role={activeTenant?.role ?? "viewer"} /></Suspense>}
{view === "Team" && <Suspense fallback={<section className="content"><div className="panel" role="status">Loading team…</div></section>}><TeamPage tenantId={tenantId as string} role={activeTenant?.role ?? "viewer"} /></Suspense>}
{view === "Usage" && <Suspense fallback={<section className="content"><div className="panel" role="status">Loading usage…</div></section>}><UsagePage tenantId={tenantId as string} /></Suspense>}
      {view === "Settings" && <section className="content"><PageHeading eyebrow="PREFERENCES" title="Settings" description="Review your business account, plan and account access."/><div className="panel settings-panel"><div className="setting-row"><div className="setting-icon"><Users size={19}/></div><div className="setting-copy"><strong>Active business account</strong><p>{activeTenant?.name ?? "No business account selected"} · Account ID and role are managed by business account membership.</p></div><span className="fixed-setting">{activeTenant?.role ?? "Member"}</span></div>
          <div className="setting-row">
            <div className="setting-icon"><CreditCard size={19}/></div>
            <div className="setting-copy">
              <strong>{tenantPlanLoading ? "Loading plan…" : tenantPlan?.tier?.name ?? "No plan assigned"}</strong>
              <p>{tenantPlanLoading ? "Checking your subscription…" : `${planStateLabel(tenantPlan)}${tenantPlan?.tier ? ` · ${tenantPlan.tier.description || "Plan details"}${tenantPlan.monthly_price_minor !== undefined ? ` · ${new Intl.NumberFormat("en-KE", { style: "currency", currency: tenantPlan.currency ?? "KES", maximumFractionDigits: 2 }).format(tenantPlan.monthly_price_minor / 100)} / month` : ""}` : " · Your platform owner can confirm or update your workspace plan."}`}</p>
              {!tenantPlanLoading && tenantPlan?.can_send === false && <p className="field-hint">Outbound sending and campaigns are paused. Inbound messages remain available, and sending resumes once billing is updated.</p>}
              {tenantPlan?.tier && <>
                <ul className="tenant-plan-highlights">
                  {Object.entries({ inbox: "Shared inbox", contacts: "Contact management", templates: "WhatsApp template management", campaigns: "Campaigns", api: "Developer API", webhooks: "Customer webhooks" }).map(([key, label]) => {
                    const included = tierFeatureAvailable(key as TierFeature);
                    return <li key={key} className={included ? "" : "is-unavailable"}>{label}{included ? " included" : " not included"}</li>;
                  })}
                </ul>
                <p className="tenant-plan-note">{tenantPlan.tier.monthly_message_limit > 0 ? `${new Intl.NumberFormat("en-KE").format(tenantPlan.monthly_messages_used ?? 0)} / ${new Intl.NumberFormat("en-KE").format(tenantPlan.tier.monthly_message_limit)} platform messages used this month` : `${new Intl.NumberFormat("en-KE").format(tenantPlan.monthly_messages_used ?? 0)} platform messages this month · no fixed cap`} · {tenantPlan.tier.max_team_members > 0 ? `Maximum ${tenantPlan.tier.max_team_members} team members` : "No fixed team size cap"}. Meta message charges are separate.</p>
              </>}
            </div>
            <a className="secondary-button compact" href="/pricing">View available plans</a>
          </div>
          <div className="setting-row"><div className="setting-icon"><MessageCircle size={19}/></div><div className="setting-copy"><strong>WhatsApp connection</strong><p>{metaStatus?.enabled ? "Meta Cloud API is enabled for this business account." : "Meta Cloud API is not enabled yet. Open Integrations to configure and verify it."}</p></div><button type="button" className="secondary-button compact" onClick={()=>goTo("Integrations")}>Open integrations</button></div>
          <div className="setting-row"><div className="setting-icon"><Users size={19}/></div><div className="setting-copy"><strong>Team access</strong><p>{teamMembers.length} member(s) can access this business account. Owners and admins can invite teammates.</p></div><button type="button" className="secondary-button compact" onClick={()=>goTo("Team")}>Manage team</button></div>
          <div className="setting-row"><div className="setting-icon"><Zap size={19}/></div><div className="setting-copy"><strong>Messaging readiness</strong><p>{approvedTemplates.length} approved template(s) · {webhooks.filter((webhook)=>webhook.enabled).length} customer webhook(s) enabled.</p></div><button type="button" className="secondary-button compact" onClick={()=>goTo("Campaigns")}>Open campaigns</button></div>
          <div className="setting-row"><div className="setting-icon"><ShieldCheck size={19}/></div><div className="setting-copy"><strong>Customer-service window</strong><p>Free-form replies are allowed inside Meta's 24-hour customer-service window. Outside it, use an approved template.</p></div><span className="fixed-setting">Policy</span></div>
          <div className="setting-row"><div className="setting-icon"><ShieldCheck size={19}/></div><div className="setting-copy"><strong>Business account access</strong><p>Your current role is {activeTenant?.role ?? "Member"}. Administrative actions are restricted to business account owners and admins.</p></div><span className="fixed-setting">{isAdmin?"Admin access":"Member access"}</span></div><div className="setting-row"><div className="setting-icon"><LogOut size={19}/></div><div className="setting-copy"><strong>Sign out</strong><p>End this session on the current browser.</p></div><button type="button" className="secondary-button compact" onClick={()=>void signOut()}>Sign out</button></div></div>
        <div className="privacy-note"><ShieldCheck size={18}/><div><strong>Privacy and data separation</strong><p>Business account data is kept separate. Use Profile to update your account details; administrative actions are restricted by role.</p></div></div></section>}
      {loading&&<div className="loading-bar"><LoaderCircle className="spin" size={14}/> Loading workspace data…</div>}
      {notice&&<div className={"toast"+(noticeIsError?" is-error":"")} role={noticeIsError?"alert":"status"}><div className="toast-icon">{noticeIsError?<X size={15}/>:<Check size={15}/>}</div><span>{notice}</span><button aria-label="Dismiss" onClick={()=>setNotice("")}><X size={15}/></button></div>}
      <footer className="footer"><span>© 2026 MobiWave Innovations Ltd</span><span><span className={metaStatus?.enabled ? "footer-dot is-connected" : "footer-dot"}/> {metaStatus?.enabled?"Meta API connected":"Meta not connected"}</span></footer>
    </main>
    {selectedCampaign && (() => {
      const campaign = selectedCampaign;
      const template = templates.find((item) => item.id === campaign.template_id);
      const preview = campaignPreview(campaign, template);
      const templateApproved = template?.meta_status === "approved";
      const canLaunch = isAdmin && ["draft", "paused", "running"].includes(campaign.status);
      const canCancel = isAdmin && ["draft", "scheduled", "queued", "running", "paused"].includes(campaign.status);
      const queuedRecipients = campaignCounts?.queued ?? 0;
      return (
        <Modal open onClose={() => setSelectedCampaign(null)} labelledBy="campaign-modal-title" className="campaign-modal">
            <div className="modal-head">
              <div className="modal-head-copy">
                <span className="eyebrow"><Zap size={13}/> CAMPAIGN DETAIL</span>
                <h2 id="campaign-modal-title">{campaign.name}</h2>
                <p>{template ? `${template.meta_template_name} · ${template.language_code}` : "Template unavailable"}</p>
              </div>
              <div className="modal-head-actions">
                <Status status={campaign.status}/>
                <button type="button" className="icon-btn" aria-label="Close campaign details" onClick={() => setSelectedCampaign(null)}><X size={17}/></button>
              </div>
            </div>
            {campaignCountsError && <div className="inline-notice" role="alert">{campaignCountsError}</div>}
            <div className="campaign-detail-stats">
              {[
                ["Recipients", campaignCountsLoading ? "…" : String(campaignCounts?.total ?? 0)],
                ["Queued", campaignCountsLoading ? "…" : String(campaignCounts?.queued ?? 0)],
                ["Needs review", campaignCountsLoading ? "…" : String(campaignCounts?.failed ?? 0)],
              ].map(([label, value]) => (
                <div className="campaign-detail-stat" key={label}><span>{label}</span><strong>{value}</strong></div>
              ))}
            </div>
            <div className="campaign-detail-section">
              <div className="section-header"><div><h3>Template preview</h3><p>Values stored with this campaign.</p></div></div>
              {preview.length ? preview.map((part, index) => (
                <div className="campaign-preview-part" key={part.label + index}><small>{part.label}</small><p>{part.text}</p></div>
              )) : <p className="muted small">This template has no variable parameters to preview.</p>}
            </div>
            <div className="campaign-detail-section">
              <h3>Pre-launch safety</h3>
              <div className="campaign-safety-list">
                <div className={templateApproved ? "safety-row done" : "safety-row blocked"}>
                  <span className="safety-mark">{templateApproved ? <Check size={13}/> : <X size={13}/>}</span>
                  <div><strong>Meta-approved template</strong><small>{templateApproved ? "Approved and ready to send." : "This template is not approved for sending."}</small></div>
                </div>
                <div className="safety-row done"><span className="safety-mark"><Check size={13}/></span><div><strong>Consent re-checked at send</strong><small>Opted-out contacts are skipped and never sent to.</small></div></div>
                <div className="safety-row done"><span className="safety-mark"><Check size={13}/></span><div><strong>Batch capped at 10</strong><small>Each launch claims and sends at most ten recipients.</small></div></div>
                <div className="safety-row done"><span className="safety-mark"><Check size={13}/></span><div><strong>Unknown outcomes held</strong><small>Unconfirmed sends stay in review and are never retried automatically.</small></div></div>
              </div>
            </div>
            {campaignCounts && campaignCounts.failed > 0 && (
              <div className="campaign-detail-section">
                <div className="section-header">
                  <div>
                    <h3>Recipients needing review</h3>
                    <p>Review the outcome in WhatsApp before re-queueing. MobiWave does not retry unknown results.</p>
                  </div>
                </div>
                {campaignFailures.length ? (
                  <div className="failure-list">
                    {campaignFailures.map((failure) => (
                      <div className="failure-row" key={failure.id}>
                        <div className="failure-who">
                          <strong>{failure.contacts?.display_name || failure.contacts?.phone_e164 || "Contact"}</strong>
                          <small>{failure.contacts?.phone_e164}</small>
                        </div>
                        <div className="failure-why">
                          <span className="failure-code">{failure.error_code || "unknown_outcome"}</span>
                          <small>{failure.error_detail || "The outcome was not confirmed."}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="inline-notice" role="status">This campaign has {campaignCounts.failed} recipient(s) that failed or have an uncertain outcome. Check WhatsApp before re-queueing.</div>
                )}
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setSelectedCampaign(null)}>Close</button>
              {isAdmin && campaign.status === "running" && <button type="button" className="secondary-button" onClick={() => void controlCampaign(campaign.id, "pause")} disabled={busy}>Pause campaign</button>}
              {canCancel && <button type="button" className="secondary-button btn-danger" onClick={() => void controlCampaign(campaign.id, "cancel")} disabled={busy}>Cancel campaign</button>}
              {canLaunch && (
                <>
                  {!campaignCountsLoading && campaignCounts && queuedRecipients === 0 && <span className="modal-action-hint">No recipients are currently queued.</span>}
                  <button type="button" className="primary-button" onClick={() => void launchCampaign(campaign.id)} disabled={busy || campaignCountsLoading || campaignCountsError !== "" || queuedRecipients === 0}>{campaign.status === "running" ? "Continue batch" : "Send next batch"} <ArrowUpRight size={14}/></button>
                </>
              )}
            </div>
        </Modal>
      );
    })()}
    {confirmElement}
  </div>;
}
