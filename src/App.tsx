import { useMemo, useState, type FormEvent } from "react";
import {
  Activity, ArrowUpRight, Bot, BookOpen, Check,
  ChevronDown, CircleHelp, Clock3, FileText, Globe2, LayoutDashboard,
  Link2, MessageCircle, MoreHorizontal, Plus, RefreshCw, Search,
  Settings2, ShieldCheck, Sparkles, Trash2, Users, X,
} from "lucide-react";

type Source = {
  id: number;
  url: string;
  label: string;
  kind: "Website" | "URL";
  status: "Not connected" | "Pending setup";
  added: string;
};

type MemoryItem = {
  id: number;
  title: string;
  detail: string;
  status: "Needs review" | "Approved";
};

const initialSources: Source[] = [
  { id: 1, url: "https://example.com/help", label: "Help centre", kind: "Website", status: "Not connected", added: "Sample" },
  { id: 2, url: "https://example.com/delivery-policy", label: "Delivery policy", kind: "URL", status: "Not connected", added: "Sample" },
];

const initialMemories: MemoryItem[] = [
  { id: 1, title: "Delivery time clarification", detail: "A suggested correction from a sample support conversation.", status: "Needs review" },
  { id: 2, title: "Escalate refund disputes", detail: "Suggested business rule awaiting administrator approval.", status: "Needs review" },
];

type View = "Overview" | "Knowledge sources" | "AI memory" | "Chatbot settings";

