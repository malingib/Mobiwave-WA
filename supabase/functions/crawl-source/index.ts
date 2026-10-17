import { requireUser, requireTenantRole } from "../_shared/auth.ts";
import { corsHeaders, json, errorMessage } from "../_shared/cors.ts";
import { emitWebhook } from "../_shared/customer-webhooks.ts";

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

async function safeFetch(raw: string, originHost: string, scope: string, allowXml = false): Promise<{ response: Response; url: URL }> {
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
    const isXml = type.includes("application/xml") || type.includes("text/xml") || type.includes("+xml");
    if (!type.includes("text/html") && !type.includes("text/plain") && !(allowXml && isXml)) throw new Error("Only HTML and plain-text pages can be indexed.");
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
  const raw = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, "").trim();
  return (raw || fallback).slice(0, 250);
}
function metadataText(html: string): string {
  const values: string[] = [];
  for (const match of html.matchAll(/<meta\b[^>]*(?:name|property)\s*=\s*["'](description|og:description|twitter:description|og:title|twitter:title)["'][^>]*>/gi)) {
    const content = match[0].match(/content\s*=\s*["']([^"']+)["']/i)?.[1];
    if (content) values.push(content.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").trim());
  }
  for (const match of html.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)) {
    const heading = htmlToText(match[1]);
    if (heading) values.push(heading);
  }
  return [...new Set(values)].join("\n");
}

function structuredDataText(html: string): string {
  const values: string[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(match[1]);
      const visit = (value: unknown) => {
        if (!value || typeof value !== "object") return;
        if (Array.isArray(value)) { value.forEach(visit); return; }
        const item = value as Record<string, unknown>;
        for (const key of ["headline", "name", "description", "articleBody", "text", "abstract", "about"]) {
          const v = item[key];
          if (typeof v === "string" && v.trim().length > 30) values.push(v.trim());
        }
        for (const key of ["@graph", "mainEntity", "mainEntityOfPage", "article", "itemListElement"]) visit(item[key]);
      };
      visit(data);
    } catch { /* malformed JSON-LD is ignored */ }
  }
  return [...new Set(values)].join("\n\n");
}
function extractReadableContent(html: string): string {
  const removeNoise = (value: string) => value
    .replace(/<(script|style|noscript|svg|nav|footer|header|aside|form)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/[\t\r ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  const preferred: string[] = [];
  for (const match of html.matchAll(/<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = removeNoise(match[2]);
    if (text.length > 80) preferred.push(text);
  }
  const primary = [...new Set(preferred)].join("\n\n");
  const fallback = htmlToText(html);
  const jsonLd = structuredDataText(html);
  // Prefer actual article/main text; use structured data only to supplement or rescue thin pages.
  if (primary.length >= 180) return primary.length >= 300 ? primary : [primary, jsonLd].filter(Boolean).join("\n\n");
  if (fallback.length >= 180) return [fallback, jsonLd].filter(Boolean).join("\n\n");
  return [primary, jsonLd].filter(Boolean).join("\n\n");
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
function sitemapLocs(xml: string, host: string): string[] {
  const urls = new Set<string>();
  for (const match of xml.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)) {
    const raw = match[1].replace(/&amp;/gi, "&").trim();
    try {
      const url = new URL(raw);
      url.hash = "";
      if (url.hostname === host && ["http:", "https:"].includes(url.protocol)) urls.add(url.toString());
    } catch { /* ignore invalid sitemap entries */ }
  }
  return [...urls];
}

async function discoverSitemapPages(startUrl: URL, originHost: string): Promise<string[]> {
  const pages = new Set<string>();
  const sitemapCandidates = [
    new URL("/sitemap.xml", startUrl.origin),
    new URL("/sitemap_index.xml", startUrl.origin),
  ];
  for (const sitemapUrl of sitemapCandidates) {
    try {
      const { response } = await safeFetch(sitemapUrl.toString(), originHost, "same_domain", true);
      const xml = (await response.text()).slice(0, MAX_BODY_BYTES);
      const locations = sitemapLocs(xml, originHost);
      if (/<sitemapindex\b/i.test(xml)) {
        for (const childUrl of locations.filter((value) => /\.xml(?:$|[?#])/i.test(value)).slice(0, 3)) {
          try {
            const { response: childResponse } = await safeFetch(childUrl, originHost, "same_domain", true);
            const childXml = (await childResponse.text()).slice(0, MAX_BODY_BYTES);
            for (const pageUrl of sitemapLocs(childXml, originHost)) {
              if (!/\.xml(?:$|[?#])/i.test(new URL(pageUrl).pathname) && pages.size < MAX_PAGES) pages.add(pageUrl);
            }
          } catch { /* one unavailable child sitemap must not fail the whole crawl */ }
        }
      } else {
        for (const pageUrl of locations) {
          if (!/\.xml(?:$|[?#])/i.test(new URL(pageUrl).pathname) && pages.size < MAX_PAGES) pages.add(pageUrl);
        }
      }
      if (pages.size >= MAX_PAGES) break;
    } catch { /* sitemap is optional; same-host HTML links remain available */ }
  }
  return [...pages];
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
    let pagesReadable = 0;
    let duplicatesSkipped = 0;
    let thinPagesSkipped = 0;
    let fetchFailures = 0;
    const seenContentHashes = new Set<string>();

    // Respect robots.txt for the submitted host. Crawl is restricted to submitted URL or exact same host.
    let robotsDisallowAll = false;
    const robotsSitemaps: string[] = [];
    try {
      const robotsUrl = new URL("/robots.txt", startUrl.origin);
      const { response } = await safeFetch(robotsUrl.toString(), originHost, "same_domain");
      const robotsText = (await response.text()).slice(0, 100_000);
      let active = false;
      for (const line of robotsText.split(/\r?\n/)) {
        const [key, ...rest] = line.split(":");
        const value = rest.join(":").trim();
        if (key?.trim().toLowerCase() === "sitemap" && value) robotsSitemaps.push(value);
        if (key?.trim().toLowerCase() === "user-agent") active = value === "*" || value.toLowerCase() === "mobiWaveknowledgebot";
        if (active && key?.trim().toLowerCase() === "disallow" && (value === "/" || value === "")) robotsDisallowAll = value === "/";
      }
    } catch { /* robots unavailable: continue only with explicit submitted scope and bounded fetches */ }
    if (robotsDisallowAll) throw new Error("robots.txt disallows crawling this host.");
    if (scope === "same_domain") {
      for (const sitemapPage of [...robotsSitemaps, ...await discoverSitemapPages(startUrl, originHost)]) {
        if (queue.length >= MAX_PAGES) break;
        try {
          const parsed = new URL(sitemapPage, startUrl);
          if (parsed.hostname === originHost && !/\.xml(?:$|[?#])/i.test(parsed.pathname) && !queue.includes(parsed.toString())) queue.push(parsed.toString());
        } catch { /* ignore invalid sitemap declarations */ }
      }
    }

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
      const extracted = html ? extractReadableContent(rawText) : rawText.trim();
      // Discover same-host links before skipping thin JavaScript app-shell pages.
      // Otherwise a nearly empty homepage prevents the crawler reaching readable routes.
      if (scope === "same_domain" && html) {
        for (const link of linksFromHtml(rawText, finalUrl, originHost)) {
          if (!visited.has(link) && !queue.includes(link) && queue.length < MAX_PAGES) queue.push(link);
        }
        if (visited.size === 1 && queue.length === 0) {
          const commonPaths = ["/about", "/about-us", "/services", "/products", "/solutions", "/pricing", "/contact", "/contact-us", "/resources", "/blog", "/industries", "/bulk-sms", "/services/bulk-sms", "/services/whatsapp", "/api"];
          for (const path of commonPaths) {
            if (queue.length >= MAX_PAGES) break;
            queue.push(new URL(path, startUrl.origin).toString());
          }
        }
      }
      if (extracted.length < 180) { thinPagesSkipped++; continue; }
      pagesReadable++;
      const title = html ? pageTitle(rawText, finalUrl.pathname || finalUrl.hostname) : finalUrl.pathname || finalUrl.hostname;
      const normalizedContent = extracted.toLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
      const hash = await sha256(normalizedContent);
      if (seenContentHashes.has(hash)) { duplicatesSkipped++; continue; }
      seenContentHashes.add(hash);
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
    }

    if (!pagesIndexed) throw new Error("No readable pages were indexed. Check the URL, access rules, robots.txt and page content.");
    await admin.from("source_ingestion_runs").update({ status: "succeeded", pages_discovered: visited.size, pages_indexed: pagesIndexed, finished_at: new Date().toISOString() }).eq("id", runId);
    await admin.from("knowledge_sources").update({ status: "indexed", canonical_url: startUrl.toString(), last_successful_at: new Date().toISOString(), last_error_code: null }).eq("id", sourceId).eq("tenant_id", tenantId);
    await emitWebhook(admin, tenantId, "knowledge.indexed", { source_id: sourceId, pages_indexed: pagesIndexed, characters_indexed: charsIndexed });
    return json({ ok: true, source_id: sourceId, pages_discovered: visited.size, pages_readable: pagesReadable, pages_indexed: pagesIndexed, duplicates_skipped: duplicatesSkipped, thin_pages_skipped: thinPagesSkipped, fetch_failures: fetchFailures, characters_indexed: charsIndexed, message: "Source crawl completed with content extraction and duplicate filtering. No general internet search was performed." });
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
