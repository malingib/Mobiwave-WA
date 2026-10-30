import { ArrowRight, ArrowUpRight, Check, ShieldCheck, X } from "lucide-react";
import { FinalCTA, Kicker, MarketingFooter, MarketingNav, SectionHeading } from "./components/MarketingChrome";
import { Reveal } from "./components/ui";

const plans = [
  { name: "Starter", price: "2,000", setup: "2,000", users: "2 users", intro: "A clear starting point for small teams", featured: false, api: false, webhooks: false },
  { name: "Basic", price: "4,000", setup: "4,000", users: "4 users", intro: "More room for a growing customer team", featured: false, api: true, webhooks: true },
  { name: "Pro", price: "8,000", setup: "8,000", users: "10 users", intro: "Connected workflows for growing teams", featured: true, api: true, webhooks: true },
  { name: "Enterprise", price: "20,000", setup: "30,000", users: "Unlimited users", intro: "For larger teams and custom requirements", featured: false, api: true, webhooks: true },
];

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
  return (
    <div className="min-h-screen bg-canvas font-sans text-ink-900">
      <MarketingNav items={[{ label: "Features", href: "/#features" }, { label: "Pricing", href: "/pricing" }, { label: "FAQs", href: "/#faq" }]} current="Pricing" />

      <main>
        {/* Hero ---------------------------------------------------------- */}
        <section className="relative overflow-hidden border-b border-ink-100 bg-canvas">
          <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 h-96 w-96 rounded-full bg-brand-100 blur-3xl" />
          <div className="mx-auto max-w-[1240px] px-5 py-16 text-center lg:px-8 lg:py-20">
            <Reveal>
              <div className="flex justify-center"><Kicker>Straightforward subscriptions</Kicker></div>
              <h1 className="mx-auto mt-5 max-w-2xl font-display text-[clamp(2.3rem,4.5vw,3.4rem)] font-extrabold leading-[1.05] tracking-[-0.035em]">
                Choose a plan that fits <span className="text-brand-600">your team.</span>
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-[16.5px] leading-relaxed text-ink-500">
                Manage WhatsApp conversations, contacts and campaigns in one business account. Upgrade when you need more team access and developer integrations.
              </p>
              <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2.5 text-[13.5px] font-medium text-ink-600">
                <span className="flex items-center gap-2"><ShieldCheck size={15} className="text-brand-600" /> Official Meta Cloud API</span>
                <span className="flex items-center gap-2"><Check size={15} className="text-brand-600" /> No fixed contact, campaign or platform-message caps</span>
              </div>
            </Reveal>
          </div>
        </section>

        {/* Plans --------------------------------------------------------- */}
        <section className="mx-auto max-w-[1240px] px-5 py-16 lg:px-8" aria-label="WhatsApp subscription plans">
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
                    <p className={"mt-1 text-[13px] leading-relaxed " + (plan.featured ? "text-brand-100/85" : "text-ink-500")}>{plan.intro}</p>
                  </div>
                  <div className="mt-6 flex items-baseline gap-1.5">
                    <span className={"text-[13px] font-bold " + (plan.featured ? "text-brand-200" : "text-ink-400")}>KES</span>
                    <strong className="font-display text-[34px] font-extrabold leading-none tracking-tight">{plan.price}</strong>
                    <span className={"text-[13px] " + (plan.featured ? "text-brand-200" : "text-ink-400")}>/ month</span>
                  </div>
                  <p className={"mt-2 text-[12.5px] " + (plan.featured ? "text-brand-100/85" : "text-ink-500")}>
                    Optional one-time setup: <strong className={plan.featured ? "text-white" : "text-ink-800"}>KES {plan.setup}</strong>
                  </p>
                  <a
                    className={
                      "btn mt-5 h-10 w-full " +
                      (plan.featured ? "bg-white !text-brand-800 hover:bg-brand-50 hover:shadow-none" : "btn-secondary")
                    }
                    href={"/login?mode=signup&plan=" + plan.name.toLowerCase()}
                  >
                    Choose {plan.name} <ArrowRight size={15} />
                  </a>

                  <div className={"my-5 border-t " + (plan.featured ? "border-white/15" : "border-ink-100")} />
                  <h3 className={"mb-3 text-[12px] font-extrabold uppercase tracking-[0.1em] " + (plan.featured ? "text-brand-200" : "text-ink-400")}>
                    Plan features
                  </h3>
                  <ul className="flex flex-col gap-2.5">
                    <Feature onDark={plan.featured} label="Official WhatsApp Business API" enabled />
                    <Feature onDark={plan.featured} label="Contacts" enabled />
                    <Feature onDark={plan.featured} label="Campaigns" enabled />
                    <Feature onDark={plan.featured} label="Platform messages: no fixed plan cap" enabled />
                    <Feature onDark={plan.featured} label={plan.users} enabled />
                    <Feature onDark={plan.featured} label="Developer API access" enabled={plan.api} />
                    <Feature onDark={plan.featured} label="Customer webhooks" enabled={plan.webhooks} />
                  </ul>
                </article>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Notes --------------------------------------------------------- */}
        <section className="border-y border-ink-100 bg-canvas">
          <div className="mx-auto grid max-w-[1240px] gap-8 px-5 py-16 md:grid-cols-3 lg:px-8">
            {[
              ["Know what you’ll pay for", "Your subscription covers access to MobiWave WA and the features shown for your plan. Setup is optional and charged once if you request onboarding assistance."],
              ["Meta messaging charges are separate", "Meta charges separately from your MobiWave subscription. Since 1 July 2025, template pricing is based on each delivered message and its category, not a flat conversation fee. Current rates and rules below reflect the Meta rate card effective 1 October 2026."],
              ["No fixed plan caps", "Contacts, campaigns and platform messaging have no fixed subscription caps. Fair-use safeguards, Meta policies, consent requirements and technical protections still apply."],
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
              description="These are Meta’s published base rates for recipients in Kenya, which uses Meta’s “Rest of Africa” rate group. They are separate from MobiWave WA subscription and optional setup fees."
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
              ["What is not included in these rates?", ["MobiWave WA monthly subscription and optional setup.", "Any separately agreed provider or onboarding fees.", "Applicable taxes, foreign-exchange conversion or payment-provider fees."]],
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
                ["Are setup fees compulsory?", "No. Setup fees are optional one-time charges if you want MobiWave to assist with onboarding. Your monthly subscription is billed separately."],
                ["Are Meta WhatsApp charges included?", "No. Meta bills separately for eligible delivered messages. Kenya is in Meta’s Rest of Africa rate group; current base rates and the October 2026 service-message changes are listed above. Rates, billing currency, discounts and taxes may vary."],
                ["Are contacts, campaigns or messages capped?", "There are no fixed subscription caps for contacts, campaigns or platform messaging. Acceptable-use safeguards and Meta's rules continue to apply."],
                ["How are campaigns controlled?", "Outbound campaigns use approved Meta templates and recorded customer opt-in. Teams choose recipients and initiate sends, and opted-out contacts must be suppressed."],
                ["Which plans include API access?", "Developer API access and customer webhooks are available on Basic, Pro and Enterprise. Starter does not include customer API or webhook access."],
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
          title="Start with the essentials."
          description="Create your business account and connect your eligible WhatsApp Business account."
        />
      </main>

      <MarketingFooter blurb="WhatsApp customer messaging for business teams." />
    </div>
  );
}
