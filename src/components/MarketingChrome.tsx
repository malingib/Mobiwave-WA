import { useState, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight, ChevronDown, Menu, X } from "lucide-react";

/** Layout wrapper for the billing/team/usage pages when shown inside the dashboard. */
export function MarketingChrome({ children }: { children: ReactNode }) {
  return <div className="dashboard-page">{children}</div>;
}

/** Parent-style wordmark: the official MobiWave logo in a white rounded box. */
export function BrandLockup({ dark = false }: { dark?: boolean }) {
  return (
    <span className={"inline-flex items-center rounded-xl bg-white px-3 py-1.5 shadow-sm " + (dark ? "ring-1 ring-white/15" : "")}>
      <img src="/branding/mw-logo.svg" alt="MobiWave" className="h-5 w-auto" />
      <span className="ml-2 font-sans text-[10px] font-bold tracking-wide text-brand-blue">WA</span>
    </span>
  );
}

type NavItem = { label: string; href: string; hasDropdown?: boolean };

const defaultNav: NavItem[] = [
  { label: "Home", href: "/" },
  { label: "Pricing", href: "/pricing" },
  { label: "Contact Us", href: "mailto:info@mobiwave.co.ke" },
];

export function MarketingNav({ items = defaultNav, current }: { items?: NavItem[]; current?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="absolute inset-x-0 top-0 z-40">
      <div className="mx-auto flex h-[76px] max-w-[80rem] items-center justify-between gap-4 px-5 lg:px-8">
        <a href="/" aria-label="MobiWave WA home">
          <BrandLockup />
        </a>

        <nav className="hidden items-center gap-6 lg:flex" aria-label="Main navigation">
          {items.map((item) => (
            <a
              key={item.label}
              href={item.href}
              aria-current={current === item.label ? "page" : undefined}
              className={
                "inline-flex items-center gap-1 text-[13.5px] font-medium transition-colors " +
                (current === item.label
                  ? "text-brand-blue"
                  : "text-[#3d4b5c] hover:text-brand-blue")
              }
            >
              {item.label}
              {item.hasDropdown && <ChevronDown size={13} />}
            </a>
          ))}
        </nav>

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

      {open && (
        <nav className="border-t border-white/20 bg-white/95 px-5 pb-4 pt-2 backdrop-blur lg:hidden" aria-label="Mobile navigation">
          {items.map((item) => (
            <a
              key={item.label}
              href={item.href}
              onClick={() => setOpen(false)}
              className="block rounded-md px-2 py-2.5 text-[14px] font-medium text-[#3d4b5c] hover:bg-white"
            >
              {item.label}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}

/** Central kicker line used above section headings (no pill). */
export function Kicker({ children }: { children: React.ReactNode }) {
  return <div className="text-[12px] font-bold uppercase tracking-[0.18em] text-brand-blue">{children}</div>;
}

export function SectionHeading({
  kicker,
  title,
  description,
  align = "center",
  id,
}: {
  kicker?: string;
  title: React.ReactNode;
  description?: string;
  align?: "center" | "left";
  id?: string;
}) {
  return (
    <div className={"max-w-3xl " + (align === "center" ? "mx-auto text-center" : "")}>
      {kicker && <Kicker>{kicker}</Kicker>}
      <h2 id={id} className="font-outfit mt-3 text-[clamp(1.9rem,3.4vw,3rem)] font-bold leading-[1.08] tracking-[-0.035em] text-[#0a1a25]">
        {title}
      </h2>
      {description && <p className="mx-auto mt-4 max-w-2xl text-[15px] leading-relaxed text-[#5b6b78]">{description}</p>}
    </div>
  );
}

export function FinalCTA({
  kicker,
  title,
  description,
  cta = "Get started",
  ctaHref = "/login?mode=signup",
}: {
  kicker?: string;
  title: string;
  description: string;
  cta?: string;
  ctaHref?: string;
}) {
  return (
    <section className="bg-[#f1efff] py-20">
      <div className="mx-auto grid max-w-[80rem] items-center gap-10 px-5 lg:grid-cols-[1fr_0.9fr] lg:px-8">
        <div>
          {kicker && <Kicker>{kicker}</Kicker>}
          <h2 className="font-outfit mt-3 text-[clamp(1.9rem,3.4vw,2.8rem)] font-bold leading-[1.08] tracking-[-0.035em] text-[#0a1a25]">
            {title}
          </h2>
          <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-[#5b6b78]">{description}</p>
          <a className="btn btn-primary btn-pill mt-7" href={ctaHref}>
            {cta} <ArrowRight size={15} />
          </a>
        </div>
        {/* Decorative chat mockup */}
        <div className="rounded-2xl border border-white bg-white p-5 shadow-[0_20px_50px_-20px_rgba(89,85,209,0.25)]">
          <div className="mb-4 flex items-center gap-2 border-b border-[#eef0f6] pb-3">
            <span className="h-2.5 w-2.5 rounded-full bg-[#e0e3ec]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#e0e3ec]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#e0e3ec]" />
            <span className="ml-2 text-[11px] font-semibold text-[#5b6b78]">New conversation</span>
          </div>
          <div className="space-y-3">
            <div className="w-fit max-w-[80%] rounded-2xl rounded-tl-sm bg-[#f4f7fb] px-4 py-2.5 text-[13px] text-[#3d4b5c]">
              Hi! How can we help you today?
            </div>
            <div className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-tr-sm bg-brand-blue px-4 py-2.5 text-[13px] text-white">
              I'd like to know more about your service.
            </div>
            <div className="w-fit max-w-[80%] rounded-2xl rounded-tl-sm bg-[#f4f7fb] px-4 py-2.5 text-[13px] text-[#3d4b5c]">
              Of course — let me connect you with the right team.
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-full border border-[#eef0f6] bg-[#fafbfe] px-4 py-2.5">
            <span className="text-[12px] text-[#9aa8b2]">Type your message…</span>
            <span className="ml-auto flex h-6 w-6 items-center justify-center rounded-full bg-brand-blue text-white">
              <ArrowUpRight size={12} />
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function MarketingFooter() {
  return (
    <footer className="bg-white">
      <div className="border-t border-[#edf0f6]">
        <div className="mx-auto max-w-[80rem] px-5 py-14 lg:px-8">
          <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div>
              <BrandLockup />
              <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-[#5b6b78]">
                Bulk SMS, WhatsApp API, USSD, email and M-Pesa integrations for Kenyan businesses.
              </p>
              <a className="btn btn-primary btn-pill mt-5" href="mailto:info@mobiwave.co.ke">
                Contact us <ArrowRight size={14} />
              </a>
            </div>
            <div>
              <h3 className="font-outfit text-[14px] font-bold text-[#0a1a25]">MobiWave</h3>
              <ul className="mt-4 space-y-2.5 text-[13px] text-[#5b6b78]">
                <li><a className="hover:text-brand-blue" href="https://mobiwave.co.ke/">About us</a></li>
                <li><a className="hover:text-brand-blue" href="https://mobiwave.co.ke/#services">Services</a></li>
                <li><a className="hover:text-brand-blue" href="https://mobiwave.co.ke/#pricing">Pricing</a></li>
                <li><a className="hover:text-brand-blue" href="/pricing">WA Pricing</a></li>
              </ul>
            </div>
            <div>
              <h3 className="font-outfit text-[14px] font-bold text-[#0a1a25]">Useful links</h3>
              <ul className="mt-4 space-y-2.5 text-[13px] text-[#5b6b78]">
                <li><a className="hover:text-brand-blue" href="https://mobiwave.co.ke/">API Docs</a></li>
                <li><a className="hover:text-brand-blue" href="/privacy-policy/">Privacy Policy</a></li>
                <li><a className="hover:text-brand-blue" href="/terms-of-service/">Terms of Service</a></li>
                <li><a className="hover:text-brand-blue" href="/data-deletion/">Data Deletion</a></li>
              </ul>
            </div>
            <div>
              <h3 className="font-outfit text-[14px] font-bold text-[#0a1a25]">Get in touch</h3>
              <ul className="mt-4 space-y-2.5 text-[13px] text-[#5b6b78]">
                <li>Kilifi, Kenya</li>
                <li><a className="hover:text-brand-blue" href="mailto:info@mobiwave.co.ke">info@mobiwave.co.ke</a></li>
                <li>Mon–Fri, 8am–5pm EAT</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      <div className="border-t border-[#edf0f6]">
        <div className="mx-auto flex max-w-[80rem] flex-wrap items-center justify-between gap-3 px-5 py-5 text-[12px] text-[#8b95a3] lg:px-8">
          <span>© {new Date().getFullYear()} MobiWave Innovations Ltd. All rights reserved.</span>
          <span className="flex items-center gap-2">
            <a className="hover:text-brand-blue" href="https://mobiwave.co.ke/">A product of MobiWave</a>
            <span>·</span>
            <span>Official Meta WhatsApp Cloud API</span>
          </span>
        </div>
      </div>
    </footer>
  );
}