export default function App() {
  const [view, setView] = useState<View>("Knowledge sources");
  const [sources, setSources] = useState<Source[]>(initialSources);
  const [memories, setMemories] = useState<MemoryItem[]>(initialMemories);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [scope, setScope] = useState<"submitted" | "domain">("submitted");
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [notice, setNotice] = useState("");
  const [aiEnabled, setAiEnabled] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const filteredSources = useMemo(() => sources.filter((source) =>
    (source.label + " " + source.url).toLowerCase().includes(query.toLowerCase()),
  ), [sources, query]);

  function addSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Only HTTP and HTTPS URLs are supported.");
    } catch {
      setNotice("Enter a valid http:// or https:// URL.");
      return;
    }
    const cleanUrl = parsed.toString().replace(/\/$/, "");
    if (sources.some((source) => source.url === cleanUrl)) {
      setNotice("That source has already been added.");
      return;
    }
    setSources((current) => [{
      id: Date.now(),
      url: cleanUrl,
      label: label.trim() || parsed.hostname,
      kind: cleanUrl.split("/").filter(Boolean).length > 1 ? "URL" : "Website",
      status: "Not connected",
      added: "Just now",
    }, ...current]);
    setUrl("");
    setLabel("");
    setShowAdd(false);
    setNotice("Source saved in this preview. Crawling will be enabled when the ingestion API is connected.");
  }

  function removeSource(id: number) {
    setSources((current) => current.filter((source) => source.id !== id));
    setNotice("Source removed from this preview. Backend deletion is not connected yet.");
  }

  function refreshSources() {
    setRefreshing(true);
    setNotice("Refresh is a UI placeholder. Connect the ingestion worker to fetch and index submitted sources.");
    window.setTimeout(() => setRefreshing(false), 450);
  }

  function approveMemory(id: number) {
    setMemories((current) => current.map((item) => item.id === id ? { ...item, status: "Approved" } : item));
    setNotice("Memory marked approved in this preview. Persistent memory storage is not connected yet.");
  }

  const navItems: { label: View; icon: typeof LayoutDashboard }[] = [
    { label: "Overview", icon: LayoutDashboard },
    { label: "Knowledge sources", icon: BookOpen },
    { label: "AI memory", icon: Sparkles },
    { label: "Chatbot settings", icon: Bot },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><MessageCircle size={21} strokeWidth={2.5} /></div>
          <div><strong>MobiWave</strong><span>WHATSAPP PLATFORM</span></div>
        </div>
        <div className="workspace-switch">
          <div className="workspace-avatar">MW</div>
          <div className="workspace-copy"><strong>MobiWave Demo</strong><span>Workspace</span></div>
          <ChevronDown size={16} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {navItems.map(({ label: item, icon: Icon }) => (
            <button key={item} className={view === item ? "nav-item active" : "nav-item"} onClick={() => setView(item)}>
              <Icon size={18} /><span>{item}</span>{item === "AI memory" && <span className="nav-count">{memories.length}</span>}
            </button>
          ))}
        </nav>
        <div className="nav-label management-label">MESSAGING</div>
        <button className="nav-item" onClick={() => setNotice("Inbox will be enabled with the Meta Cloud API integration.")}><MessageCircle size={18} /><span>Shared inbox</span><span className="soon">SOON</span></button>
        <button className="nav-item" onClick={() => setNotice("Campaigns will be enabled with the Meta Cloud API integration.")}><Users size={18} /><span>Contacts & campaigns</span></button>
        <div className="sidebar-bottom">
          <div className="help-card"><CircleHelp size={18} /><div><strong>Need a hand?</strong><span>View setup guide</span></div><ArrowUpRight size={15} /></div>
          <button className="profile"><div className="profile-avatar">BM</div><div><strong>Workspace admin</strong><span>Administrator</span></div><MoreHorizontal size={18} /></button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-sep">/</span><strong>{view}</strong></div>
          <div className="top-actions"><span className="environment"><span className="status-dot" /> Preview environment</span><button className="icon-button" aria-label="Settings" onClick={() => setView("Chatbot settings")}><Settings2 size={18} /></button><div className="mini-avatar">BM</div></div>
        </header>

        {view === "Knowledge sources" && (
          <section className="content">
            <div className="page-heading">
              <div>
                <div className="eyebrow"><BookOpen size={14} /> AI KNOWLEDGE</div>
                <h1>Knowledge sources</h1>
                <p className="page-description">Choose exactly which websites and documents your AI can learn from.</p>
              </div>
              <button className="primary-button" onClick={() => { setShowAdd(true); setNotice(""); }}><Plus size={17} /> Add source</button>
            </div>

            <div className="callout">
              <div className="callout-icon"><ShieldCheck size={20} /></div>
              <div><strong>Your sources. Your AI.</strong><p>We only use links and files you submit. MobiWave will not search the wider internet to fill gaps in your knowledge base.</p></div>
              <button className="text-button" onClick={() => setView("Chatbot settings")}>How it works <ArrowUpRight size={15} /></button>
            </div>

            <div className="metric-grid">
              <Metric icon={<Globe2 size={18} />} label="Sources added" value={String(sources.length)} note="Submitted by your team" />
              <Metric icon={<FileText size={18} />} label="Pages indexed" value="—" note="Ingestion not connected" />
              <Metric icon={<Sparkles size={18} />} label="Memory items" value={String(memories.length)} note="Review before use" />
              <Metric icon={<Activity size={18} />} label="Knowledge health" value="Setup" note="Waiting for backend" />
            </div>

            <div className="section-header">
              <div><h2>Connected sources</h2><p>Manage the websites and individual pages available to your chatbot.</p></div>
              <button className="secondary-button" onClick={refreshSources} disabled={refreshing}><RefreshCw size={15} className={refreshing ? "spin" : ""} /> Refresh status</button>
            </div>

            <div className="source-toolbar">
              <div className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sources..." aria-label="Search sources" /></div>
              <button className="filter-button" onClick={() => setQuery("")}>All sources <ChevronDown size={15} /></button>
            </div>

            <div className="source-list">
              <div className="source-table-head"><span>SOURCE</span><span>TYPE</span><span>STATUS</span><span>ADDED</span><span /></div>
              {filteredSources.length === 0 ? <div className="empty-state"><Globe2 size={25} /><strong>No sources found</strong><span>Add a URL or try a different search.</span></div> : filteredSources.map((source) => (
                <div className="source-row" key={source.id}>
                  <div className="source-main"><div className="source-icon"><Globe2 size={18} /></div><div className="source-text"><strong>{source.label}</strong><a href={source.url} target="_blank" rel="noreferrer">{source.url} <ArrowUpRight size={12} /></a></div></div>
                  <div className="source-type">{source.kind === "Website" ? <Globe2 size={14} /> : <Link2 size={14} />}{source.kind}</div>
                  <div><span className="status-pill neutral"><span />{source.status}</span></div>
                  <div className="source-added">{source.added}</div>
                  <div className="row-actions"><button className="icon-button" aria-label={"Remove " + source.label} onClick={() => removeSource(source.id)}><Trash2 size={16} /></button></div>
                </div>
              ))}
            </div>
            <div className="source-footnote"><ShieldCheck size={15} /><span>Only authorized, tenant-approved content should be indexed. External links will not be followed unless explicitly added.</span></div>

            {showAdd && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowAdd(false); }}>
              <form className="modal" onSubmit={addSource}>
                <div className="modal-heading"><div><h2>Add a knowledge source</h2><p>Submit a website or one specific page for your chatbot.</p></div><button type="button" className="icon-button" aria-label="Close" onClick={() => setShowAdd(false)}><X size={19} /></button></div>
                <label htmlFor="source-url">Website or page URL <span className="required">*</span></label>
                <input id="source-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://yourbusiness.co.ke/help" required />
                <label htmlFor="source-name">Display name <span className="optional">(optional)</span></label>
                <input id="source-name" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Help centre" />
                <div className="scope-label">Crawl scope</div>
                <label className="scope-option"><input type="radio" name="scope" checked={scope === "submitted"} onChange={() => setScope("submitted")} /><span><strong>Submitted URL only</strong><small>Index only the exact page you provide.</small></span></label>
                <label className="scope-option"><input type="radio" name="scope" checked={scope === "domain"} onChange={() => setScope("domain")} /><span><strong>Same-domain pages</strong><small>Allow crawling within this domain, subject to page and depth limits.</small></span></label>
                <div className="modal-warning"><ShieldCheck size={16} /><span>Ingestion is not connected yet. This saves the source configuration in the preview only.</span></div>
                <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowAdd(false)}>Cancel</button><button type="submit" className="primary-button"><Plus size={16} /> Save source</button></div>
              </form>
            </div>}
          </section>
        )}

        {view === "AI memory" && <section className="content">
          <div className="page-heading"><div><div className="eyebrow"><Sparkles size={14} /> CURATED LEARNING</div><h1>AI memory</h1><p className="page-description">Review what the assistant may remember about your business.</p></div><button className="secondary-button" onClick={() => setNotice("Memory suggestions will be generated from resolved conversations once the AI and inbox backend is connected.")}><Sparkles size={16} /> Suggest memories</button></div>
          <div className="callout"><div className="callout-icon"><ShieldCheck size={20} /></div><div><strong>Memory is reviewed, not blindly learned.</strong><p>The AI does not retrain itself after every chat. Durable memories should be approved by your team and remain isolated to this workspace.</p></div></div>
          <div className="section-header"><div><h2>Memory review queue</h2><p>Approve, keep under review, or remove suggested business knowledge.</p></div><span className="queue-count">{memories.filter((m) => m.status === "Needs review").length} awaiting review</span></div>
          <div className="memory-list">{memories.map((item) => <div className="memory-row" key={item.id}><div className="memory-symbol"><Sparkles size={18} /></div><div className="memory-copy"><strong>{item.title}</strong><p>{item.detail}</p><span className={item.status === "Approved" ? "status-pill success" : "status-pill warning"}><span />{item.status}</span></div><div className="memory-actions">{item.status === "Needs review" ? <button className="secondary-button" onClick={() => approveMemory(item.id)}><Check size={15} /> Approve</button> : <button className="secondary-button" disabled><Check size={15} /> Approved</button>}<button className="icon-button" aria-label={"Delete " + item.title} onClick={() => setMemories((current) => current.filter((memory) => memory.id !== item.id))}><Trash2 size={16} /></button></div></div>)}</div>
          <div className="privacy-note"><ShieldCheck size={17} /><div><strong>Memory controls</strong><p>Production memory will include source attribution, timestamps, approval history, retention settings and deletion controls. Never save passwords, payment credentials or unnecessary sensitive personal data.</p></div></div>
        </section>}

        {view === "Overview" && <section className="content">
          <div className="page-heading"><div><div className="eyebrow"><LayoutDashboard size={14} /> WORKSPACE</div><h1>Overview</h1><p className="page-description">Your WhatsApp automation workspace at a glance.</p></div></div>
          <div className="callout"><div className="callout-icon"><Activity size={20} /></div><div><strong>Foundation preview is ready to configure</strong><p>This branch starts with knowledge source management and AI memory review. Meta messaging, authentication, database persistence and crawling workers still need to be integrated.</p></div></div>
          <div className="metric-grid"><Metric icon={<Globe2 size={18} />} label="Knowledge sources" value={String(sources.length)} note="Preview data only" /><Metric icon={<Sparkles size={18} />} label="Memory items" value={String(memories.length)} note="Review queue" /><Metric icon={<Bot size={18} />} label="Chatbot status" value={aiEnabled ? "Enabled" : "Paused"} note="Local preview toggle" /><Metric icon={<MessageCircle size={18} />} label="WhatsApp API" value="Not linked" note="Meta setup required" /></div>
          <div className="section-header"><div><h2>Next setup steps</h2><p>Complete these before using the platform with real customers.</p></div></div>
          <div className="checklist"><SetupRow done label="Define product and security architecture" detail="Meta-only transport, tenant isolation and source-restricted knowledge." /><SetupRow done label="Create the frontend foundation" detail="Knowledge source and AI memory preview screens." /><SetupRow label="Connect authentication and database" detail="Tenant memberships, row-level security and persistent records." /><SetupRow label="Build safe website ingestion" detail="URL scope controls, SSRF protection, extraction and indexing." /><SetupRow label="Connect Meta Cloud API and chatbot" detail="Verified webhooks, messages, approved templates and agent handoff." /></div>
        </section>}

        {view === "Chatbot settings" && <section className="content">
          <div className="page-heading"><div><div className="eyebrow"><Bot size={14} /> AUTOMATION</div><h1>Chatbot settings</h1><p className="page-description">Control how your assistant uses approved knowledge and when it hands off to a person.</p></div></div>
          <div className="settings-panel"><div className="setting-row"><div className="setting-icon"><Bot size={19} /></div><div className="setting-copy"><strong>AI replies</strong><p>Pause automated replies without affecting campaigns or the shared inbox.</p></div><button className={aiEnabled ? "toggle on" : "toggle"} role="switch" aria-checked={aiEnabled} onClick={() => setAiEnabled((value) => !value)}><span /></button></div><div className="setting-row"><div className="setting-icon"><BookOpen size={19} /></div><div className="setting-copy"><strong>Approved knowledge only</strong><p>Answers must use tenant-approved sources. No general web search fallback.</p></div><span className="fixed-setting"><ShieldCheck size={14} /> Required</span></div><div className="setting-row"><div className="setting-icon"><Users size={19} /></div><div className="setting-copy"><strong>Human handoff</strong><p>Route uncertain or unsupported questions to the shared inbox and pause the bot for that conversation.</p></div><span className="fixed-setting"><Check size={14} /> Planned</span></div><div className="setting-row"><div className="setting-icon"><Clock3 size={19} /></div><div className="setting-copy"><strong>Conversation context retention</strong><p>Set a retention window for temporary conversation context when persistence is implemented.</p></div><span className="fixed-setting">Not configured</span></div></div>
          <div className="privacy-note"><ShieldCheck size={17} /><div><strong>AI and messaging are separate</strong><p>If the AI provider is unavailable or AI is switched off, inbound messages remain available for human agents. Outbound campaigns do not depend on AI.</p></div></div>
        </section>}

        {notice && <div className="toast" role="status"><div className="toast-icon"><Check size={15} /></div><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice("")}><X size={15} /></button></div>}
        <footer className="footer"><span>© 2026 MobiWave Innovations Ltd</span><span><span className="footer-dot" /> Preview · Backend not connected</span><button onClick={() => setNotice("MobiWave WhatsApp MVP — official Meta Cloud API only.")}>System status <ArrowUpRight size={13} /></button></footer>
      </main>
    </div>
  );
}

function Metric({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note: string }) {
  return <div className="metric-card"><div className="metric-top"><span className="metric-icon">{icon}</span><span className="metric-label">{label}</span></div><div className="metric-value">{value}</div><div className="metric-note">{note}</div></div>;
}

function SetupRow({ done = false, label, detail }: { done?: boolean; label: string; detail: string }) {
  return <div className="setup-row"><div className={done ? "setup-check done" : "setup-check"}>{done ? <Check size={15} /> : <span />}</div><div><strong>{label}</strong><p>{detail}</p></div><span className={done ? "setup-status complete" : "setup-status"}>{done ? "Done" : "Planned"}</span></div>;
}
