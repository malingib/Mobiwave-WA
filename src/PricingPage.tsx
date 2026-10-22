import { ArrowRight, ArrowUpRight, Check, MessageCircle, ShieldCheck, X } from "lucide-react";

const plans = [
  { name: "Starter", price: "2,000", setup: "2,000", users: "2 users", intro: "A clear starting point for small teams", featured: false, api: false, webhooks: false },
  { name: "Basic", price: "4,000", setup: "4,000", users: "4 users", intro: "More room for a growing customer team", featured: false, api: true, webhooks: true },
  { name: "Pro", price: "8,000", setup: "8,000", users: "10 users", intro: "Connected workflows for growing teams", featured: true, api: true, webhooks: true },
  { name: "Enterprise", price: "20,000", setup: "30,000", users: "Unlimited users", intro: "For larger teams and custom requirements", featured: false, api: true, webhooks: true },
];

function Feature({ label, enabled }: { label: string; enabled: boolean }) {
  return <li className={enabled ? "wa-price-feature" : "wa-price-feature unavailable"}>
    {enabled ? <Check size={15} aria-hidden="true" /> : <X size={15} aria-hidden="true" />}
    <span>{label}</span>
  </li>;
}

export default function PricingPage() {
  return <div className="marketing-site wa-pricing-page">
    <header className="marketing-nav">
      <a className="marketing-brand" href="/" aria-label="MobiWave WA home">
        <span className="marketing-brand-icon"><MessageCircle size={21} strokeWidth={2.4}/></span>
        <span><strong>MobiWave</strong><small>WA</small></span>
      </a>
      <nav className="marketing-nav-links" aria-label="Main navigation">
        <a href="/#features">Features</a><a href="/pricing" aria-current="page">Pricing</a><a href="/#faq">FAQs</a>
      </nav>
      <div className="marketing-nav-actions"><a className="marketing-signin" href="/login">Sign in</a><a className="marketing-nav-cta" href="/login?mode=signup">Get started <ArrowUpRight size={15}/></a></div>
    </header>
    <main>
      <section className="wa-pricing-hero">
        <div className="marketing-kicker"><span/> STRAIGHTFORWARD SUBSCRIPTIONS</div>
        <h1>Choose a plan that fits <em>your team.</em></h1>
        <p>Manage WhatsApp conversations, contacts and campaigns in one workspace. Upgrade when you need more team access and developer integrations.</p>
        <div className="wa-pricing-trust"><span><ShieldCheck size={15}/> Official Meta Cloud API</span><span><Check size={15}/> No fixed contact, campaign or platform-message caps</span></div>
      </section>
      <section className="wa-pricing-plans" aria-label="WhatsApp subscription plans">
        {plans.map(plan => <article className={plan.featured ? "wa-plan featured" : "wa-plan"} key={plan.name}>
          {plan.featured && <div className="wa-plan-badge">MOST POPULAR</div>}
          <div className="wa-plan-head"><h2>{plan.name}</h2><p>{plan.intro}</p></div>
          <div className="wa-plan-price"><span>KES</span><strong>{plan.price}</strong><small>/ month</small></div>
          <p className="wa-plan-setup">Optional one-time setup: <strong>KES {plan.setup}</strong></p>
          <a className={plan.featured ? "marketing-primary wa-plan-cta" : "marketing-secondary wa-plan-cta"} href={"/login?mode=signup&plan=" + plan.name.toLowerCase()}>Choose {plan.name} <ArrowRight size={15}/></a>
          <div className="wa-plan-divider"/>
          <h3>Plan features</h3>
          <ul className="wa-price-features">
            <Feature label="Official WhatsApp Business API" enabled />
            <Feature label="Contacts" enabled />
            <Feature label="Campaigns" enabled />
            <Feature label="Platform messages: no fixed plan cap" enabled />
            <Feature label={plan.users} enabled />
            <Feature label="Developer API access" enabled={plan.api}/>
            <Feature label="Customer webhooks" enabled={plan.webhooks}/>

          </ul>
        </article>)}
      </section>
      <section className="wa-pricing-notes">
        <div><h2>Know what you’ll pay for</h2><p>Your subscription covers access to MobiWave WA and the features shown for your plan. Setup is optional and charged once if you request onboarding assistance.</p></div>
        <div><h3>Meta messaging charges are separate</h3><p>Meta charges separately from your MobiWave subscription. Since 1 July 2025, template pricing is based on each delivered message and its category, not a flat conversation fee. Current rates and rules below reflect the Meta rate card effective 1 October 2026.</p></div>
        <div><h3>No fixed plan caps</h3><p>Contacts, campaigns and platform messaging have no fixed subscription caps. Fair-use safeguards, Meta policies, consent requirements and technical protections still apply.</p></div>
      </section>
      <section className="wa-meta-pricing" aria-labelledby="wa-meta-pricing-title">
        <div className="marketing-section-heading">
          <div className="marketing-kicker">META WHATSAPP BUSINESS PLATFORM</div>
          <h2 id="wa-meta-pricing-title">Message charges, <em>explained.</em></h2>
          <p>These are Meta’s published base rates for recipients in Kenya, which uses Meta’s “Rest of Africa” rate group. They are separate from MobiWave WA subscription and optional setup fees.</p>
        </div>
        <div className="wa-meta-rate-table-wrap"><table className="wa-meta-rate-table">
          <thead><tr><th>Message category</th><th>Typical use</th><th>Meta base rate</th></tr></thead>
          <tbody>
            <tr><td><strong>Marketing</strong></td><td>Promotions, offers, product announcements and re-engagement templates</td><td><strong>US$0.0225</strong><small>per delivered message</small></td></tr>
            <tr><td><strong>Utility</strong></td><td>Order updates, receipts, appointment reminders and transactional templates</td><td><strong>US$0.0040</strong><small>per delivered message*</small></td></tr>
            <tr><td><strong>Authentication</strong></td><td>One-time passwords and account verification templates</td><td><strong>US$0.0040</strong><small>per delivered message*</small></td></tr>
            <tr><td><strong>Service replies</strong></td><td>Free-form customer support replies in the 24-hour customer service window</td><td><strong>First 1,000 free</strong><small>per business phone number per month; then US$0.0040 per message</small></td></tr>
          </tbody>
        </table></div>
        <p className="wa-meta-footnote">*Utility and authentication base/list rates shown before eligible volume discounts. Effective 1 October 2026, utility templates sent inside an open customer service window are chargeable too. Service-message free allowance applies separately to each business phone number; service messages do not receive utility volume discounts.</p>
        <div className="wa-meta-rules">
          <article><h3>How Meta calculates charges</h3><ul><li>Only delivered messages are charged.</li><li>The recipient’s country calling code determines the market rate.</li><li>Template category determines the applicable rate.</li><li>Eligible utility and authentication traffic can qualify for volume-tier discounts.</li></ul></article>
          <article><h3>What is not included in these rates?</h3><ul><li>MobiWave WA monthly subscription and optional setup.</li><li>Any separately agreed provider or onboarding fees.</li><li>Applicable taxes, foreign-exchange conversion or payment-provider fees.</li></ul></article>
        </div>
        <div className="wa-meta-source"><ShieldCheck size={17}/><p><strong>Meta’s rates can change.</strong> The figures above are the published Rest of Africa USD base rates identified for the rate card effective 1 October 2026. Confirm the rate and billing currency in your own WhatsApp Business Account before budgeting or sending campaigns.</p></div>
        <p className="wa-meta-official">Official references: <a href="https://developers.facebook.com/docs/whatsapp/pricing/" target="_blank" rel="noreferrer">Meta pricing and rate cards <ArrowUpRight size={13}/></a> <span>·</span> <a href="https://developers.facebook.com/docs/whatsapp/pricing/updates-to-pricing/" target="_blank" rel="noreferrer">Meta pricing updates <ArrowUpRight size={13}/></a></p>
      </section>
      <section className="marketing-faq wa-pricing-faq" id="pricing-faq">
        <div className="marketing-section-heading"><div className="marketing-kicker">PRICING FAQ</div><h2>Questions, <em>answered.</em></h2></div>
        <div className="marketing-faq-list">
          <details><summary>Are setup fees compulsory?</summary><p>No. Setup fees are optional one-time charges if you want MobiWave to assist with onboarding. Your monthly subscription is billed separately.</p></details>
          <details><summary>Are Meta WhatsApp charges included?</summary><p>No. Meta bills separately for eligible delivered messages. Kenya is in Meta’s Rest of Africa rate group; current base rates and the October 2026 service-message changes are listed above. Rates, billing currency, discounts and taxes may vary.</p></details>
          <details><summary>Are contacts, campaigns or messages capped?</summary><p>There are no fixed subscription caps for contacts, campaigns or platform messaging. Acceptable-use safeguards and Meta's rules continue to apply.</p></details>
          <details><summary>How are campaigns controlled?</summary><p>Outbound campaigns use approved Meta templates and recorded customer opt-in. Teams choose recipients and initiate sends, and opted-out contacts must be suppressed.</p></details>
          <details><summary>Which plans include API access?</summary><p>Developer API access and customer webhooks are available on Basic, Pro and Enterprise. Starter does not include customer API or webhook access.</p></details>
        </div>
      </section>
      <section className="marketing-final-cta"><div><div className="marketing-kicker">READY WHEN YOU ARE</div><h2>Start with the essentials.</h2><p>Create your workspace and connect your eligible WhatsApp Business account.</p></div><a className="marketing-primary" href="/login?mode=signup">Get started <ArrowRight size={16}/></a></section>
    </main>
    <footer className="marketing-footer"><a className="marketing-brand" href="/"><span className="marketing-brand-icon"><MessageCircle size={19}/></span><span><strong>MobiWave</strong><small>WA</small></span></a><p>WhatsApp customer messaging for business teams.</p><div><a href="/privacy-policy/">Privacy</a><a href="/terms-of-service/">Terms</a><a href="/data-deletion/">Data deletion</a><a href="mailto:info@mobiwave.co.ke">Contact</a></div><small>© {new Date().getFullYear()} MobiWave Innovations Ltd</small></footer>
  </div>;
}
