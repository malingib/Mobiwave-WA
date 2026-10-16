import { requireUser, requireTenantRole } from "../_shared/auth.ts";
import { corsHeaders, json, errorMessage } from "../_shared/cors.ts";

const MAX_PAGES = 20;
const MAX_BODY_BYTES = 1_500_000;
const MAX_REDIRECTS = 4;
const FETCH_TIMEOUT_MS = 12_000;

function ipv4IsPrivate(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  return p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 ||
    (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
    (p[0] === 192 && p[1] === 0) || (p[0] === 198 && (p[1] === 18 || p[1] === 19));
}
function ipv6IsPrivate(ip: string): boolean {
  const s = ip.toLowerCase().split("%")[0];
  return s === "::" || s === "::1" || s.startsWith("fc") || s.startsWith("fd") ||
    /^fe[89ab]/.test(s) || s.startsWith("ff") || s.startsWith("::ffff:") || s === "2001:db8::";
}
async function validatePublicHttpUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP and HTTPS sources are allowed.");
  if (url.username || url.password) throw new Error("URLs containing credentials are not allowed.");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("Only standard HTTP/HTTPS ports are allowed.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      host.endsWith(".internal") || host.endsWith(".test") || host.endsWith(".invalid")) {
    throw new Error("Private and local hosts are not allowed.");
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    if (ipv4IsPrivate(host)) throw new Error("Private IP addresses are not allowed.");
    throw new Error("IP-literal URLs are not accepted. Submit a public domain name.");
  }
  if (host.includes(":")) throw new Error("IP-literal URLs are not accepted. Submit a public domain name.");
  let addresses: string[] = [];
  try {
    const a = await Deno.resolveDns(host, "A");
    addresses = addresses.concat(a);
  } catch { /* host may be IPv6-only; query AAAA below */ }
  try {
    const aaaa = await Deno.resolveDns(host, "AAAA");
    addresses = addresses.concat(aaaa);
  } catch { /* no AAAA record is fine */ }
  if (!addresses.length) throw new Error("The domain did not resolve to a public IP address.");
  if (addresses.some((ip) => ip.includes(":") ? ipv6IsPrivate(ip) : ipv4IsPrivate(ip))) {
    throw new Error("This domain resolves to a private or reserved IP address and cannot be crawled.");
  }
  url.hash = "";
  return url;
}

async function safeFetch(raw: string, originHost: string, scope: string): Promise<{ response: Response; url: URL }> {
  let current = await validatePublicHttpUrl(raw);
  if (scope === "submitted_url" && current.hostname !== originHost) throw new Error("Crawl left the submitted host.");
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    if (scope === "same_domain" && current.hostname !== originHost) throw new Error("Cross-domain redirects are blocked.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(current.toString(), {
        method: "GET", redirect: "manual", signal: controller.signal,
        headers: { "User-Agent": "MobiWaveKnowledgeBot/1.0 (+https://mobiwave.co.ke)", "Accept": "text/html,text/plain;q=0.9" },
      });
    } finally { clearTimeout(timeout); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect response had no location.");
      if (redirects === MAX_REDIRECTS) throw new Error("Too many redirects.");
      current = await validatePublicHttpUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error("Source returned HTTP " + response.status + ".");
    const type = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!type.includes("text/html") && !type.includes("text/plain")) throw new Error("Only HTML and plain-text pages can be indexed.");
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_BODY_BYTES) throw new Error("Page is larger than the allowed 1.5 MB limit.");
    return { response, url: current };
  }
  throw new Error("Redirect limit exceeded.");
}

