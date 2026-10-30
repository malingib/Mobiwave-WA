import { useState } from "react";
import { ArrowRight, ArrowUpRight, Menu, MessageCircle, X } from "lucide-react";

export function BrandMark({ size = "md" }: { size?: "sm" | "md" }) {
  const box = size === "sm" ? "h-7 w-7 rounded-md" : "h-8 w-8 rounded-lg";
  const icon = size === "sm" ? 15 : 17;
  return (
    <span className={`flex ${box} items-center justify-center bg-brand-600 text-white shadow-brand`}>
      <MessageCircle size={icon} strokeWidth={2.4} />
    </span>
  );
}

export function BrandLockup({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark size={size} />
      <span className="font-display text-[14.5px] font-bold tracking-tight text-text">
        MobiWave<span className="ml-1 font-sans text-[10.5px] font-bold text-brand-600">WA</span>
      </span>
    </span>
  );
}

type NavItem = { label: string; href: string };

const defaultNav: NavItem[] = [
  { label: "Features", href: "/#features" },
  { label: "Use cases", href: "/#use-cases" },
  { label: "How it works", href: "/#how-it-works" },
  { label: "Pricing", href: "/pricing" },
  { label: "Security", href: "/#security" },
  { label: "FAQs", href: "/#faq" },
];

export function MarketingNav({ items = defaultNav, current }: { items?: NavItem[]; current?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-hairline-strong bg-surface/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1180px] items-center justify-between gap-4 px-5 lg:px-8">
        <a href="/" aria-label="MobiWave WA home">
          <BrandLockup />
        </a>

        <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Main navigation">
          {items.map((item) => (
            <a
              key={item.label}
              href={item.href}
              aria-current={current === item.label ? "page" : undefined}
              className={
                "rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors " +
                (current === item.label
                  ? "bg-raised text-text"
                  : "text-text-muted hover:bg-raised hover:text-text")
              }
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a className="hidden rounded-md px-2.5 py-1.5 text-[13px] font-medium text-text-muted hover:text-text sm:inline-flex" href="/login">
            Sign in
          </a>
          <a className="btn btn-primary btn-sm" href="/login?mode=signup">
            Start free <ArrowUpRight size={13} />
          </a>
          <button
            type="button"
            className="icon-btn lg:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {open && (
        <nav className="border-t border-hairline-strong bg-surface px-5 pb-4 pt-2 lg:hidden" aria-label="Mobile navigation">
          {items.map((item) => (
            <a
              key={item.label}
              href={item.href}
              onClick={() => setOpen(false)}
              className="block rounded-md px-2 py-2.5 text-[14px] font-medium text-text hover:bg-raised"
            >
              {item.label}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}

export function Kicker({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={"inline-flex items-center gap-2 rounded-md border border-hairline-strong bg-raised px-2 py-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-muted " + className}>
      <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
      {children}
    </div>
  );
}

export function SectionHeading({
  kicker,
  title,
  description,
  align = "center",
  id,
}: {
  kicker: string;
  title: React.ReactNode;
  description?: string;
  align?: "center" | "left";
  id?: string;
}) {
  return (
    <div className={"max-w-2xl " + (align === "center" ? "mx-auto text-center" : "")}>
      <Kicker className={align === "center" ? "justify-center" : ""}>{kicker}</Kicker>
      <h2 id={id} className="mt-3.5 font-display text-[clamp(1.7rem,2.8vw,2.3rem)] font-semibold leading-[1.12] tracking-[-0.03em]">
        {title}
      </h2>
      {description && <p className="mt-3 text-[14.5px] leading-relaxed text-text-muted">{description}</p>}
    </div>
  );
}

export function FinalCTA({
  kicker,
  title,
  description,
  cta = "Get started",
}: {
  kicker: string;
  title: string;
  description: string;
  cta?: string;
}) {
  return (
    <section className="mx-auto max-w-[1180px] px-5 pb-20 lg:px-8">
      <div className="relative overflow-hidden rounded-xl bg-midnight-950 px-7 py-12 sm:px-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="relative max-w-xl">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-brand-300">{kicker}</div>
          <h2 className="mt-3 font-display text-[clamp(1.6rem,2.8vw,2.2rem)] font-semibold leading-[1.14] tracking-[-0.03em] text-white">
            {title}
          </h2>
          <p className="mt-3 text-[14px] leading-relaxed text-white/60">{description}</p>
          <div className="mt-7 flex flex-wrap gap-2.5">
            <a className="btn btn-primary" href="/login?mode=signup">
              {cta} <ArrowRight size={15} />
            </a>
            <a className="btn border border-white/15 bg-white/5 text-white hover:bg-white/10" href="/pricing">
              See pricing
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

export function MarketingFooter({ blurb = "WhatsApp Business messaging for Kenyan teams." }: { blurb?: string }) {
  return (
    <footer className="border-t border-hairline-strong bg-surface">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-9 lg:flex-row lg:items-start lg:justify-between lg:px-8">
        <div className="max-w-xs">
          <a href="/" aria-label="MobiWave WA home">
            <BrandLockup size="sm" />
          </a>
          <p className="mt-3 text-[12.5px] leading-relaxed text-text-muted">{blurb}</p>
        </div>
        <nav className="flex flex-wrap gap-x-5 gap-y-2 text-[12.5px]" aria-label="Footer navigation">
          <a className="font-medium text-text-muted hover:text-text" href="https://mobiwave.co.ke/">MobiWave services</a>
          <a className="font-medium text-text-muted hover:text-text" href="/pricing">Pricing</a>
          <a className="font-medium text-text-muted hover:text-text" href="/privacy-policy/">Privacy</a>
          <a className="font-medium text-text-muted hover:text-text" href="/terms-of-service/">Terms</a>
          <a className="font-medium text-text-muted hover:text-text" href="/data-deletion/">Data deletion</a>
          <a className="font-medium text-text-muted hover:text-text" href="mailto:info@mobiwave.co.ke">Contact</a>
        </nav>
      </div>
      <div className="border-t border-hairline-strong">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-2 px-5 py-4 text-[11.5px] text-text-faint lg:px-8">
          <span>© {new Date().getFullYear()} MobiWave Innovations Ltd</span>
          <span>Official Meta WhatsApp Cloud API</span>
        </div>
      </div>
    </footer>
  );
}
