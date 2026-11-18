import { useState } from "react";
import {
  ArrowRight, ArrowUpRight, Check, CircleCheck, MessageCircle, MessagesSquare,
  ContactRound, ShieldCheck, Workflow, Zap, Bot, BarChart3,
  LockKeyhole, PlugZap, Headphones,
} from "lucide-react";
import { FinalCTA, Kicker, MarketingFooter, MarketingNav, SectionHeading } from "./components/MarketingChrome";
import { Reveal } from "./components/ui";

const capabilities = [
  {
    icon: MessagesSquare,
    tag: "Shared inbox",
    title: "One team, every conversation.",
    text: "Bring customer threads into a single workspace so the right person can pick up, follow up and hand over with full context.",
  },
  {
    icon: Zap,
    tag: "Campaigns",
    title: "Send with the right safeguards.",
    text: "Use Meta-approved templates and recorded customer opt-in. Consent is checked again immediately before every send.",
  },
  {
    icon: ShieldCheck,
    tag: "Trust & control",
    title: "Built around permission.",
    text: "Official WhatsApp Cloud API only. Workspace-scoped access keeps each business's messaging data inside its account.",
  },
];

const solutions = [
  {
    tab: "Customer support",
    icon: Headphones,
    title: "Support that keeps the thread.",
    text: "Route conversations to the right teammate, keep the full history in view and resolve issues without losing context.",
    points: ["Shared team inbox", "Conversation assignment", "Full message history"],
  },
  {
    tab: "Notifications",
    icon: Bot,
    title: "Updates customers expect.",
    text: "Use eligible, approved templates for order updates, receipts and appointment reminders to opted-in customers.",
    points: ["Approved templates", "Utility messages", "Delivery status"],
  },
  {
    tab: "Sales",
    icon: BarChart3,
    title: "Follow up on real interest.",
    text: "Manage inbound enquiries and follow-ups in one place, with consent records and opt-outs respected automatically.",
    points: ["Inbound lead capture", "Consent-aware sends", "Opt-out suppression"],
  },
];

const channels = [
  { icon: MessagesSquare, title: "Shared team inbox", text: "One place for every customer conversation." },
  { icon: ContactRound, title: "Contact management", text: "Keep details, consent records and opt-outs together." },
  { icon: MessageCircle, title: "Approved templates", text: "Compose with templates approved in Meta." },
  { icon: Zap, title: "Safeguarded campaigns", text: "Batched sends with consent re-checks and review." },
  { icon: Workflow, title: "Developer API", text: "Workspace-scoped API keys for your workflows." },
  { icon: PlugZap, title: "Customer webhooks", text: "Signed webhooks for reliable integrations." },
  { icon: BarChart3, title: "Usage analytics", text: "See message volume and allowance at a glance." },
  { icon: LockKeyhole, title: "Workspace isolation", text: "Accounts stay separate by design." },
];

const systems = [
  { name: "Meta Cloud API", detail: "Official WhatsApp Business Platform, no browser automation." },
  { name: "Consent ledger", detail: "Source and timestamp for every opt-in and opt-out." },
  { name: "Template sync", detail: "Approved templates pulled straight from your Meta account." },
  { name: "Delivery safety", detail: "Unknown send outcomes are held for review, never auto-retried." },
  { name: "Team access", detail: "Role-based membership scoped to your workspace." },
  { name: "Usage & billing", detail: "Allowance tracking with a separate Meta cost line item." },
];

const testimonials = [
  {
    quote: "The shared inbox cut our response time in half. Everyone sees the same conversation and nothing gets dropped.",
    name: "Amina K.",
    role: "Customer support lead",
    metric: "2× faster replies",
  },
  {
    quote: "We can finally run campaigns without worrying about consent. Opted-out contacts are skipped automatically.",
    name: "Brian O.",
    role: "Operations manager",
    metric: "Zero opt-out breaches",
  },
  {
    quote: "Setup was straightforward and the Meta Cloud API connection is rock solid. Our team was up and running in a day.",
    name: "Naomi W.",
    role: "Business owner",
    metric: "Live in 1 day",
  },
];

