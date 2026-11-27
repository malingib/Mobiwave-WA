import { useMemo, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  ArrowUpRight, Inbox, MessageCircle, Users, X, Zap,
} from "lucide-react";
import { KpiCard, SetupRow, Status, WidgetCard } from "../components/ui";

type Conversation = { id: string; status: string; unread?: boolean; last_message_at?: string; contacts?: { display_name?: string; phone_e164: string } };
type MetaStatus = { enabled?: boolean; verified?: boolean; display_phone_number?: string; phone_number_id?: string } | null;

export type DailyMessagePoint = { date: string; label: string; inbound: number; outbound: number };
export type OverviewMetrics = {
  contacts: { total: number; opted_in: number; opted_out: number };
  conversations: { total: number; open: number; pending: number; resolved: number; unread: number };
  unfinished_campaigns: number;
  approved_templates: number;
};

/* Recharts needs concrete values, so these mirror the light token set. */
const SERIES_1 = "var(--color-series-1)";
const SERIES_2 = "var(--color-series-2)";
const SERIES_3 = "var(--color-series-4)";
const AXIS = "var(--color-text-faint)";
const GRID = "var(--color-hairline)";

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-hairline-strong bg-raised px-2.5 py-2 text-[11.5px] shadow-raised">
      {label && <p className="mb-1 font-semibold text-text">{label}</p>}
      {payload.map((entry: any) => (
        <p key={entry.dataKey} className="flex items-center gap-1.5 text-text-muted">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: entry.color || entry.payload?.fill }} />
          <span className="capitalize">{entry.name}: </span>
          <strong className="font-semibold text-text">{entry.value}</strong>
        </p>
      ))}
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = { open: "var(--color-series-3)", pending: SERIES_3, resolved: SERIES_1 };

