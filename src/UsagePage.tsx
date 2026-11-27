import React, { useState, useEffect } from 'react';
import { Code2, Megaphone, MessageSquare, Send } from 'lucide-react';
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
  api_requests: number;
  campaigns_launched: number;
  templates_created: number;
}

interface MetaAllowance {
  free_limit: number;
  free_service_used: number;
  free_service_remaining: number;
  billable_delivered?: number;
  billable_by_category?: Record<string, number>;
  period_end: string;
  waba_timezone?: string;
  connected: boolean;
}

type UsagePageProps = { tenantId: string };
const UsagePage: React.FC<UsagePageProps> = ({ tenantId }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [usageStats, setUsageStats] = useState<UsageStat[]>([]);
  const [metaAllowance, setMetaAllowance] = useState<MetaAllowance | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState('30d');
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (tenantId) void fetchUsageData();
    else {
      setLoading(false);
      setError('');
      setUsageStats([]);
      setMetaAllowance(null);
    }
  }, [selectedPeriod, tenantId]);

  const fetchUsageData = async () => {
    setLoading(true);
    setError('');
    try {
      if (!tenantId) throw new Error('Select a business account to view usage.');

      const days = selectedPeriod === '7d' ? 7 : selectedPeriod === '30d' ? 30 : selectedPeriod === '90d' ? 90 : 365;
      const since = new Date(Date.now() - days * 86400000).toISOString();

      // Messages are counted from the message ledger. usage_events also contains
      // API requests and other non-message activity, so it is not a message counter.
      const [
        sentResult,
        receivedResult,
        apiRequestsResult,
        campaignsResult,
        templatesResult,
        allowanceResult,
      ] = await Promise.all([
        supabase.from('messages').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId).eq('direction', 'outbound').gte('created_at', since),
        supabase.from('messages').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId).eq('direction', 'inbound').gte('created_at', since),
        supabase.from('usage_events').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId).eq('event_type', 'api_request').gte('occurred_at', since),
        supabase.from('campaigns').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId).not('started_at', 'is', null).gte('started_at', since),
        supabase.from('wa_templates').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId).gte('created_at', since),
        supabase.rpc('tenant_meta_allowance', { p_tenant_id: tenantId }),
      ]);

      const queryError = sentResult.error || receivedResult.error || apiRequestsResult.error
        || campaignsResult.error || templatesResult.error || allowanceResult.error;
      if (queryError) throw queryError;

      setUsageStats([{
        id: tenantId,
        period_start: since,
        period_end: new Date().toISOString(),
        messages_sent: sentResult.count ?? 0,
        messages_received: receivedResult.count ?? 0,
        api_requests: apiRequestsResult.count ?? 0,
        campaigns_launched: campaignsResult.count ?? 0,
        templates_created: templatesResult.count ?? 0,
      }]);
      setMetaAllowance((allowanceResult.data as MetaAllowance | null) ?? null);
    } catch (cause) {
      console.error('Error fetching usage data:', cause);
      setUsageStats([]);
      setMetaAllowance(null);
      setError(cause instanceof Error ? cause.message : 'Usage data could not be loaded. Please refresh and try again.');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => new Date(dateString).toLocaleDateString('en-KE', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const formatNumber = (num: number) => new Intl.NumberFormat('en-KE').format(num);
  const getUsagePercentage = (used: number, total: number) => total > 0 ? Math.round((used / total) * 100) : 0;
  const metaUsed = metaAllowance?.connected ? (metaAllowance.free_service_used || 0) : 0;
  const metaLimit = metaAllowance?.free_limit || 1000;
  const metaProgress = metaAllowance?.connected ? getUsagePercentage(metaUsed, metaLimit) : 0;
  const latest = usageStats[0];
  const metaHint = !metaAllowance?.connected
    ? 'Connect a WhatsApp Business Account to view its allowance.'
    : `${formatNumber(metaAllowance.free_service_remaining || 0)} free remaining · ${formatNumber(metaAllowance.billable_delivered || 0)} billable deliveries · resets ${metaAllowance.period_end ? formatDate(metaAllowance.period_end) : 'monthly'} (${metaAllowance.waba_timezone || 'Africa/Nairobi'})`;

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

  return (
    <MarketingChrome>
      <div className="content">
        <div className="page-heading">
          <div>
            <span className="eyebrow">Monitor</span>
            <h1>Usage</h1>
            <p className="page-description">Accurate message totals, API traffic, campaigns and Meta service-message allowance for this workspace.</p>
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

        {error && <div className="notice error" role="alert"><strong>Usage data unavailable</strong><p>{error}</p></div>}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard
            label="Free Meta service messages"
            value={metaAllowance?.connected ? formatNumber(metaUsed) : '—'}
            hint={metaHint}
            icon={<MessageSquare size={20} />}
            tone={metaProgress >= 90 ? 'danger' : 'brand'}
          >
            <div className="kpi-progress" aria-hidden><span style={{ width: `${Math.min(100, metaProgress)}%` }} /></div>
          </KpiCard>
          <KpiCard
            label="Outbound messages"
            value={formatNumber(latest?.messages_sent || 0)}
            hint="Messages recorded in the outbound ledger"
            icon={<Send size={20} />}
            tone="brand"
          />
          <KpiCard
            label="Inbound messages"
            value={formatNumber(latest?.messages_received || 0)}
            hint="Messages received from contacts"
            icon={<MessageSquare size={20} />}
            tone="success"
          />
          <KpiCard
            label="API requests"
            value={formatNumber(latest?.api_requests || 0)}
            hint="Authenticated Developer API requests"
            icon={<Code2 size={20} />}
            tone="brand"
          />
          <KpiCard
            label="Campaigns launched"
            value={formatNumber(latest?.campaigns_launched || 0)}
            hint="Campaigns with a recorded start time"
            icon={<Megaphone size={20} />}
            tone="warning"
          />
        </div>

        <div className="billing-note mt-4">
          Meta charges are billed separately by Meta. This report shows the free service-message allowance and billable delivery counts; it does not estimate Meta currency charges from webhook events.
        </div>

        <div className="section-header">
          <div>
            <h2>Detailed usage</h2>
            <p>Totals across the selected reporting window.</p>
          </div>
          <button type="button" className="secondary-button compact" onClick={() => setShowDetails(!showDetails)}>
            {showDetails ? 'Hide details' : 'Show details'}
          </button>
        </div>
        <div className="source-list">
          <div className="source-table-head usage-head">
            <span>Period</span><span>Outbound</span><span>Inbound</span><span>API requests</span><span>Campaigns</span><span>Templates</span>
          </div>
          {usageStats.length === 0 ? (
            <Empty icon={<MessageSquare size={22} />} title="No usage data yet" text="Usage totals will appear after your workspace sends or receives messages or makes Developer API requests." />
          ) : (
            usageStats.map((stat) => (
              <div className="source-row usage-row" key={stat.id}>
                <span>{formatDate(stat.period_start)} – {formatDate(stat.period_end)}</span>
                <strong>{formatNumber(stat.messages_sent)}</strong>
                <strong>{formatNumber(stat.messages_received)}</strong>
                <span>{formatNumber(stat.api_requests)}</span>
                <span>{formatNumber(stat.campaigns_launched)}</span>
                <span>{formatNumber(stat.templates_created)}</span>
              </div>
            ))
          )}
        </div>

        {showDetails && usageStats.length > 0 && (
          <div className="panel form-panel">
            <div className="section-header">
              <div><h2>Period summary</h2><p>Totals across the selected reporting window.</p></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <div className="setup-row"><div><strong>Outbound messages</strong><p>{formatNumber(usageStats.reduce((sum, stat) => sum + stat.messages_sent, 0))}</p></div></div>
              <div className="setup-row"><div><strong>Inbound messages</strong><p>{formatNumber(usageStats.reduce((sum, stat) => sum + stat.messages_received, 0))}</p></div></div>
              <div className="setup-row"><div><strong>API requests</strong><p>{formatNumber(usageStats.reduce((sum, stat) => sum + stat.api_requests, 0))}</p></div></div>
              <div className="setup-row"><div><strong>Campaigns launched</strong><p>{formatNumber(usageStats.reduce((sum, stat) => sum + stat.campaigns_launched, 0))}</p></div></div>
              <div className="setup-row"><div><strong>Templates created</strong><p>{formatNumber(usageStats.reduce((sum, stat) => sum + stat.templates_created, 0))}</p></div></div>
            </div>
          </div>
        )}

        {metaAllowance?.connected && (metaProgress >= 90 || metaAllowance.free_service_remaining <= 0) && (
          <div className="notice error">
            <strong>{metaAllowance.free_service_remaining <= 0 ? 'Free Meta service-message allowance exhausted' : 'Free Meta service-message allowance almost exhausted'}</strong>
            <p>
              {metaAllowance.free_service_remaining <= 0
                ? 'Meta may charge for eligible delivered messages under its pricing rules. Keep a valid payment method on the WhatsApp Business Account to avoid delivery interruption. Upgrading your MobiWave plan does not change Meta’s allowance.'
                : `You have used ${metaProgress}% of the free Meta service-message allowance. Ensure the WhatsApp Business Account has a valid payment method for billable deliveries.`}
            </p>
          </div>
        )}
      </div>
    </MarketingChrome>
  );
};

export default UsagePage;
