import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, ArrowUpRight, Home, RefreshCw } from "lucide-react";

type ErrorPageProps = {
  kind?: "not-found" | "error" | "unavailable";
  title?: string;
  description?: string;
};

export function ErrorPage({ kind = "error", title, description }: ErrorPageProps) {
  const content = {
    "not-found": {
      code: "404",
      title: "We couldn’t find that page",
      description: "The link may be outdated, or the page may have moved. You can return to MobiWave WA and continue from there.",
    },
    error: {
      code: "500",
      title: "Something didn’t go as planned",
      description: "An unexpected error interrupted this page. Your workspace is still protected. Try again, or return to the home page.",
    },
    unavailable: {
      code: "503",
      title: "MobiWave WA is temporarily unavailable",
      description: "We couldn’t complete your request just now. Please wait a moment and try again.",
    },
  }[kind];

  return (
    <main className="flex min-h-screen flex-col bg-canvas font-sans">
      <div className="flex items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <a className="flex items-center gap-2.5" href="/" aria-label="MobiWave WA home">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white shadow-brand">
            <span className="font-display text-[13px] font-extrabold">MW</span>
          </span>
          <span className="font-display text-[15.5px] font-extrabold tracking-tight text-ink-900">
            MobiWave<span className="ml-1 font-sans text-[11px] font-bold text-brand-600">WA</span>
          </span>
        </a>
        <span className="text-[12.5px] text-ink-400">MobiWave Innovations Ltd</span>
      </div>

      <section className="flex flex-1 flex-col items-center justify-center px-5 py-12 text-center" role="alert">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-600">
          <AlertTriangle size={25} strokeWidth={1.8} />
        </div>
        <p className="mt-6 flex items-center gap-2 text-[11.5px] font-extrabold uppercase tracking-[0.16em] text-brand-600">
          {content.code}
          <span className="text-ink-300">·</span>
          <span className="text-ink-400">
            {kind === "not-found" ? "Page not found" : kind === "unavailable" ? "Service unavailable" : "Unexpected error"}
          </span>
        </p>
        <h1 className="mt-4 max-w-xl font-display text-[clamp(1.8rem,4vw,2.6rem)] font-extrabold leading-tight tracking-[-0.03em]">
          {title ?? content.title}
        </h1>
        <p className="mt-4 max-w-lg text-[15.5px] leading-relaxed text-ink-500">{description ?? content.description}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button className="btn btn-primary h-11 px-5" onClick={() => window.location.reload()}>
            <RefreshCw size={16} /> Try again
          </button>
          <a className="btn btn-secondary h-11 px-5" href="/"><Home size={16} /> Back to home</a>
        </div>
        <p className="mt-8 text-[13.5px] text-ink-400">
          Still having trouble?{" "}
          <a className="font-semibold text-brand-600 hover:text-brand-700" href="mailto:info@mobiwave.co.ke?subject=MobiWave%20WA%20support">
            Contact MobiWave support
          </a>
          .
        </p>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-200 px-5 py-5 text-[12.5px] text-ink-400 sm:px-8">
        <span>© 2026 MobiWave Innovations Ltd</span>
        <a className="inline-flex items-center gap-1.5 font-medium text-ink-500 hover:text-brand-700" href="https://mobiwave.co.ke/">
          Company website <ArrowUpRight size={13} />
        </a>
      </footer>
    </main>
  );
}

type BoundaryProps = { children: ReactNode };
type BoundaryState = { hasError: boolean };

export class AppErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  componentDidMount() {
    window.addEventListener("error", this.handleWindowError);
    window.addEventListener("unhandledrejection", this.handleUnhandledRejection);
    window.addEventListener("vite:preloadError", this.handlePreloadError);
  }

  componentWillUnmount() {
    window.removeEventListener("error", this.handleWindowError);
    window.removeEventListener("unhandledrejection", this.handleUnhandledRejection);
    window.removeEventListener("vite:preloadError", this.handlePreloadError);
  }

  private handleWindowError = (event: ErrorEvent) => {
    if (!event.error) return;
    console.error("MobiWave WA uncaught runtime error:", event.error);
    this.setState({ hasError: true });
  };

  private handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    console.error("MobiWave WA unhandled async error:", event.reason);
    this.setState({ hasError: true });
  };

  private handlePreloadError = (event: Event) => {
    event.preventDefault();
    console.error("MobiWave WA failed to load an application resource.");
    this.setState({ hasError: true });
  };

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep diagnostic details in the browser console, not in the customer-facing UI.
    console.error("MobiWave WA render error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) return <ErrorPage kind="error" />;
    return this.props.children;
  }
}

export function NetworkStatus() {
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && !navigator.onLine);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (!offline) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[70] flex flex-wrap items-center justify-center gap-3 bg-amber-500 px-4 py-2.5 text-[13px] font-semibold text-amber-950" role="status">
      <AlertTriangle size={16} />
      <span>You appear to be offline. Some workspace actions may not work until your connection returns.</span>
      <button
        type="button"
        className="rounded-md bg-amber-950/10 px-2.5 py-1 text-[12.5px] font-bold transition-colors hover:bg-amber-950/20"
        onClick={() => window.location.reload()}
      >
        Retry
      </button>
    </div>
  );
}
