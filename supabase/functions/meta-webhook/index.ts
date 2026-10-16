import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { retrieveApprovedContext, buildGroundedPrompt } from "../_shared/knowledge.ts";
import { decryptToken, verifyMetaSignature } from "../_shared/meta.ts";
import { emitWebhook } from "../_shared/customer-webhooks.ts";
import { corsHeaders, json } from "../_shared/cors.ts";

const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") || "v23.0";
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method === "GET") {
    const url = new URL(request.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const expected = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN");
    if (mode === "subscribe" && expected && token === expected && challenge) return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
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
        const text = message.type === "text" ? String(message.text?.body ?? "") : "[" + String(message.type ?? "unknown") + " message]";
        const normalized = text.trim().toLowerCase();
        if (/^(stop|unsubscribe|opt out|opt-out|cancel|end)$/.test(normalized)) {
          await admin.from("contacts").update({ consent_status: "opted_out", opted_out_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", contact.id).eq("tenant_id", tenantId);
          contact.consent_status = "opted_out";
        }
        const { data: conversation, error: convError } = await admin.from("conversations").upsert({
          tenant_id: tenantId, contact_id: contact.id, status: "open", last_message_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }, { onConflict: "tenant_id,contact_id" }).select("id,bot_paused").single();
        if (convError) throw convError;
        const { error: messageError } = await admin.from("messages").insert({
          tenant_id: tenantId, conversation_id: conversation.id, direction: "inbound", actor_type: "contact",
          message_type: message.type === "text" ? "text" : "unknown", body: text, status: "received", meta_message_id: metaId,
          metadata: { timestamp: message.timestamp, type: message.type },
        });
        if (messageError) throw messageError;
        await emitWebhook(admin, tenantId, "message.inbound", {
          message_id: metaId, conversation_id: conversation.id, contact: { phone_e164: phone, display_name: profile?.profile?.name ?? null },
          message: { type: message.type, text: text.slice(0, 3000), timestamp: message.timestamp },
        });
        await admin.from("conversations").update({ last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", conversation.id);

        // Explicit opt-in is required before proactive campaigns. Inbound messages open a customer-service window,
        // but do not by themselves opt a contact into future marketing campaigns.
        if (contact.consent_status === "opted_out" || conversation.bot_paused || message.type !== "text") continue;
        const { data: settings } = await admin.from("tenant_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
        if (!settings?.ai_enabled) continue;
        const apiKey = Deno.env.get("OPENAI_API_KEY");
        if (!apiKey) continue;
        const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0,0,0,0);
        const [{ data: limits }, { count: aiUsed }] = await Promise.all([
          admin.from("tenant_usage_limits").select("monthly_ai_request_limit").eq("tenant_id", tenantId).maybeSingle(),
          admin.from("usage_events").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("event_type", "ai_request").gte("occurred_at", monthStart.toISOString()),
        ]);
        if ((aiUsed ?? 0) >= (limits?.monthly_ai_request_limit ?? 500)) continue;
        const context = await retrieveApprovedContext(admin, tenantId, text);
        if (!context.sources.length && !context.memories.length) {
          if (settings.human_handoff_enabled) await admin.from("conversations").update({ bot_paused: true, status: "pending" }).eq("id", conversation.id);
          continue;
        }
        const prompt = buildGroundedPrompt(text, context, settings.system_instructions ?? "");
        let aiResponse: Response;
        try {
          aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST", headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({ model: settings.ai_model || Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini", temperature: 0.1, max_tokens: settings.max_ai_reply_tokens ?? 500, response_format: { type: "json_object" }, messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }] }),
            signal: AbortSignal.timeout(16000),
          });
        } catch { continue; }
        await admin.from("usage_events").insert({ tenant_id: tenantId, event_type: "ai_request", quantity: 1, metadata: { channel: "inbound_chatbot" } });
        if (!aiResponse.ok) continue;
        const aiPayload = await aiResponse.json();
        let ai: any;
        try { ai = JSON.parse(aiPayload.choices?.[0]?.message?.content ?? "{}"); } catch { ai = {}; }
        const answer = typeof ai.answer === "string" ? ai.answer.trim().slice(0, 3000) : "";
        const evidence = Array.isArray(ai.evidence) ? ai.evidence.filter((v: unknown) => typeof v === "string").slice(0, 6) : [];
        if (ai.handoff === true || !answer || !evidence.some((ref: string) => prompt.allowedEvidence.includes(ref))) {
          if (settings.human_handoff_enabled) await admin.from("conversations").update({ bot_paused: true, status: "pending" }).eq("id", conversation.id);
          continue;
        }
        const token = await decryptToken(integration.encrypted_access_token);
        const send = await fetch("https://graph.facebook.com/" + GRAPH_VERSION + "/" + phoneNumberId + "/messages", {
          method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify({ messaging_product: "whatsapp", to: from, type: "text", text: { preview_url: false, body: answer } }),
          signal: AbortSignal.timeout(15000),
        });
        const sendResult = await send.json();
        if (send.ok && sendResult.messages?.[0]?.id) await admin.from("messages").insert({
          tenant_id: tenantId, conversation_id: conversation.id, direction: "outbound", actor_type: "bot", message_type: "text",
          body: answer, status: "sent", meta_message_id: sendResult.messages[0].id, metadata: { evidence, model: settings.ai_model || "gpt-4o-mini" },
        });
      }
      for (const status of value.statuses ?? []) {
        const statusName = String(status.status ?? "");
        const metaId = String(status.id ?? "");
        if (!metaId) continue;
        const mapped = ["sent", "delivered", "read", "failed"].includes(statusName) ? statusName : null;
        if (!mapped) continue;
        await admin.from("messages").update({ status: mapped, metadata: { status_timestamp: status.timestamp, errors: status.errors ?? [] } }).eq("tenant_id", tenantId).eq("meta_message_id", metaId);
        await emitWebhook(admin, tenantId, "message.status", { message_id: metaId, status: mapped, timestamp: status.timestamp, errors: status.errors ?? [] });
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
