import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Activity, MessageCircle, X } from "lucide-react";

/* Brand lockup used across sidebar, auth and error screens. */
export function Brand({ compact = false, iconOnly = false, tone = "onLight" }: { compact?: boolean; iconOnly?: boolean; tone?: "onDark" | "onLight" }) {
  const isDark = tone === "onDark";
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand-600 text-white shadow-brand">
        <MessageCircle size={18} strokeWidth={2.5} />
      </div>
      {!iconOnly && (
        <div className="leading-none">
          <strong className={"font-display text-[15.5px] font-bold tracking-tight " + (isDark ? "text-white" : "text-text")}>
            MobiWave
            <span className={"ml-1 font-sans text-[11px] font-bold tracking-normal " + (isDark ? "text-brand-200" : "text-brand-600")}>
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
        <div className="eyebrow"><Activity size={14} />{eyebrow}</div>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {actions && <div className="flex flex-none items-center gap-2">{actions}</div>}
    </div>
  );
}

const SUCCESS = ["approved", "indexed", "completed", "accepted", "delivered", "read", "connected", "opted_in", "sent", "verified", "active", "enabled", "paid"];
const DANGER = ["failed", "rejected", "opted_out", "paused", "revoked", "dead", "disabled", "not connected", "overdue"];
const WARNING = ["needs_review", "suggested", "pending", "running", "queued", "processing", "outcome_unknown", "scheduled", "unknown", "draft"];

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
    <div className="setup-row flex items-start gap-3 rounded-lg border border-hairline bg-raised px-3 py-2.5">
      <div
        className={
          "mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full " +
          (done ? "bg-success text-white" : "border border-hairline-strong bg-surface text-text-faint")
        }
      >
        {done ? <Check size={12} strokeWidth={3} /> : null}
      </div>
      <div className="min-w-0 flex-1">
        <strong className="text-[12.5px] font-semibold text-text">{label}</strong>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-text-muted">{detail}</p>
      </div>
      <span
        className={
          "flex-none rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] " +
          (done ? "bg-success-soft text-success" : "bg-surface text-text-muted")
        }
      >
        {done ? "Done" : "Pending"}
      </span>
    </div>
  );
}

/* KPI card matching the reference dashboard: pastel circular icon on the
   left, quiet label and one strong value. */
