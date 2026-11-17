import { useEffect, useState } from "react";
import { Activity, TrendingUp, AlertTriangle, Clock } from "lucide-react";
import { supabase } from "./lib/supabase";
import { MarketingFooter, MarketingNav, SectionHeading } from "./components/MarketingChrome";

type UsageData = {
  daily_messages: Array<{
    date: string;
    count: number;
  }>;
  monthly_stats: {
    total_messages: number;
    remaining_messages: number;
    daily_average: number;
    days_remaining: number;
  };
  alerts: Array<{
    id: string;
    type: "warning" | "info";
    message: string;
    timestamp: string;
  }>;
};

type PlanLimit = {
  monthly_message_limit: number;
  current_usage: number;
  usage_percentage: number;
  days_remaining: number;
};

export default function UsagePage() {
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [planLimit, setPlanLimit] = useState<PlanLimit | null>(null);

  useEffect(() => {
    fetchUsageData();
  }, []);

  const fetchUsageData = async () => {
    try {
      // Fetch daily message data
      const { data: dailyMessages, error: dailyError } = await (supabase ? supabase
        .from("daily_message_stats")
        .select("date, count")
        .order("date", { ascending: false })
        .limit(30) : { data: [], error: null });

      if (dailyError) throw dailyError;

      // Fetch monthly stats
      const { data: monthlyStats, error: monthlyError } = await (supabase ? supabase
        .from("monthly_usage_stats")
        .select("*")
        .eq("tenant_id", "current_tenant_id") // Replace with actual tenant ID
        .single() : { data: null, error: null });

      if (monthlyError) throw monthlyError;

      // Fetch plan information
      const { data: planData, error: planError } = await (supabase ? supabase
        .from("platform_billing_tiers")
        .select("monthly_message_limit")
        .eq("slug", "current_plan_slug") // Replace with actual plan slug
        .single() : { data: null, error: null });

      if (planError) throw planError;

      // Calculate usage percentage and days remaining
      const currentUsage = monthlyStats?.total_messages || 0;
      const monthlyLimit = planData?.monthly_message_limit || 0;
      const usagePercentage = monthlyLimit > 0 ? (currentUsage / monthlyLimit) * 100 : 0;
      const daysRemaining = 30 - (monthlyStats?.days_used || 0);

      setUsageData({
        daily_messages: dailyMessages || [],
        monthly_stats: {
          total_messages: currentUsage,
          remaining_messages: Math.max(0, monthlyLimit - currentUsage),
          daily_average: currentUsage / Math.max(1, daysRemaining),
          days_remaining: daysRemaining
        },
        alerts: generateAlerts(usagePercentage, daysRemaining)
      });

      setPlanLimit({
        monthly_message_limit: monthlyLimit,
        current_usage: currentUsage,
        usage_percentage: usagePercentage,
        days_remaining: daysRemaining
      });

    } catch (err) {
      console.error("Error fetching usage data:", err);
    } finally {
      // setLoading(false);
    }
  };

  const generateAlerts = (usagePercentage: number, daysRemaining: number) => {
    const alerts = [];

    if (usagePercentage > 90) {
      alerts.push({
        id: "high-usage",
        type: "warning" as const,
        message: "You've used 90% of your monthly message limit. Consider upgrading your plan.",
        timestamp: new Date().toISOString()
      });
    }

    if (daysRemaining <= 3) {
      alerts.push({
        id: "near-end-month",
        type: "info" as const,
        message: `Your monthly reset is in ${daysRemaining} day${daysRemaining > 1 ? 's' : ''}.`,
        timestamp: new Date().toISOString()
      });
    }

    if (usagePercentage > 75 && usagePercentage <= 90) {
      alerts.push({
        id: "moderate-usage",
        type: "info" as const,
        message: "You're approaching your monthly message limit.",
        timestamp: new Date().toISOString()
      });
    }

    return alerts;
  };

  const getUsageColor = (percentage: number) => {
    if (percentage >= 90) return "text-red-600";
    if (percentage >= 75) return "text-yellow-600";
    return "text-green-600";
  };

  const getUsageBgColor = (percentage: number) => {
    if (percentage >= 90) return "bg-red-100";
    if (percentage >= 75) return "bg-yellow-100";
    return "bg-green-100";
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-KE", {
      month: "short",
      day: "numeric"
    });
  };

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <MarketingNav />

      <main className="flex-grow">
        <div className="container mx-auto px-4 py-12 md:py-16 lg:py-20">
          {/* Hero Section */}
          <SectionHeading
            kicker="Usage Analytics"
            title="Track your messaging performance"
            description="Monitor your daily and monthly usage with detailed analytics and insights."
            align="center"
          />

          {/* Usage Overview Cards */}
          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-ink-200 bg-surface p-6">
              <div className="flex items-center gap-2">
                <Activity size={20} className="text-brand-600" />
                <h3 className="font-medium text-ink-800">Total Messages</h3>
              </div>
              <p className="mt-2 text-2xl font-bold text-ink-800">
                {planLimit?.current_usage.toLocaleString() || "0"}
              </p>
              <p className="text-sm text-ink-500">This month</p>
            </div>

            <div className="rounded-xl border border-ink-200 bg-surface p-6">
              <div className="flex items-center gap-2">
                <TrendingUp size={20} className="text-brand-600" />
                <h3 className="font-medium text-ink-800">Remaining</h3>
              </div>
              <p className="mt-2 text-2xl font-bold text-ink-800">
                {usageData?.monthly_stats.remaining_messages.toLocaleString() || "0"}
              </p>
              <p className="text-sm text-ink-500">This month</p>
            </div>

            <div className="rounded-xl border border-ink-200 bg-surface p-6">
              <div className="flex items-center gap-2">
                <Clock size={20} className="text-brand-600" />
                <h3 className="font-medium text-ink-800">Daily Average</h3>
              </div>
              <p className="mt-2 text-2xl font-bold text-ink-800">
                {Math.round(usageData?.monthly_stats.daily_average || 0).toLocaleString()}
              </p>
              <p className="text-sm text-ink-500">Messages/day</p>
            </div>

            <div className="rounded-xl border border-ink-200 bg-surface p-6">
              <div className="flex items-center gap-2">
                <AlertTriangle size={20} className="text-brand-600" />
                <h3 className="font-medium text-ink-800">Days Left</h3>
              </div>
              <p className="mt-2 text-2xl font-bold text-ink-800">
                {usageData?.monthly_stats.days_remaining || 0}
              </p>
              <p className="text-sm text-ink-500">In this billing cycle</p>
            </div>
          </div>

          {/* Usage Progress */}
          <div className="mt-12">
            <h3 className="text-[18px] font-bold text-ink-800 mb-6">Monthly Usage</h3>
            <div className="rounded-xl border border-ink-200 bg-surface p-6">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-medium text-ink-700">
                  {planLimit?.current_usage.toLocaleString() || "0"} of {planLimit?.monthly_message_limit.toLocaleString() || "Unlimited"} messages
                </span>
                <span className={`text-sm font-medium ${getUsageColor(planLimit?.usage_percentage || 0)}`}>
                  {Math.round(planLimit?.usage_percentage || 0)}% used
                </span>
              </div>
              <div className="h-3 w-full rounded-full bg-ink-100">
                <div 
                  className={`h-3 rounded-full ${getUsageBgColor(planLimit?.usage_percentage || 0)}`}
                  style={{ width: `${Math.min(100, planLimit?.usage_percentage || 0)}%` }}
                ></div>
              </div>
              <div className="mt-4 flex justify-between text-xs text-ink-500">
                <span>0</span>
                <span>50%</span>
                <span>75%</span>
                <span>90%</span>
                <span>100%</span>
              </div>
            </div>
          </div>

          {/* Alerts */}
          {usageData?.alerts && usageData.alerts.length > 0 && (
            <div className="mt-8">
              <h3 className="text-[18px] font-bold text-ink-800 mb-4">Usage Alerts</h3>
              <div className="space-y-3">
                {usageData.alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`rounded-lg p-4 ${alert.type === "warning" ? "bg-red-50 border border-red-200" : "bg-blue-50 border border-blue-200"}`}
                  >
                    <div className="flex items-start gap-3">
                      {alert.type === "warning" ? (
                        <AlertTriangle size={20} className="text-red-600 mt-0.5" />
                      ) : (
                        <Clock size={20} className="text-blue-600 mt-0.5" />
                      )}
                      <div>
                        <p className="text-sm font-medium text-ink-800">{alert.message}</p>
                        <p className="text-xs text-ink-500 mt-1">
                          {new Date(alert.timestamp).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Daily Usage Chart */}
          <div className="mt-12">
            <h3 className="text-[18px] font-bold text-ink-800 mb-6">Daily Message Trend</h3>
            <div className="rounded-xl border border-ink-200 bg-surface p-6">
              <div className="h-64 flex items-end justify-between gap-2">
                {usageData?.daily_messages.slice(0, 14).map((day, index) => {
                  const maxValue = Math.max(...usageData.daily_messages.map(d => d.count));
                  const height = maxValue > 0 ? (day.count / maxValue) * 100 : 0;
                  
                  return (
                    <div key={index} className="flex flex-col items-center flex-1">
                      <div
                        className="w-full bg-brand-600 rounded-t transition-all duration-300"
                        style={{ height: `${height}%` }}
                      ></div>
                      <span className="text-xs text-ink-500 mt-2">
                        {formatDate(day.date)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Usage Tips */}
          <div className="mt-12">
            <SectionHeading
              kicker="Usage Optimization Tips"
              title="Get the most out of your messaging plan"
              align="center"
            />

            <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-xl border border-ink-200 bg-surface p-6">
                <h3 className="font-bold text-ink-800 mb-2">Use Templates</h3>
                <p className="text-sm text-ink-600">
                  Save time with reusable message templates for common responses.
                </p>
              </div>

              <div className="rounded-xl border border-ink-200 bg-surface p-6">
                <h3 className="font-bold text-ink-800 mb-2">Schedule Messages</h3>
                <p className="text-sm text-ink-600">
                  Send messages at optimal times when your audience is most responsive.
                </p>
              </div>

              <div className="rounded-xl border border-ink-200 bg-surface p-6">
                <h3 className="font-bold text-ink-800 mb-2">Segment Contacts</h3>
                <p className="text-sm text-ink-600">
                  Target specific customer groups with relevant messaging.
                </p>
              </div>

              <div className="rounded-xl border border-ink-200 bg-surface p-6">
                <h3 className="font-bold text-ink-800 mb-2">Track Performance</h3>
                <p className="text-sm text-ink-600">
                  Monitor which messages get the best response rates.
                </p>
              </div>

              <div className="rounded-xl border border-ink-200 bg-surface p-6">
                <h3 className="font-bold text-ink-800 mb-2">Use Analytics</h3>
                <p className="text-sm text-ink-600">
                  Review usage patterns to optimize your messaging strategy.
                </p>
              </div>

              <div className="rounded-xl border border-ink-200 bg-surface p-6">
                <h3 className="font-bold text-ink-800 mb-2">Upgrade Plan</h3>
                <p className="text-sm text-ink-600">
                  Upgrade when you consistently exceed your current limits.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}