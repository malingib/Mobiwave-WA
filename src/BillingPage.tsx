import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { supabase } from "./lib/supabase";
import { FinalCTA, MarketingFooter, MarketingNav, SectionHeading } from "./components/MarketingChrome";
import { Reveal } from "./components/ui";

type Plan = {
  id: string; slug: string; name: string; description: string; currency: string;
  monthly_price_minor: number; setup_fee_minor: number; featured: boolean;
  max_team_members: number; monthly_message_limit: number; feature_flags: Record<string, boolean>;
  feature_highlights: string[];
};

const formatMoney = (minor: number, currency: string) => new Intl.NumberFormat("en-KE", {
  style: "currency", currency, maximumFractionDigits: 2,
}).format(Number(minor) / 100);

function Feature({ label, enabled, onDark = false }: { label: string; enabled: boolean; onDark?: boolean }) {
  const text = onDark
    ? enabled ? "text-white/85" : "text-white/40 line-through decoration-white/25"
    : enabled ? "text-ink-700" : "text-ink-400 line-through decoration-ink/300";
  const badge = onDark
    ? enabled ? "bg-white/15 text-white" : "bg-white/10 text-white/50"
    : enabled ? "bg-brand-100 text-brand-700" : "bg-ink-100 text-ink-400";
  return (
    <li className={"flex items-start gap-2.5 text-[13.5px] " + text}>
      <span className={"mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full " + badge}>
        {enabled ? <Check size={11} strokeWidth={3} /> : <X size={11} strokeWidth={3} />}
      </span>
      <span>{label}</span>
    </li>
  );
}

