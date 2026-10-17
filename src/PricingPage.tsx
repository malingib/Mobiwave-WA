import { ArrowRight, ArrowUpRight, Check, MessageCircle, Minus, ShieldCheck, X } from "lucide-react";

const plans = [
  { name: "Starter", price: "2,000", setup: "2,000", users: "2 users", intro: "A clear starting point for small teams", featured: false, ai: false, api: false, webhooks: false, chatbot: false },
  { name: "Basic", price: "4,000", setup: "4,000", users: "4 users", intro: "More room for a growing customer team", featured: false, ai: false, api: true, webhooks: true, chatbot: false },
  { name: "Pro", price: "8,000", setup: "8,000", users: "10 users", intro: "Connected workflows with AI assistance", featured: true, ai: true, api: true, webhooks: true, chatbot: true },
  { name: "Enterprise", price: "20,000", setup: "30,000", users: "Unlimited users", intro: "For larger teams and custom requirements", featured: false, ai: true, api: true, webhooks: true, chatbot: true },
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
        <p>Manage WhatsApp conversations, contacts and campaigns in one workspace. Upgrade when you need more team access, integrations or AI automation.</p>
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
            <Feature label="AI assistant" enabled={plan.ai}/>
            <Feature label="Chatbot automation" enabled={plan.chatbot}/>
          </ul>
        </article>)}
      </section>
      <section className="wa-pricing-notes">
        <div><h2>Know what you’ll pay for</h2><p>Your subscription covers access to MobiWave WA and the features shown for your plan. Setup is optional and charged once if you request onboarding assistance.</p></div>
        <div><h3>Meta messaging charges are separate</h3><p>Meta may charge for WhatsApp message templates and conversations according to its current pricing and category rules. These third-party charges are not included in the MobiWave monthly subscription.</p></div>
        <div><h3>No fixed plan caps</h3><p>Contacts, campaigns and platform messaging have no fixed subscription caps. Fair-use safeguards, Meta policies, consent requirements and technical protections still apply.</p></div>
      </section>
      <section className="marketing-faq wa-pricing-faq" id="pricing-faq">
        <div className="marketing-section-heading"><div className="marketing-kicker">PRICING FAQ</div><h2>Questions, <em>answered.</em></h2></div>
        <div className="marketing-faq-list">
          <details><summary>Are setup fees compulsory?</summary><p>No. Setup fees are optional one-time charges if you want MobiWave to assist with onboarding. Your monthly subscription is billed separately.</p></details>
          <details><summary>Are Meta WhatsApp charges included?</summary><p>No. Meta's applicable WhatsApp messaging charges are separate from the MobiWave subscription and depend on Meta's pricing rules.</p></details>
          <details><summary>Are contacts, campaigns or messages capped?</summary><p>There are no fixed subscription caps for contacts, campaigns or platform messaging. Acceptable-use safeguards and Meta's rules continue to apply.</p></details>
          <details><summary>Which plans have AI automation?</summary><p>AI assistant and chatbot automation are available on Pro and Enterprise. Starter and Basic can use the core inbox and campaign workflow without AI.</p></details>
          <details><summary>Which plans include API access?</summary><p>Developer API access and customer webhooks are available on Basic, Pro and Enterprise. Starter does not include customer API or webhook access.</p></details>
        </div>
      </section>
      <section className="marketing-final-cta"><div><div className="marketing-kicker">READY WHEN YOU ARE</div><h2>Start with the essentials.</h2><p>Create your workspace and connect your eligible WhatsApp Business account.</p></div><a className="marketing-primary" href="/login?mode=signup">Get started <ArrowRight size={16}/></a></section>
    </main>
    <footer className="marketing-footer"><a className="marketing-brand" href="/"><span className="marketing-brand-icon"><MessageCircle size={19}/></span><span><strong>MobiWave</strong><small>WA</small></span></a><p>Customer messaging and automation for business.</p><div><a href="/privacy-policy/">Privacy</a><a href="/terms-of-service/">Terms</a><a href="/data-deletion/">Data deletion</a><a href="mailto:info@mobiwave.co.ke">Contact</a></div><small>© {new Date().getFullYear()} MobiWave Innovations Ltd</small></footer>
  </div>;
}