export function KpiCard({
  label,
  value,
  delta,
  deltaTone = "neutral",
  hint,
  icon,
  tone = "brand",
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
  tone?: "brand" | "success" | "warning" | "danger";
  action?: ReactNode;
  trend?: ReactNode;
  children?: ReactNode;
}) {
  const deltaClass =
    deltaTone === "positive"
      ? "bg-success-soft text-success"
      : deltaTone === "negative"
        ? "bg-danger-soft text-danger"
        : "bg-raised text-text-muted";
  return (
    <article className={"kpi-card panel kpi-tone-" + tone}>
      <div className="kpi-body">
        {icon && <span className="kpi-icon">{icon}</span>}
        <div className="kpi-copy">
          <span className="kpi-label">{label}</span>
          <strong className="kpi-value">{value}</strong>
          {hint && <span className="kpi-hint">{hint}</span>}
        </div>
        {delta && <span className={"kpi-delta " + deltaClass}>{delta}</span>}
      </div>
      {trend && <div className="kpi-trend">{trend}</div>}
      {(action || children) && <div className="kpi-foot">{action}{children}</div>}
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
    <section className={"panel flex min-w-0 flex-col " + className}>
      <header className="flex flex-wrap items-start justify-between gap-2 px-5 pb-1 pt-4">
        <div className="min-w-0">
          <h2 className="text-[16px] font-bold text-text">{title}</h2>
          {subtitle && <p className="mt-1 truncate text-[12px] text-text-muted">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className="min-h-0 flex-1 p-5 pt-3">{children}</div>
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

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The single modal primitive for the dashboard. It owns the accessibility
 * behaviour every dialog needs: a focus trap, Escape to close, a scroll lock
 * while open, and focus returned to the element that opened it.
 */
export function Modal({
  open,
  onClose,
  labelledBy,
  className = "",
  backdropClassName = "",
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  className?: string;
  backdropClassName?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // `onClose` is frequently an inline arrow from the caller (see useConfirm).
  // Keeping it in a ref stops the dialog effect from re-running on every
  // parent render, which otherwise steals focus from the prompt input.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusable = () =>
      Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (element) => element.offsetParent !== null || element === document.activeElement,
      );

    focusable()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    // A click on a non-focusable part of the panel, or a programmatic focus
    // change, can move focus to <body>. Without this, Tab escapes into the
    // page behind the dialog.
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof Node && panelRef.current && !panelRef.current.contains(target)) {
        focusable()[0]?.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className={"modal-backdrop " + backdropClassName}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={"modal-panel " + className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Header row shared by every dialog: title, optional description and close. */
export function ModalHead({
  titleId,
  eyebrow,
  title,
  description,
  onClose,
  closeLabel = "Close dialog",
  children,
}: {
  titleId: string;
  eyebrow?: string;
  title: string;
  description?: string;
  onClose: () => void;
  closeLabel?: string;
  children?: ReactNode;
}) {
  return (
    <div className="modal-head">
      <div className="modal-head-copy">
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2 id={titleId}>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      <div className="modal-head-actions">
        {children}
        <button type="button" className="icon-btn" aria-label={closeLabel} onClick={onClose}>
          <X size={17} />
        </button>
      </div>
    </div>
  );
}

export type ConfirmOptions = {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

export type PromptOptions = ConfirmOptions & {
  label: string;
  placeholder?: string;
};

/**
 * Promise-based confirmation used instead of the native window.confirm
 * dialog, which blocks the page and is never announced to screen readers.
 * `prompt` additionally collects a short reason before confirming.
 */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [promptOptions, setPromptOptions] = useState<PromptOptions | null>(null);
  const [reason, setReason] = useState("");
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);
  const promptResolver = useRef<((value: string | null) => void) | null>(null);

  const confirm = useCallback((next: ConfirmOptions) => {
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((confirmed: boolean) => {
    resolver.current?.(confirmed);
    resolver.current = null;
    setOptions(null);
  }, []);

  const prompt = useCallback((next: PromptOptions) => {
    setReason("");
    setPromptOptions(next);
    return new Promise<string | null>((resolve) => {
      promptResolver.current = resolve;
    });
  }, []);

  const settlePrompt = useCallback((value: string | null) => {
    promptResolver.current?.(value);
    promptResolver.current = null;
    setPromptOptions(null);
    setReason("");
  }, []);

  // If the owning screen unmounts while a dialog is open, resolve pending
  // promises so callers awaiting confirm()/prompt() are not left hanging.
  useEffect(() => () => {
    resolver.current?.(false);
    promptResolver.current?.(null);
    resolver.current = null;
    promptResolver.current = null;
  }, []);

  const confirmElement = options ? (
    <Modal open onClose={() => settle(false)} labelledBy="confirm-dialog-title" className="confirm-modal">
      <div className="confirm-modal-body">
        <ModalHead
          titleId="confirm-dialog-title"
          title={options.title}
          description={options.description}
          onClose={() => settle(false)}
          closeLabel="Cancel"
        />
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={() => settle(false)}>
            {options.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            className={options.destructive ? "primary-button btn-danger" : "primary-button"}
            onClick={() => settle(true)}
          >
            {options.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </Modal>
  ) : null;

  const promptElement = promptOptions ? (
    <Modal open onClose={() => settlePrompt(null)} labelledBy="prompt-dialog-title" className="confirm-modal">
      <div className="confirm-modal-body">
        <ModalHead
          titleId="prompt-dialog-title"
          title={promptOptions.title}
          description={promptOptions.description}
          onClose={() => settlePrompt(null)}
          closeLabel="Cancel"
        />
        <div className="field">
          <label htmlFor="prompt-dialog-reason">{promptOptions.label}</label>
          <input
            id="prompt-dialog-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={promptOptions.placeholder}
            autoFocus
          />
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={() => settlePrompt(null)}>
            {promptOptions.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            className={promptOptions.destructive ? "primary-button btn-danger" : "primary-button"}
            onClick={() => settlePrompt(reason.trim())}
          >
            {promptOptions.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </Modal>
  ) : null;

  return { confirm, confirmElement, prompt, promptElement };
}