const faqs: [string, string][] = [
  ["Is MobiWave WA a WhatsApp Business API provider?", "MobiWave WA is a business messaging workspace that connects through Meta's official WhatsApp Cloud API. You need an eligible business account, a connected number and the required Meta permissions."],
  ["Can my team manage conversations together?", "Yes. The shared inbox brings customer threads into one workspace with team access and conversation context for follow-ups and hand-offs."],
  ["Can I send WhatsApp bulk messages or campaigns?", "Campaigns must follow Meta's messaging policies. Outbound template messages require approval and marketing messages require customer opt-in. Opt-outs are respected."],
  ["How much does WhatsApp Business API cost in Kenya?", "MobiWave charges a platform fee (KES 1,500-3,500/month + VAT) plus separate Meta message charges. All plans include 1,000 free Meta messages per business phone number per month."],
  ["What is the free service-message allowance?", "Each business phone number gets 1,000 free delivered service messages per month within the 24-hour customer service window. Marketing, utility and authentication templates are billed from the first delivered message."],
  ["Can I connect MobiWave WA to my existing systems?", "Supported integrations include workspace-scoped API keys and signed customer webhooks. Check the integration settings before planning a specific connection."],
  ["How are opt-outs handled?", "Consent is re-checked immediately before each campaign send. Contacts with an opt-out on record are skipped automatically, with the history kept per contact."],
  ["What happens if a campaign send result is unknown?", "A claimed send with an unknown result is marked failed for review and is not retried automatically, because Meta may already have accepted the message."],
];



