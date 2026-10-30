import { useMemo, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  ArrowUpRight, Inbox, MessageCircle, Radio, Users,
} from "lucide-react";
import { KpiCard, SetupRow, Status, WidgetCard } from "../components/ui";

type Conversation = { id: string; status: string; unread?: boolean; last_message_at?: string; contacts?: { display_name?: string; phone_e164: string } };
type Contact = { consent_status: string };
type Campaign = { id: string; name: string; status: string; created_at: string };
type Template = { meta_status: string };
type MetaStatus = { enabled?: boolean; verified?: boolean; display_phone_number?: string; phone_number_id?: string } | null;

export type DailyMessagePoint = { date: string; label: string; inbound: number; outbound: number };

/* Recharts needs concrete values, so these mirror the Midnight token set. */
const SERIES_1 = "#22c98a";
const SERIES_2 = "#6c8cff";
const SERIES_3 = "#f0b44c";
const AXIS = "#73827b";
const GRID = "rgba(255,255,255,0.06)";

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

const STATUS_COLORS: Record<string, string> = { open: SERIES_1, pending: SERIES_3, resolved: SERIES_2 };

/* Compact 7/14 day sparkline used inside the KPI cards. */
function Sparkline({ data, dataKey, color }: { data: DailyMessagePoint[]; dataKey: "inbound" | "outbound"; color: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={"spark-" + dataKey} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.22} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.6} fill={"url(#spark-" + dataKey + ")"} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export default function Overview({
  conversations,
  contacts,
  campaigns,
  templates,
  dailyMessages,
  metaStatus,
  onNavigate,
  onOpenConversation,
}: {
  conversations: Conversation[];
  contacts: Contact[];
  campaigns: Campaign[];
  templates: Template[];
  dailyMessages: DailyMessagePoint[];
  metaStatus: MetaStatus;
  onNavigate: (view: string) => void;
  onOpenConversation: (conversationId: string) => void;
}) {
  const [range, setRange] = useState<7 | 14>(14);

  const stats = useMemo(() => {
    const open = conversations.filter((c) => c.status === "open").length;
    const unread = conversations.filter((c) => c.unread).length;
    const pending = conversations.filter((c) => c.status === "pending").length;
    const resolved = conversations.filter((c) => c.status === "resolved").length;
    const optedIn = contacts.filter((c) => c.consent_status === "opted_in").length;
    const optedOut = contacts.filter((c) => c.consent_status === "opted_out").length;
    const unknown = contacts.length - optedIn - optedOut;
    const inbound = dailyMessages.reduce((sum, day) => sum + day.inbound, 0);
    const outbound = dailyMessages.reduce((sum, day) => sum + day.outbound, 0);
    const activeCampaigns = campaigns.filter((c) => ["running", "draft", "paused"].includes(c.status)).length;
    const approvedTemplates = templates.filter((t) => t.meta_status === "approved").length;
    return {
      open, unread, pending, resolved, optedIn, optedOut, unknown, inbound, outbound,
      messages14d: inbound + outbound,
      activeCampaigns, approvedTemplates,
      consentMix: [
        { name: "Opted in", value: optedIn, fill: SERIES_1 },
        { name: "Opted out", value: optedOut, fill: "#e15b7c" },
        { name: "No record", value: unknown, fill: "#cfd7d3" },
      ],
      statusMix: [
        { name: "Open", value: open, fill: STATUS_COLORS.open },
        { name: "Pending", value: pending, fill: STATUS_COLORS.pending },
        { name: "Resolved", value: resolved, fill: STATUS_COLORS.resolved },
      ],
    };
  }, [conversations, contacts, campaigns, dailyMessages, templates]);

  const visibleMessages = useMemo(() => dailyMessages.slice(-range), [dailyMessages, range]);
  const recent = useMemo(() => [...conversations].slice(0, 6), [conversations]);
  const whatsappConnected = Boolean(metaStatus?.enabled && metaStatus?.verified);
  const optInShare = contacts.length ? Math.round((stats.optedIn / contacts.length) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* KPI row */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Messages · last 14 days"
          value={stats.messages14d.toLocaleString()}
          hint={`${stats.inbound} inbound · ${stats.outbound} outbound`}
          icon={<MessageCircle size={13} />}
          trend={<Sparkline data={dailyMessages} dataKey="inbound" color={SERIES_1} />}
        />
        <KpiCard
          label="Open conversations"
          value={String(stats.open)}
          delta={stats.unread ? `${stats.unread} unread` : "All read"}
          deltaTone={stats.unread ? "negative" : "positive"}
          hint={`${stats.pending} pending · ${stats.resolved} resolved`}
          icon={<Inbox size={13} />}
        >
          <button className="text-[11.5px] font-medium text-brand-700 hover:text-brand-800" onClick={() => onNavigate("Inbox")}>
            Open inbox
          </button>
        </KpiCard>
        <KpiCard
          label="Opted-in contacts"
          value={stats.optedIn.toLocaleString()}
          hint={`${optInShare}% of ${contacts.length} contact(s)`}
          icon={<Users size={13} />}
        >
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-text-faint" aria-hidden>
            <div className="h-full rounded-full bg-brand-600" style={{ width: `${optInShare}%` }} />
          </div>
        </KpiCard>
        <KpiCard
          label="WhatsApp connection"
          value={whatsappConnected ? "Live" : "Setup"}
          delta={whatsappConnected ? "Connected" : "Pending"}
          deltaTone={whatsappConnected ? "positive" : "negative"}
          hint={metaStatus?.display_phone_number || "Connect a number to start"}
          icon={<Radio size={13} />}
        >
          <button className="text-[11.5px] font-medium text-brand-700 hover:text-brand-800" onClick={() => onNavigate("Integrations")}>
            Manage
          </button>
        </KpiCard>
      </div>

      {/* Charts row */}
      <div className="grid gap-3 xl:grid-cols-3">
        <WidgetCard
          className="xl:col-span-2"
          title="Message volume"
          subtitle="Inbound and outbound messages per day"
          action={
            <div className="flex items-center gap-2">
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
          {stats.messages14d === 0 ? (
            <div className="flex h-[236px] flex-col items-center justify-center gap-2 text-center">
              <MessageCircle size={20} className="text-text-faint" />
              <p className="text-[12.5px] font-medium text-text-muted">No messages in the last 14 days</p>
              <p className="max-w-xs text-[11.5px] text-text-muted">Volume appears as soon as your team and your contacts start exchanging messages.</p>
            </div>
          ) : (
            <div className="h-[236px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={visibleMessages} margin={{ top: 6, right: 4, bottom: 0, left: -20 }}>
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
                  <YAxis tickLine={false} axisLine={false} tick={{ fill: AXIS, fontSize: 10.5 }} allowDecimals={false} width={36} />
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

        <WidgetCard title="Conversations by status" subtitle={`${conversations.length} in this workspace`}>
          {conversations.length === 0 ? (
            <div className="flex h-[236px] flex-col items-center justify-center gap-2 text-center text-text-muted">
              <Inbox size={18} />
              <p className="text-[11.5px]">No conversations yet.</p>
            </div>
          ) : (
            <div className="flex h-[236px] flex-col">
              <div className="relative min-h-0 flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={stats.statusMix} dataKey="value" nameKey="name" innerRadius={56} outerRadius={78} paddingAngle={2} stroke="none">
                      {stats.statusMix.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <strong className="font-display text-[22px] font-semibold leading-none text-text">{conversations.length}</strong>
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
            {contacts.length === 0 ? (
              <p className="rounded-lg border border-dashed border-hairline-strong bg-raised/60 p-4 text-[12px] text-text-muted">
                Add contacts to see your consent breakdown.
              </p>
            ) : (
              <div className="h-[148px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.consentMix} margin={{ top: 4, right: 4, bottom: 0, left: -24 }} barCategoryGap={20}>
                    <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: AXIS, fontSize: 10.5 }} dy={4} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fill: AXIS, fontSize: 10.5 }} allowDecimals={false} width={32} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                    <Bar dataKey="value" name="Contacts" radius={[5, 5, 0, 0]}>
                      {stats.consentMix.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </WidgetCard>

          <WidgetCard
            title="Messaging readiness"
            subtitle="What is ready right now"
            action={
              <button className="btn btn-secondary btn-sm" onClick={() => onNavigate("Integrations")}>
                Manage
              </button>
            }
          >
            <div className="flex flex-col gap-1.5">
              <SetupRow done={whatsappConnected} label="WhatsApp number connected" detail={metaStatus?.display_phone_number || "Add Meta credentials to connect a number."} />
              <SetupRow done={stats.approvedTemplates > 0} label="Approved templates synced" detail={`${stats.approvedTemplates} available for campaigns.`} />
              <SetupRow done={stats.optedIn > 0} label="Opted-in audience recorded" detail={`${stats.optedIn} contact(s) eligible.`} />
            </div>
          </WidgetCard>
        </div>
      </div>

    </div>
  );
}
