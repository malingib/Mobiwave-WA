import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { decryptToken, verifyMetaSignature } from "../_shared/meta.ts";
import { emitWebhook } from "../_shared/customer-webhooks.ts";
import { corsHeaders, json } from "../_shared/cors.ts";

const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") || "v23.0";
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
async function sha256(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method === "GET") {
    const url = new URL(request.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const legacyExpected = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN");
    const tokenHash = token ? await sha256(token) : "";
    const { data: matchingTenant } = tokenHash ? await admin.from("meta_integrations").select("tenant_id").eq("webhook_verify_token_hash", tokenHash).limit(1).maybeSingle() : { data: null };
    if (mode === "subscribe" && challenge && ((matchingTenant && tokenHash) || (legacyExpected && token === legacyExpected))) return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    return new Response("Forbidden", { status: 403 });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const rawBody = await request.text();
  if (!(await verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256")))) return json({ error: "Invalid Meta webhook signature." }, 401);
  let body: any;
  try { body = JSON.parse(rawBody); } catch { return json({ error: "Invalid JSON." }, 400); }
  if (body.object !== "whatsapp_business_account") return json({ received: true, ignored: true });
  try {
    for (const entry of body.entry ?? []) for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const phoneNumberId = String(value.metadata?.phone_number_id ?? "");
      if (!phoneNumberId) continue;
      const { data: integration } = await admin.from("meta_integrations").select("*").eq("phone_number_id", phoneNumberId).eq("enabled", true).maybeSingle();
      if (!integration) continue;
      const tenantId = integration.tenant_id;
      for (const message of value.messages ?? []) {
        const from = String(message.from ?? "");
        if (!/^\d{8,15}$/.test(from)) continue;
        const phone = "+" + from;
        const metaId = String(message.id ?? "");
        if (!metaId) continue;
        const { data: existing } = await admin.from("messages").select("id").eq("tenant_id", tenantId).eq("meta_message_id", metaId).maybeSingle();
        if (existing) continue;
        const profile = (value.contacts ?? []).find((c: any) => c.wa_id === from);
        const { data: oldContact } = await admin.from("contacts").select("id,consent_status").eq("tenant_id", tenantId).eq("phone_e164", phone).maybeSingle();
        let contact: any;
        if (oldContact) {
          const { data } = await admin.from("contacts").update({ display_name: profile?.profile?.name ?? undefined, updated_at: new Date().toISOString() }).eq("id", oldContact.id).select("id,consent_status").single();
          contact = data ?? oldContact;
        } else {
          const { data, error } = await admin.from("contacts").insert({ tenant_id: tenantId, phone_e164: phone, display_name: profile?.profile?.name ?? null, consent_status: "unknown" }).select("id,consent_status").single();
          if (error) throw error;
          contact = data;
        }
        const messageType = ["text", "image", "audio", "video", "document", "interactive"].includes(String(message.type)) ? String(message.type) : "unknown";
        const media = ["image", "audio", "video", "document"].includes(messageType) ? message[messageType] ?? {} : {};
        const text = messageType === "text" ? String(message.text?.body ?? "") : String(media.caption ?? "") || "[" + String(message.type ?? "unknown") + " message]";
        const normalized = text.trim().toLowerCase().replace(/[.!?,]+$/g, "").replace(/\s+/g, " ");
        if (/^(stop|stop all|unsubscribe( me)?|opt ?out|cancel|end|quit|remove me|do not (message|text) me|don't (message|text) me)$/.test(normalized)) {
          await admin.from("contacts").update({ consent_status: "opted_out", consent_source: "WhatsApp opt-out keyword: " + text.trim().slice(0, 80), opted_out_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", contact.id).eq("tenant_id", tenantId);
          contact.consent_status = "opted_out";
        }
        const { data: conversation, error: convError } = await admin.from("conversations").upsert({
          tenant_id: tenantId, contact_id: contact.id, status: "open", last_message_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }, { onConflict: "tenant_id,contact_id" }).select("id,bot_paused").single();
        if (convError) throw convError;
        const { error: messageError } = await admin.from("messages").insert({
          tenant_id: tenantId, conversation_id: conversation.id, direction: "inbound", actor_type: "contact",
          message_type: messageType, body: text, status: "received", meta_message_id: metaId,
          metadata: { timestamp: message.timestamp, type: message.type, media_id: media.id ?? null, mime_type: media.mime_type ?? null, filename: media.filename ?? null },
        });
        if (messageError) throw messageError;
        await emitWebhook(admin, tenantId, "message.inbound", {
          message_id: metaId, conversation_id: conversation.id, contact: { phone_e164: phone, display_name: profile?.profile?.name ?? null },
          message: { type: message.type, text: text.slice(0, 3000), timestamp: message.timestamp },
        }, false);
        await admin.from("conversations").update({ last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", conversation.id);
      }
      for (const status of value.statuses ?? []) {
        const statusName = String(status.status ?? "");
        const metaId = String(status.id ?? "");
        if (!metaId) continue;
        const mapped = ["sent", "delivered", "read", "failed"].includes(statusName) ? statusName : null;
        if (!mapped) continue;
        await admin.from("messages").update({ status: mapped, metadata: { status_timestamp: status.timestamp, errors: status.errors ?? [] } }).eq("tenant_id", tenantId).eq("meta_message_id", metaId);
        await emitWebhook(admin, tenantId, "message.status", { message_id: metaId, status: mapped, timestamp: status.timestamp, errors: status.errors ?? [] }, false);
        const column = mapped === "delivered" ? "delivered_at" : mapped === "read" ? "read_at" : null;
        if (column) await admin.from("campaign_recipients").update({ status: mapped, [column]: new Date().toISOString() }).eq("tenant_id", tenantId).eq("meta_message_id", metaId);
      }
    }
    return json({ received: true });
  } catch (error) {
    console.error("Meta webhook processing failed:", error instanceof Error ? error.message : "unknown");
    // Return a non-2xx response so Meta may retry; writes are idempotent by Meta message ID.
    return json({ error: "Webhook processing failed. The event can be retried." }, 500);
  }
});
