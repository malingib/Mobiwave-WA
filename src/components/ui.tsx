import { useEffect, useRef, type ReactNode } from "react";
import { Activity, Check, MessageCircle } from "lucide-react";

/* Brand lockup used across sidebar, auth and error screens. */
export function Brand({ compact = false, iconOnly = false, tone = "onDark" }: { compact?: boolean; iconOnly?: boolean; tone?: "onDark" | "onLight" }) {
  const isDark = tone === "onDark";
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white shadow-brand">
        <MessageCircle size={17} strokeWidth={2.5} />
      </div>
      {!iconOnly && (
        <div className="leading-none">
          <strong className={"font-display text-[14.5px] font-bold tracking-tight " + (isDark ? "text-white" : "text-text")}>
            MobiWave
            <span className={"ml-1 font-sans text-[10.5px] font-bold tracking-normal " + (isDark ? "text-brand-200" : "text-brand-600")}>
              WA
            </span>
          </strong>
          {!compact && (
            <span className="mt-1 block text-[8px] font-semibold tracking-[0.16em] text-text-faint">
              WHATSAPP PLATFORM
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function PageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">
          <Activity size={12} />
          {eyebrow}
        </div>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {actions && <div className="flex flex-none items-center gap-2">{actions}</div>}
    </div>
  );
}

const SUCCESS = ["approved", "indexed", "completed", "delivered", "read", "connected", "opted_in", "sent", "verified", "active", "enabled"];
const DANGER = ["failed", "rejected", "opted_out", "paused", "revoked", "dead", "disabled", "not connected"];
const WARNING = ["needs_review", "suggested", "pending", "running", "queued", "unknown", "draft"];

export function Status({ status }: { status: string }) {
  const s = status.toLowerCase();
  const tone = SUCCESS.includes(s) ? "success" : DANGER.includes(s) ? "danger" : WARNING.includes(s) ? "warning" : "neutral";
  return (
    <span className={"status-pill " + tone}>
      <span />
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function Empty({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="empty-state">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-hairline-strong bg-raised text-text-muted">
        {icon}
      </div>
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

export function SetupRow({ done = false, label, detail }: { done?: boolean; label: string; detail: string }) {
  return (
    <div className="setup-row flex items-start gap-3 rounded-lg border border-hairline-strong bg-raised px-3 py-2.5">
      <div
        className={
          "mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full text-white " +
          (done ? "bg-brand-600" : "border border-hairline-strong bg-surface")
        }
      >
        {done ? <Check size={12} strokeWidth={3} /> : null}
      </div>
      <div className="min-w-0 flex-1">
        <strong className="text-[12.5px] font-medium text-text">{label}</strong>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-text-muted">{detail}</p>
      </div>
      <span
        className={
          "flex-none rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] " +
          (done ? "bg-brand-100 text-brand-800" : "bg-raised text-text-muted")
        }
      >
        {done ? "Done" : "Pending"}
      </span>
    </div>
  );
}

/* KPI card for the Overview dashboard. */
export function KpiCard({
  label,
  value,
  delta,
  deltaTone = "neutral",
  hint,
  icon,
  action,
  trend,
  children,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "positive" | "negative" | "neutral";
  hint?: string;
  icon?: ReactNode;
  action?: ReactNode;
  trend?: ReactNode;
  children?: ReactNode;
}) {
  const deltaClass =
    deltaTone === "positive"
      ? "bg-brand-50 text-brand-700 ring-1 ring-brand-100"
      : deltaTone === "negative"
        ? "bg-rose-50 text-rose-700 ring-1 ring-rose-100"
        : "bg-raised text-text-muted ring-1 ring-hairline-strong";
  return (
    <article className="panel relative flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 pt-3.5">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-text-muted">
          {icon && <span className="text-text-faint">{icon}</span>}
          {label}
        </span>
        {action}
      </div>
      <div className="flex items-end gap-2 px-4 pb-1 pt-2">
        <strong className="font-display text-[27px] font-semibold leading-none tracking-[-0.03em] text-text">{value}</strong>
        {delta && <span className={"mb-0.5 rounded px-1.5 py-0.5 text-[10.5px] font-semibold " + deltaClass}>{delta}</span>}
      </div>
      {trend && <div className="mt-1 h-[52px] w-full">{trend}</div>}
      {(hint || children) && (
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-hairline-strong px-4 py-2.5">
          {hint && <span className="truncate text-[11.5px] text-text-faint">{hint}</span>}
          {children}
        </div>
      )}
    </article>
  );
}

/* Card wrapper with heading for charts and Overview widgets. */
export function WidgetCard({
  title,
  subtitle,
  action,
  className = "",
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={"panel flex flex-col " + className}>
      <header className="flex items-start justify-between gap-3 border-b border-hairline-strong px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[13.5px] font-semibold text-text">{title}</h2>
          {subtitle && <p className="mt-0.5 truncate text-[11.5px] text-text-muted">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className="min-h-0 flex-1 p-4">{children}</div>
    </section>
  );
}

/* Adds a gentle reveal-on-scroll animation, skipped for reduced-motion users. */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      node.classList.add("is-visible");
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return ref;
}

/* Small helper so page sections can opt into the reveal animation. */
export function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={"reveal " + className} style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

export function LiveDot({ live }: { live: boolean }) {
  return <span className={live ? "relative flex h-2 w-2" : "relative flex h-2 w-2"} aria-hidden>
    {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />}
    <span className={"relative inline-flex h-2 w-2 rounded-full " + (live ? "bg-brand-500" : "bg-text-faint")} />
  </span>;
}
