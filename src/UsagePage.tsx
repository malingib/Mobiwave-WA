import React, { useState, useEffect } from 'react';
import { HardDrive, Megaphone, MessageSquare, Send } from 'lucide-react';
import { supabase as supabaseClient } from './lib/supabase';
import { MarketingChrome } from './components/MarketingChrome';
import { Empty, KpiCard } from './components/ui';

const supabase = supabaseClient!;

interface UsageStat {
  id: string;
  period_start: string;
  period_end: string;
  messages_sent: number;
  messages_received: number;
  campaigns_launched: number;
  templates_created: number;
  meta_cost: number;
  storage_used: number;
  storage_limit: number;
}

interface MetaAllowance {
  free_limit: number;
  free_service_used: number;
  free_service_remaining: number;
  period_end: string;
  connected: boolean;
}

type UsagePageProps = { tenantId: string };\nconst UsagePage: React.FC<UsagePageProps> = ({ tenantId }) => {
  const [loading, setLoading] = useState(true);
  const [usageStats, setUsageStats] = useState<UsageStat[]>([]);
  const [metaAllowance, setMetaAllowance] = useState<MetaAllowance | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState('30d');
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    fetchUsageData();
  }, [selectedPeriod]);

  const fetchUsageData = async () => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw authError;

      const { data: membership, error: membershipError } = await supabase
        .from('tenant_members')
        .select('tenant_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) throw new Error('No workspace membership found for this account.');
      const tenantId = membership.tenant_id;

      // Build period totals from workspace-scoped tables. The old
      // `unified-api` function is not deployed and referenced a view
      // (`tenant_usage_stats`) that does not exist.
      const days = selectedPeriod === '7d' ? 7 : selectedPeriod === '30d' ? 30 : selectedPeriod === '90d' ? 90 : 365;
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const { data: events, error: eventsError } = await supabase
        .from('usage_events')
        .select('event_type, quantity, occurred_at')
        .eq('tenant_id', tenantId)
        .gte('occurred_at', since);
      if (eventsError) console.error('Could not load usage events:', eventsError);

      const { count: campaignsLaunched } = await supabase
        .from('campaigns')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .gte('created_at', since);
      const { count: templatesCreated } = await supabase
        .from('wa_templates')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .gte('created_at', since);

      const messagesSent = (events ?? []).filter(e => e.event_type !== 'inbound')
        .reduce((sum, e) => sum + (Number(e.quantity) || 1), 0);
      const messagesReceived = (events ?? []).filter(e => e.event_type === 'inbound')
        .reduce((sum, e) => sum + (Number(e.quantity) || 1), 0);

      setUsageStats([{
        id: tenantId,
        period_start: since,
        period_end: new Date().toISOString(),
        messages_sent: messagesSent,
        messages_received: messagesReceived,
        campaigns_launched: campaignsLaunched ?? 0,
        templates_created: templatesCreated ?? 0,
        meta_cost: 0,
        storage_used: 0,
        storage_limit: 0,
      }]);

      // tenant_meta_allowance is an RPC, not a related table of `tenants`.
      const { data: allowance, error: tenantError } = await supabase
        .rpc('tenant_meta_allowance', { p_tenant_id: tenantId });
      if (tenantError) throw tenantError;
      setMetaAllowance(allowance);
    } catch (error) {
      console.error('Error fetching usage data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-KE', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: 'KES'
    }).format(amount);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-KE').format(num);
  };

  const getUsagePercentage = (used: number, total: number) => {
    return total > 0 ? Math.round((used / total) * 100) : 0;
  };

  const getMetaProgress = () => {
    if (!metaAllowance) return 0;
    const used = metaAllowance.free_service_used || 0;
    const limit = metaAllowance.free_limit || 1000;
    return getUsagePercentage(used, limit);
  };

  const getStorageProgress = () => {
    const latestStat = usageStats[0];
    if (!latestStat) return 0;
    return getUsagePercentage(latestStat.storage_used, latestStat.storage_limit);
  };

  if (loading) {
    return (
      <MarketingChrome>
        <div className="content">
          <div className="panel flex min-h-[12rem] items-center justify-center gap-2" role="status">
            <span className="animate-spin rounded-full h-5 w-5 border-2 border-brand-200 border-t-brand-600" />
            <span className="muted small">Loading usage data…</span>
          </div>
        </div>
      </MarketingChrome>
    );
  }

  const metaProgress = getMetaProgress();
  const storageProgress = getStorageProgress();
  const metaUsed = metaAllowance?.free_service_used || 0;
  const storageUsed = usageStats[0]?.storage_used || 0;
  const storageLimit = usageStats[0]?.storage_limit || 0;

  return (
    <MarketingChrome>
      <div className="content">
        <div className="page-heading">
          <div>
            <span className="eyebrow">Monitor</span>
            <h1>Usage</h1>
            <p className="page-description">Monitor messaging volume, campaigns and Meta allowance for this workspace.</p>
          </div>
          <div className="flex flex-none items-center gap-2">
            <div className="flex rounded-md border border-hairline-strong bg-raised p-0.5" role="group" aria-label="Usage period">
              {['7d', '30d', '90d', '1y'].map((period) => (
                <button
                  key={period}
                  type="button"
                  aria-pressed={selectedPeriod === period}
                  onClick={() => setSelectedPeriod(period)}
                  className={
                    'rounded px-2.5 py-1 text-[11px] font-medium transition-colors ' +
                    (selectedPeriod === period ? 'bg-surface text-text shadow-card' : 'text-text-muted hover:text-text')
                  }
                >
                  {period}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Meta messages used"
            value={formatNumber(metaUsed)}
            hint={`${formatNumber(metaAllowance?.free_service_remaining || 0)} remaining · resets ${metaAllowance?.period_end ? formatDate(metaAllowance.period_end) : 'N/A'}`}
            icon={<MessageSquare size={20} />}
            tone={metaProgress >= 90 ? 'danger' : 'brand'}
          >
            <div className="kpi-progress" aria-hidden><span style={{ width: `${Math.min(100, metaProgress)}%` }} /></div>
          </KpiCard>
          <KpiCard
            label="Storage used"
            value={`${formatNumber(storageUsed)} MB`}
            hint={`of ${formatNumber(storageLimit)} MB · ${storageProgress}% used`}
            icon={<HardDrive size={20} />}
            tone={storageProgress >= 90 ? 'danger' : 'success'}
          >
            <div className="kpi-progress" aria-hidden><span style={{ width: `${Math.min(100, storageProgress)}%` }} /></div>
          </KpiCard>
          <KpiCard
            label="Messages sent"
            value={formatNumber(usageStats[0]?.messages_sent || 0)}
            hint="Total sent this period"
            icon={<Send size={20} />}
            tone="brand"
          />
          <KpiCard
            label="Campaigns launched"
            value={formatNumber(usageStats[0]?.campaigns_launched || 0)}
            hint="Sent this period"
            icon={<Megaphone size={20} />}
            tone="warning"
          />
        </div>

        <div className="section-header">
          <div>
            <h2>Detailed usage</h2>
            <p>Per-period message, campaign and storage totals.</p>
          </div>
          <button type="button" className="secondary-button compact" onClick={() => setShowDetails(!showDetails)}>
            {showDetails ? 'Hide details' : 'Show details'}
          </button>
        </div>
        <div className="source-list">
          <div className="source-table-head usage-head">
            <span>Period</span><span>Sent</span><span>Received</span><span>Campaigns</span><span>Templates</span><span>Meta cost</span><span>Storage</span>
          </div>
          {usageStats.length === 0 ? (
            <Empty icon={<MessageSquare size={22} />} title="No usage data yet" text="Usage totals will appear after your workspace sends or receives messages." />
          ) : (
            usageStats.map((stat) => (
              <div className="source-row usage-row" key={stat.id}>
                <span>{formatDate(stat.period_start)} – {formatDate(stat.period_end)}</span>
                <strong>{formatNumber(stat.messages_sent)}</strong>
                <strong>{formatNumber(stat.messages_received)}</strong>
                <span>{formatNumber(stat.campaigns_launched)}</span>
                <span>{formatNumber(stat.templates_created)}</span>
                <span>{formatCurrency(stat.meta_cost)}</span>
                <span>
                  {formatNumber(stat.storage_used)} / {formatNumber(stat.storage_limit)} MB
                  <span className="kpi-progress mt-1.5" aria-hidden>
                    <span style={{ width: `${Math.min(100, getUsagePercentage(stat.storage_used, stat.storage_limit))}%` }} />
                  </span>
                </span>
              </div>
            ))
          )}
        </div>

        {showDetails && usageStats.length > 0 && (
          <div className="panel form-panel">
            <div className="section-header">
              <div><h2>Period summary</h2><p>Totals across the selected reporting window.</p></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="setup-row"><div><strong>Messages sent</strong><p>{formatNumber(usageStats.reduce((sum, stat) => sum + stat.messages_sent, 0))}</p></div></div>
              <div className="setup-row"><div><strong>Messages received</strong><p>{formatNumber(usageStats.reduce((sum, stat) => sum + stat.messages_received, 0))}</p></div></div>
              <div className="setup-row"><div><strong>Campaigns</strong><p>{formatNumber(usageStats.reduce((sum, stat) => sum + stat.campaigns_launched, 0))}</p></div></div>
              <div className="setup-row"><div><strong>Meta cost</strong><p>{formatCurrency(usageStats.reduce((sum, stat) => sum + stat.meta_cost, 0))}</p></div></div>
            </div>
          </div>
        )}

        {(metaProgress >= 90 || storageProgress >= 90 || (metaAllowance && metaAllowance.free_service_remaining <= 0)) && (
          <div className="flex flex-col gap-3">
            {metaAllowance && metaAllowance.free_service_remaining <= 0 ? (
              <div className="notice error">
                <strong>Meta message allowance exceeded</strong>
                <p>You have exceeded your monthly Meta message allowance. Upgrade your plan to continue sending messages.</p>
              </div>
            ) : metaProgress >= 90 ? (
              <div className="notice error">
                <strong>Meta message allowance almost exhausted</strong>
                <p>You have used {metaProgress}% of your monthly Meta message allowance. Upgrade your plan to avoid service interruption.</p>
              </div>
            ) : null}
            {storageProgress >= 90 && (
              <div className="inline-notice">
                <strong>Storage almost full</strong>
                <p>You have used {storageProgress}% of your storage capacity. Delete unused files or upgrade your plan.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </MarketingChrome>
  );
};

export default UsagePage;