function Hero() {
  return (
    <section className="relative overflow-hidden bg-[#f7f5ff] pt-[76px]">
      {/* soft radial glows */}
      <div aria-hidden className="pointer-events-none absolute -left-20 top-10 h-96 w-96 rounded-full bg-white/50 blur-[100px]" />
      <div aria-hidden className="pointer-events-none absolute right-1/4 top-0 h-80 w-80 rounded-full bg-[#e5e0ff]/60 blur-[90px]" />

      <div className="relative mx-auto grid max-w-[80rem] items-center gap-8 px-5 pb-24 pt-12 lg:grid-cols-[1.05fr_1fr] lg:px-8 lg:pb-32 lg:pt-16">
        <div>
          <h1 className="font-outfit text-[clamp(2.8rem,5.2vw,4.6rem)] font-bold leading-[1.02] tracking-[-0.045em] text-[#0a1a25]">
            Reach every customer with <span className="text-brand-blue">MobiWave.</span>
          </h1>
          <p className="mt-6 max-w-xl text-[16px] leading-relaxed text-[#5b6b78]">
            WhatsApp business messaging in one calm console, built for Kenyan teams that need every conversation and every shilling accounted for.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a className="btn btn-primary btn-pill" href="/login?mode=signup">
              Get started <ArrowRight size={15} />
            </a>
            <a className="btn btn-pill border border-[#dcd9ef] bg-white text-[#0a1a25] hover:bg-white/70" href="/pricing">
              Explore pricing
            </a>
          </div>
          <div className="mt-12 flex flex-wrap gap-x-12 gap-y-6 border-t border-[#e3dffa] pt-7">
            {[
              ["1,000", "free service replies / number / month"],
              ["100%", "official Meta Cloud API"],
            ].map(([value, label]) => (
              <div key={label}>
                <strong className="font-outfit block text-[30px] font-bold leading-none tracking-[-0.03em] text-[#0a1a25]">{value}</strong>
                <span className="mt-1.5 block max-w-[190px] text-[12.5px] leading-snug text-[#5b6b78]">{label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="relative flex justify-center lg:justify-end">
          <img
            src="/branding/martex-hero-nobg.webp"
            alt="MobiWave customer engagement illustration"
            className="w-full max-w-[540px] object-contain"
          />
        </div>
      </div>

      {/* lavender wave divider */}
      <svg className="absolute inset-x-0 bottom-0 w-full" viewBox="0 0 1440 120" preserveAspectRatio="none" aria-hidden>
        <path d="M0,60 C240,110 480,10 720,50 C960,90 1200,30 1440,70 L1440,120 L0,120 Z" fill="#ffffff" />
      </svg>
    </section>
  );
}



function InfrastructureSection() {
  return (
    <section className="bg-white py-12">
      <div className="mx-auto max-w-[80rem] px-5 lg:px-8">
        <Reveal>
          <SectionHeading
            title={<>The WhatsApp infrastructure that <span className="text-brand-blue">fits the way you work.</span></>}
            description="A practical workspace for shared conversations, approved campaigns and consent-aware messaging — without relying on unofficial WhatsApp tools."
          />
        </Reveal>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {capabilities.map(({ icon: Icon, tag, title, text }, index) => (
            <Reveal key={tag} delay={index * 60}>
              <article className="group h-full rounded-2xl border border-[#eef0f6] bg-white p-6 shadow-[0_8px_30px_-20px_rgba(10,26,37,0.15)] transition-all hover:-translate-y-1 hover:border-brand-blue/25 hover:shadow-[0_20px_45px_-25px_rgba(89,85,209,0.35)]">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#f1efff] text-brand-blue">
                  <Icon size={20} />
                </span>
                <span className="mt-5 block text-[11px] font-bold uppercase tracking-[0.12em] text-brand-blue">{tag}</span>
                <h3 className="font-outfit mt-2 text-[19px] font-bold leading-snug text-[#0a1a25]">{title}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-[#5b6b78]">{text}</p>
              </article>
            </Reveal>
          ))}
        </div>
        <div className="mt-10 grid grid-cols-3 gap-4 border-t border-[#eef0f6] pt-8">
          {[
            ["6+", "core messaging tools"],
            ["50+", "businesses onboarded"],
            ["12+", "integration touchpoints"],
          ].map(([value, label]) => (
            <div key={label} className="text-center">
              <strong className="font-outfit block text-[26px] font-bold text-[#0a1a25]">{value}</strong>
              <span className="text-[12px] text-[#5b6b78]">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SolutionsSection() {
  const [active, setActive] = useState(0);
  const sol = solutions[active];
  const Icon = sol.icon;
  return (
    <section className="bg-[#f7f9fc] py-20">
      <div className="mx-auto max-w-[80rem] px-5 lg:px-8">
        <Reveal>
          <SectionHeading
            align="left"
            title={<>Digital solutions designed for <span className="text-brand-blue">real-world work.</span></>}
            description="Pick the workflow that matters most to your team and see how MobiWave WA supports it."
          />
        </Reveal>
        <div className="mt-10 flex flex-wrap gap-2">
          {solutions.map((s, i) => (
            <button
              key={s.tab}
              onClick={() => setActive(i)}
              className={"btn btn-pill text-[13px] " + (active === i ? "btn-primary" : "border border-[#dfe4ee] bg-white text-[#5b6b78] hover:text-[#0a1a25]")}
            >
              {s.tab}
            </button>
          ))}
        </div>
        <div className="mt-6 grid items-center gap-8 rounded-2xl border border-[#eef0f6] bg-white p-8 lg:grid-cols-[0.9fr_1.1fr] lg:p-12">
          <div>
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#f1efff] text-brand-blue"><Icon size={22} /></span>
            <h3 className="font-outfit mt-5 text-[clamp(1.5rem,2.5vw,2rem)] font-bold leading-tight text-[#0a1a25]">{sol.title}</h3>
            <p className="mt-3 max-w-md text-[14px] leading-relaxed text-[#5b6b78]">{sol.text}</p>
            <ul className="mt-5 space-y-2.5">
              {sol.points.map((p) => (
                <li key={p} className="flex items-center gap-2.5 text-[13.5px] font-medium text-[#0a1a25]">
                  <CircleCheck size={16} className="text-brand-blue" /> {p}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative rounded-xl bg-[#f7f5ff] p-6">
            <div className="space-y-3">
              {["Customer: I'd like to place an order.", "You: Sure — I can help with that.", "Customer: Thank you!"].map((m, i) => (
                <div key={m} className={i % 2 === 0 ? "w-fit max-w-[80%] rounded-2xl rounded-tl-sm bg-white px-4 py-3 text-[13px] text-[#3d4b5c] shadow-sm" : "ml-auto w-fit max-w-[80%] rounded-2xl rounded-tr-sm bg-brand-blue px-4 py-3 text-[13px] text-white"}>
                  {m}
                </div>
              ))}
            </div>
            <div className="mt-5 flex items-center gap-2 rounded-full border border-[#e3dffa] bg-white px-4 py-2.5">
              <span className="text-[12px] text-[#9aa8b2]">Write a reply…</span>
              <span className="ml-auto flex h-6 w-6 items-center justify-center rounded-full bg-brand-blue text-white"><ArrowUpRight size={12} /></span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ChannelsSection() {
  return (
    <section className="bg-white py-20">
      <div className="mx-auto max-w-[80rem] px-5 lg:px-8">
        <Reveal>
          <SectionHeading
            title={<>The tools that keep <span className="text-brand-blue">business moving.</span></>}
            description="One connected platform for the conversations your customers actually have."
          />
        </Reveal>
        <div className="mt-12 grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-4">
          {channels.map(({ icon: Icon, title, text }, i) => (
            <Reveal key={title} delay={(i % 4) * 50}>
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f1efff] text-brand-blue"><Icon size={18} /></span>
                  <span className="font-outfit text-[12px] font-bold text-[#c3c9d4]">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <h3 className="font-outfit text-[15px] font-bold text-[#0a1a25]">{title}</h3>
                <p className="text-[12.5px] leading-relaxed text-[#5b6b78]">{text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function SystemsSection() {
  return (
    <section className="bg-[#f1efff] py-20">
      <div className="mx-auto max-w-[80rem] px-5 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr]">
          <Reveal>
            <Kicker>Under the hood</Kicker>
            <h2 className="font-outfit mt-3 text-[clamp(1.9rem,3vw,2.6rem)] font-bold leading-[1.08] tracking-[-0.035em] text-[#0a1a25]">
              We build the systems behind the work.
            </h2>
            <p className="mt-4 max-w-md text-[14px] leading-relaxed text-[#5b6b78]">
              The detail that makes a difference: official APIs, careful consent handling and controls that keep each workspace separate.
            </p>
            <a className="btn btn-primary btn-pill mt-7" href="/login?mode=signup">
              Explore the platform <ArrowRight size={15} />
            </a>
          </Reveal>
          <div className="grid gap-3 sm:grid-cols-2">
            {systems.map((s, i) => (
              <Reveal key={s.name} delay={i * 40}>
                <div className="rounded-xl border border-white bg-white/70 p-5 backdrop-blur">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f1efff] text-brand-blue">
                    <Check size={15} />
                  </span>
                  <h3 className="font-outfit mt-3 text-[14px] font-bold text-[#0a1a25]">{s.name}</h3>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-[#5b6b78]">{s.detail}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function SimpleSection() {
  const steps = [
    { n: "01", title: "Create your workspace", text: "Set up your business account and invite the people who answer customers." },
    { n: "02", title: "Connect with Meta", text: "Link an eligible WhatsApp Business number through the official Cloud API." },
    { n: "03", title: "Start the conversation", text: "Organise contacts, use approved templates and keep consent records current." },
  ];
  return (
    <section className="bg-[#f1efff] py-20">
      <div className="mx-auto max-w-[80rem] px-5 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-2">
          <Reveal>
            <Kicker>Getting started</Kicker>
            <h2 className="font-outfit mt-3 text-[clamp(1.9rem,3vw,2.6rem)] font-bold leading-[1.08] tracking-[-0.035em] text-[#0a1a25]">
              Simple to start. Solid when it matters.
            </h2>
            <p className="mt-4 max-w-md text-[14px] leading-relaxed text-[#5b6b78]">
              No browser automation, no shortcuts — just a clear path from setup to your first customer conversation.
            </p>
          </Reveal>
          <div className="flex flex-col gap-4">
            {steps.map((s, i) => (
              <Reveal key={s.n} delay={i * 60}>
                <div className="flex gap-4 rounded-xl border border-white bg-white/70 p-5 backdrop-blur">
                  <span className="font-outfit text-[13px] font-bold text-brand-blue">{s.n}</span>
                  <div>
                    <h3 className="font-outfit text-[15px] font-bold text-[#0a1a25]">{s.title}</h3>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-[#5b6b78]">{s.text}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function TestimonialsSection() {
  return (
    <section className="bg-white py-20">
      <div className="mx-auto max-w-[80rem] px-5 lg:px-8">
        <Reveal>
          <SectionHeading
            title={<>Trusted when the <span className="text-brand-blue">message matters.</span></>}
            description="Teams use MobiWave WA to keep customer conversations clear, timely and accountable."
          />
        </Reveal>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {testimonials.map((t, i) => (
            <Reveal key={t.name} delay={i * 60}>
              <article className="flex h-full flex-col rounded-2xl border border-[#eef0f6] bg-white p-6">
                <div className="flex gap-1 text-[#f5a70d]">
                  {Array.from({ length: 5 }).map((_, s) => <span key={s}>★</span>)}
                </div>
                <p className="mt-4 flex-1 text-[14px] leading-relaxed text-[#3d4b5c]">“{t.quote}”</p>
                <div className="mt-5 flex items-center justify-between border-t border-[#eef0f6] pt-4">
                  <div>
                    <strong className="block text-[13px] font-semibold text-[#0a1a25]">{t.name}</strong>
                    <span className="text-[12px] text-[#5b6b78]">{t.role}</span>
                  </div>
                  <span className="rounded-full bg-[#f1efff] px-3 py-1 text-[11px] font-bold text-brand-blue">{t.metric}</span>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function FaqSection() {
  return (
    <section id="faq" className="bg-white py-20">
      <div className="mx-auto max-w-[80rem] px-5 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <Reveal>
            <Kicker>FAQ</Kicker>
            <h2 className="font-outfit mt-3 text-[clamp(1.9rem,3vw,2.6rem)] font-bold leading-[1.08] tracking-[-0.035em] text-[#0a1a25]">
              Straight answers before you start.
            </h2>
            <p className="mt-4 max-w-sm text-[14px] leading-relaxed text-[#5b6b78]">
              Still have a question? <a className="font-semibold text-brand-blue hover:underline" href="mailto:info@mobiwave.co.ke">Talk to our team.</a>
            </p>
          </Reveal>
          <div>
            {faqs.map(([q, a], i) => (
              <details key={q} className="group border-b border-[#eef0f6]" open={i === 0}>
                <summary className="flex cursor-pointer items-center justify-between gap-4 py-4 text-[14px] font-semibold text-[#0a1a25] transition-colors hover:text-brand-blue">
                  {q}
                  <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full border border-[#e3e8f0] text-[#5b6b78] transition-all group-open:rotate-45 group-open:border-brand-blue group-open:text-brand-blue">+</span>
                </summary>
                <p className="pb-4 pr-8 text-[13px] leading-relaxed text-[#5b6b78]">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  return (
    <div className="marketing-theme min-h-screen bg-white font-sans text-[#0a1a25]">
      <div className="relative">
        <MarketingNav />
        <Hero />
      </div>
      <main>
        <InfrastructureSection />
        <SolutionsSection />
        <ChannelsSection />
        <SystemsSection />
        <SimpleSection />
        <TestimonialsSection />
        <FaqSection />
        <FinalCTA
          title="Make every message count."
          description="Set up your MobiWave WA workspace and bring conversations, contacts and campaign controls together on Meta's official WhatsApp Cloud API."
        />
      </main>
      <MarketingFooter />
    </div>
  );
}