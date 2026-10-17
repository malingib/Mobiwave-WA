import {
  ArrowRight, ArrowUpRight, Bot, Check, ChevronRight, CircleCheck,
  ContactRound, MessageCircle, MessagesSquare, ShieldCheck, Sparkles,
  Workflow, Zap,
} from "lucide-react";

const features = [
  { icon: MessagesSquare, title: "One shared inbox", text: "Give your team a single place to manage customer conversations and handoffs." },
  { icon: Zap, title: "Campaigns with guardrails", text: "Use approved Meta templates and recorded opt-in consent for outbound messaging." },
  { icon: Bot, title: "Helpful AI automation", text: "Ground answers in your own approved knowledge, with human handoff when needed." },
  { icon: ContactRound, title: "Contacts that stay organized", text: "Manage customer records, consent and opt-out status in each workspace." },
  { icon: Workflow, title: "Connect your workflows", text: "Use tenant-scoped API keys and signed webhooks to connect your business systems." },
  { icon: ShieldCheck, title: "Built for business use", text: "Each customer workspace keeps its own settings, integration and messaging data." },
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
          <a href="#how-it-works">How it works</a>
          <a href="/pricing">Pricing</a>
          <a href="#security">Security</a>
          <a href="#faq">FAQs</a>
        </nav>
        <div className="marketing-nav-actions">
          <a className="marketing-signin" href="/login">Sign in</a>
          <a className="marketing-nav-cta" href="/login?mode=signup">Get started <ArrowUpRight size={15}/></a>
        </div>
      </header>

      <main>
        <section className="marketing-hero">
          <div className="marketing-hero-copy">
            <div className="marketing-kicker"><span/> CUSTOMER MESSAGING, MADE CLEAR</div>
            <h1>WhatsApp Business messaging. <em>Less busywork.</em></h1>
            <p className="marketing-hero-description">Bring WhatsApp conversations, team collaboration, campaigns and useful AI automation into one focused workspace for your business.</p>
            <div className="marketing-hero-actions">
              <a className="marketing-primary" href="/login?mode=signup">Get started <ArrowRight size={16}/></a>
              <a className="marketing-secondary" href="#features">Explore the platform <ChevronRight size={16}/></a>
            </div>
            <div className="marketing-proof"><span><CircleCheck size={15}/> Official Meta Cloud API</span><span><CircleCheck size={15}/> Your business, your workspace</span></div>
          </div>
          <div className="marketing-preview-wrap" aria-label="Illustration of the MobiWave WA workspace">
            <div className="marketing-preview">
              <div className="preview-topbar"><div className="preview-brand"><span><MessageCircle size={14}/></span><strong>MobiWave WA</strong></div><div className="preview-top-status"><i/> Workspace overview</div><div className="preview-user">MW</div></div>
              <div className="preview-body">
                <aside className="preview-sidebar"><div className="preview-side-active"><MessagesSquare size={15}/> Inbox <b>4</b></div><div><ContactRound size={15}/> Contacts</div><div><Zap size={15}/> Campaigns</div><div><Bot size={15}/> AI assistant</div><div><Workflow size={15}/> Integrations</div><div className="preview-side-bottom"><ShieldCheck size={14}/> Workspace secure</div></aside>
                <div className="preview-main">
                  <div className="preview-heading"><div><small>YOUR WORKSPACE</small><h3>Good morning.</h3><p>Here's what's happening with your customers.</p></div><span className="preview-date">This month⌄</span></div>
                  <div className="preview-stats"><div><span>Conversations</span><strong>128</strong><small className="preview-positive">Active customer threads</small></div><div><span>Response time</span><strong>4m <small>12s</small></strong><small>Team performance</small></div><div><span>Contacts</span><strong>846</strong><small>Managed in one place</small></div></div>
                  <div className="preview-lower"><div className="preview-inbox"><div className="preview-section-title"><strong>Recent conversations</strong><span>View inbox <ArrowUpRight size={12}/></span></div><div className="preview-chat-row"><span className="preview-avatar avatar-one">AK</span><div><strong>Angela K.</strong><p>Thank you, that helps!</p></div><time>2m</time></div><div className="preview-chat-row"><span className="preview-avatar avatar-two">JM</span><div><strong>James M.</strong><p>Can you share the details?</p></div><time>8m</time></div><div className="preview-chat-row"><span className="preview-avatar avatar-three">NW</span><div><strong>Naomi W.</strong><p>I'd like to know more.</p></div><time>21m</time></div></div><div className="preview-assistant"><span className="preview-ai-icon"><Sparkles size={15}/></span><strong>AI assistant</strong><p>Answers grounded in your business knowledge.</p><div><Check size={12}/> Human handoff enabled</div><div><Check size={12}/> Knowledge sources connected</div></div></div>
                </div>
              </div>
            </div>
            <div className="preview-floating-note"><span><CircleCheck size={16}/></span><div><strong>Everything in context</strong><small>Messages, team and customer history</small></div></div>
          </div>
        </section>

        <section className="marketing-value-strip" id="security">
          <div><ShieldCheck size={19}/><span><strong>Official WhatsApp Cloud API</strong><small>Connect through Meta's official platform</small></span></div>
          <div><MessagesSquare size={19}/><span><strong>Team-ready workspace</strong><small>Shared conversations and handoffs</small></span></div>
          <div><Sparkles size={19}/><span><strong>AI when you need it</strong><small>Optional automation with human control</small></span></div>
        </section>

        <section className="marketing-features" id="features">
          <div className="marketing-section-heading"><div className="marketing-kicker">ONE WORKSPACE, LESS FRICTION</div><h2>The tools to serve customers <em>thoughtfully.</em></h2><p>Keep everyday messaging simple, while giving your team the controls to grow with confidence.</p></div>
          <div className="marketing-feature-grid">{features.map(({ icon: Icon, title, text }) => <article className="marketing-feature" key={title}><span className="marketing-feature-icon"><Icon size={19}/></span><h3>{title}</h3><p>{text}</p><a href="/login">Explore workspace <ArrowUpRight size={14}/></a></article>)}</div>
        </section>

        <section className="marketing-how" id="how-it-works">
          <div className="marketing-how-copy"><div className="marketing-kicker">GET STARTED IN STEPS</div><h2>Set up for your business. <em>Not someone else's.</em></h2><p>Start with a workspace for your team, connect your own WhatsApp Business account, and configure the tools that fit your customer experience.</p><a className="marketing-primary" href="/login?mode=signup">Create your workspace <ArrowRight size={16}/></a></div>
          <div className="marketing-steps"><div><span>01</span><section><strong>Create your workspace</strong><p>Set up your team and business space.</p></section><CircleCheck size={18}/></div><div><span>02</span><section><strong>Connect your WhatsApp account</strong><p>Use your own eligible Meta Business integration.</p></section><CircleCheck size={18}/></div><div><span>03</span><section><strong>Bring your customer workflow together</strong><p>Configure your inbox, contacts, campaigns and optional AI.</p></section><CircleCheck size={18}/></div></div>
        </section>

        <section className="marketing-faq" id="faq">
          <div className="marketing-section-heading"><div className="marketing-kicker">COMMON QUESTIONS</div><h2>Good to know <em>before you start.</em></h2><p>Clear answers about connecting WhatsApp and working with your team.</p></div>
          <div className="marketing-faq-list">
            <details><summary>Does MobiWave WA use the official WhatsApp API?</summary><p>Yes. MobiWave WA is designed to connect through Meta's official WhatsApp Cloud API, not unofficial WhatsApp automation engines.</p></details>
            <details><summary>Can my business connect its own WhatsApp account?</summary><p>Yes. Each client workspace is designed for its own business integration and settings. Your business needs an eligible WhatsApp Business account and the required Meta permissions.</p></details>
            <details><summary>Can my team manage conversations together?</summary><p>The platform brings customer conversations into a shared workspace to support team visibility and handoffs.</p></details>
            <details><summary>Can I send WhatsApp campaigns?</summary><p>Campaign messaging must follow Meta's policies, including required approved message templates and appropriate customer opt-in. Availability depends on your connected account and permissions.</p></details>
            <details><summary>Is AI automation required?</summary><p>No. AI assistance is optional. Configure the messaging workflow that suits your business and keep human handoff available where needed.</p></details>
          </div>
        </section>

        <section className="marketing-final-cta"><div><div className="marketing-kicker">READY WHEN YOU ARE</div><h2>Make every conversation count.</h2><p>Bring your customer messaging into one clear, connected workspace.</p></div><a className="marketing-primary" href="/login?mode=signup">Get started <ArrowRight size={16}/></a></section>
      </main>
      <footer className="marketing-footer"><a className="marketing-brand" href="/"><span className="marketing-brand-icon"><MessageCircle size={19}/></span><span><strong>MobiWave</strong><small>WA</small></span></a><p>Customer messaging and automation for business.</p><div><a href="/privacy-policy/">Privacy</a><a href="/terms-of-service/">Terms</a><a href="/data-deletion/">Data deletion</a><a href="mailto:info@mobiwave.co.ke">Contact</a></div><small>© {new Date().getFullYear()} MobiWave Innovations Ltd</small></footer>
    </div>
  );
}
