import {
  ArrowRight, ArrowUpRight, Check, ChevronRight, CircleCheck,
  ContactRound, MessageCircle, MessagesSquare, ShieldCheck,
  Workflow, Zap,
} from "lucide-react";

const features = [
  { icon: MessagesSquare, title: "A shared WhatsApp team inbox", text: "Give your team one place to view customer conversations, follow up and hand work over without losing context." },
  { icon: Zap, title: "WhatsApp campaigns with safeguards", text: "Prepare outbound campaigns with approved Meta message templates and recorded customer opt-in." },
  { icon: MessageCircle, title: "Conversation status at a glance", text: "Keep message status and customer history visible so your team can follow up with more confidence." },
  { icon: ContactRound, title: "Organised customer contacts", text: "Manage contact details, consent records and opt-outs in your business workspace." },
  { icon: Workflow, title: "APIs and webhooks for your systems", text: "Connect supported workflows using workspace-scoped API keys and signed customer webhooks." },
  { icon: ShieldCheck, title: "Business accounts kept separate", text: "Workspace membership and access controls help keep each business's messaging data within its account." },
];

const useCases = [
  { title: "Customer support", text: "Let the right team member pick up a conversation and see its history." },
  { title: "Order and service updates", text: "Use eligible, approved templates to send important customer notifications." },
  { title: "Appointment and payment reminders", text: "Keep opted-in customers informed with relevant utility messages." },
  { title: "Sales follow-up", text: "Manage inbound interest and follow-ups in a shared team inbox." },
];

