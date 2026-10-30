import {
  ArrowRight, ArrowUpRight, ChevronRight, CircleCheck,
  ContactRound, MessageCircle, MessagesSquare, ShieldCheck, Workflow, Zap,
} from "lucide-react";
import { FinalCTA, Kicker, MarketingFooter, MarketingNav, SectionHeading } from "./components/MarketingChrome";
import { Reveal } from "./components/ui";

const features = [
  { icon: MessagesSquare, title: "A shared WhatsApp team inbox", text: "Give your team one place to view customer conversations, follow up and hand work over without losing context." },
  { icon: Zap, title: "Campaigns with safeguards", text: "Prepare outbound campaigns with approved Meta message templates and recorded customer opt-in." },
  { icon: MessageCircle, title: "Status at a glance", text: "Keep message status and customer history visible so your team can follow up with more confidence." },
  { icon: ContactRound, title: "Organised customer contacts", text: "Manage contact details, consent records and opt-outs in your business workspace." },
  { icon: Workflow, title: "APIs and webhooks", text: "Connect supported workflows using workspace-scoped API keys and signed customer webhooks." },
  { icon: ShieldCheck, title: "Accounts kept separate", text: "Workspace membership and access controls help keep each business's messaging data within its account." },
];

const useCases = [
  { title: "Customer support", text: "Let the right team member pick up a conversation and see its history." },
  { title: "Order and service updates", text: "Use eligible, approved templates to send important customer notifications." },
  { title: "Appointment reminders", text: "Keep opted-in customers informed with relevant utility messages." },
  { title: "Sales follow-up", text: "Manage inbound interest and follow-ups in a shared team inbox." },
];

const steps = [
  { title: "Create your workspace", text: "Set up your business account and invite the people who answer customers." },
  { title: "Connect through Meta", text: "Use the official WhatsApp Cloud API and the required business permissions." },
  { title: "Run the work", text: "Organise contacts, use approved templates and keep consent records current." },
];