export default function Overview({
  conversations,
  dailyMessages,
  metrics,
  metricsError,
  metricsLoading = false,
  metaStatus,
  tenantId,
  onNavigate,
  onOpenConversation,
}: {
  conversations: Conversation[];
  dailyMessages: DailyMessagePoint[];
  metrics: OverviewMetrics | null;
  metricsError: string;
  metricsLoading?: boolean;
  metaStatus: MetaStatus;
  tenantId: string;
  onNavigate: (view: string) => void;
  onOpenConversation: (conversationId: string) => void;
}) {
  const [range, setRange] = useState<7 | 14>(14);
  const onboardingDismissKey = `mobiwave-wa:onboarding-dismissed:${tenantId}`;
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try { return localStorage.getItem(onboardingDismissKey) !== "true"; }
    catch { return true; }
  });

  const stats = useMemo(() => {
    const open = metrics?.conversations.open ?? 0;
    const unread = metrics?.conversations.unread ?? 0;
    const pending = metrics?.conversations.pending ?? 0;
    const resolved = metrics?.conversations.resolved ?? 0;
    const optedIn = metrics?.contacts.opted_in ?? 0;
    const optedOut = metrics?.contacts.opted_out ?? 0;
    const unknown = Math.max(0, (metrics?.contacts.total ?? 0) - optedIn - optedOut);
    const inbound = dailyMessages.reduce((sum, day) => sum + day.inbound, 0);
    const outbound = dailyMessages.reduce((sum, day) => sum + day.outbound, 0);
    const unfinishedCampaigns = metrics?.unfinished_campaigns ?? 0;
    const approvedTemplates = metrics?.approved_templates ?? 0;
    return {
      open, unread, pending, resolved, optedIn, optedOut, unknown, inbound, outbound,
      messages14d: inbound + outbound,
      unfinishedCampaigns, approvedTemplates,
      consentMix: [
        { name: "Opted in", value: optedIn, fill: "var(--color-series-3)" },
        { name: "Opted out", value: optedOut, fill: "var(--color-series-5)" },
        { name: "No record", value: unknown, fill: "var(--color-ink-300)" },
      ],
      statusMix: [
        { name: "Open", value: open, fill: STATUS_COLORS.open },
        { name: "Pending", value: pending, fill: STATUS_COLORS.pending },
        { name: "Resolved", value: resolved, fill: STATUS_COLORS.resolved },
      ],
    };
  }, [conversations, metrics, dailyMessages]);

  const visibleMessages = useMemo(() => dailyMessages.slice(-range), [dailyMessages, range]);
  const visibleInbound = visibleMessages.reduce((sum, day) => sum + day.inbound, 0);
  const visibleOutbound = visibleMessages.reduce((sum, day) => sum + day.outbound, 0);
  const visibleMessagesTotal = visibleInbound + visibleOutbound;
  const recent = useMemo(() => [...conversations].slice(0, 6), [conversations]);
  const whatsappConnected = Boolean(metaStatus?.enabled && metaStatus?.verified);
  const contactTotal = metrics?.contacts.total ?? 0;
  const conversationTotal = metrics?.conversations.total ?? 0;
  const optInShare = contactTotal ? Math.round((stats.optedIn / contactTotal) * 100) : 0;
  // "Loading" and "unavailable" are different states and must not read alike.
  const metricsStatusText = metricsError
    ? metricsError
    : metricsLoading
      ? "Loading workspace metrics…"
      : "Workspace metrics are unavailable for this plan.";
  const metricsStatusHint = metricsError || metricsLoading
    ? "Workspace metrics unavailable"
    : "Not included in this workspace’s active tier";

  return (
    <div className="overview-page flex flex-col gap-5">
      {/* Onboarding checklist. Once every step is done it collapses into a
          quiet "ready" state instead of showing green ticks with stale copy. */}
      {metrics && (() => {
        const steps = [
          {
            done: Boolean(metaStatus?.enabled && metaStatus?.verified),
            label: "Connect WhatsApp number",
            detail: metaStatus?.display_phone_number ? `Connected · ${metaStatus.display_phone_number}` : "Link an official Meta Cloud API number",
            view: "Integrations", cta: "Connect WhatsApp",
          },
          {
            done: stats.approvedTemplates > 0,
            label: "Create approved templates",
            detail: `${stats.approvedTemplates} approved · required for bulk campaigns`,
            view: "Templates", cta: "Create templates",
          },
          {
            done: metrics.contacts.total > 0,
            label: "Add contacts",
            detail: `${metrics.contacts.total} contact(s) · ${stats.optedIn} opted in`,
            view: "Contacts", cta: "Add contacts",
          },
        ];
        const remaining = steps.filter((step) => !step.done);
        return (
          showOnboarding && (
            <div className={"onboarding-banner panel p-4 " + (remaining.length === 0 ? "is-ready" : "")}>
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3 flex-1">
                  <span className="kpi-icon"><Zap size={18} /></span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[13px] font-bold text-text">
                      {remaining.length === 0 ? "Your workspace is ready to send" : "Getting started with MobiWave WA"}
                    </h3>
                    <p className="mt-0.5 text-[12px] text-text-muted">
                      {remaining.length === 0
                        ? "WhatsApp is connected, templates are approved and contacts are in place."
                        : "Complete these steps to start sending bulk WhatsApp messages:"}
                    </p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {steps.map((step) => (
                        <SetupRow key={step.label} done={step.done} label={step.label} detail={step.detail} />
                      ))}
                    </div>
                    {remaining.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {remaining.map((step) => (
                          <button key={step.view} type="button" className="btn btn-secondary btn-sm" onClick={() => onNavigate(step.view)}>
                            {step.cta}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="icon-btn ml-2 flex-shrink-0"
                  onClick={() => {
                    setShowOnboarding(false);
                    try { localStorage.setItem(onboardingDismissKey, "true"); } catch { /* keep dismissal for this session */ }
                  }}
                  aria-label="Close onboarding banner"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          )
        );
      })()}
      
      <div className="overview-intro">
        <div>
          <span className="eyebrow">Workspace overview</span>
          <h1>Your messaging at a glance</h1>
          <p>A live view of conversations, audience readiness and WhatsApp activity.</p>
        </div>
      </div>
      {/* KPI row */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Messages"
          value={metrics ? visibleMessagesTotal.toLocaleString() : "—"}
          hint={metrics ? `Last ${range} days · ${visibleInbound} in / ${visibleOutbound} out` : metricsStatusHint}
          icon={<MessageCircle size={20} />}
          tone="brand"
        />
        <KpiCard
          label="Open conversations"
          value={metrics ? String(stats.open) : "—"}
          hint={metrics ? `${stats.pending} pending · ${stats.resolved} resolved` : metricsStatusHint}
          icon={<Inbox size={20} />}
          tone="warning"
        />
        <KpiCard
          label="Opted-in contacts"
          value={metrics ? stats.optedIn.toLocaleString() : "—"}
          hint={metrics ? `${optInShare}% of ${contactTotal} contact(s)` : metricsStatusHint}
          icon={<Users size={20} />}
          tone="success"
        />
        <KpiCard
          label="Unfinished campaigns"
          value={metrics ? stats.unfinishedCampaigns.toLocaleString() : "—"}
          hint={metrics ? "Draft, scheduled or running" : metricsStatusHint}
          icon={<Zap size={20} />}
          tone="danger"
        />
      </div>

      {/* Charts row */}
      <div className="grid gap-3 xl:grid-cols-3">
        <WidgetCard
          className="xl:col-span-2"
          title="Message volume"
          subtitle="Inbound and outbound messages per day"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-md border border-hairline-strong bg-raised p-0.5" role="group" aria-label="Chart range">
                {([7, 14] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={range === value}
                    onClick={() => setRange(value)}
                    className={
                      "rounded px-2 py-1 text-[11px] font-medium transition-colors " +
                      (range === value ? "bg-surface text-text shadow-card" : "text-text-muted hover:text-text")
                    }
                  >
                    {value}d
                  </button>
                ))}
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => onNavigate("Campaigns")}>
                Campaigns <ArrowUpRight size={12} />
              </button>
            </div>
          }
        >
          {!metrics ? (
            <div className="flex h-[236px] flex-col items-center justify-center gap-2 text-center">
              <MessageCircle size={20} className="text-text-faint" />
              <p className="text-[12.5px] font-medium text-text-muted">{metricsStatusText}</p>
            </div>
          ) : stats.messages14d === 0 ? (
            <div className="flex h-[236px] flex-col items-center justify-center gap-2 text-center">
              <MessageCircle size={20} className="text-text-faint" />
              <p className="text-[12.5px] font-medium text-text-muted">No messages in the last 14 days</p>
              <p className="max-w-xs text-[11.5px] text-text-muted">Volume appears as soon as your team and your contacts start exchanging messages.</p>
            </div>
          ) : (
            <div className="h-[236px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={visibleMessages} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="fillInbound" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={SERIES_1} stopOpacity={0.2} />
                      <stop offset="100%" stopColor={SERIES_1} stopOpacity={0.01} />
                    </linearGradient>
                    <linearGradient id="fillOutbound" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={SERIES_2} stopOpacity={0.18} />
                      <stop offset="100%" stopColor={SERIES_2} stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: AXIS, fontSize: 10.5 }} dy={4} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fill: AXIS, fontSize: 10.5 }} allowDecimals={false} width={40} />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: GRID }} />
                  <Area type="monotone" dataKey="inbound" name="Inbound" stroke={SERIES_1} strokeWidth={1.8} fill="url(#fillInbound)" />
                  <Area type="monotone" dataKey="outbound" name="Outbound" stroke={SERIES_2} strokeWidth={1.8} fill="url(#fillOutbound)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="mt-2 flex items-center gap-4 border-t border-hairline-strong pt-2.5 text-[11px] text-text-muted">
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-brand-400" aria-hidden /> Inbound</span>
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full" style={{ background: SERIES_2 }} aria-hidden /> Outbound</span>
            <span className="ml-auto text-text-faint">Last {range} days</span>
          </div>
        </WidgetCard>

        <WidgetCard title="Conversations by status" subtitle={metrics ? `${conversationTotal} in this workspace` : metricsStatusHint}>
          {!metrics ? (
            <div className="flex h-[236px] items-center justify-center text-center text-[11.5px] text-text-muted">{metricsStatusText}</div>
          ) : conversationTotal === 0 ? (
            <div className="flex h-[236px] flex-col items-center justify-center gap-2 text-center text-text-muted">
              <Inbox size={18} />
              <p className="text-[11.5px]">No conversations yet.</p>
            </div>
          ) : (
            <div className="flex h-[236px] flex-col">
              <div className="relative h-[180px]">
                <ResponsiveContainer width="100%" height={180} debounce={50}>
                  <PieChart>
                    <Pie data={stats.statusMix} dataKey="value" nameKey="name" innerRadius={52} outerRadius={72} paddingAngle={2} stroke="none" isAnimationActive={false}>
                      {stats.statusMix.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <strong className="font-display text-[22px] font-semibold leading-none text-text">{conversationTotal}</strong>
                  <span className="mt-1 text-[10.5px] text-text-faint">total</span>
                </div>
                </div>
                <div className="mt-2 flex flex-col gap-1.5 border-t border-hairline-strong pt-2.5 text-[11.5px]">
                {stats.statusMix.map((entry) => (
                  <span key={entry.name} className="flex items-center gap-2 text-text-muted">
                    <i className="h-1.5 w-1.5 rounded-full" style={{ background: entry.fill }} />
                    {entry.name}
                    <strong className="ml-auto font-semibold text-text">{entry.value}</strong>
                  </span>
                ))}
                </div>
            </div>
          )}
        </WidgetCard>
      </div>

      {/* Activity + readiness row */}
      <div className="grid gap-3 xl:grid-cols-3">
        <WidgetCard
          className="xl:col-span-2"
          title="Recent conversations"
          subtitle="Jump straight back into the latest threads"
          action={
            <button className="btn btn-secondary btn-sm" onClick={() => onNavigate("Inbox")}>
              Open inbox <ArrowUpRight size={12} />
            </button>
          }
        >
          {recent.length === 0 ? (
            <p className="rounded-lg border border-dashed border-hairline-strong bg-raised/60 p-5 text-[12px] text-text-muted">
              New messages from your contacts will show up here.
            </p>
          ) : (
            <div className="-mx-4 -my-2">
              <div className="grid grid-cols-[minmax(0,1fr)_90px_96px_20px] gap-2 border-b border-hairline-strong px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-faint">
                <span>Contact</span><span>Status</span><span>Last message</span><span />
              </div>
              {recent.map((conversation) => (
                <button
                  key={conversation.id}
                  className="group grid w-full grid-cols-[minmax(0,1fr)_90px_96px_20px] items-center gap-2 border-b border-hairline-strong px-4 py-2.5 text-left transition-colors last:border-0 hover:bg-raised"
                  onClick={() => onOpenConversation(conversation.id)}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-800">
                      {(conversation.contacts?.display_name || conversation.contacts?.phone_e164 || "?").slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <strong className="block truncate text-[12.5px] font-medium text-text">
                        {conversation.contacts?.display_name || conversation.contacts?.phone_e164 || "Unknown contact"}
                      </strong>
                      <span className="block truncate text-[11px] text-text-muted">{conversation.contacts?.phone_e164}</span>
                    </span>
                  </span>
                  <Status status={conversation.status} />
                  <span className="truncate text-[11px] text-text-muted">
                    {conversation.last_message_at ? new Date(conversation.last_message_at).toLocaleDateString() : "No messages"}
                  </span>
                  <ArrowUpRight size={13} className="text-text-faint transition-colors group-hover:text-brand-400" />
                </button>
              ))}
            </div>
          )}
        </WidgetCard>

        <div className="flex flex-col gap-3">
          <WidgetCard title="Consent mix" subtitle="Campaign eligibility source of truth">
            {!metrics ? (
              <p className="rounded-lg border border-dashed border-hairline-strong bg-raised/60 p-4 text-[12px] text-text-muted">{metricsStatusText}</p>
            ) : contactTotal === 0 ? (
              <p className="rounded-lg border border-dashed border-hairline-strong bg-raised/60 p-4 text-[12px] text-text-muted">
                Add contacts to see your consent breakdown.
              </p>
            ) : (
              <div className="h-[148px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.consentMix} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap={20}>
                    <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: AXIS, fontSize: 10.5 }} dy={4} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fill: AXIS, fontSize: 10.5 }} allowDecimals={false} width={36} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(12, 36, 60, 0.04)" }} />
                    <Bar dataKey="value" name="Contacts" radius={[5, 5, 0, 0]}>
                      {stats.consentMix.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </WidgetCard>

          <WidgetCard
            className="readiness-card"
            title="Messaging readiness"
            subtitle="What is ready right now"
            action={
              <button className="btn btn-secondary btn-sm" onClick={() => onNavigate("Integrations")}>
                Manage
              </button>
            }
          >
            {(() => {
              const ready = [whatsappConnected, stats.approvedTemplates > 0, stats.optedIn > 0].filter(Boolean).length;
              const pct = Math.round((ready / 3) * 100);
              const circumference = 2 * Math.PI * 46;
              return (
                <div className="readiness-body">
                  <div className="readiness-ring">
                    <svg viewBox="0 0 110 110" aria-hidden>
                      <circle cx="55" cy="55" r="46" fill="none" stroke="rgba(255,255,255,.25)" strokeWidth="7" />
                      <circle
                        cx="55" cy="55" r="46" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round"
                        strokeDasharray={`${(pct / 100) * circumference} ${circumference}`}
                        transform="rotate(-90 55 55)"
                      />
                    </svg>
                    <div className="readiness-ring-label">
                      <strong>{pct}%</strong>
                      <span>{ready} of 3 ready</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <SetupRow done={whatsappConnected} label="WhatsApp number connected" detail={metaStatus?.display_phone_number || "Add Meta credentials to connect a number."} />
                    <SetupRow done={stats.approvedTemplates > 0} label="Approved templates synced" detail={`${stats.approvedTemplates} available for campaigns.`} />
                    <SetupRow done={stats.optedIn > 0} label="Opted-in audience recorded" detail={`${stats.optedIn} contact(s) eligible.`} />
                  </div>
                </div>
              );
            })()}
          </WidgetCard>
        </div>
      </div>

    </div>
  );
}
