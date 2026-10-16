import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { decryptToken } from "../_shared/meta.ts";
import { emitWebhook } from "../_shared/customer-webhooks.ts";
import { corsHeaders, json } from "../_shared/cors.ts";

const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") || "v23.0";
async function hash(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const suppliedKey = request.headers.get("x-api-key") ?? request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!suppliedKey.startsWith("mw_live_") || suppliedKey.length < 40) return json({ error: "A valid MobiWave API key is required." }, 401);
    const url = Deno.env.get("SUPABASE_URL")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: apiKey } = await admin.from("tenant_api_keys").select("id,tenant_id,scopes,expires_at,revoked_at").eq("secret_hash", await hash(suppliedKey)).maybeSingle();
    if (!apiKey || apiKey.revoked_at || (apiKey.expires_at && new Date(apiKey.expires_at).getTime() < Date.now()) || !apiKey.scopes?.includes("messages:send")) return json({ error: "API key is invalid, expired, revoked or lacks permission." }, 401);
    const tenantId = apiKey.tenant_id;
    const body = await request.json();
    const to = String(body.to ?? ""), templateName = String(body.template_name ?? ""), language = String(body.language_code ?? "en");
    if (!/^\+[1-9][0-9]{7,14}$/.test(to) || !/^[a-z0-9_]{1,512}$/.test(templateName)) return json({ error: "Use an E.164 recipient and an approved template name." }, 400);
    const { data: limits } = await admin.from("tenant_usage_limits").select("monthly_message_limit").eq("tenant_id", tenantId).maybeSingle();
    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0,0,0,0);
    const { count: used } = await admin.from("usage_events").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("event_type", "message_submitted").gte("occurred_at", monthStart.toISOString());
    if ((used ?? 0) >= (limits?.monthly_message_limit ?? 1000)) return json({ error: "This workspace has reached its monthly message limit." }, 429);
    const { data: contact } = await admin.from("contacts").select("id,consent_status").eq("tenant_id", tenantId).eq("phone_e164", to).maybeSingle();
    if (!contact || contact.consent_status !== "opted_in") return json({ error: "Recipient must exist in contacts with recorded opt-in consent." }, 403);
    const { data: template } = await admin.from("wa_templates").select("meta_status,components,language_code").eq("tenant_id", tenantId).eq("meta_template_name", templateName).eq("language_code", language).maybeSingle();
    if (!template || template.meta_status !== "approved") return json({ error: "Only approved Meta templates can be sent through the public API." }, 403);
    const { data: integration } = await admin.from("meta_integrations").select("phone_number_id,encrypted_access_token").eq("tenant_id", tenantId).eq("enabled", true).maybeSingle();
    if (!integration?.phone_number_id || !integration.encrypted_access_token) return json({ error: "Official Meta Cloud API is not connected." }, 409);
    const response = await fetch("https://graph.facebook.com/" + GRAPH_VERSION + "/" + integration.phone_number_id + "/messages", {
      method: "POST", headers: { "Authorization": "Bearer " + await decryptToken(integration.encrypted_access_token), "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: to.slice(1), type: "template", template: { name: templateName, language: { code: language }, components: Array.isArray(body.components) ? body.components : [] } }),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok || !result.messages?.[0]?.id) {
      console.error("API send failed at Meta", response.status, JSON.stringify(result).slice(0,500));
      await admin.from("usage_events").insert({ tenant_id: tenantId, event_type: "api_request", quantity: 1, reference_id: apiKey.id, metadata: { outcome: "meta_rejected" } });
      return json({ error: "Meta rejected the message. Verify the template and WhatsApp account." }, 502);
    }
    const metaMessageId = result.messages[0].id;
    const { data: conversation } = await admin.from("conversations").upsert({ tenant_id: tenantId, contact_id: contact.id, status: "open", last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "tenant_id,contact_id" }).select("id").single();
    if (conversation) await admin.from("messages").insert({ tenant_id: tenantId, conversation_id: conversation.id, direction: "outbound", actor_type: "agent", message_type: "template", body: "[Template: " + templateName + "]", status: "sent", meta_message_id: metaMessageId });
    await admin.from("usage_events").insert([
      { tenant_id: tenantId, event_type: "message_submitted", quantity: 1, reference_id: metaMessageId, metadata: { channel: "api" } },
      { tenant_id: tenantId, event_type: "api_request", quantity: 1, reference_id: apiKey.id, metadata: { outcome: "sent_to_meta" } },
    ]);
    await admin.from("tenant_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", apiKey.id);
    await emitWebhook(admin, tenantId, "message.outbound", { message_id: metaMessageId, to, template_name: templateName, status: "sent_to_meta" });
    return json({ ok: true, message_id: metaMessageId, status: "sent_to_meta" });
  } catch (error) {
    console.error("Public API send error:", error instanceof Error ? error.message : "unknown");
    return json({ error: "Request could not be processed." }, 400);
  }
});
