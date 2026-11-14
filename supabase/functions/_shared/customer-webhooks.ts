import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { checkTenantFeature } from "./auth.ts";
import { decryptToken } from "./meta.ts";

function ipv4Private(ip: string) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  return p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224
    || (p[0] === 169 && p[1] === 254)
    || (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
    || (p[0] === 192 && ((p[1] === 0 && (p[2] === 0 || p[2] === 2)) || (p[1] === 88 && p[2] === 99) || p[1] === 168))
    || (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
    || (p[0] === 198 && ((p[1] === 18 || p[1] === 19) || (p[1] === 51 && p[2] === 100)))
    || (p[0] === 203 && p[1] === 0 && p[2] === 113);
}
function ipv6Private(ip: string) {
  let value = ip.toLowerCase().split("%")[0];
  if (value.includes(".")) {
    const split = value.lastIndexOf(":");
    const octets = value.slice(split + 1).split(".").map(Number);
    if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    value = value.slice(0, split) + ":" + ((octets[0] << 8) | octets[1]).toString(16) + ":" + ((octets[2] << 8) | octets[3]).toString(16);
  }
  const halves = value.split("::");
  if (halves.length > 2) return true;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return true;
  const groups = [...left, ...Array(missing).fill("0"), ...right].map((part) => Number.parseInt(part || "0", 16));
  if (groups.length !== 8 || groups.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff)) return true;
  // Accept only global unicast 2000::/3. This excludes mapped, local, multicast,
  // unspecified, NAT64, and other non-global IPv6 ranges by default.
  if ((groups[0] & 0xe000) !== 0x2000) return true;
  if (groups[0] === 0x2001 && (groups[1] <= 0x01ff || groups[1] === 0x0db8 || (groups[1] === 0x0020 && (groups[2] & 0xf000) === 0))) return true;
  return groups[0] === 0x2002; // 6to4 embeds an IPv4 destination.
}
async function resolveWebhookEndpoint(raw: string): Promise<{ url: URL; addresses: string[] }> {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new Error("Webhook endpoints must use HTTPS on the standard port and cannot contain credentials.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".test")) throw new Error("Private or local webhook hosts are not allowed.");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) throw new Error("Webhook endpoints must use a public DNS hostname, not an IP literal.");
  let addresses: string[] = [];
  try { addresses.push(...await Deno.resolveDns(host, "A")); } catch {}
  try { addresses.push(...await Deno.resolveDns(host, "AAAA")); } catch {}
  if (!addresses.length || addresses.some((ip) => ip.includes(":") ? ipv6Private(ip) : ipv4Private(ip))) throw new Error("Webhook host does not resolve exclusively to public IP addresses.");
  return { url, addresses };
}
export async function validateWebhookUrl(raw: string): Promise<URL> {
  return (await resolveWebhookEndpoint(raw)).url;
}
async function hmac(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return "sha256=" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function writeAll(conn: Deno.Conn, bytes: Uint8Array) {
  let offset = 0;
  while (offset < bytes.length) {
    const written = await conn.write(bytes.subarray(offset));
    if (written <= 0) throw new Error("Webhook request could not be written completely.");
    offset += written;
  }
}

async function requestPinnedWebhook(url: URL, address: string, headers: Record<string, string>, body: string) {
  const connection: { current: Deno.Conn | null } = { current: null };
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      try { connection.current?.close(); } catch {}
      reject(new Error("Webhook request timed out."));
    }, 10000);
  });
  const request = async () => {
    const tcp = await Deno.connect({ hostname: address, port: 443 });
    connection.current = tcp;
    if (timedOut) { tcp.close(); throw new Error("Webhook request timed out."); }
    const tls = await Deno.startTls(tcp, { hostname: url.hostname, alpnProtocols: ["http/1.1"] });
    connection.current = tls;
    if (timedOut) { tls.close(); throw new Error("Webhook request timed out."); }
    const target = url.pathname + url.search;
    const head = [`POST ${target || "/"} HTTP/1.1`, `Host: ${url.host}`, ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`), `Content-Length: ${new TextEncoder().encode(body).length}`, "Connection: close", "", ""].join("\r\n");
    await writeAll(tls, new TextEncoder().encode(head + body));

    const chunks: Uint8Array[] = [];
    let total = 0;
    let responseHeaders = "";
    while (total < 16 * 1024) {
      const chunk = new Uint8Array(Math.min(4096, 16 * 1024 - total));
      const count = await tls.read(chunk);
      if (count === null) break;
      chunks.push(chunk.subarray(0, count));
      total += count;
      const combined = new Uint8Array(total);
      let offset = 0;
      for (const part of chunks) { combined.set(part, offset); offset += part.length; }
      responseHeaders = new TextDecoder().decode(combined);
      if (responseHeaders.includes("\r\n\r\n")) break;
    }
    const statusLine = responseHeaders.split("\r\n", 1)[0];
    const match = /^HTTP\/1\.[01] (\d{3})(?: .*)?$/.exec(statusLine);
    if (!match) throw new Error("Webhook endpoint returned an invalid HTTP response.");
    return { status: Number(match[1]), excerpt: "" };
  };
  try {
    return await Promise.race([request(), timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    try { connection.current?.close(); } catch {}
  }
}

export async function deliverWebhook(admin: SupabaseClient, deliveryId: string) {
  const { data: claims, error: claimError } = await admin.rpc("claim_customer_webhook_delivery", { p_delivery_id: deliveryId });
  if (claimError) return { ok: false, error: "Could not claim webhook delivery." };
  const delivery = Array.isArray(claims) ? claims[0] : claims;
  if (!delivery) return { ok: false, skipped: true, error: "Delivery already claimed, not due, or terminal." };
  const token = delivery.lease_token as string;
  const attempt = Number(delivery.attempt_count ?? 1);
  const finish = async (values: Record<string, unknown>) => {
    const { data, error } = await admin.from("webhook_deliveries").update({ ...values, lease_token: null, lease_expires_at: null, updated_at: new Date().toISOString() }).eq("id", deliveryId).eq("status", "processing").eq("lease_token", token).select("id").maybeSingle();
    return !error && Boolean(data);
  };
  const feature = await checkTenantFeature(admin, delivery.tenant_id, "webhooks");
  if (feature.error) {
    const saved = await finish({ status: "failed", next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString(), last_error: feature.error });
    return saved ? { ok: false, retrying: true, error: feature.error } : { ok: false, skipped: true, error: "Delivery lease was superseded." };
  }
  if (!feature.allowed) {
    const saved = await finish({ status: "dead", last_error: "Customer webhooks are not included in this workspace's active tier." });
    return saved ? { ok: false, error: "Customer webhooks are not included in this workspace's active tier." } : { ok: false, skipped: true, error: "Delivery lease was superseded." };
  }
  let hook: any = null;
  try {
    const { data, error: hookError } = await admin.from("tenant_webhooks").select("id,endpoint_url,encrypted_secret,enabled").eq("id", delivery.webhook_id).eq("tenant_id", delivery.tenant_id).maybeSingle();
    if (hookError) throw hookError;
    hook = data;
    if (!hook || !hook.enabled) {
      const saved = await finish({ status: "dead", last_error: "Webhook disabled or deleted." });
      if (!saved) return { ok: false, skipped: true, error: "Delivery lease was superseded." };
      return { ok: false, error: "Webhook disabled." };
    }
    const { url, addresses } = await resolveWebhookEndpoint(hook.endpoint_url);
    const body = JSON.stringify({ id: delivery.id, type: delivery.event_type, created_at: delivery.created_at, data: delivery.payload });
    const secret = await decryptToken(hook.encrypted_secret);
    if (!/^[a-z0-9._-]{1,120}$/i.test(delivery.event_type) || !/^[a-z0-9-]{1,128}$/i.test(delivery.id)) throw new Error("Webhook event metadata is invalid.");
    const response = await requestPinnedWebhook(url, addresses[0], {
      "Content-Type": "application/json",
      "X-MobiWave-Event": delivery.event_type,
      "X-MobiWave-Delivery": delivery.id,
      "X-MobiWave-Signature": await hmac(secret, body),
      "Idempotency-Key": delivery.id,
      "User-Agent": "MobiWave-Webhooks/1.0",
    }, body);
    if (response.status >= 200 && response.status < 300) {
      const saved = await finish({ status: "delivered", response_status: response.status, response_excerpt: response.excerpt, delivered_at: new Date().toISOString(), last_error: null });
      if (!saved) return { ok: false, skipped: true, error: "Delivery lease was superseded." };
      await admin.from("tenant_webhooks").update({ last_delivery_at: new Date().toISOString(), last_status: "delivered", last_error: null }).eq("id", hook.id);
      return { ok: true };
    }
    throw new Error("Endpoint returned HTTP " + response.status + (response.status >= 300 && response.status < 400 ? " (redirects are blocked)" : ""));
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Webhook delivery failed.";
    const dead = attempt >= 8, delayMinutes = Math.min(60, Math.pow(2, Math.min(attempt, 6)));
    const saved = await finish({ status: dead ? "dead" : "failed", next_attempt_at: new Date(Date.now() + delayMinutes * 60000).toISOString(), last_error: message });
    if (!saved) return { ok: false, skipped: true, error: "Delivery lease was superseded." };
    if (hook?.id) await admin.from("tenant_webhooks").update({ last_delivery_at: new Date().toISOString(), last_status: dead ? "dead" : "failed", last_error: message }).eq("id", hook.id);
    return { ok: false, error: message, retrying: !dead };
  }
}

export async function emitWebhook(admin: SupabaseClient, tenantId: string, eventType: string, payload: unknown, immediate = true, requirePersistence = false) {
  const { data: hooks, error } = await admin.from("tenant_webhooks").select("id").eq("tenant_id", tenantId).eq("enabled", true).contains("events", [eventType]);
  if (error) {
    if (requirePersistence) throw error;
    console.error("Could not look up customer webhook subscriptions", error.code);
    return;
  }
  if (!hooks?.length) return;
  const feature = await checkTenantFeature(admin, tenantId, "webhooks");
  if (feature.error) {
    if (requirePersistence) throw new Error(feature.error);
    console.error("Could not verify customer webhook access.");
    return;
  }
  if (!feature.allowed) return;
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const stableEvent = ["message.inbound", "message.status", "message.outbound", "campaign.completed"].includes(eventType);
  const base = stableEvent ? String(record.message_id ?? record.campaign_id ?? crypto.randomUUID()) : crypto.randomUUID();
  const eventKey = eventType + ":" + base + (record.status ? ":" + String(record.status) : "");
  const queued = await Promise.all(hooks.map(async (hook: any) => {
    const { data: delivery, error: insertError } = await admin.from("webhook_deliveries").upsert({ tenant_id: tenantId, webhook_id: hook.id, event_type: eventType, event_key: eventKey, payload, status: "queued" }, { onConflict: "webhook_id,event_key", ignoreDuplicates: true }).select("id").maybeSingle();
    if (insertError) {
      if (requirePersistence) throw insertError;
      console.error("Could not queue customer webhook delivery", insertError.code);
    }
    return !insertError && delivery ? delivery.id as string : null;
  }));
  if (immediate) await Promise.all(queued.filter(Boolean).map((id) => deliverWebhook(admin, id as string)));
}
