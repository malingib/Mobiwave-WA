import { useEffect, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, ShieldCheck, X } from "lucide-react";
import { supabase } from "./lib/supabase";
import { FinalCTA, Kicker, MarketingFooter, MarketingNav, SectionHeading } from "./components/MarketingChrome";
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
    : enabled ? "text-ink-700" : "text-ink-400 line-through decoration-ink-300";
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

const rateRows: [string, string, string, string][] = [
  ["Marketing", "Promotions, offers, product announcements and re-engagement templates", "US$0.0225", "per delivered message"],
  ["Utility", "Order updates, receipts, appointment reminders and transactional templates", "US$0.0040", "per delivered message*"],
  ["Authentication", "One-time passwords and account verification templates", "US$0.0040", "per delivered message*"],
  ["Service replies", "Free-form customer support replies in the 24-hour customer service window", "First 1,000 free", "per business phone number per month; then US$0.0040 per message"],
];

export default function PricingPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansError, setPlansError] = useState("");
  useEffect(() => {
    if (!supabase) { setPlansError("Plan pricing is temporarily unavailable."); setPlansLoading(false); return; }
    supabase.rpc("platform_public_tiers").then(({ data, error }) => {
      if (error) setPlansError("Plan pricing is temporarily unavailable.");
      else setPlans((data ?? []) as Plan[]);
      setPlansLoading(false);
    });
  }, []);
  return (
    <div className="marketing-theme min-h-screen bg-canvas font-sans text-ink-900">
      <MarketingNav items={[{ label: "Features", href: "/#features" }, { label: "Pricing", href: "/pricing" }, { label: "FAQs", href: "/#faq" }]} current="Pricing" />

      <main>
        {/* Hero ---------------------------------------------------------- */}
        <section className="relative overflow-hidden border-b border-ink-100 bg-canvas">
          <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 h-96 w-96 rounded-full bg-brand-100 blur-3xl" />
          <div className="mx-auto max-w-[1240px] px-5 py-16 text-center lg:px-8 lg:py-20">
            <Reveal>
              <div className="flex justify-center"><Kicker>Plans and pricing</Kicker></div>
              <h1 className="mx-auto mt-5 max-w-2xl font-display text-[clamp(2.3rem,4.5vw,3.4rem)] font-extrabold leading-[1.05] tracking-[-0.035em]">
                Find the right setup for <span className="text-brand-600">your team.</span>
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-[16.5px] leading-relaxed text-ink-500">
                Manage WhatsApp conversations, contacts and campaigns in one business account. Compare indicative plan pricing and confirm availability with our team.
              </p>
              <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2.5 text-[13.5px] font-medium text-ink-600">
                <span className="flex items-center gap-2"><ShieldCheck size={15} className="text-brand-600" /> Official Meta Cloud API</span>
                <span className="flex items-center gap-2"><Check size={15} className="text-brand-600" /> Plan limits are shown with each tier</span>
              </div>
            </Reveal>
          </div>
        </section>

        {/* Plans --------------------------------------------------------- */}
        <section className="mx-auto max-w-[1240px] px-5 pb-0 lg:px-8" aria-label="Plan and checkout information">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-[13.5px] leading-relaxed text-amber-950">
            <strong>Plan selection is not checkout.</strong> MobiWave WA does not currently create a subscription or activate plan entitlements automatically. Contact our team to confirm pricing, included access and billing arrangements before relying on a plan.
          </div>
        </section>

        <section className="mx-auto max-w-[1240px] px-5 py-12 lg:px-8" aria-label="MobiWave WA plans">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {plans.map((plan, index) => (
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
                    <p className={"mt-1 text-[13px] leading-relaxed " + (plan.featured ? "text-brand-100/85" : "text-ink-500")}>{plan.description}</p>
                  </div>
                  <div className="mt-6 flex items-baseline gap-1.5">
                    <strong className="font-display text-[34px] font-extrabold leading-none tracking-tight">{formatMoney(plan.monthly_price_minor, plan.currency)}</strong>
                    <span className={"text-[13px] " + (plan.featured ? "text-brand-200" : "text-ink-400")}>/ month*</span>
                  </div>
                  <p className={"mt-2 text-[12.5px] " + (plan.featured ? "text-brand-100/85" : "text-ink-500")}>
                    Optional setup: <strong className={plan.featured ? "text-white" : "text-ink-800"}>{formatMoney(plan.setup_fee_minor, plan.currency)}</strong>
                  </p>
                  <a
                    className={
                      "btn mt-5 h-10 w-full " +
                      (plan.featured ? "bg-white !text-brand-800 hover:bg-brand-50 hover:shadow-none" : "btn-secondary")
                    }
                    href={`mailto:info@mobiwave.co.ke?subject=${encodeURIComponent(`Plan enquiry: ${plan.name}`)}&body=${encodeURIComponent(`Hello MobiWave team,\n\nI would like to discuss the ${plan.name} plan. Please confirm current pricing, access and billing arrangements.\n`)}`}
                  >
                    Ask about {plan.name} <ArrowRight size={15} />
                  </a>

                  <div className={"my-5 border-t " + (plan.featured ? "border-white/15" : "border-ink-100")} />
                  <h3 className={"mb-3 text-[12px] font-extrabold uppercase tracking-[0.1em] " + (plan.featured ? "text-brand-200" : "text-ink-400")}>
                    Product capabilities
                  </h3>
                  <ul className="flex flex-col gap-2.5">
                    <Feature onDark={plan.featured} label="Official WhatsApp Business API" enabled />
                    {[["inbox", "Shared inbox"], ["contacts", "Contacts"], ["templates", "Templates"], ["campaigns", "Campaigns"], ["api", "Developer API"], ["webhooks", "Customer webhooks"]].map(([key, label]) => <Feature key={key} onDark={plan.featured} label={label} enabled={plan.feature_flags?.[key] ?? false} />)}
                    <Feature onDark={plan.featured} label={plan.max_team_members > 0 ? `Maximum team size: ${plan.max_team_members} users` : "No fixed team size cap"} enabled />
                    <Feature onDark={plan.featured} label={plan.monthly_message_limit > 0 ? `Up to ${new Intl.NumberFormat("en-KE").format(plan.monthly_message_limit)} platform messages / month` : "No fixed platform message cap"} enabled />
                    {plan.feature_highlights.map((feature) => <Feature key={feature} onDark={plan.featured} label={feature} enabled />)}
                  </ul>
                </article>
              </Reveal>
            ))}
          </div>
          {plansLoading && <p className="py-12 text-center text-sm text-ink-500" role="status">Loading current plans…</p>}
          {plansError && <p className="py-12 text-center text-sm text-ink-500" role="status">{plansError} Please contact our team for current options.</p>}
          {!plansLoading && !plansError && plans.length === 0 && <p className="py-12 text-center text-sm text-ink-500">No public plans are available right now. Please contact our team.</p>}
        </section>

        {/* Notes --------------------------------------------------------- */}
        <section className="border-y border-ink-100 bg-canvas">
          <div className="mx-auto grid max-w-[1240px] gap-8 px-5 py-16 md:grid-cols-3 lg:px-8">
            {[
              ["Confirm your plan first", "Displayed plan amounts are indicative. Confirm the current price, enabled access and billing arrangements with our team before onboarding. Setup is optional and quoted separately."],
              ["Meta messaging charges are separate", "Meta charges separately from MobiWave WA plan fees. Since 1 July 2025, template pricing is based on each delivered message and its category, not a flat conversation fee. Current rates and rules below reflect the Meta rate card effective 1 October 2026."],
              ["Know what your plan includes", "Included capabilities and any configured team or usage limits are listed on each plan. Meta messaging charges remain separate."],
            ].map(([title, text]) => (
              <div key={title}>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100">
                  <Check size={16} />
                </span>
                <h2 className="mt-4 text-[16px] font-bold">{title}</h2>
                <p className="mt-2 text-[13.5px] leading-relaxed text-ink-500">{text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Meta rate card ------------------------------------------------ */}
        <section className="mx-auto max-w-[1240px] px-5 py-20 lg:px-8" aria-labelledby="wa-meta-pricing-title">
          <Reveal>
            <SectionHeading
              id="wa-meta-pricing-title"
              kicker="Meta WhatsApp Business Platform"
              title={<>Message charges, <span className="text-brand-600">explained.</span></>}
              description="These are Meta’s published base rates for recipients in Kenya, which uses Meta’s “Rest of Africa” rate group. They are separate from MobiWave WA plan pricing and optional setup fees."
            />
          </Reveal>

          <div className="mt-10 overflow-hidden rounded-xl border border-ink-200 bg-surface shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-ink-200 bg-ink-50 text-[11px] font-bold uppercase tracking-[0.09em] text-ink-500">
                    <th className="px-5 py-3.5">Message category</th>
                    <th className="px-5 py-3.5">Typical use</th>
                    <th className="px-5 py-3.5 text-right">Meta base rate</th>
                  </tr>
                </thead>
                <tbody>
                  {rateRows.map(([category, use, rate, note]) => (
                    <tr key={category} className="border-b border-ink-100 transition-colors last:border-0 hover:bg-ink-50">
                      <td className="px-5 py-4 align-top text-[14.5px] font-semibold text-ink-900">{category}</td>
                      <td className="px-5 py-4 align-top text-[13.5px] leading-relaxed text-ink-500">{use}</td>
                      <td className="px-5 py-4 text-right align-top">
                        <strong className="block font-display text-[16px] font-extrabold text-ink-900">{rate}</strong>
                        <small className="mt-0.5 block text-[11.5px] text-ink-400">{note}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="mt-4 text-[12.5px] leading-relaxed text-ink-400">
            * Utility and authentication base/list rates shown before eligible volume discounts. Effective 1 October 2026, utility templates sent inside an open customer
            service window are chargeable too. Service-message free allowance applies separately to each business phone number; service messages do not receive utility
            volume discounts.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {[
              ["How Meta calculates charges", ["Only delivered messages are charged.", "The recipient’s country calling code determines the market rate.", "Template category determines the applicable rate.", "Eligible utility and authentication traffic can qualify for volume-tier discounts."]],
              ["What is not included in these rates?", ["MobiWave WA plan pricing and optional setup.", "Any separately agreed provider or onboarding fees.", "Applicable taxes, foreign-exchange conversion or payment-provider fees."]],
            ].map(([title, items]) => (
              <div key={title as string} className="rounded-xl border border-ink-200 bg-surface p-6">
                <h3 className="text-[15.5px] font-bold">{title}</h3>
                <ul className="mt-3 flex flex-col gap-2">
                  {(items as string[]).map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-[13.5px] leading-relaxed text-ink-500">
                      <Check size={14} className="mt-1 flex-none text-brand-600" /> {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-6 flex items-start gap-3 rounded-xl border border-brand-100 bg-brand-50 p-5 text-brand-800">
            <ShieldCheck size={18} className="mt-0.5 flex-none" />
            <p className="text-[13.5px] leading-relaxed">
              <strong>Meta’s rates can change.</strong> The figures above are the published Rest of Africa USD base rates identified for the rate card effective 1 October 2026.
              Confirm the rate and billing currency in your own WhatsApp Business Account before budgeting or sending campaigns.
            </p>
          </div>

          <p className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-500">
            <span className="font-semibold text-ink-600">Official references:</span>
            <a className="inline-flex items-center gap-1 font-medium text-brand-600 hover:text-brand-700" href="https://developers.facebook.com/docs/whatsapp/pricing/" target="_blank" rel="noreferrer">
              Meta pricing and rate cards <ArrowUpRight size={13} />
            </a>
            <span className="text-ink-300">·</span>
            <a className="inline-flex items-center gap-1 font-medium text-brand-600 hover:text-brand-700" href="https://developers.facebook.com/docs/whatsapp/pricing/updates-to-pricing/" target="_blank" rel="noreferrer">
              Meta pricing updates <ArrowUpRight size={13} />
            </a>
          </p>
        </section>

        {/* Pricing FAQ --------------------------------------------------- */}
        <section id="pricing-faq" className="border-t border-ink-100 bg-canvas">
          <div className="mx-auto max-w-[1240px] px-5 py-20 lg:px-8">
            <Reveal>
              <SectionHeading kicker="Pricing FAQ" title={<>Questions, <span className="text-brand-600">answered.</span></>} />
            </Reveal>
            <div className="mx-auto mt-10 max-w-3xl">
              {[
                ["Are setup fees compulsory?", "No. Setup is optional. Ask our team for the current setup quote and billing arrangements before onboarding."],
                ["Are Meta WhatsApp charges included?", "No. Meta bills separately for eligible delivered messages. Kenya is in Meta’s Rest of Africa rate group; current base rates and the October 2026 service-message changes are listed above. Rates, billing currency, discounts and taxes may vary."],
                ["Are contacts, campaigns or messages capped?", "Any configured team or usage limits are shown on the selected plan. Contact our team to confirm how those limits are applied to your workspace."],
                ["How are campaigns controlled?", "Outbound campaigns use approved Meta templates and recorded customer opt-in. Teams choose recipients and initiate sends, and opted-out contacts must be suppressed."],
                ["Which plans include API access?", "Developer API message sending follows the published tier access. API keys and customer webhook setup are still confirmed per workspace."],
              ].map(([question, answer], index) => (
                <details key={question} className="group border-b border-ink-200 first:border-t" open={index === 0}>
                  <summary className="flex items-center justify-between gap-6 py-5 text-[15.5px] font-semibold text-ink-900 transition-colors hover:text-brand-700">
                    {question}
                    <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full border border-ink-200 bg-white text-ink-500 transition-all group-open:rotate-45 group-open:border-brand-300 group-open:bg-brand-50 group-open:text-brand-700">
                      <span className="text-[15px] leading-none">+</span>
                    </span>
                  </summary>
                  <p className="pb-5 pr-10 text-[14.5px] leading-relaxed text-ink-500">{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <FinalCTA
          kicker="Ready when you are"
          title="Talk to us about getting started."
          description="We’ll confirm your workspace setup, pricing and access before you begin. Meta messaging charges are separate."
          cta="Contact our team"
          ctaHref="mailto:info@mobiwave.co.ke?subject=MobiWave%20WA%20plan%20enquiry"
        />
      </main>

      <MarketingFooter blurb="WhatsApp customer messaging for business teams." />
    </div>
  );
}