export default function LandingPage() {
  return (
    <div className="marketing-site">
      <header className="marketing-nav">
        <a className="marketing-brand" href="/" aria-label="MobiWave WA home">
          <span className="marketing-brand-icon"><MessageCircle size={21} strokeWidth={2.4}/></span>
          <span><strong>MobiWave</strong><small>WA</small></span>
        </a>
        <nav className="marketing-nav-links" aria-label="Main navigation">
          <a href="#features">Features</a>
          <a href="#use-cases">Use cases</a>
          <a href="#how-it-works">How it works</a>
          <a href="/pricing">Pricing</a>
          <a href="#security">Security</a>
          <a href="#faq">FAQs</a>
        </nav>
        <div className="marketing-nav-actions">
          <a className="marketing-signin" href="/login">Sign in</a>
          <a className="marketing-nav-cta" href="/login?mode=signup">Create account <ArrowUpRight size={15}/></a>
        </div>
      </header>

      <main>
        <section className="marketing-hero">
          <div className="marketing-hero-copy">
            <div className="marketing-kicker"><span/> ONE NUMBER, ONE BUSINESS ACCOUNT · WHATSAPP BUSINESS MESSAGING FOR KENYA</div>
            <h1>WhatsApp Business API in Kenya, <em>built for your team.</em></h1>
            <p className="marketing-hero-description">Use the WhatsApp Business API in Kenya to manage customer conversations, contacts and approved campaigns in one shared workspace. MobiWave WA connects through Meta's official WhatsApp Cloud API, with tools designed for local business teams.</p>
            <div className="marketing-hero-actions">
              <a className="marketing-primary" href="/login?mode=signup">Create your account <ArrowRight size={16}/></a>
              <a className="marketing-secondary" href="/pricing">Explore pricing <ChevronRight size={16}/></a>
            </div>
            <div className="marketing-proof"><span><CircleCheck size={15}/> Official Meta Cloud API</span><span><CircleCheck size={15}/> Shared team inbox</span><span><CircleCheck size={15}/> Consent-aware campaigns</span></div>
          </div>
          <div className="marketing-preview-wrap" aria-label="Illustration of the MobiWave WA inbox"><p className="preview-demo-label">Illustrative preview · sample data</p>
            <div className="marketing-preview">
              <div className="preview-topbar"><div className="preview-brand"><span><MessageCircle size={14}/></span><strong>MobiWave WA</strong></div><div className="preview-top-status"><i/> Workspace overview</div><div className="preview-user">MW</div></div>
              <div className="preview-body">
                <aside className="preview-sidebar"><div className="preview-side-active"><MessagesSquare size={15}/> Inbox <b>4</b></div><div><ContactRound size={15}/> Contacts</div><div><Zap size={15}/> Campaigns</div><div><ShieldCheck size={15}/> Team access</div><div><Workflow size={15}/> Integrations</div><div className="preview-side-bottom"><ShieldCheck size={14}/> Consent-aware workflow</div></aside>
                <div className="preview-main">
                  <div className="preview-heading"><div><small>WHATSAPP BUSINESS</small><h3>Customer conversations</h3><p>One shared place for your customer threads.</p></div><span className="preview-date">All contacts⌄</span></div>
                  <div className="preview-stats"><div><span>Conversations</span><strong>128</strong><small className="preview-positive">Sample activity</small></div><div><span>Response time</span><strong>4m <small>12s</small></strong><small>Illustrative metric</small></div><div><span>Contacts</span><strong>846</strong><small>Sample records</small></div></div>
                  <div className="preview-lower"><div className="preview-inbox"><div className="preview-section-title"><strong>Recent conversations</strong><span>Inbox <ArrowUpRight size={12}/></span></div><div className="preview-chat-row"><span className="preview-avatar avatar-one">AK</span><div><strong>Angela K.</strong><p>Thank you, that helps!</p></div><time>2m</time></div><div className="preview-chat-row"><span className="preview-avatar avatar-two">JM</span><div><strong>James M.</strong><p>Can you share the details?</p></div><time>8m</time></div><div className="preview-chat-row"><span className="preview-avatar avatar-three">NW</span><div><strong>Naomi W.</strong><p>I'd like to know more.</p></div><time>21m</time></div></div><div className="preview-assistant"><strong>Campaign checks</strong><p>Keep outbound messaging accountable.</p><div><Check size={12}/> Approved templates</div><div><Check size={12}/> Recorded opt-in</div></div></div>
                </div>
              </div>
            </div>
            <div className="preview-floating-note"><span><CircleCheck size={16}/></span><div><strong>One shared workspace</strong><small>Conversations, contacts and team access</small></div></div>
          </div>
        </section>

        <section className="marketing-value-strip" id="security">
          <div><ShieldCheck size={19}/><span><strong>Official WhatsApp Cloud API</strong><small>Connect through Meta's official platform</small></span></div>
          <div><MessagesSquare size={19}/><span><strong>Shared team inbox</strong><small>Keep customer threads together</small></span></div>
          <div><ShieldCheck size={19}/><span><strong>Consent-led campaigns</strong><small>Approved templates and opt-in controls</small></span></div>
        </section>

        <section className="marketing-features" id="features">
          <div className="marketing-section-heading"><div className="marketing-kicker">THE TOOLS YOUR TEAM NEEDS</div><h2>A practical WhatsApp Business platform. <em>All in one place.</em></h2><p>Support customers, organise contacts and manage outbound messaging from one business workspace—without relying on unofficial WhatsApp automation tools.</p></div>
          <div className="marketing-feature-grid">{features.map(({ icon: Icon, title, text }) => <article className="marketing-feature" key={title}><span className="marketing-feature-icon"><Icon size={19}/></span><h3>{title}</h3><p>{text}</p><a href="/login">Explore the platform <ArrowUpRight size={14}/></a></article>)}</div>
        </section>

        <section className="marketing-use-cases" id="use-cases">
          <div className="marketing-section-heading"><div className="marketing-kicker">MADE FOR REAL CUSTOMER WORK</div><h2>From first question to <em>follow-up.</em></h2><p>Give customer-facing teams a clearer way to manage everyday WhatsApp conversations.</p></div>
          <div className="marketing-use-case-grid">{useCases.map(({ title, text }, index) => <article className="marketing-use-case" key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{text}</p></article>)}</div>
        </section>

        <section className="marketing-how" id="how-it-works">
          <div className="marketing-how-copy"><div className="marketing-kicker">HOW TO GET STARTED</div><h2>Connect your business. <em>Bring your team together.</em></h2><p>Start with a MobiWave WA workspace, connect an eligible WhatsApp Business account through Meta, and set up the tools your customer workflow needs.</p><a className="marketing-primary" href="/login?mode=signup">Create your business account <ArrowRight size={16}/></a></div>
          <div className="marketing-steps"><div><span>01</span><section><strong>Create your workspace</strong><p>Set up your business account and invite your team.</p></section><CircleCheck size={18}/></div><div><span>02</span><section><strong>Connect through Meta</strong><p>Use the official WhatsApp Cloud API and the required business permissions.</p></section><CircleCheck size={18}/></div><div><span>03</span><section><strong>Manage conversations and campaigns</strong><p>Organise contacts, use approved templates and keep consent records up to date.</p></section><CircleCheck size={18}/></div></div>
        </section>

        <section className="marketing-faq" id="faq">
          <div className="marketing-section-heading"><div className="marketing-kicker">WHATSAPP BUSINESS API FAQ</div><h2>Questions, answered <em>before you start.</em></h2><p>Understand the platform, Meta requirements and how your team can use it.</p></div>
          <div className="marketing-faq-list">
            <details><summary>What is the WhatsApp Business API?</summary><p>The WhatsApp Business Platform lets eligible businesses connect WhatsApp messaging to business tools and workflows. MobiWave WA provides a workspace for shared conversations, contact management and approved-template campaigns using Meta's official Cloud API.</p></details>
            <details><summary>Is MobiWave WA a WhatsApp Business API provider?</summary><p>MobiWave WA is a business messaging workspace that connects through Meta's official WhatsApp Cloud API. You need an eligible business account, a connected number and the required Meta permissions. Do not assume that account approval or a verification badge is guaranteed.</p></details>
            <details><summary>Can my team manage conversations together?</summary><p>Yes. The shared inbox brings customer threads into one workspace, with team access and conversation context to support follow-up and hand-offs.</p></details>
            <details><summary>Can I send WhatsApp bulk messages or campaigns?</summary><p>Campaigns must follow Meta's messaging policies. Outbound messages that require templates must use approved templates, and marketing messages require appropriate customer opt-in. Opt-outs must be respected.</p></details>
            <details><summary>How much does WhatsApp Business API cost in Kenya?</summary><p>Costs can include Meta's message charges and any platform or implementation fees. The final amount depends on message category, destination and your setup. Review the <a href="/pricing">MobiWave WA pricing page</a> and contact the team for details rather than assuming a single flat WhatsApp rate.</p></details>
            <details><summary>Can I connect MobiWave WA to my existing systems?</summary><p>Supported integrations include workspace-scoped API keys and signed webhooks. Check the available integration settings and documentation before planning a specific connection.</p></details>
            <details><summary>Can I use unofficial WhatsApp QR tools?</summary><p>No. MobiWave WA is built around Meta's official WhatsApp Cloud API. It does not use unofficial WhatsApp Web engines or QR-pairing automation.</p></details>
          </div>
        </section>

        <section className="marketing-final-cta"><div><div className="marketing-kicker">WHATSAPP BUSINESS MESSAGING, MADE CLEARER</div><h2>Give every customer conversation a next step.</h2><p>Set up your MobiWave WA workspace and bring conversations, contacts and campaign controls together.</p></div><a className="marketing-primary" href="/login?mode=signup">Get started <ArrowRight size={16}/></a></section>
      </main>
      <footer className="marketing-footer"><a className="marketing-brand" href="/"><span className="marketing-brand-icon"><MessageCircle size={19}/></span><span><strong>MobiWave</strong><small>WA</small></span></a><p>WhatsApp Business messaging for Kenyan teams.</p><div><a href="https://mobiwave.co.ke/">MobiWave services</a><a href="/pricing">Pricing</a><a href="/privacy-policy/">Privacy</a><a href="/terms-of-service/">Terms</a><a href="/data-deletion/">Data deletion</a><a href="mailto:info@mobiwave.co.ke">Contact</a></div><small>© {new Date().getFullYear()} MobiWave Innovations Ltd</small></footer>
    </div>
  );
}
