import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { decryptToken } from "./meta.ts";

function ipv4Private(ip: string) {
  const p = ip.split(".").map(Number);
  return p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255) ||
    p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 ||
    (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
    (p[0] === 198 && (p[1] === 18 || p[1] === 19));
}
function ipv6Private(ip: string) {
  const value = ip.toLowerCase().split("%")[0];
  return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") ||
    /^fe[89ab]/.test(value) || value.startsWith("ff") || value.startsWith("::ffff:");
}
export async function validateWebhookUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new Error("Webhook endpoints must use HTTPS on the standard port and cannot contain credentials.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".test")) throw new Error("Private or local webhook hosts are not allowed.");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) throw new Error("Webhook endpoints must use a public DNS hostname, not an IP literal.");
  let addresses: string[] = [];
  try { addresses.push(...await Deno.resolveDns(host, "A")); } catch { /* try AAAA */ }
  try { addresses.push(...await Deno.resolveDns(host, "AAAA")); } catch { /* ignore empty AAAA */ }
  if (!addresses.length || addresses.some((ip) => ip.includes(":") ? ipv6Private(ip) : ipv4Private(ip))) throw new Error("Webhook host does not resolve exclusively to public IP addresses.");
  return url;
}

async function hmac(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return "sha256=" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function readExcerpt(response: Response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (text.length < 1000) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.length >= 1000) break;
    }
  } finally { try { await reader.cancel(); } catch { /* already closed */ } }
  return text.slice(0, 1000);
}

export async function deliverWebhook(admin: SupabaseClient, deliveryId: string) {
  const { data: delivery, error } = await admin.from("webhook_deliveries").select("id,tenant_id,webhook_id,event_type,payload,attempt_count").eq("id", deliveryId).maybeSingle();
  if (error || !delivery) return { ok: false, error: "Delivery record not found." };
  const { data: hook } = await admin.from("tenant_webhooks").select("id,endpoint_url,encrypted_secret,enabled").eq("id", delivery.webhook_id).eq("tenant_id", delivery.tenant_id).maybeSingle();
  if (!hook || !hook.enabled) {
    await admin.from("webhook_deliveries").update({ status: "dead", last_error: "Webhook disabled or deleted." }).eq("id", deliveryId);
    return { ok: false, error: "Webhook disabled." };
  }
  const attempt = Number(delivery.attempt_count ?? 0) + 1;
  try {
    const url = await validateWebhookUrl(hook.endpoint_url);
    const body = JSON.stringify({
      id: delivery.id, type: delivery.event_type, created_at: new Date().toISOString(), data: delivery.payload,
    });
    const secret = await decryptToken(hook.encrypted_secret);
    const response = await fetch(url.toString(), {
      method: "POST", redirect: "manual", headers: {
        "Content-Type": "application/json", "X-MobiWave-Event": delivery.event_type,
        "X-MobiWave-Delivery": delivery.id, "X-MobiWave-Signature": await hmac(secret, body),
        "User-Agent": "MobiWave-Webhooks/1.0",
      }, body, signal: AbortSignal.timeout(10000),
    });
    const excerpt = await readExcerpt(response);
    if (response.status >= 200 && response.status < 300) {
      await admin.from("webhook_deliveries").update({ status: "delivered", attempt_count: attempt, response_status: response.status, response_excerpt: excerpt, delivered_at: new Date().toISOString(), last_error: null }).eq("id", deliveryId);
      await admin.from("tenant_webhooks").update({ last_delivery_at: new Date().toISOString(), last_status: "delivered", last_error: null }).eq("id", hook.id);
      return { ok: true };
    }
    throw new Error("Endpoint returned HTTP " + response.status + (response.status >= 300 && response.status < 400 ? " (redirects are blocked)" : ""));
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Webhook delivery failed.";
    const dead = attempt >= 8;
    const delayMinutes = Math.min(60, Math.pow(2, Math.min(attempt, 6)));
    await admin.from("webhook_deliveries").update({
      status: dead ? "dead" : "failed", attempt_count: attempt,
      next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(), last_error: message,
    }).eq("id", deliveryId);
    await admin.from("tenant_webhooks").update({ last_delivery_at: new Date().toISOString(), last_status: dead ? "dead" : "failed", last_error: message }).eq("id", hook.id);
    return { ok: false, error: message, retrying: !dead };
  }
}

export async function emitWebhook(admin: SupabaseClient, tenantId: string, eventType: string, payload: unknown, immediate = true) {
  const { data: hooks, error } = await admin.from("tenant_webhooks").select("id").eq("tenant_id", tenantId).eq("enabled", true).contains("events", [eventType]);
  if (error || !hooks?.length) return;
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const stableEvent = ["message.inbound","message.status","message.outbound","campaign.completed"].includes(eventType);
  const base = stableEvent
    ? String(record.message_id ?? record.campaign_id ?? crypto.randomUUID())
    : crypto.randomUUID();
  const eventKey = eventType + ":" + base + (record.status ? ":" + String(record.status) : "");
  const queued = await Promise.all(hooks.map(async (hook: any) => {
    const { data: delivery, error: insertError } = await admin.from("webhook_deliveries").upsert({
      tenant_id: tenantId, webhook_id: hook.id, event_type: eventType, event_key: eventKey, payload, status: "queued",
    }, { onConflict: "webhook_id,event_key", ignoreDuplicates: true }).select("id").maybeSingle();
    return !insertError && delivery ? delivery.id as string : null;
  }));
  if (immediate) await Promise.all(queued.filter(Boolean).map((id) => deliverWebhook(admin, id as string)));
}