const faqs: [string, React.ReactNode][] = [
  ["What is the WhatsApp Business API?", "The WhatsApp Business Platform lets eligible businesses connect WhatsApp messaging to business tools and workflows. MobiWave WA provides a workspace for shared conversations, contact management and approved-template campaigns using Meta's official Cloud API."],
  ["Is MobiWave WA a WhatsApp Business API provider?", "MobiWave WA is a business messaging workspace that connects through Meta's official WhatsApp Cloud API. You need an eligible business account, a connected number and the required Meta permissions. Do not assume that account approval or a verification badge is guaranteed."],
  ["Can my team manage conversations together?", "Yes. The shared inbox brings customer threads into one workspace, with team access and conversation context to support follow-up and hand-offs."],
  ["Can I send WhatsApp bulk messages or campaigns?", "Campaigns must follow Meta's messaging policies. Outbound messages that require templates must use approved templates, and marketing messages require appropriate customer opt-in. Opt-outs must be respected."],
  ["How much does WhatsApp Business API cost in Kenya?", <>Costs can include Meta's message charges and any platform or implementation fees. The final amount depends on message category, destination and your setup. Review the <a className="font-semibold text-brand-700 hover:text-brand-800" href="/pricing">MobiWave WA pricing page</a> and contact the team for details rather than assuming a single flat WhatsApp rate.</>],
  ["Can I connect MobiWave WA to my existing systems?", "Supported integrations include workspace-scoped API keys and signed webhooks. Check the available integration settings and documentation before planning a specific connection."],
  ["Can I use unofficial WhatsApp QR tools?", "No. MobiWave WA is built around Meta's official WhatsApp Cloud API. It does not use unofficial WhatsApp Web engines or QR-pairing automation."],
];

const chartBars = [42, 58, 36, 71, 64, 88, 76, 95, 68, 82, 74, 90];

function ProductPreview() {
  return (
    <div className="relative">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-400">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
          Product preview · illustrative sample data
        </p>
        <span className="whitespace-nowrap rounded border border-brand-200 bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-800">
          Sample
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-ink-200 bg-surface shadow-raised">
        <div className="flex items-center gap-1.5 border-b border-ink-200 bg-ink-50 px-3 py-2">
          <span className="h-2 w-2 rounded-full bg-ink-300" />
          <span className="h-2 w-2 rounded-full bg-ink-300" />
          <span className="h-2 w-2 rounded-full bg-ink-300" />
          <span className="ml-2 flex items-center gap-1.5 text-[10.5px] font-medium text-ink-500">
            <MessageCircle size={11} className="text-brand-600" /> MobiWave WA · Overview
          </span>
          <span className="ml-auto flex items-center gap-1 rounded border border-brand-200 bg-brand-50 px-1.5 py-0.5 text-[9.5px] font-semibold text-brand-800">
            <span className="h-1 w-1 rounded-full bg-brand-500" /> Connected
          </span>
        </div>

        <div className="grid grid-cols-[52px_minmax(0,1fr)]">
          <aside className="flex flex-col items-center gap-1.5 border-r border-ink-200 bg-surface py-3">
            {[MessageCircle, ContactRound, Zap, Workflow].map((Icon, index) => (
              <span
                key={index}
                className={
                  "flex h-7 w-7 items-center justify-center rounded-md " +
                  (index === 0 ? "bg-brand-50 text-brand-700 ring-1 ring-brand-200" : "text-ink-400")
                }
              >
                <Icon size={14} />
              </span>
            ))}
          </aside>

          <div className="space-y-2.5 p-3">
            <div className="grid grid-cols-3 gap-2">
              {[
                ["Open chats", "24", "+6 today"],
                ["Response", "4m 12s", "median"],
                ["Opted in", "846", "+31 this week"],
              ].map(([label, value, hint]) => (
                <div key={label} className="rounded-lg border border-ink-200 p-2.5">
                  <span className="block truncate text-[9.5px] font-medium text-ink-400">{label}</span>
                  <strong className="mt-1 block font-display text-[16px] font-semibold leading-none text-ink-900">{value}</strong>
                  <span className="mt-1 block truncate text-[9px] text-ink-400">{hint}</span>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-ink-200 p-2.5">
              <div className="mb-2 flex items-center justify-between">
                <strong className="text-[11px] font-semibold text-ink-800">Message volume · 14 days</strong>
                <span className="flex items-center gap-2.5 text-[9px] text-ink-400">
                  <span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-brand-600" /> Inbound</span>
                  <span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-series-2" /> Outbound</span>
                </span>
              </div>
              <div className="flex h-16 items-end gap-1">
                {chartBars.map((height, index) => (
                  <div key={index} className="flex flex-1 flex-col justify-end gap-0.5">
                    <div className="rounded-t-[2px] bg-brand-600" style={{ height: Math.round(height * 0.28) + "px" }} />
                    <div className="rounded-b-[2px] bg-series-2/70" style={{ height: Math.round(height * 0.16) + "px" }} />
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-ink-200">
              {[
                ["AK", "Angela K.", "Thank you, that helps!", "2m"],
                ["JM", "James M.", "Can you share the details?", "8m"],
                ["NW", "Naomi W.", "I'd like to know more.", "21m"],
              ].map(([initials, name, text, time], index) => (
                <div key={name} className={"flex items-center gap-2 px-2.5 py-2 " + (index < 2 ? "border-b border-ink-100" : "")}>
                  <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-brand-100 text-[9.5px] font-bold text-brand-800">{initials}</span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-[11px] font-medium text-ink-900">{name}</strong>
                    <span className="block truncate text-[10px] text-ink-400">{text}</span>
                  </span>
                  <span className="text-[9.5px] text-ink-300">{time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-canvas font-sans text-ink-900">
      <MarketingNav />

      <main>
        {/* Hero ---------------------------------------------------------- */}
        <section className="border-b border-ink-200 bg-surface">
          <div className="mx-auto grid max-w-[1180px] items-center gap-12 px-5 py-14 lg:grid-cols-[1.02fr_1fr] lg:px-8 lg:py-20">
            <div>
              <Reveal>
                <Kicker>WhatsApp business messaging for Kenya</Kicker>
                <h1 className="mt-5 font-display text-[clamp(2.1rem,4.4vw,3.4rem)] font-semibold leading-[1.04] tracking-[-0.035em]">
                  One shared inbox for every WhatsApp conversation.
                </h1>
                <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-ink-500">
                  Use the WhatsApp Business API in Kenya to manage customer conversations, contacts and approved campaigns in one workspace.
                  MobiWave WA connects through Meta's official WhatsApp Cloud API, with tools built for local business teams.
                </p>
                <div className="mt-7 flex flex-wrap gap-2.5">
                  <a className="btn btn-primary" href="/login?mode=signup">Create your account <ArrowRight size={15} /></a>
                  <a className="btn btn-secondary" href="/pricing">Explore pricing <ChevronRight size={15} /></a>
                </div>
                <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-[12.5px] font-medium text-ink-600">
                  {["Official Meta Cloud API", "Shared team inbox", "Consent-aware campaigns"].map((item) => (
                    <span key={item} className="flex items-center gap-1.5"><CircleCheck size={13} className="text-brand-600" /> {item}</span>
                  ))}
                </div>
              </Reveal>
            </div>

            <Reveal delay={100}>
              <ProductPreview />
            </Reveal>
          </div>
        </section>

        {/* Stat strip ---------------------------------------------------- */}
        <section className="border-b border-ink-200 bg-surface">
          <div className="mx-auto max-w-[1180px] px-5 lg:px-8">
          <div className="grid grid-cols-2 gap-px border-x border-ink-200 bg-ink-200 sm:grid-cols-4">
            {[
              ["1,000", "free service replies / month"],
              ["6", "message categories handled"],
              ["24/7", "shared inbox coverage"],
              ["100%", "official Cloud API"],
            ].map(([value, label]) => (
              <div key={label} className="bg-surface px-4 py-5">
                <strong className="block font-display text-[22px] font-semibold leading-none tracking-[-0.02em]">{value}</strong>
                <span className="mt-1.5 block text-[11.5px] text-ink-500">{label}</span>
              </div>
            ))}
          </div>
          </div>
        </section>

        {/* Value strip --------------------------------------------------- */}
        <section id="security" className="border-b border-ink-200 bg-canvas">
          <div className="mx-auto grid max-w-[1180px] gap-3 px-5 py-10 sm:grid-cols-3 lg:px-8">
            {[
              { icon: ShieldCheck, title: "Official WhatsApp Cloud API", text: "Connect through Meta's official platform, not browser automation." },
              { icon: CircleCheck, title: "Consent records kept", text: "Every opt-in and opt-out is stored with its source and timestamp." },
              { icon: ShieldCheck, title: "Workspace-scoped access", text: "Team members only see the business account they belong to." },
            ].map(({ icon: Icon, title, text }) => (
              <div key={title} className="flex items-start gap-3 rounded-xl border border-ink-200 bg-surface p-4">
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-brand-50 text-brand-700 ring-1 ring-brand-100">
                  <Icon size={15} />
                </span>
                <span className="min-w-0">
                  <strong className="block text-[13px] font-semibold text-ink-900">{title}</strong>
                  <small className="mt-1 block text-[12px] leading-relaxed text-ink-500">{text}</small>
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Features ------------------------------------------------------ */}
        <section id="features" className="border-b border-ink-200 bg-surface">
          <div className="mx-auto max-w-[1180px] px-5 py-16 lg:px-8">
            <Reveal>
              <SectionHeading
                align="left"
                kicker="The tools your team needs"
                title={<>A practical WhatsApp platform. <span className="text-brand-600">All in one place.</span></>}
                description="Support customers, organise contacts and manage outbound messaging from one business workspace — without relying on unofficial WhatsApp automation tools."
              />
            </Reveal>
            <div className="mt-9 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {features.map(({ icon: Icon, title, text }, index) => (
                <Reveal key={title} delay={index * 50}>
                  <article className="group h-full rounded-xl border border-ink-200 bg-surface p-5 transition-colors hover:border-brand-300 hover:bg-brand-50/30">
                    <div className="flex items-center justify-between">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-700 ring-1 ring-brand-100 transition-colors group-hover:bg-brand-600 group-hover:text-white">
                        <Icon size={16} />
                      </span>
                      <ArrowUpRight size={14} className="text-ink-300 transition-colors group-hover:text-brand-600" />
                    </div>
                    <h3 className="mt-4 text-[14px] font-semibold leading-snug">{title}</h3>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-500">{text}</p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Use cases ----------------------------------------------------- */}
        <section id="use-cases" className="border-b border-ink-200 bg-canvas">
          <div className="mx-auto max-w-[1180px] px-5 py-16 lg:px-8">
            <Reveal>
              <SectionHeading
                align="left"
                kicker="Made for real customer work"
                title={<>From first question to <span className="text-brand-600">follow-up.</span></>}
                description="Give customer-facing teams a clearer way to manage everyday WhatsApp conversations."
              />
            </Reveal>
            <div className="mt-9 grid gap-px overflow-hidden rounded-xl border border-ink-200 bg-ink-200 sm:grid-cols-2 lg:grid-cols-4">
              {useCases.map(({ title, text }, index) => (
                <Reveal key={title} delay={index * 50} className="h-full">
                  <article className="h-full bg-surface p-5">
                    <span className="font-display text-[11px] font-semibold tracking-[0.08em] text-brand-600">0{index + 1}</span>
                    <h3 className="mt-2.5 text-[13.5px] font-semibold">{title}</h3>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-500">{text}</p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* How it works -------------------------------------------------- */}
        <section id="how-it-works" className="border-b border-ink-200 bg-surface">
          <div className="mx-auto grid max-w-[1180px] items-start gap-10 px-5 py-16 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
            <Reveal>
              <Kicker>How to get started</Kicker>
              <h2 className="mt-4 font-display text-[clamp(1.7rem,2.8vw,2.3rem)] font-semibold leading-[1.12] tracking-[-0.03em]">
                Connect your business. <span className="text-brand-600">Bring your team together.</span>
              </h2>
              <p className="mt-3.5 max-w-lg text-[14.5px] leading-relaxed text-ink-500">
                Start with a MobiWave WA workspace, connect an eligible WhatsApp Business account through Meta, and set up the tools your customer workflow needs.
              </p>
              <a className="btn btn-primary mt-6" href="/login?mode=signup">Create your business account <ArrowRight size={15} /></a>
            </Reveal>

            <div className="flex flex-col">
              {steps.map(({ title, text }, index) => (
                <Reveal key={title} delay={index * 60}>
                  <div className="flex items-start gap-4 border-b border-ink-100 py-5 first:pt-0 last:border-0 last:pb-0">
                    <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md border border-brand-200 bg-brand-50 text-[11px] font-semibold text-brand-800">
                      0{index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong className="block text-[13.5px] font-semibold">{title}</strong>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">{text}</p>
                    </span>
                    <CircleCheck size={16} className="mt-0.5 flex-none text-brand-500" />
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ ----------------------------------------------------------- */}
        <section id="faq" className="bg-canvas">
          <div className="mx-auto max-w-[1180px] px-5 py-16 lg:px-8">
            <Reveal>
              <SectionHeading
                align="left"
                kicker="WhatsApp Business API FAQ"
                title={<>Questions, answered <span className="text-brand-600">before you start.</span></>}
                description="Understand the platform, Meta requirements and how your team can use it."
              />
            </Reveal>
            <div className="mt-9 grid gap-x-10 lg:grid-cols-2">
              {faqs.map(([question, answer], index) => (
                <details key={question} className="group border-b border-ink-200 lg:first:border-t" open={index === 0}>
                  <summary className="flex items-center justify-between gap-4 py-4 text-[13.5px] font-medium text-ink-900 transition-colors hover:text-brand-700">
                    {question}
                    <span className="flex h-5 w-5 flex-none items-center justify-center rounded border border-ink-200 bg-surface text-[13px] leading-none text-ink-500 transition-all group-open:rotate-45 group-open:border-brand-300 group-open:text-brand-700">
                      +
                    </span>
                  </summary>
                  <p className="pb-4 pr-8 text-[12.5px] leading-relaxed text-ink-500">{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <FinalCTA
          kicker="WhatsApp business messaging, made clearer"
          title="Give every customer conversation a next step."
          description="Set up your MobiWave WA workspace and bring conversations, contacts and campaign controls together."
        />
      </main>

      <MarketingFooter />
    </div>
  );
}
