import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import {
  Activity, ArrowLeft, ArrowUpRight, BookOpen, Bot, Check, ChevronDown, CircleHelp,
  Globe2, LayoutDashboard, Link2, LogOut, MessageCircle, Plus, RefreshCw, Search,
  Send, Settings2, ShieldCheck, Sparkles, Trash2, Users, UserRound, Settings as SettingsIcon, X, Zap, LoaderCircle, Eye, EyeOff, LockKeyhole, Mail,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import LandingPage from "./LandingPage";
import PricingPage from "./PricingPage";

type View = "Overview" | "Knowledge sources" | "AI memory" | "Chatbot settings" | "Shared inbox" | "Contacts" | "Campaigns" | "Integrations" | "Profile" | "Settings";
type Tenant = { id: string; name: string; slug: string; role: string };
type Source = { id: string; submitted_url: string; display_name: string; scope: string; status: string; last_successful_at?: string; last_error_code?: string; created_at: string };
type Memory = { id: string; title: string; memory_text: string; memory_type: string; status: string; updated_at: string; source_reference?: string };
type Contact = { id: string; phone_e164: string; display_name?: string; consent_status: string; consent_source?: string };
type Template = { id: string; meta_template_name: string; language_code: string; category: string; meta_status: string };
type Campaign = { id: string; name: string; status: string; created_at: string; template_id?: string };
type Conversation = { id: string; status: string; bot_paused: boolean; last_message_at?: string; contacts?: { display_name?: string; phone_e164: string } };
type ApiKey = { id: string; name: string; key_prefix: string; last_used_at?: string; expires_at?: string; revoked_at?: string; created_at: string };
type TenantWebhook = { id: string; name: string; endpoint_url: string; events: string[]; enabled: boolean; last_delivery_at?: string; last_status?: string; last_error?: string; created_at: string };
type WebhookDelivery = { id: string; webhook_id: string; event_type: string; status: string; attempt_count: number; response_status?: number; last_error?: string; created_at: string; delivered_at?: string };
type ChatMessage = { id: string; direction: string; actor_type: string; body?: string; status: string; created_at: string };
type Settings = { ai_enabled: boolean; system_instructions: string; context_retention_days: number; max_ai_reply_tokens: number; human_handoff_enabled: boolean };
type UsageStats = { messages: number; aiRequests: number; messageLimit: number; aiLimit: number };

const views: { label: View; icon: typeof LayoutDashboard; section?: string }[] = [
  { label: "Overview", icon: LayoutDashboard, section: "WORKSPACE" },
  { label: "Knowledge sources", icon: BookOpen },
  { label: "AI memory", icon: Sparkles },
  { label: "Chatbot settings", icon: Bot },
  { label: "Shared inbox", icon: MessageCircle, section: "MESSAGING" },
  { label: "Contacts", icon: Users },
  { label: "Campaigns", icon: Zap },
  { label: "Integrations", icon: Settings2, section: "ADMINISTRATION" },
  { label: "Profile", icon: UserRound, section: "ACCOUNT" },
  { label: "Settings", icon: SettingsIcon },
];

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"signin" | "signup">(() => new URLSearchParams(window.location.search).get("mode") === "signup" ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [view, setView] = useState<View>("Overview");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [settings, setSettings] = useState<Settings>({ ai_enabled: false, system_instructions: "", context_retention_days: 30, max_ai_reply_tokens: 500, human_handoff_enabled: true });
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedConversation, setSelectedConversation] = useState("");
  const [search, setSearch] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceScope, setSourceScope] = useState("submitted_url");
  const [memoryTitle, setMemoryTitle] = useState("");
  const [memoryText, setMemoryText] = useState("");
  const [memoryType, setMemoryType] = useState("business_rule");
  const [memoryConversationId, setMemoryConversationId] = useState("");
  const [memorySourceId, setMemorySourceId] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactOptIn, setContactOptIn] = useState(false);
  const [contactConsentSource, setContactConsentSource] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [campaignTemplate, setCampaignTemplate] = useState("");
  const [campaignParameters, setCampaignParameters] = useState("[]");
  const [campaignContacts, setCampaignContacts] = useState<string[]>([]);
  const [replyText, setReplyText] = useState("");
  const [metaPhoneId, setMetaPhoneId] = useState("");
  const [metaWabaId, setMetaWabaId] = useState("");
  const [metaToken, setMetaToken] = useState("");
  const [metaStatus, setMetaStatus] = useState<any>(null);
  const [metaWebhookToken, setMetaWebhookToken] = useState("");
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [apiKeyName, setApiKeyName] = useState("Production integration");
  const [newApiKey, setNewApiKey] = useState("");
  const [webhooks, setWebhooks] = useState<TenantWebhook[]>([]);
  const [webhookDeliveries, setWebhookDeliveries] = useState<WebhookDelivery[]>([]);
  const [webhookName, setWebhookName] = useState("Support event receiver");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEvents, setWebhookEvents] = useState<string[]>(["message.inbound","message.status"]);
  const [newWebhookSecret, setNewWebhookSecret] = useState("");
  const [usageStats, setUsageStats] = useState<UsageStats>({ messages: 0, aiRequests: 0, messageLimit: 1000, aiLimit: 500 });
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiAnswer, setAiAnswer] = useState<any>(null);

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setUser(data.session?.user ?? null); setAuthLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next); setUser(next?.user ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const loadTenants = useCallback(async () => {
    if (!supabase || !user) return;
    const { data, error } = await supabase.from("tenant_members").select("tenant_id,role,tenants(id,name,slug)").eq("user_id", user.id);
    if (error) { setNotice("Could not load workspaces: " + error.message); return; }
    const mapped = (data ?? []).map((row: any) => ({ id: row.tenants.id, name: row.tenants.name, slug: row.tenants.slug, role: row.role })) as Tenant[];
    setTenants(mapped);
    setTenantId((current) => mapped.some((t) => t.id === current) ? current : mapped[0]?.id ?? "");
  }, [user]);

  useEffect(() => { void loadTenants(); }, [loadTenants]);
  useEffect(() => { setProfileName(String(user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? "")); }, [user]);
  useEffect(() => { setNewApiKey(""); setNewWebhookSecret(""); setMetaWebhookToken(""); }, [tenantId]);

  const activeTenant = tenants.find((t) => t.id === tenantId);
  const isAdmin = activeTenant ? ["owner", "admin"].includes(activeTenant.role) : false;

  const loadWorkspace = useCallback(async () => {
    if (!supabase || !tenantId) {
      setSources([]); setMemories([]); setContacts([]); setTemplates([]); setCampaigns([]); setConversations([]);
      setMetaStatus(null); setMetaPhoneId(""); setMetaWabaId(""); setMetaWebhookToken(""); setApiKeys([]); setWebhooks([]); setWebhookDeliveries([]); setUsageStats({ messages: 0, aiRequests: 0, messageLimit: 1000, aiLimit: 500 }); return;
    }
    setLoading(true);
    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0,0,0,0);
    const [s, m, st, c, t, ca, co, mi, ak, ul, um, ua, wh] = await Promise.all([
      supabase.from("knowledge_sources").select("id,submitted_url,display_name,scope,status,last_successful_at,last_error_code,created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
      supabase.from("ai_memory_items").select("id,title,memory_text,memory_type,status,updated_at,source_reference").eq("tenant_id", tenantId).order("updated_at", { ascending: false }),
      supabase.from("tenant_settings").select("ai_enabled,system_instructions,context_retention_days,max_ai_reply_tokens,human_handoff_enabled").eq("tenant_id", tenantId).maybeSingle(),
      supabase.from("contacts").select("id,phone_e164,display_name,consent_status,consent_source").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(500),
      supabase.from("wa_templates").select("id,meta_template_name,language_code,category,meta_status").eq("tenant_id", tenantId).order("meta_template_name"),
      supabase.from("campaigns").select("id,name,status,created_at,template_id").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(100),
      supabase.from("conversations").select("id,status,bot_paused,last_message_at,contacts(display_name,phone_e164)").eq("tenant_id", tenantId).order("last_message_at", { ascending: false }).limit(100),
      supabase.from("meta_integrations").select("phone_number_id,waba_id,display_phone_number,verified,enabled,verified_name,last_error_code,last_health_check_at").eq("tenant_id", tenantId).maybeSingle(),
      supabase.from("tenant_api_keys").select("id,name,key_prefix,last_used_at,expires_at,revoked_at,created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
      supabase.from("tenant_usage_limits").select("monthly_message_limit,monthly_ai_request_limit").eq("tenant_id", tenantId).maybeSingle(),
      supabase.from("usage_events").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("event_type", "message_submitted").gte("occurred_at", monthStart.toISOString()),
      supabase.from("usage_events").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("event_type", "ai_request").gte("occurred_at", monthStart.toISOString()),
      supabase.from("tenant_webhooks").select("id,name,endpoint_url,events,enabled,last_delivery_at,last_status,last_error,created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
    ]);
    if (s.error) setNotice("Could not load workspace data: " + s.error.message);
    setSources((s.data ?? []) as Source[]);
    setMemories((m.data ?? []) as Memory[]);
    if (st.data) setSettings(st.data as Settings);
    setContacts((c.data ?? []) as Contact[]);
    setTemplates((t.data ?? []) as Template[]);
    setCampaigns((ca.data ?? []) as Campaign[]);
    setConversations((co.data ?? []) as unknown as Conversation[]);
    setMetaStatus(mi.data);
    setMetaPhoneId(mi.data?.phone_number_id ?? "");
    setMetaWabaId(mi.data?.waba_id ?? "");
    setApiKeys((ak.data ?? []) as ApiKey[]);
    setWebhooks((wh.data ?? []) as TenantWebhook[]);
    const { data: deliveryRows, error: deliveryError } = await supabase.from("webhook_deliveries").select("id,webhook_id,event_type,status,attempt_count,response_status,last_error,created_at,delivered_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(50);
    if (deliveryError) setNotice("Could not load webhook delivery history: " + deliveryError.message);
    setWebhookDeliveries((deliveryRows ?? []) as WebhookDelivery[]);
    setUsageStats({ messages: um.count ?? 0, aiRequests: ua.count ?? 0, messageLimit: ul.data?.monthly_message_limit ?? 1000, aiLimit: ul.data?.monthly_ai_request_limit ?? 500 });
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);

  const loadMessages = useCallback(async () => {
    if (!supabase || !tenantId || !selectedConversation) { setMessages([]); return; }
    const { data, error } = await supabase.from("messages").select("id,direction,actor_type,body,status,created_at").eq("tenant_id", tenantId).eq("conversation_id", selectedConversation).order("created_at", { ascending: true }).limit(200);
    if (error) setNotice(error.message);
    setMessages((data ?? []) as ChatMessage[]);
  }, [tenantId, selectedConversation]);

  useEffect(() => { void loadMessages(); }, [loadMessages]);

  async function signIn(event: FormEvent) {
    event.preventDefault(); if (!supabase) return;
    setBusy(true); setNotice("");
    const result = authMode === "signin"
      ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
      : await supabase.auth.signUp({ email: email.trim(), password });
    setBusy(false);
    if (result.error) setNotice(result.error.message);
    else if (authMode === "signup" && !result.data.session) setNotice("Check your email to confirm your account, then sign in.");
    else setNotice(authMode === "signup" ? "Account created." : "Signed in.");
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
    if (slug.length < 3) { setNotice("Use a workspace name that produces at least 3 URL characters."); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("create-workspace", { body: { name, slug } });
    setBusy(false);
    if (error || data?.error) { setNotice(data?.error ?? error?.message ?? "Workspace creation failed."); return; }
    setWorkspaceName(""); setNotice("Workspace created."); await loadTenants();
  }

  async function addSource(event: FormEvent) {
    event.preventDefault(); if (!supabase || !activeTenant || !user) return;
    let url: URL;
    try { url = new URL(sourceUrl.trim()); if (!["https:","http:"].includes(url.protocol)) throw new Error(); }
    catch { setNotice("Enter a valid HTTP or HTTPS URL."); return; }
    setBusy(true); setNotice("");
    const { data, error } = await supabase.from("knowledge_sources").insert({
      tenant_id: tenantId, submitted_url: url.toString().replace(/\/$/, ""), display_name: sourceName.trim() || url.hostname,
      scope: sourceScope, status: "pending", created_by: user.id,
    }).select("id").single();
    if (error) { setBusy(false); setNotice(error.message); return; }
    setSourceUrl(""); setSourceName("");
    const crawl = await supabase.functions.invoke("crawl-source", { body: { tenant_id: tenantId, source_id: data.id } });
    setBusy(false);
    if (crawl.error || crawl.data?.error) setNotice("Source saved. Crawl did not complete: " + (crawl.data?.error ?? crawl.error?.message));
    else setNotice("Source indexed: " + crawl.data.pages_indexed + " page(s).");
    await loadWorkspace();
  }

  async function recrawlSource(sourceId: string) {
    if (!supabase) return; setBusy(true);
    const { data, error } = await supabase.functions.invoke("crawl-source", { body: { tenant_id: tenantId, source_id: sourceId } });
    setBusy(false); setNotice(error ? error.message : data?.error ?? ("Indexed " + (data?.pages_indexed ?? 0) + " page(s).")); await loadWorkspace();
  }

  async function removeSource(sourceId: string) {
    if (!supabase || !confirm("Remove this source and its indexed documents?")) return;
    const { error } = await supabase.from("knowledge_sources").delete().eq("id", sourceId).eq("tenant_id", tenantId);
    setNotice(error ? error.message : "Source removed."); await loadWorkspace();
  }

  async function addMemory(event: FormEvent) {
    event.preventDefault(); if (!supabase || !user) return;
    setBusy(true);
    const { error } = await supabase.from("ai_memory_items").insert({ tenant_id: tenantId, title: memoryTitle.trim(), memory_text: memoryText.trim(), memory_type: memoryType, status: "needs_review", source_type: "manual", created_by: user.id });
    setBusy(false);
    if (error) setNotice(error.message); else { setMemoryTitle(""); setMemoryText(""); setNotice("Memory added to review queue."); }
    await loadWorkspace();
  }

  async function reviewMemory(memory: Memory, approve: boolean) {
    if (!supabase || !user) return;
    const patch: any = { status: approve ? "approved" : "rejected", updated_at: new Date().toISOString() };
    if (approve) { patch.approved_by = user.id; patch.approved_at = new Date().toISOString(); }
    const { error } = await supabase.from("ai_memory_items").update(patch).eq("id", memory.id).eq("tenant_id", tenantId);
    setNotice(error ? error.message : approve ? "Memory approved for use by the assistant." : "Memory rejected."); await loadWorkspace();
  }

  async function suggestMemory(event: FormEvent) {
    event.preventDefault(); if (!supabase || !memoryConversationId) return; setBusy(true);
    const { data, error } = await supabase.functions.invoke("suggest-memory", { body: { tenant_id: tenantId, conversation_id: memoryConversationId } });
    setBusy(false); setNotice(error ? error.message : data?.error ?? data?.message ?? "Memory suggestions created."); await loadWorkspace();
  }

  async function suggestSourceMemory(event: FormEvent) {
    event.preventDefault(); if (!supabase || !memorySourceId) return; setBusy(true);
    const { data, error } = await supabase.functions.invoke("suggest-source-memory", { body: { tenant_id: tenantId, source_id: memorySourceId } });
    setBusy(false); setNotice(error ? (data?.error ?? error.message) : data?.error ?? data?.message ?? "Website memory suggestions created."); await loadWorkspace();
  }

  async function deleteMemory(memoryId: string) {
    if (!supabase || !confirm("Permanently delete this memory item?")) return;
    const { error } = await supabase.from("ai_memory_items").delete().eq("id", memoryId).eq("tenant_id", tenantId);
    setNotice(error ? error.message : "Memory deleted."); await loadWorkspace();
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault(); if (!supabase) return; setBusy(true);
    const { error } = await supabase.from("tenant_settings").update({ ai_enabled: settings.ai_enabled, system_instructions: settings.system_instructions, context_retention_days: settings.context_retention_days, max_ai_reply_tokens: settings.max_ai_reply_tokens, human_handoff_enabled: settings.human_handoff_enabled, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId);
    setBusy(false); setNotice(error ? error.message : "Chatbot settings saved."); await loadWorkspace();
  }

  async function testAi(event: FormEvent) {
    event.preventDefault(); if (!supabase) return; setBusy(true); setAiAnswer(null);
    const { data, error } = await supabase.functions.invoke("ai-reply", { body: { tenant_id: tenantId, question: aiQuestion } });
    setBusy(false); setAiAnswer(error ? { error: error.message } : data); 
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
    const { error } = await supabase.from("contacts").update({ consent_status: "opted_out", opted_out_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", contact.id).eq("tenant_id", tenantId);
    setNotice(error ? error.message : "Contact opted out and suppressed from campaigns."); await loadWorkspace();
  }

  async function createCampaign(event: FormEvent) {
    event.preventDefault(); if (!supabase || !user) return;
    const chosen = contacts.filter((c) => campaignContacts.includes(c.id) && c.consent_status === "opted_in");
    if (!chosen.length) { setNotice("Select at least one contact with recorded opt-in consent."); return; }
    if (!campaignTemplate) { setNotice("Select an approved Meta template."); return; }
    let parameters: unknown;
    try { parameters = JSON.parse(campaignParameters); if (!Array.isArray(parameters)) throw new Error(); }
    catch { setNotice("Template parameters must be a valid JSON array, for example []."); return; }
    setBusy(true);
    const { data: campaign, error } = await supabase.from("campaigns").insert({ tenant_id: tenantId, name: campaignName.trim(), template_id: campaignTemplate, template_parameters: parameters, created_by: user.id, status: "draft" }).select("id").single();
    if (error) { setBusy(false); setNotice(error.message); return; }
    const { error: recipientError } = await supabase.from("campaign_recipients").insert(chosen.map((c) => ({ tenant_id: tenantId, campaign_id: campaign.id, contact_id: c.id, status: "queued" })));
    setBusy(false);
    if (recipientError) setNotice("Campaign created, but recipients could not be added: " + recipientError.message);
    else { setCampaignName(""); setCampaignContacts([]); setCampaignParameters("[]"); setNotice("Campaign draft created with " + chosen.length + " opted-in recipients."); }
    await loadWorkspace();
  }

  async function launchCampaign(campaignId: string) {
    if (!supabase || !confirm("Send this campaign now using the selected approved Meta template?")) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("campaign-launch", { body: { tenant_id: tenantId, campaign_id: campaignId } });
    setBusy(false); setNotice(error ? error.message : data?.error ?? ("Campaign batch: " + data.sent + " sent, " + data.skipped + " skipped, " + data.failed + " failed. " + data.remaining + " remain queued."));
    await loadWorkspace();
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault(); if (!supabase || !selectedConversation || !replyText.trim()) return;
    const conversation = conversations.find((c) => c.id === selectedConversation);
    if (!conversation?.contacts?.phone_e164) { setNotice("Contact phone number not found."); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("meta-send", { body: { tenant_id: tenantId, to: conversation.contacts.phone_e164, type: "text", text: replyText.trim() } });
    setBusy(false);
    if (error || data?.error) setNotice(data?.error ?? error?.message ?? "Send failed.");
    else { setReplyText(""); setNotice("Message submitted to Meta."); }
    await loadMessages(); await loadWorkspace();
  }

  async function resolveConversation(conversation: Conversation) {
    if (!supabase) return;
    const { data, error } = await supabase.functions.invoke("conversation-control", { body: { tenant_id: tenantId, conversation_id: conversation.id, action: "resolve" } });
    setNotice(error ? error.message : data?.error ?? "Conversation resolved. You can now suggest reusable business memory."); await loadWorkspace();
  }

  async function handoffConversation(conversation: Conversation, pause: boolean) {
    if (!supabase) return;
    const { data, error } = await supabase.functions.invoke("conversation-control", { body: { tenant_id: tenantId, conversation_id: conversation.id, action: pause ? "pause_bot" : "resume_bot" } });
    setNotice(error ? error.message : data?.error ?? (pause ? "Bot paused for this conversation." : "Bot resumed for this conversation.")); await loadWorkspace();
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
    if (error || data?.error) { setNotice(data?.error ?? error?.message ?? "Could not configure Meta webhook verification."); return; }
    setMetaWebhookToken(raw);
    setNotice("Verification token saved securely. Copy it now and paste the same value into Meta.");
  }

  async function saveMeta(event: FormEvent) {
    event.preventDefault(); if (!supabase) return; setBusy(true);
    const { data, error } = await supabase.functions.invoke("meta-config", { body: { tenant_id: tenantId, phone_number_id: metaPhoneId.trim(), waba_id: metaWabaId.trim(), access_token: metaToken.trim() } });
    setBusy(false);
    if (error || data?.error) setNotice(data?.error ?? error?.message ?? "Save failed.");
    else { setMetaToken(""); setNotice("Meta token encrypted and saved. Verify the connection next."); await loadWorkspace(); }
  }

  async function verifyMeta() {
    if (!supabase) return; setBusy(true);
    const { data, error } = await supabase.functions.invoke("meta-verify", { body: { tenant_id: tenantId } });
    setBusy(false); setNotice(error ? error.message : data?.error ?? "Meta connection verified."); await loadWorkspace();
  }

  async function syncTemplates() {
    if (!supabase) return; setBusy(true);
    const { data, error } = await supabase.functions.invoke("meta-sync-templates", { body: { tenant_id: tenantId } });
    setBusy(false); setNotice(error ? error.message : data?.error ?? ("Templates synced: " + data?.synced)); await loadWorkspace();
  }

  async function createWebhook(event: FormEvent) {
    event.preventDefault(); if (!supabase) return; setBusy(true); setNewWebhookSecret("");
    const { data, error } = await supabase.functions.invoke("manage-webhook", { body: { tenant_id: tenantId, action: "create", name: webhookName.trim(), endpoint_url: webhookUrl.trim(), events: webhookEvents } });
    setBusy(false);
    if (error || data?.error) setNotice(data?.error ?? error?.message ?? "Could not create webhook.");
    else { setNewWebhookSecret(data.signing_secret); setWebhookUrl(""); setWebhookName("Support event receiver"); setNotice("Webhook created. Copy the signing secret now."); await loadWorkspace(); }
  }

  async function manageWebhook(webhook: TenantWebhook, action: "enable" | "disable" | "delete") {
    if (!supabase) return;
    if (action === "delete" && !confirm("Delete this webhook subscription and its delivery history?")) return;
    const { data, error } = await supabase.functions.invoke("manage-webhook", { body: { tenant_id: tenantId, action, webhook_id: webhook.id } });
    setNotice(error ? error.message : data?.error ?? (action === "delete" ? "Webhook deleted." : "Webhook updated."));
    await loadWorkspace();
  }

  async function testWebhook(hook: TenantWebhook) {
    if (!supabase) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("manage-webhook", { body: { tenant_id: tenantId, action: "test", webhook_id: hook.id } });
    setBusy(false);
    setNotice(error ? error.message : data?.error ?? data?.message ?? "Webhook test completed.");
    await loadWorkspace();
  }

  async function retryWebhookDelivery(delivery: WebhookDelivery) {
    if (!supabase || !confirm("Retry this failed webhook delivery?")) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("manage-webhook", { body: { tenant_id: tenantId, action: "retry", delivery_id: delivery.id } });
    setBusy(false);
    setNotice(error ? error.message : data?.error ?? data?.message ?? "Webhook retry completed.");
    await loadWorkspace();
  }

  async function copyWebhookSecret() {
    try { await navigator.clipboard.writeText(newWebhookSecret); setNotice("Webhook signing secret copied."); }
    catch { setNotice("Clipboard unavailable. Select and copy the signing secret manually."); }
  }

  async function createApiKey(event: FormEvent) {
    event.preventDefault(); if (!supabase) return; setBusy(true); setNewApiKey("");
    const { data, error } = await supabase.functions.invoke("create-api-key", { body: { tenant_id: tenantId, name: apiKeyName.trim() } });
    setBusy(false);
    if (error || data?.error) setNotice(data?.error ?? error?.message ?? "Could not create API key.");
    else { setNewApiKey(data.api_key); setApiKeyName("Production integration"); setNotice("API key created. Copy it now; the secret will not be shown again."); await loadWorkspace(); }
  }

  async function revokeApiKey(key: ApiKey) {
    if (!supabase || !confirm("Revoke API key " + key.name + "? Requests using it will stop working.")) return;
    const { error } = await supabase.from("tenant_api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", key.id).eq("tenant_id", tenantId);
    setNotice(error ? error.message : "API key revoked."); await loadWorkspace();
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

  async function signOut() { if (supabase) await supabase.auth.signOut(); setTenants([]); setTenantId(""); }

  const filteredSources = useMemo(() => sources.filter((s) => (s.display_name + " " + s.submitted_url).toLowerCase().includes(search.toLowerCase())), [sources, search]);
  const filteredContacts = useMemo(() => contacts.filter((c) => (c.phone_e164 + " " + (c.display_name ?? "")).toLowerCase().includes(search.toLowerCase())), [contacts, search]);
  const approvedTemplates = templates.filter((t) => t.meta_status === "approved");

  // Public routes are available without authentication; account access starts at /login.
  if (window.location.pathname === "/pricing" || window.location.pathname === "/pricing/") return <PricingPage />;
  if (window.location.pathname === "/") return <LandingPage />;

  if (!isSupabaseConfigured) return <div className="auth-screen"><div className="auth-card"><Brand /><h1>Connect your workspace</h1><p>Configure the Supabase URL and publishable/anon key in <code>.env.local</code> before running the dashboard.</p><pre>VITE_SUPABASE_URL=https://your-project.supabase.co{"\n"}VITE_SUPABASE_ANON_KEY=your-publishable-key</pre><a href="https://github.com/malingib/Mobiwave-WA/blob/main/docs/environment-and-deployment.md">Deployment guide <ArrowUpRight size={14} /></a></div></div>;
  if (authLoading) return <div className="auth-screen"><LoaderCircle className="spin" /><span>Loading secure session…</span></div>;
  if (!session || !user) {
    if (window.location.pathname !== "/login") return <LandingPage />;
    return <div className="auth-page">
      <a className="auth-back-home" href="/" aria-label="Back to MobiWave WA home"><ArrowLeft size={15}/> Back to website</a>
      <div className="auth-layout">
        <section className="auth-story">
          <a className="auth-story-brand" href="/" aria-label="MobiWave WA home"><span className="auth-story-mark"><MessageCircle size={22} strokeWidth={2.5}/></span><span><strong>MobiWave</strong><small>WA</small></span></a>
          <div className="auth-story-content">
            <div className="auth-story-kicker"><span/> WHATSAPP BUSINESS, IN ONE PLACE</div>
            <h1>Better conversations.<br/><em>Stronger relationships.</em></h1>
            <p>Bring your customer conversations, team inbox, approved campaigns and helpful automation into one clear workspace.</p>
            <div className="auth-story-list">
              <div><span><Check size={15}/></span><section><strong>A shared inbox for your team</strong><small>Keep customer conversations moving with human handoff.</small></section></div>
              <div><span><Check size={15}/></span><section><strong>Messaging with safeguards</strong><small>Use official Meta Cloud API and recorded consent.</small></section></div>
              <div><span><Check size={15}/></span><section><strong>Your business knowledge stays yours</strong><small>Workspace data is isolated and AI is always optional.</small></section></div>
            </div>
          </div>
          <div className="auth-story-footer"><ShieldCheck size={15}/> Official Meta Cloud API connectivity <span>·</span> Built by MobiWave Innovations Ltd</div>
        </section>
        <section className="auth-form-side">
          <form className="auth-form-card" onSubmit={forgotMode ? sendPasswordReset : signIn}>
            <div className="auth-mobile-brand"><Brand /></div>
            <div className="auth-form-topline"><span className="auth-eyebrow">{forgotMode ? "ACCOUNT RECOVERY" : authMode === "signin" ? "WELCOME BACK" : "GET STARTED"}</span><span className="auth-secure"><LockKeyhole size={13}/> Secure sign-in</span></div>
            <h2>{forgotMode ? "Reset your password" : authMode === "signin" ? "Sign in to your workspace" : "Create your account"}</h2>
            <p className="auth-form-description">{forgotMode ? "Enter the email address linked to your account and we’ll send a password-reset link if it exists." : authMode === "signin" ? "Pick up where your team left off." : "Create an account to set up your business workspace."}</p>
            <label htmlFor="auth-email">Work email</label>
            <div className="auth-input-wrap"><Mail size={17}/><input id="auth-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required placeholder="you@company.co.ke" /></div>
            {!forgotMode && <>
              <div className="auth-password-label"><label htmlFor="auth-password">Password</label>{authMode === "signin" && <button type="button" className="auth-text-link" onClick={() => { setForgotMode(true); setNotice(""); }}>Forgot password?</button>}</div>
              <div className="auth-input-wrap"><LockKeyhole size={17}/><input id="auth-password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} autoComplete={authMode === "signin" ? "current-password" : "new-password"} required placeholder={authMode === "signin" ? "Enter your password" : "At least 8 characters"} /><button type="button" className="auth-password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div>
            </>}
            <button className="auth-submit" disabled={busy}>{busy ? "Please wait…" : forgotMode ? "Send reset link" : authMode === "signin" ? "Sign in securely" : "Create account"} <ArrowUpRight size={16}/></button>
            {notice && <div className="auth-feedback" role="status">{notice}</div>}
            {forgotMode ? <button type="button" className="auth-mode-switch" onClick={() => { setForgotMode(false); setNotice(""); }}> <ArrowLeft size={14}/> Back to sign in</button> : <div className="auth-mode-prompt"><span>{authMode === "signin" ? "New to MobiWave WA?" : "Already have an account?"}</span><button type="button" className="auth-text-link" onClick={() => { setAuthMode(authMode === "signin" ? "signup" : "signin"); setNotice(""); setForgotMode(false); }}>{authMode === "signin" ? "Create an account" : "Sign in instead"}</button></div>}
            <div className="auth-assurance"><ShieldCheck size={15}/><span>Your workspace is protected by authenticated access and tenant-level data isolation.</span></div>
          </form>
          <div className="auth-form-legal"><a href="/">MobiWave WA</a><span>·</span><a href="https://mobiwave.co.ke/">MobiWave Innovations</a><span>·</span><span>© 2026</span></div>
        </section>
      </div>
    </div>;
  }

  if (!tenants.length) return <div className="auth-screen"><form className="auth-card" onSubmit={createWorkspace}><Brand /><div className="auth-eyebrow">FIRST-TIME SETUP</div><h1>Create a workspace</h1><p>Your business data, knowledge base, approved memory and contacts will be isolated in this workspace.</p><label>Business / workspace name</label><input value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} required minLength={2} maxLength={160} placeholder="e.g. MobiWave Demo" /><button className="primary-button full" disabled={busy}>{busy ? "Creating…" : "Create workspace"}</button>{notice && <div className="inline-notice">{notice}</div>}<button type="button" className="auth-switch" onClick={signOut}>Sign out</button></form></div>;

  return <div className="app-shell">
    <aside className="sidebar">
      <Brand />
      <div className="workspace-picker"><div className="workspace-avatar">{activeTenant?.name.slice(0,2).toUpperCase() ?? "MW"}</div><select value={tenantId} onChange={(e) => { setTenantId(e.target.value); setSelectedConversation(""); }} aria-label="Select workspace">{tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select><ChevronDown size={15} /></div>
      {views.map((item) => <div key={item.label}>{item.section && <div className="nav-label">{item.section}</div>}<button className={view === item.label ? "nav-item active" : "nav-item"} onClick={() => setView(item.label)}><item.icon size={18} /><span>{item.label}</span>{item.label === "AI memory" && <span className="nav-count">{memories.length}</span>}</button></div>)}
      <div className="sidebar-bottom"><div className="help-card"><CircleHelp size={18} /><div><strong>Need a hand?</strong><span>Read the setup guide</span></div><a href="https://github.com/malingib/Mobiwave-WA/blob/main/docs/environment-and-deployment.md" aria-label="Open setup guide"><ArrowUpRight size={15} /></a></div><div className="profile"><div className="profile-avatar">{user.email?.slice(0,1).toUpperCase() ?? "U"}</div><div><strong>{user.email}</strong><span>{activeTenant?.role ?? "Member"}</span></div><button className="icon-button" onClick={signOut} aria-label="Sign out"><LogOut size={17} /></button></div></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumbs"><span>{activeTenant?.name ?? "Workspace"}</span><span className="crumb-sep">/</span><strong>{view}</strong></div><div className="top-actions"><span className="environment"><span className="status-dot" /> {metaStatus?.enabled ? "Meta connected" : "Meta not connected"}</span><button className="icon-button" aria-label="Refresh" onClick={() => void loadWorkspace()}><RefreshCw size={17} /></button><div className="mini-avatar">{user.email?.slice(0,1).toUpperCase()}</div></div></header>
      {view === "Overview" && <section className="content">
        <PageHeading eyebrow="WORKSPACE" title="Overview" description="Manage official WhatsApp messaging, approved knowledge and optional AI support." />
        <div className="callout"><div className="callout-icon"><ShieldCheck size={20} /></div><div><strong>Your sources. Your AI. Your customer data.</strong><p>The assistant answers only from your approved sources and memories. It does not search the wider internet, and AI can be paused without interrupting human messaging.</p></div></div>
        <div className="metric-grid"><Metric icon={<Globe2 size={18}/>} label="Knowledge sources" value={sources.length} note="Tenant-submitted only"/><Metric icon={<BookOpen size={18}/>} label="Indexed pages" value={sources.filter(s=>s.status==="indexed").length} note="Ready for retrieval"/><Metric icon={<Sparkles size={18}/>} label="Approved memory" value={memories.filter(m=>m.status==="approved").length} note="Curated business knowledge"/><Metric icon={<MessageCircle size={18}/>} label="Conversations" value={conversations.length} note="Shared inbox"/><Metric icon={<Send size={18}/>} label="Messages this month" value={usageStats.messages} note={"Limit: "+usageStats.messageLimit}/><Metric icon={<Bot size={18}/>} label="AI requests this month" value={usageStats.aiRequests} note={"Limit: "+usageStats.aiLimit}/></div>
        <div className="section-header"><div><h2>Launch checklist</h2><p>Complete configuration before sending messages to real customers.</p></div></div>
        <div className="checklist"><SetupRow done label="Workspace and tenant isolation" detail="Each workspace has separate data and access policies."/><SetupRow done={sources.some(s=>s.status==="indexed")} label="Build the knowledge base" detail="Add approved help pages and crawl only the URLs you authorize."/><SetupRow done={Boolean(metaStatus?.verified && metaStatus?.enabled)} label="Connect official Meta Cloud API" detail="Save credentials securely, verify access and sync approved templates."/><SetupRow done={settings.ai_enabled} label="Enable optional AI replies" detail="Review source content and business memories before enabling automation."/><SetupRow done={contacts.some(c=>c.consent_status==="opted_in")} label="Record customer consent" detail="Only opted-in contacts can receive campaign templates." /></div>
      </section>}
      {view === "Knowledge sources" && <section className="content"><PageHeading eyebrow="AI KNOWLEDGE" title="Knowledge sources" description="Add only the websites and pages your business authorizes the assistant to use."/><div className="callout"><div className="callout-icon"><ShieldCheck size={20}/></div><div><strong>No general internet search</strong><p>The crawler follows only the submitted URL or pages on the same host, depending on your selected scope. Page text is treated as untrusted reference material.</p></div></div>
        {isAdmin && <form className="panel form-panel" onSubmit={addSource}><h2>Add a source</h2><div className="form-grid"><div className="field wide"><label>URL *</label><input type="url" value={sourceUrl} onChange={(e)=>setSourceUrl(e.target.value)} placeholder="https://yourbusiness.co.ke/help" required/></div><div className="field"><label>Display name</label><input value={sourceName} onChange={(e)=>setSourceName(e.target.value)} placeholder="Help centre"/></div><div className="field"><label>Crawl scope</label><select value={sourceScope} onChange={(e)=>setSourceScope(e.target.value)}><option value="submitted_url">Submitted URL only</option><option value="same_domain">Same host (max 20 pages)</option></select></div></div><div className="form-actions"><span className="muted small">HTML and plain text only · max 1.5 MB/page</span><button className="primary-button" disabled={busy}><Plus size={16}/>{busy?"Processing…":"Save and crawl"}</button></div></form>}
        <div className="section-header"><div><h2>Connected sources</h2><p>{sources.length} source(s) in this workspace.</p></div><div className="search-field"><Search size={16}/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search sources…"/></div></div><div className="source-list"><div className="source-table-head"><span>SOURCE</span><span>SCOPE</span><span>STATUS</span><span/></div>{filteredSources.length===0?<Empty icon={<Globe2 size={25}/>} title="No sources yet" text="Add a URL above to build your knowledge base."/>:filteredSources.map(s=><div className="source-row" key={s.id}><div className="source-main"><div className="source-icon"><Globe2 size={18}/></div><div className="source-text"><strong>{s.display_name}</strong><a href={s.submitted_url} target="_blank" rel="noreferrer">{s.submitted_url}<ArrowUpRight size={12}/></a>{s.last_error_code&&<small className="error-text">{s.last_error_code}</small>}</div></div><div className="source-type"><Link2 size={14}/>{s.scope==="same_domain"?"Same host":"Single URL"}</div><div><Status status={s.status}/></div><div className="row-actions"><button className="icon-button" title="Crawl now" onClick={()=>void recrawlSource(s.id)} disabled={busy}><RefreshCw size={15}/></button>{isAdmin&&<button className="icon-button" title="Remove source" onClick={()=>void removeSource(s.id)}><Trash2 size={15}/></button>}</div></div>)}</div>
      </section>}
      {view === "AI memory" && <section className="content"><PageHeading eyebrow="CURATED LEARNING" title="AI memory" description="Persistent business memory is curated and approved by your team; the model does not retrain itself."/>
        {<form className="panel form-panel" onSubmit={suggestMemory}><h2>Learn from a resolved conversation</h2><p className="muted small">AI extracts reusable business knowledge for review. Customer-specific or sensitive details must not become memory, and suggestions are never auto-approved.</p><div className="form-actions"><select value={memoryConversationId} onChange={(e)=>setMemoryConversationId(e.target.value)} required><option value="">Select resolved conversation…</option>{conversations.filter(c=>c.status==="resolved").map(c=><option key={c.id} value={c.id}>{c.contacts?.display_name||c.contacts?.phone_e164||c.id}</option>)}</select><button className="secondary-button" disabled={busy||!conversations.some(c=>c.status==="resolved")}><Sparkles size={15}/> Suggest memory</button></div></form>}
        {isAdmin&&<form className="panel form-panel" onSubmit={suggestSourceMemory}><h2>Learn from an indexed website</h2><p className="muted small">Create reviewable memory candidates from the pages already crawled. Only distinct, readable content is accepted; nothing is approved automatically.</p><div className="form-actions"><select value={memorySourceId} onChange={(e)=>setMemorySourceId(e.target.value)} required><option value="">Select indexed source…</option>{sources.filter(source=>source.status==="indexed").map(source=><option key={source.id} value={source.id}>{source.display_name} — {source.submitted_url}</option>)}</select><button className="secondary-button" disabled={busy||!sources.some(source=>source.status==="indexed")}><Sparkles size={15}/> Suggest from website</button></div></form>}
        {isAdmin&&<form className="panel form-panel" onSubmit={addMemory}><h2>Add business memory</h2><div className="field"><label>Title *</label><input value={memoryTitle} onChange={(e)=>setMemoryTitle(e.target.value)} required maxLength={200} placeholder="e.g. Standard delivery window"/></div><div className="field"><label>Memory / rule *</label><textarea value={memoryText} onChange={(e)=>setMemoryText(e.target.value)} required maxLength={6000} rows={3} placeholder="Write a verified fact or policy that the assistant should remember."/></div><div className="form-actions"><select value={memoryType} onChange={(e)=>setMemoryType(e.target.value)}><option value="business_rule">Business rule</option><option value="business_preference">Business preference</option><option value="confirmed_correction">Confirmed correction</option><option value="resolved_issue">Resolved issue</option></select><button className="primary-button" disabled={busy}><Plus size={16}/> Add to review</button></div></form>}
        <div className="section-header"><div><h2>Memory items</h2><p>Only approved items are included in AI retrieval.</p></div><span className="queue-count">{memories.filter(m=>m.status==="needs_review"||m.status==="suggested").length} awaiting review</span></div><div className="memory-list">{memories.length===0?<Empty icon={<Sparkles size={24}/>} title="No memory items" text="Add verified business knowledge to get started."/>:memories.map(m=><div className="memory-row" key={m.id}><div className="memory-symbol"><Sparkles size={18}/></div><div className="memory-copy"><strong>{m.title}</strong><p>{m.memory_text}</p><div className="inline-status"><Status status={m.status}/><span>{m.memory_type.replaceAll("_"," ")}</span></div></div><div className="memory-actions">{isAdmin&&(m.status!=="approved"?<button className="secondary-button" onClick={()=>void reviewMemory(m,true)}><Check size={15}/> Approve</button>:<button className="secondary-button" onClick={()=>void reviewMemory(m,false)}>Archive / reject</button>)}{isAdmin&&<button className="icon-button" onClick={()=>void deleteMemory(m.id)} aria-label="Delete memory"><Trash2 size={15}/></button>}</div></div>)}</div>
      </section>}
      {view === "Chatbot settings" && <section className="content"><PageHeading eyebrow="AUTOMATION" title="Chatbot settings" description="AI is optional and must answer only from approved workspace knowledge."/>
        <form className="panel settings-panel" onSubmit={saveSettings}><div className="setting-row"><div className="setting-icon"><Bot size={19}/></div><div className="setting-copy"><strong>AI replies</strong><p>When off, inbound messages remain available in the shared inbox.</p></div><button type="button" role="switch" aria-checked={settings.ai_enabled} className={settings.ai_enabled?"toggle on":"toggle"} onClick={()=>setSettings(s=>({...s,ai_enabled:!s.ai_enabled}))}><span/></button></div><div className="setting-row"><div className="setting-icon"><ShieldCheck size={19}/></div><div className="setting-copy"><strong>Approved knowledge only</strong><p>Hard-coded system guardrail. No general internet search fallback.</p></div><span className="fixed-setting">Required</span></div><div className="setting-row"><div className="setting-icon"><Users size={19}/></div><div className="setting-copy"><strong>Human handoff</strong><p>Pause the bot when evidence is missing or a handoff is required.</p></div><button type="button" role="switch" aria-checked={settings.human_handoff_enabled} className={settings.human_handoff_enabled?"toggle on":"toggle"} onClick={()=>setSettings(s=>({...s,human_handoff_enabled:!s.human_handoff_enabled}))}><span/></button></div><div className="field"><label>Business instructions</label><textarea value={settings.system_instructions??""} onChange={(e)=>setSettings(s=>({...s,system_instructions:e.target.value}))} rows={4} maxLength={6000} placeholder="Tone, escalation rules and business-specific response preferences."/></div><div className="form-grid"><div className="field"><label>Conversation context retention (days)</label><input type="number" min={0} max={365} value={settings.context_retention_days} onChange={(e)=>setSettings(s=>({...s,context_retention_days:Number(e.target.value)}))}/></div><div className="field"><label>Maximum reply tokens</label><input type="number" min={50} max={2000} value={settings.max_ai_reply_tokens} onChange={(e)=>setSettings(s=>({...s,max_ai_reply_tokens:Number(e.target.value)}))}/></div></div><div className="form-actions"><button className="primary-button" disabled={busy}>Save settings</button></div></form>
        <form className="panel form-panel" onSubmit={testAi}><h2>Test grounded answer</h2><p className="muted small">Uses only indexed pages and approved memories. If evidence is missing, the assistant should hand off.</p><div className="field"><label>Question</label><input value={aiQuestion} onChange={(e)=>setAiQuestion(e.target.value)} required placeholder="Ask about a policy in your knowledge base"/></div><div className="form-actions"><button className="secondary-button" disabled={busy}><Sparkles size={15}/> Test answer</button></div>{aiAnswer&&<div className="ai-test-result"><strong>{aiAnswer.error?"Test failed":aiAnswer.handoff?"Human handoff":"Assistant response"}</strong><p>{aiAnswer.error??aiAnswer.answer}</p>{aiAnswer.evidence?.length>0&&<small>Evidence references: {aiAnswer.evidence.join(", ")}</small>}</div>}</form>
      </section>}
      {view === "Contacts" && <section className="content"><PageHeading eyebrow="CUSTOMER DATA" title="Contacts" description="Store consent and suppression status before using contacts for campaigns."/>
        {isAdmin&&<form className="panel form-panel" onSubmit={addContact}><h2>Add contact</h2><div className="form-grid"><div className="field"><label>Phone number (E.164) *</label><input value={contactPhone} onChange={(e)=>setContactPhone(e.target.value)} required pattern="\+[1-9][0-9]{7,14}" placeholder="+2547XXXXXXXX"/></div><div className="field"><label>Display name</label><input value={contactName} onChange={(e)=>setContactName(e.target.value)} placeholder="Customer name"/></div></div><label className="checkbox-line"><input type="checkbox" checked={contactOptIn} onChange={(e)=>setContactOptIn(e.target.checked)}/> I have verifiable permission to send WhatsApp messages to this contact.</label>{contactOptIn&&<div className="field"><label>Consent source / record *</label><input value={contactConsentSource} onChange={(e)=>setContactConsentSource(e.target.value)} required placeholder="e.g. website signup form, 2026-10-16"/></div>}<div className="form-actions"><span className="muted small">Unconfirmed contacts are not eligible for campaigns.</span><button className="primary-button" disabled={busy}><Plus size={15}/> Add contact</button></div></form>}
        <div className="section-header"><div><h2>Contact list</h2><p>{contacts.length} contact(s)</p></div><div className="search-field"><Search size={16}/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search contacts…"/></div></div><div className="source-list"><div className="source-table-head contact-head"><span>CONTACT</span><span>CONSENT</span><span>SOURCE</span><span/></div>{filteredContacts.length===0?<Empty icon={<Users size={24}/>} title="No contacts" text="Add a contact above."/>:filteredContacts.map(c=><div className="source-row contact-row" key={c.id}><div className="source-main"><div className="source-icon"><Users size={17}/></div><div className="source-text"><strong>{c.display_name||"Unnamed contact"}</strong><a>{c.phone_e164}</a></div></div><div><Status status={c.consent_status}/></div><div className="source-added">{c.consent_source||"No consent record"}</div><div className="row-actions">{c.consent_status!=="opted_out"&&<button className="icon-button" title="Opt out / suppress" onClick={()=>void optOut(c)}><ShieldCheck size={16}/></button>}</div></div>)}</div>
      </section>}
      {view === "Campaigns" && <section className="content"><PageHeading eyebrow="OUTBOUND MESSAGING" title="Campaigns" description="Campaigns use only Meta-approved templates and contacts with recorded opt-in consent."/>
        {isAdmin&&<form className="panel form-panel" onSubmit={createCampaign}><h2>Create campaign</h2><div className="field"><label>Campaign name *</label><input value={campaignName} onChange={(e)=>setCampaignName(e.target.value)} required maxLength={180} placeholder="October customer update"/></div><div className="field"><label>Approved template *</label><select value={campaignTemplate} onChange={(e)=>setCampaignTemplate(e.target.value)} required><option value="">Choose template…</option>{approvedTemplates.map(t=><option value={t.id} key={t.id}>{t.meta_template_name} · {t.language_code}</option>)}</select>{approvedTemplates.length===0&&<small className="muted">No approved templates found. Connect Meta and sync templates in Integrations.</small>}</div><div className="field"><label>Template parameters JSON (optional)</label><textarea value={campaignParameters} onChange={(e)=>setCampaignParameters(e.target.value)} rows={3} placeholder='[] or [{"type":"body","parameters":[{"type":"text","text":"Brighton"}]}]'/><small className="muted">Provide Meta message component parameters for templates with placeholders. Leave [] for templates without variables.</small></div><div className="field"><label>Recipients (opted-in contacts only)</label><div className="contact-select">{contacts.filter(c=>c.consent_status==="opted_in").map(c=><label key={c.id} className="checkbox-line"><input type="checkbox" checked={campaignContacts.includes(c.id)} onChange={(e)=>setCampaignContacts(list=>e.target.checked?[...list,c.id]:list.filter(id=>id!==c.id))}/>{c.display_name||c.phone_e164} <span className="muted">{c.phone_e164}</span></label>)}</div></div><div className="form-actions"><span className="muted small">{campaignContacts.length} recipient(s) selected</span><button className="primary-button" disabled={busy}><Plus size={15}/> Save draft</button></div></form>}
        <div className="section-header"><div><h2>Campaign history</h2><p>Send batches of up to 50 recipients per run.</p></div></div><div className="source-list"><div className="source-table-head campaign-head"><span>CAMPAIGN</span><span>STATUS</span><span>CREATED</span><span/></div>{campaigns.length===0?<Empty icon={<Zap size={24}/>} title="No campaigns" text="Create a campaign draft above."/>:campaigns.map(c=><div className="source-row campaign-row" key={c.id}><div className="source-main"><div className="source-icon"><Zap size={17}/></div><div className="source-text"><strong>{c.name}</strong><small>{templates.find(t=>t.id===c.template_id)?.meta_template_name||"Template unavailable"}</small></div></div><div><Status status={c.status}/></div><div className="source-added">{new Date(c.created_at).toLocaleDateString()}</div><div className="row-actions">{isAdmin&&["draft","paused","failed","running"].includes(c.status)&&<button className="secondary-button compact" onClick={()=>void launchCampaign(c.id)} disabled={busy}>{c.status==="running"?"Continue batch":"Send batch"} <ArrowUpRight size={13}/></button>}</div></div>)}</div>
      </section>}
      {view === "Shared inbox" && <section className="content inbox-content"><PageHeading eyebrow="CUSTOMER SUPPORT" title="Shared inbox" description="Inbound WhatsApp messages and human-agent handoff."/><div className="inbox-layout"><div className="conversation-list"><div className="inbox-list-title">Conversations <span>{conversations.length}</span></div>{conversations.length===0?<Empty icon={<MessageCircle size={22}/>} title="Inbox is empty" text="Inbound messages arrive after the Meta webhook is configured."/>:conversations.map(c=><button className={selectedConversation===c.id?"conversation-item selected":"conversation-item"} key={c.id} onClick={()=>setSelectedConversation(c.id)}><div className="conversation-avatar">{(c.contacts?.display_name||c.contacts?.phone_e164||"?").slice(0,1).toUpperCase()}</div><div className="conversation-summary"><strong>{c.contacts?.display_name||c.contacts?.phone_e164||"Unknown contact"}</strong><span>{c.status}{c.bot_paused?" · bot paused":""}</span><small>{c.last_message_at?new Date(c.last_message_at).toLocaleString():"No messages"}</small></div></button>)}</div><div className="chat-panel">{!selectedConversation?<div className="empty-chat"><MessageCircle size={28}/><strong>Select a conversation</strong><span>Choose a contact to view messages and reply.</span></div>:<><div className="chat-header"><div><strong>{conversations.find(c=>c.id===selectedConversation)?.contacts?.display_name||conversations.find(c=>c.id===selectedConversation)?.contacts?.phone_e164}</strong><span>{conversations.find(c=>c.id===selectedConversation)?.contacts?.phone_e164}</span></div>{(()=>{const c=conversations.find(x=>x.id===selectedConversation);return c?<div className="chat-head-actions"><button className="secondary-button compact" onClick={()=>void handoffConversation(c,!c.bot_paused)}>{c.bot_paused?"Resume bot":"Pause bot"}</button>{c.status!=="resolved"&&<button className="secondary-button compact" onClick={()=>void resolveConversation(c)}>Resolve</button>}</div>:null})()}</div><div className="chat-messages">{messages.map(m=><div key={m.id} className={m.direction==="outbound"?"message-bubble outbound":"message-bubble inbound"}><p>{m.body||"Unsupported media message"}</p><small>{m.actor_type} · {new Date(m.created_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})} · {m.status}</small></div>)}</div><form className="chat-reply" onSubmit={sendReply}><input value={replyText} onChange={(e)=>setReplyText(e.target.value)} placeholder="Reply within the 24-hour service window…" required/><button className="primary-button" disabled={busy}><Send size={15}/> Send</button></form></>}</div></div></section>}
      {view === "Integrations" && <section className="content">
        <PageHeading eyebrow="CHANNELS & DEVELOPER TOOLS" title="Integrations" description="Connect your official WhatsApp Business Platform, then configure developer access only if needed."/>
        <div className="integration-card">
          <div className="integration-head"><div className="integration-logo"><MessageCircle size={24}/></div><div><strong>WhatsApp Business Platform</strong><p>Official Meta Cloud API</p></div><Status status={metaStatus?.enabled&&metaStatus?.verified?"connected":metaStatus?.verified?"verified":"not connected"}/></div>
          <div className="checklist">
            <SetupRow done={Boolean(metaStatus?.phone_number_id)} label="Business number details saved" detail="Phone Number ID and WABA ID are stored for this workspace."/>
            <SetupRow done={Boolean(metaStatus?.verified)} label="Credentials verified" detail="MobiWave successfully checked the number with Meta Graph API."/>
            <SetupRow done={Boolean(metaStatus?.enabled&&metaStatus?.verified)} label="Messaging enabled" detail="Messaging is enabled only after credentials are verified."/>
          </div>
          <p className="muted small">Access tokens are encrypted server-side and never returned to the browser. Saving credentials does not itself verify or enable the connection.</p>
          {isAdmin&&<form onSubmit={saveMeta} className="integration-form">
            <h2>1. Connect your WhatsApp number</h2>
            <div className="form-grid"><div className="field"><label>Phone Number ID *</label><input value={metaPhoneId} onChange={(e)=>setMetaPhoneId(e.target.value)} required pattern="[0-9]{5,30}" placeholder="Numeric ID from Meta"/></div><div className="field"><label>WhatsApp Business Account ID *</label><input value={metaWabaId} onChange={(e)=>setMetaWabaId(e.target.value)} required pattern="[0-9]{5,30}" placeholder="Numeric WABA ID"/></div></div>
            <div className="field"><label>Meta access token *</label><input type="password" value={metaToken} onChange={(e)=>setMetaToken(e.target.value)} required minLength={40} autoComplete="off" placeholder="Paste Meta access token"/></div>
            <div className="form-actions"><button className="primary-button" disabled={busy}>{busy?"Saving…":"Encrypt and save credentials"}</button><button type="button" className="secondary-button" onClick={()=>void verifyMeta()} disabled={busy}><ShieldCheck size={15}/> Verify connection</button><button type="button" className="secondary-button" onClick={()=>void syncTemplates()} disabled={busy}><RefreshCw size={15}/> Sync templates</button></div>
          </form>}
          {metaStatus?.display_phone_number&&<div className="connected-detail"><Check size={15}/> Connected number: {metaStatus.display_phone_number}{metaStatus.verified_name?" · "+metaStatus.verified_name:""}</div>}
        </div>
        <div className="panel form-panel">
          <h2>2. Configure Meta's webhook callback</h2>
          <p className="muted small">Meta requires a callback URL and verification token. Copy both values into your Meta app's Webhooks configuration. The token is stored as a hash and shown only when generated; it cannot be retrieved after leaving this screen.</p>
          <div className="field"><label>Callback URL</label><div className="copyable-value"><code>{(import.meta.env.VITE_SUPABASE_URL||"").replace(/\/$/,"")+"/functions/v1/meta-webhook"}</code><button type="button" className="secondary-button compact" onClick={()=>void copyIntegrationValue((import.meta.env.VITE_SUPABASE_URL||"").replace(/\/$/,"")+"/functions/v1/meta-webhook","Callback URL")}>Copy URL</button></div></div>
          <div className="field"><label>Webhook verification token</label>{metaWebhookToken?<div className="copyable-value"><code>{metaWebhookToken}</code><button type="button" className="secondary-button compact" onClick={()=>void copyIntegrationValue(metaWebhookToken,"Verification token")}>Copy token</button></div>:<p className="muted small">Generate a token to configure a new callback or replace a lost token.</p>}</div>
          {isAdmin&&<div className="form-actions"><button type="button" className="primary-button" onClick={()=>void generateMetaWebhookToken()} disabled={busy}><ShieldCheck size={15}/>{metaWebhookToken?"Generate replacement token":"Generate verification token"}</button></div>}
          <ol className="setup-steps">
            <li>Open your app in Meta for Developers and select <strong>Webhooks</strong>.</li>
            <li>Choose the WhatsApp Business Account object, then paste the callback URL and verification token above.</li>
            <li>Verify and save the callback, then subscribe to the <code>messages</code> field and <code>message_template_status_update</code> where available.</li>
            <li>Subscribe the app to your WhatsApp Business Account and send a test message to confirm it appears in Shared inbox.</li>
          </ol>
          <p className="muted small">Webhook verification is separate from access-token verification. The platform's Meta App Secret must be configured as the <code>META_APP_SECRET</code> Supabase Edge Function secret to validate POST signatures.</p>
        </div>
        <div className="panel form-panel">
          <h2>Developer API</h2><p className="muted small">Use workspace-scoped keys for server-to-server integrations. Never put API keys in browser code or public repositories.</p>
          {isAdmin&&<form onSubmit={createApiKey} className="api-key-create"><div className="field"><label>Key name</label><input value={apiKeyName} onChange={(e)=>setApiKeyName(e.target.value)} required minLength={2} maxLength={120}/></div><button className="primary-button" disabled={busy}><Plus size={15}/> Create API key</button></form>}
          {newApiKey&&<div className="new-key-box"><strong>Copy your new key now</strong><code>{newApiKey}</code><button className="secondary-button" onClick={()=>void copyApiKey()}>Copy key</button><small>It will disappear if you refresh or leave this screen.</small></div>}
          <div className="api-key-list">{apiKeys.length===0?<p className="muted small">No API keys created.</p>:apiKeys.map(key=><div className="api-key-row" key={key.id}><div><strong>{key.name}</strong><code>{key.key_prefix}…</code><small>Created {new Date(key.created_at).toLocaleDateString()} · {key.last_used_at?"Last used "+new Date(key.last_used_at).toLocaleString():"Not used yet"}{key.expires_at?" · Expires "+new Date(key.expires_at).toLocaleDateString():""}</small></div><Status status={key.revoked_at?"revoked":"active"}/>{isAdmin&&!key.revoked_at&&<button className="secondary-button compact" onClick={()=>void revokeApiKey(key)}>Revoke</button>}</div>)}</div>
          <div className="api-example"><strong>Send an approved template</strong><pre>{`POST ${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api-send
apikey: YOUR_SUPABASE_PUBLISHABLE_KEY
X-API-Key: YOUR_MOBIWAVE_API_KEY
Content-Type: application/json

{"to":"+2547XXXXXXXX","template_name":"approved_template","language_code":"en","components":[]}`}</pre></div>
        </div>
        <details className="panel form-panel">
          <summary><strong>Advanced: customer event webhooks</strong><span className="muted small"> Send MobiWave events to your own HTTPS endpoints</span></summary>
          <p className="muted small">This is separate from the Meta callback above. Customer webhooks send signed MobiWave events to your server; they do not receive Meta's inbound WhatsApp webhook.</p>
          {isAdmin&&<form className="webhook-create" onSubmit={createWebhook}><div className="form-grid"><div className="field"><label>Webhook name</label><input value={webhookName} onChange={(e)=>setWebhookName(e.target.value)} required minLength={2} maxLength={120}/></div><div className="field"><label>HTTPS endpoint URL</label><input type="url" value={webhookUrl} onChange={(e)=>setWebhookUrl(e.target.value)} required placeholder="https://api.yourbusiness.co.ke/hooks/mobiwave"/></div></div><div className="webhook-event-options">{[["message.inbound","Inbound message"],["message.status","Delivery status"],["message.outbound","Outbound message"],["campaign.completed","Campaign completed"],["knowledge.indexed","Knowledge indexed"],["conversation.updated","Conversation updated"]].map(([value,label])=><label key={value} className="checkbox-line"><input type="checkbox" checked={webhookEvents.includes(value)} onChange={(e)=>setWebhookEvents(current=>e.target.checked?[...current,value]:current.filter(item=>item!==value))}/>{label}</label>)}</div><div className="form-actions"><span className="muted small">HTTPS only · public host required</span><button className="primary-button" disabled={busy}><Plus size={15}/> Add webhook</button></div></form>}
          {newWebhookSecret&&<div className="new-key-box"><strong>Copy your webhook signing secret now</strong><code>{newWebhookSecret}</code><button className="secondary-button" onClick={()=>void copyWebhookSecret()}>Copy secret</button><small>Use this secret to verify X-MobiWave-Signature. It cannot be retrieved again.</small></div>}
          <div className="api-key-list">{webhooks.length===0?<p className="muted small">No customer webhooks configured.</p>:webhooks.map(h=><div className="api-key-row" key={h.id}><div><strong>{h.name}</strong><code>{h.endpoint_url}</code><small>Events: {h.events.join(", ")}</small>{h.last_error&&<small className="error-text">{h.last_error}</small>}{h.last_delivery_at&&<small>Last delivery: {new Date(h.last_delivery_at).toLocaleString()}</small>}</div><Status status={h.enabled?(h.last_status||"active"):"disabled"}/>{isAdmin&&h.enabled&&<button className="secondary-button compact" onClick={()=>void testWebhook(h)} disabled={busy}>Send test</button>}{isAdmin&&<button className="secondary-button compact" onClick={()=>void manageWebhook(h,h.enabled?"disable":"enable")}>{h.enabled?"Disable":"Enable"}</button>}{isAdmin&&<button className="icon-button" onClick={()=>void manageWebhook(h,"delete")} aria-label="Delete webhook"><Trash2 size={15}/></button>}</div>)}</div>
          <div className="section-header"><div><h3>Recent delivery history</h3><p>Latest 50 attempts across this workspace.</p></div></div>
          <div className="api-key-list">{webhookDeliveries.length===0?<p className="muted small">No webhook deliveries yet. Use Send test to validate an endpoint.</p>:webhookDeliveries.map(delivery=><div className="api-key-row" key={delivery.id}><div><strong>{delivery.event_type}</strong><small>{new Date(delivery.created_at).toLocaleString()} · Attempt {delivery.attempt_count}{delivery.response_status?" · HTTP "+delivery.response_status:""}</small>{delivery.last_error&&<small className="error-text">{delivery.last_error}</small>}</div><Status status={delivery.status}/>{isAdmin&&["failed","dead"].includes(delivery.status)&&<button className="secondary-button compact" onClick={()=>void retryWebhookDelivery(delivery)} disabled={busy}>Retry</button>}</div>)}</div>
          <div className="muted small">Signatures use HMAC-SHA256 over the exact raw JSON body. Use X-MobiWave-Delivery for idempotency.</div>
        </details>
      </section>}
      {view === "Profile" && <section className="content"><PageHeading eyebrow="ACCOUNT" title="Your profile" description="Manage the name shown in your workspace and update your sign-in password."/><form className="panel form-panel profile-form" onSubmit={saveProfile}><h2>Personal details</h2><div className="profile-summary"><div className="profile-avatar large">{(profileName.trim() || user.email || "U").slice(0,1).toUpperCase()}</div><div><strong>{profileName.trim() || "Workspace member"}</strong><span>{activeTenant?.role ?? "Member"} · {activeTenant?.name ?? "No workspace"}</span></div></div><div className="field"><label>Full name</label><input value={profileName} onChange={(e)=>setProfileName(e.target.value)} maxLength={120} placeholder="Your name"/></div><div className="field"><label>Email address</label><input value={user.email ?? ""} readOnly aria-readonly="true"/><small className="muted small">Your sign-in email is managed by your authentication account.</small></div><div className="field"><label>New password <span className="muted small">(optional)</span></label><input type="password" value={newPassword} onChange={(e)=>setNewPassword(e.target.value)} minLength={8} autoComplete="new-password" placeholder="At least 8 characters"/></div><div className="form-actions"><span className="muted small">Leave the password blank to keep it unchanged.</span><button className="primary-button" disabled={busy}>{busy?"Saving…":"Save profile"}</button></div></form><div className="privacy-note"><ShieldCheck size={18}/><div><strong>Account security</strong><p>Use a unique password. Your profile is stored with your authenticated account and does not change workspace permissions.</p></div></div></section>}
      {view === "Settings" && <section className="content"><PageHeading eyebrow="PREFERENCES" title="Settings" description="Review your workspace, account access and the configuration areas available to you."/><div className="panel settings-panel"><div className="setting-row"><div className="setting-icon"><Users size={19}/></div><div className="setting-copy"><strong>Active workspace</strong><p>{activeTenant?.name ?? "No workspace selected"} · workspace ID and role are managed by workspace membership.</p></div><span className="fixed-setting">{activeTenant?.role ?? "Member"}</span></div><div className="setting-row"><div className="setting-icon"><MessageCircle size={19}/></div><div className="setting-copy"><strong>WhatsApp connection</strong><p>{metaStatus?.enabled ? "Meta Cloud API is enabled for this workspace." : "Meta Cloud API is not enabled yet. Open Integrations to configure and verify it."}</p></div><button type="button" className="secondary-button compact" onClick={()=>setView("Integrations")}>Open integrations</button></div><div className="setting-row"><div className="setting-icon"><Bot size={19}/></div><div className="setting-copy"><strong>AI behaviour</strong><p>{settings.ai_enabled ? "AI replies are enabled." : "AI replies are currently disabled."} Configure reply rules, retention and handoff.</p></div><button type="button" className="secondary-button compact" onClick={()=>setView("Chatbot settings")}>Chatbot settings</button></div><div className="setting-row"><div className="setting-icon"><ShieldCheck size={19}/></div><div className="setting-copy"><strong>Workspace access</strong><p>Your current role is {activeTenant?.role ?? "Member"}. Administrative actions are restricted to workspace owners and admins.</p></div><span className="fixed-setting">{isAdmin?"Admin access":"Member access"}</span></div><div className="setting-row"><div className="setting-icon"><LogOut size={19}/></div><div className="setting-copy"><strong>Sign out</strong><p>End this session on the current browser.</p></div><button type="button" className="secondary-button compact" onClick={()=>void signOut()}>Sign out</button></div></div><div className="privacy-note"><ShieldCheck size={18}/><div><strong>Privacy and data separation</strong><p>Workspace records are tenant-scoped. Use Profile to update your account details; workspace-level AI controls remain under Chatbot settings.</p></div></div></section>}
      {loading&&<div className="loading-bar"><LoaderCircle className="spin" size={14}/> Loading workspace data…</div>}
      {notice&&<div className="toast" role="status"><div className="toast-icon"><Check size={15}/></div><span>{notice}</span><button aria-label="Dismiss" onClick={()=>setNotice("")}><X size={15}/></button></div>}
      <footer className="footer"><span>© 2026 MobiWave Innovations Ltd</span><span><span className="footer-dot"/> {metaStatus?.enabled?"Meta API connected":"Meta not connected"}</span></footer>
    </main>
  </div>;
}

function Brand() { return <div className="brand"><div className="brand-mark"><MessageCircle size={21} strokeWidth={2.5}/></div><div><strong>MobiWave</strong><span>WHATSAPP PLATFORM</span></div></div>; }
function PageHeading({eyebrow,title,description}:{eyebrow:string;title:string;description:string}) { return <div className="page-heading"><div><div className="eyebrow"><Activity size={14}/>{eyebrow}</div><h1>{title}</h1><p className="page-description">{description}</p></div></div>; }
function Metric({icon,label,value,note}:{icon:ReactNode;label:string;value:number|string;note:string}) { return <div className="metric-card"><div className="metric-top"><span className="metric-icon">{icon}</span><span className="metric-label">{label}</span></div><div className="metric-value">{value}</div><div className="metric-note">{note}</div></div>; }
function Status({status}:{status:string}) { const s=status.toLowerCase(); const tone=["approved","indexed","completed","delivered","read","connected","opted_in","sent","verified"].includes(s)?"success":["failed","rejected","opted_out","paused"].includes(s)?"danger":["needs_review","suggested","pending","running","queued","unknown","not connected","draft"].includes(s)?"warning":"neutral"; return <span className={"status-pill "+tone}><span/>{status.replaceAll("_"," ")}</span>; }
function Empty({icon,title,text}:{icon:ReactNode;title:string;text:string}) { return <div className="empty-state">{icon}<strong>{title}</strong><span>{text}</span></div>; }
function SetupRow({done=false,label,detail}:{done?:boolean;label:string;detail:string}) { return <div className="setup-row"><div className={done?"setup-check done":"setup-check"}>{done?<Check size={15}/>:<span/>}</div><div><strong>{label}</strong><p>{detail}</p></div><span className={done?"setup-status complete":"setup-status"}>{done?"Done":"Pending"}</span></div>; }