export default function BillingPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPlans = async () => {
      try {
        const { data, error } = await (supabase ? supabase
          .from("platform_billing_tiers")
          .select("*")
          .eq("is_public", true)
          .order("display_order")
          .order("name") : { data: [], error: null });

        if (error) throw error;
        setPlans(data);
      } catch (err) {
        console.error("Error fetching plans:", err);
        setError("Failed to load pricing plans");
      } finally {
        setLoading(false);
      }
    };

    fetchPlans();
  }, []);

  const isSetupOptional = (setupFeeMinor: number) => setupFeeMinor === 0 || setupFeeMinor < 1000;

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <MarketingNav />

      <main className="flex-grow">
        <div className="container mx-auto px-4 py-12 md:py-16 lg:py-20">
          {/* Hero Section */}
          <SectionHeading
            kicker="Simple, Transparent Pricing"
            title="Choose the perfect plan for your business"
            description="Start with our free trial and upgrade as you grow. All plans include 1,000 free Meta messages per phone number."
            align="center"
          />

          {/* Plans Grid */}
          <div className="mt-16 grid grid-cols-1 gap-8 lg:grid-cols-3">
            {loading ? (
              <div className="col-span-full text-center py-8">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent"></div>
                <p className="mt-2 text-sm text-ink-500">Loading plans...</p>
              </div>
            ) : error ? (
              <div className="col-span-full text-center py-8">
                <p className="text-red-600">{error}</p>
              </div>
            ) : (
              plans.map((plan, index) => (
                <Reveal key={plan.name} delay={index * 60}>
                  <article
                    className={
                      "relative flex h-full flex-col rounded-xl border p-6 transition-all duration-200 " +
                      (plan.featured
                        ? "border-brand-700 bg-brand-800 text-white shadow-raised"
                        : "border-ink-200 bg-surface hover:-translate-y-1 hover:border-brand-300 hover:shadow-raised")
                    }
                  >
                    {plan.featured && (
                      <span className="absolute -top-3 left-6 rounded-full bg-white px-3 py-1 text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-brand-800 shadow-card">
                        Most popular
                      </span>
                    )}
                    <div>
                      <h2 className={"text-[17px] font-bold " + (plan.featured ? "text-white" : "")}>{plan.name}</h2>
                      <p className={"mt-1 text-[13px] leading-relaxed " + (plan.featured ? "text-brand-100/85" : "text-ink-500")}>
                        {plan.description}
                      </p>
                    </div>
                    <div className="mt-6">
                      <strong className="font-display text-[34px] font-extrabold leading-none tracking-tight">
                        {formatMoney(plan.monthly_price_minor, plan.currency)}
                      </strong>
                      <span className={"text-[13px] " + (plan.featured ? "text-brand-200" : "text-ink-400")}>/ month*</span>
                    </div>
                    <p className={`mt-2 text-[12.5px] ${plan.featured ? "text-brand-100/85" : "text-ink-500"}`}>
                      {isSetupOptional(plan.setup_fee_minor) ? (
                        "Optional setup: " + (plan.setup_fee_minor === 0 ? "No setup fee" : <strong className={plan.featured ? "text-white" : "text-ink-800"}>{formatMoney(plan.setup_fee_minor, plan.currency)}</strong>)
                      ) : (
                        "Setup fee: " + <strong className={plan.featured ? "text-white" : "text-ink-800"}>{formatMoney(plan.setup_fee_minor, plan.currency)}</strong>
                      )}
                    </p>
                    <p className={`mt-1 text-[12px] ${plan.featured ? "text-brand-100/75" : "text-ink-400"}`}>
                      + 1,000 free Meta messages
                    </p>
                    <div className="mt-8">
                      <ul className="space-y-2.5">
                        {plan.feature_highlights.map((highlight, idx) => (
                          <Feature
                            key={idx}
                            label={highlight}
                            enabled={true}
                            onDark={plan.featured}
                          />
                        ))}
                      </ul>
                    </div>
                    <div className="mt-8">
                      <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-ink-500">
                        Team size: {plan.max_team_members === 0 ? "Unlimited" : plan.max_team_members}
                      </p>
                      <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-ink-500">
                        Messages: {plan.monthly_message_limit === 0 ? "Unlimited" : plan.monthly_message_limit.toLocaleString()}/month
                      </p>
                    </div>
                    <div className="mt-auto pt-6">
                      <button
                        className={
                          "w-full rounded-lg px-4 py-3 text-center font-medium text-white transition-all duration-200 " +
                          (plan.featured
                            ? "bg-brand-700 hover:bg-brand-600 active:bg-brand-800"
                            : "bg-brand-600 hover:bg-brand-500 active:bg-brand-700")
                        }
                      >
                        Get Started
                      </button>
                      <p className="mt-3 text-center text-[11px] text-ink-500">
                        7-day free trial • No credit card required
                      </p>
                    </div>
                  </article>
                </Reveal>
              ))
            )}
          </div>

          {/* FAQ Section */}
          <SectionHeading
            kicker="Frequently Asked Questions"
            title="Everything you need to know about the platform"
            align="center"
          />

          <div className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-ink-200 bg-surface p-6">
              <h3 className="font-bold text-ink-800">What payment methods do you accept?</h3>
              <p className="mt-2 text-[13.5px] text-ink-600">
                We accept M-Pesa for all payments in Kenya. All pricing is in Kenyan Shillings (KES) plus VAT.
              </p>
            </div>
            <div className="rounded-xl border border-ink-200 bg-surface p-6">
              <h3 className="font-bold text-ink-800">Can I change plans later?</h3>
              <p className="mt-2 text-[13.5px] text-ink-600">
                Yes, you can upgrade or downgrade your plan at any time. Changes take effect at the start of your next billing cycle.
              </p>
            </div>
            <div className="rounded-xl border border-ink-200 bg-surface p-6">
              <h3 className="font-bold text-ink-800">What happens if I exceed my message limit?</h3>
              <p className="mt-2 text-[13.5px] text-ink-600">
                You'll receive notifications as you approach your limit. Additional messages are charged at a reasonable rate based on your plan.
              </p>
            </div>
            <div className="rounded-xl border border-ink-200 bg-surface p-6">
              <h3 className="font-bold text-ink-800">Is there a contract?</h3>
              <p className="mt-2 text-[13.5px] text-ink-600">
                No, we offer month-to-month subscriptions with no long-term contracts. You can cancel anytime.
              </p>
            </div>
            <div className="rounded-xl border border-ink-200 bg-surface p-6">
              <h3 className="font-bold text-ink-800">What about support?</h3>
              <p className="mt-2 text-[13.5px] text-ink-600">
                All plans include email support. Business and Enterprise plans include priority support with faster response times.
              </p>
            </div>
            <div className="rounded-xl border border-ink-200 bg-surface p-6">
              <h3 className="font-bold text-ink-800">Can I get a refund?</h3>
              <p className="mt-2 text-[13.5px] text-ink-600">
                We offer a 7-day free trial. If you're not satisfied within the first 7 days, contact us for a full refund.
              </p>
            </div>
          </div>

          {/* Footer CTA */}
          <div className="mt-20 rounded-xl border border-ink-200 bg-gradient-to-br from-brand-50 to-brand-100 p-8 text-center">
            <h3 className="text-[20px] font-bold text-ink-800">Ready to get started?</h3>
            <p className="mt-2 text-[14px] text-ink-600">
              Join thousands of businesses using MobiWave WA to grow their customer relationships.
            </p>
            <FinalCTA
              kicker="Ready to get started?"
              title="Join thousands of businesses using MobiWave WA"
              description="Start your free trial today and experience the power of WhatsApp marketing"
              cta="Get Started"
              ctaHref="/login"
            />
          </div>
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}