function htmlToText(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/[\t\r ]+/g, " ").replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n").trim();
}
function pageTitle(html: string, fallback: string): string {
  return html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, "").trim().slice(0, 250) || fallback;
}
function linksFromHtml(html: string, base: URL, host: string): string[] {
  const matches = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi)].map((m) => m[1]);
  const out = new Set<string>();
  for (const link of matches) {
    try {
      const u = new URL(link, base);
      u.hash = "";
      if (u.hostname === host && ["http:", "https:"].includes(u.protocol) && !/\.(pdf|png|jpe?g|gif|svg|zip|docx?|xlsx?|pptx?|mp[34]|css|js)(\?|$)/i.test(u.pathname)) out.add(u.toString());
    } catch { /* ignore malformed hrefs */ }
  }
  return [...out];
}
function chunksFor(text: string): string[] {
  const chunks: string[] = [];
  const size = 1400, overlap = 180;
  for (let start = 0; start < text.length; start += size - overlap) {
    const chunk = text.slice(start, start + size).trim();
    if (chunk.length >= 80) chunks.push(chunk);
    if (chunks.length >= 250) break;
  }
  return chunks;
}
async function sha256(text: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  let runId: string | undefined;
  let admin: any;
  let source: any;
  try {
    const auth = await requireUser(request);
    admin = auth.admin;
    const body = await request.json();
    const tenantId = String(body.tenant_id ?? "");
    const sourceId = String(body.source_id ?? "");
    if (!tenantId || !sourceId) return json({ error: "tenant_id and source_id are required." }, 400);
    await requireTenantRole(admin, tenantId, auth.userId, ["owner", "admin"]);
    const { data, error } = await admin.from("knowledge_sources").select("*").eq("tenant_id", tenantId).eq("id", sourceId).eq("enabled", true).maybeSingle();
    if (error || !data) return json({ error: "Enabled knowledge source was not found." }, 404);
    source = data;
    const { data: run, error: runError } = await admin.from("source_ingestion_runs").insert({ tenant_id: tenantId, source_id: sourceId, status: "running", started_at: new Date().toISOString() }).select("id").single();
    if (runError) throw runError;
    runId = run.id;
    await admin.from("knowledge_sources").update({ status: "crawling", last_crawled_at: new Date().toISOString(), last_error_code: null }).eq("id", sourceId).eq("tenant_id", tenantId);

    const startUrl = await validatePublicHttpUrl(source.submitted_url);
    const originHost = startUrl.hostname;
    const scope = source.scope === "same_domain" ? "same_domain" : "submitted_url";
    const queue = [startUrl.toString()];
    const visited = new Set<string>();
    let pagesIndexed = 0;
    let charsIndexed = 0;

    // Respect robots.txt for the submitted host. Crawl is restricted to submitted URL or exact same host.
    let robotsDisallowAll = false;\n    const robotsRules: { allow: boolean; path: string }[] = [];
    try {
      const robotsUrl = new URL("/robots.txt", startUrl.origin);
      const { response } = await safeFetch(robotsUrl.toString(), originHost, "same_domain");
      const robotsText = (await response.text()).slice(0, 100_000);
      let active = false;
      for (const line of robotsText.split(/\r?\n/)) {
        const [key, ...rest] = line.split(":");
        const value = rest.join(":").trim();
        if (key?.trim().toLowerCase() === "user-agent") active = value === "*" || value.toLowerCase() === "mobiWaveknowledgebot";
        if (active && key?.trim().toLowerCase() === "disallow" && (value === "/" || value === "")) robotsDisallowAll = value === "/";
      }
    } catch { /* robots unavailable: continue only with explicit submitted scope and bounded fetches */ }
    if (robotsDisallowAll) throw new Error("robots.txt disallows crawling this host.");

    while (queue.length && visited.size < (scope === "same_domain" ? MAX_PAGES : 1)) {
      const rawUrl = queue.shift()!;
      let safeUrl: URL;
      try { safeUrl = await validatePublicHttpUrl(rawUrl); } catch { continue; }
      if (safeUrl.hostname !== originHost) continue;
      const normalized = safeUrl.toString();
      if (visited.has(normalized)) continue;
      visited.add(normalized);
      const { response, url: finalUrl } = await safeFetch(normalized, originHost, scope);
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > MAX_BODY_BYTES) throw new Error("Fetched page exceeded the 1.5 MB limit.");
      const rawText = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
      const html = (response.headers.get("content-type") ?? "").includes("text/html");
      const extracted = html ? htmlToText(rawText) : rawText.trim();
      if (extracted.length < 80) continue;
      const title = html ? pageTitle(rawText, finalUrl.pathname || finalUrl.hostname) : finalUrl.pathname || finalUrl.hostname;
      const hash = await sha256(extracted);
      const { data: document, error: docError } = await admin.from("knowledge_documents").upsert({
        tenant_id: tenantId, source_id: sourceId, canonical_url: finalUrl.toString(), title,
        content_hash: hash, extracted_text: extracted.slice(0, 500_000),
        content_type: html ? "text/html" : "text/plain", fetched_at: new Date().toISOString(), is_current: true,
      }, { onConflict: "tenant_id,canonical_url,content_hash" }).select("id").single();
      if (docError) throw docError;
      await admin.from("knowledge_documents").update({ is_current: false }).eq("tenant_id", tenantId).eq("canonical_url", finalUrl.toString()).neq("id", document.id);
      const parts = chunksFor(extracted);
      await admin.from("knowledge_chunks").delete().eq("tenant_id", tenantId).eq("document_id", document.id);
      if (parts.length) {
        const { error: chunkError } = await admin.from("knowledge_chunks").insert(parts.map((content, index) => ({
          tenant_id: tenantId, document_id: document.id, chunk_index: index, content,
          token_estimate: Math.ceil(content.length / 4), metadata: { title, url: finalUrl.toString() },
        })));
        if (chunkError) throw chunkError;
      }
      pagesIndexed++; charsIndexed += extracted.length;
      if (scope === "same_domain") for (const link of linksFromHtml(rawText, finalUrl, originHost)) if (!visited.has(link) && !queue.includes(link) && queue.length < MAX_PAGES) queue.push(link);
    }

    if (!pagesIndexed) throw new Error("No readable pages were indexed. Check the URL, access rules, robots.txt and page content.");
    await admin.from("source_ingestion_runs").update({ status: "succeeded", pages_discovered: visited.size, pages_indexed: pagesIndexed, finished_at: new Date().toISOString() }).eq("id", runId);
    await admin.from("knowledge_sources").update({ status: "indexed", canonical_url: startUrl.toString(), last_successful_at: new Date().toISOString(), last_error_code: null }).eq("id", sourceId).eq("tenant_id", tenantId);
    return json({ ok: true, source_id: sourceId, pages_indexed: pagesIndexed, characters_indexed: charsIndexed, message: "Submitted source content indexed. No general internet search was performed." });
  } catch (error) {
    const message = errorMessage(error);
    if (runId && admin) {
      await admin.from("source_ingestion_runs").update({ status: "failed", error_code: message.slice(0, 180), finished_at: new Date().toISOString() }).eq("id", runId);
      if (source?.id) await admin.from("knowledge_sources").update({ status: "failed", last_error_code: message.slice(0, 180) }).eq("id", source.id);
    }
    const status = /sign in|session is invalid/i.test(message) ? 401 : /permission/i.test(message) ? 403 : 400;
    return json({ error: message }, status);
  }
});
