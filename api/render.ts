import type { VercelRequest, VercelResponse } from "@vercel/node";
import chromium from "@sparticuz/chromium";
import { chromium as playwright } from "playwright-core";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_HTML = 1_000_000;
const NAV_TIMEOUT = 12_000;

function privateIPv4(ip: string) {
  const p = ip.split(".").map(Number);
  return p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255) ||
    p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 ||
    (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
}
function privateIPv6(ip: string) {
  const s = ip.toLowerCase();
  return s === "::" || s === "::1" || s.startsWith("fc") || s.startsWith("fd") ||
    /^fe[89ab]/.test(s) || s.startsWith("ff") || s.startsWith("::ffff:") || s.startsWith("2001:db8:");
}
async function assertPublicHost(host: string) {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (!normalized || normalized === "localhost" || normalized.endsWith(".localhost") ||
      normalized.endsWith(".local") || normalized.endsWith(".internal")) throw new Error("Local hosts are blocked.");
  const ipType = isIP(normalized);
  if (ipType === 4 && privateIPv4(normalized)) throw new Error("Private IP addresses are blocked.");
  if (ipType === 6 && privateIPv6(normalized)) throw new Error("Private IP addresses are blocked.");
  if (!ipType) {
    const records = await lookup(normalized, { all: true, verbatim: true });
    if (!records.length || records.some((r) => r.family === 4 ? privateIPv4(r.address) : privateIPv6(r.address))) {
      throw new Error("Host must resolve only to public IP addresses.");
    }
  }
}
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST required." });
  const secret = process.env.CRAWL_RENDERER_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: "Unauthorized." });
  const rawUrl = typeof req.body?.url === "string" ? req.body.url : "";
  let target: URL;
  try {
    target = new URL(rawUrl);
    if (!["http:", "https:"].includes(target.protocol) || target.username || target.password ||
        (target.port && !["80", "443"].includes(target.port))) throw new Error("Only standard public HTTP(S) URLs are supported.");
    await assertPublicHost(target.hostname);
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Invalid URL." });
  }
  let browser: Awaited<ReturnType<typeof playwright.launch>> | undefined;
  try {
    browser = await playwright.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
    const context = await browser.newContext({ javaScriptEnabled: true, serviceWorkers: "block" });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(NAV_TIMEOUT);
    await page.route("**/*", async (route) => {
      const requestUrl = route.request().url();
      try {
        const u = new URL(requestUrl);
        if (!["http:", "https:"].includes(u.protocol)) return route.abort();
        // The renderer only visits the submitted host; subresources from other hosts are dropped.
        if (u.hostname !== target.hostname) return route.abort();
        await assertPublicHost(u.hostname);
        if (["image", "media", "font"].includes(route.request().resourceType())) return route.abort();
        return route.continue();
      } catch { return route.abort(); }
    });
    await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
    const result = await page.evaluate((limit) => {
      const html = document.documentElement?.outerHTML ?? "";
      const links = [...document.querySelectorAll("a[href]")].map((a) => (a as HTMLAnchorElement).href).filter(Boolean).slice(0, 500);
      return { html: html.slice(0, limit), title: document.title || "", finalUrl: location.href, links };
    }, MAX_HTML);
    const finalUrl = new URL(result.finalUrl);
    if (finalUrl.hostname !== target.hostname) return res.status(422).json({ error: "Cross-host navigation blocked." });
    return res.status(200).json({ ...result, rendered: true });
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message.slice(0, 300) : "Rendering failed." });
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
