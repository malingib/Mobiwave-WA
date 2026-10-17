import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, Home, RefreshCw } from "lucide-react";

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
    <main className="mw-error-screen">
      <div className="mw-error-top">
        <a className="mw-error-brand" href="/" aria-label="MobiWave WA home">
          <span className="mw-error-mark"><span>MW</span></span>
          <span><strong>MobiWave</strong><small>WA</small></span>
        </a>
        <span className="mw-error-secure">MobiWave Innovations Ltd</span>
      </div>
      <section className="mw-error-content" role="alert">
        <div className="mw-error-symbol"><AlertTriangle size={25} strokeWidth={1.8} /></div>
        <p className="mw-error-code">{content.code} <span>·</span> {kind === "not-found" ? "PAGE NOT FOUND" : kind === "unavailable" ? "SERVICE UNAVAILABLE" : "UNEXPECTED ERROR"}</p>
        <h1>{title ?? content.title}</h1>
        <p className="mw-error-description">{description ?? content.description}</p>
        <div className="mw-error-actions">
          <button className="mw-error-primary" onClick={() => window.location.reload()}><RefreshCw size={16} /> Try again</button>
          <a className="mw-error-secondary" href="/"><Home size={16} /> Back to home</a>
        </div>
        <p className="mw-error-help">Still having trouble? <a href="mailto:info@mobiwave.co.ke?subject=MobiWave%20WA%20support">Contact MobiWave support</a>.</p>
      </section>
      <footer className="mw-error-footer"><span>© 2026 MobiWave Innovations Ltd</span><a href="https://mobiwave.co.ke/">Company website <ArrowLeft size={12} /></a></footer>
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
