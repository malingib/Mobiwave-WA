import { requireUser, requireTenantRole } from "../_shared/auth.ts";
import { decryptToken } from "../_shared/meta.ts";
import { corsHeaders, json, errorMessage } from "../_shared/cors.ts";

const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") || "v23.0";
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const auth = await requireUser(request);
    const body = await request.json();
    const tenantId = String(body.tenant_id ?? ""), to = String(body.to ?? "");
    const type = body.type === "template" ? "template" : "text";
    if (!tenantId || !/^\+[1-9][0-9]{7,14}$/.test(to)) return json({ error: "A tenant_id and E.164 recipient phone number are required." }, 400);
    await requireTenantRole(auth.admin, tenantId, auth.userId, ["owner", "admin", "agent"]);
    const { data: integration, error: integrationError } = await auth.admin.from("meta_integrations").select("*").eq("tenant_id", tenantId).eq("enabled", true).maybeSingle();
    if (integrationError || !integration?.encrypted_access_token || !integration.phone_number_id) return json({ error: "Official Meta Cloud API is not configured and enabled for this workspace." }, 409);
    const { data: contact } = await auth.admin.from("contacts").select("id,consent_status").eq("tenant_id", tenantId).eq("phone_e164", to).maybeSingle();
    if (!contact) return json({ error: "Recipient must exist in this workspace's contacts." }, 404);
    if (contact.consent_status === "opted_out") return json({ error: "This contact opted out and is suppressed." }, 403);

    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0,0,0,0);
    const [{ data: limits }, { count: used }] = await Promise.all([
      auth.admin.from("tenant_usage_limits").select("monthly_message_limit").eq("tenant_id", tenantId).maybeSingle(),
      auth.admin.from("usage_events").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("event_type", "message_submitted").gte("occurred_at", monthStart.toISOString()),
    ]);
    if ((used ?? 0) >= (limits?.monthly_message_limit ?? 1000)) return json({ error: "This workspace has reached its monthly message limit." }, 429);
    let payload: any;
    if (type === "template") {
      if (contact.consent_status !== "opted_in") return json({ error: "Template messages require recorded opt-in consent." }, 403);
      const name = String(body.template_name ?? "");
      const language = String(body.language_code ?? "en");
      if (!/^[a-z0-9_]{1,512}$/.test(name) || !/^[a-zA-Z_]{2,10}(-[a-zA-Z0-9]{2,10})?$/.test(language)) return json({ error: "Invalid template name or language code." }, 400);
      const { data: template } = await auth.admin.from("wa_templates").select("meta_status,components,category").eq("tenant_id", tenantId).eq("meta_template_name", name).eq("language_code", language).maybeSingle();
      if (!template || template.meta_status !== "approved") return json({ error: "Only Meta-approved templates can be sent outside the customer-service window." }, 403);
      payload = { messaging_product: "whatsapp", to: to.replace("+", ""), type: "template", template: { name, language: { code: language }, components: Array.isArray(body.components) ? body.components : [] } };
    } else {
      const text = String(body.text ?? "").trim();
      if (!text || text.length > 4000) return json({ error: "Text must contain 1–4,000 characters." }, 400);
      const { data: conversation } = await auth.admin.from("conversations").select("id").eq("tenant_id", tenantId).eq("contact_id", contact.id).maybeSingle();
      if (!conversation) return json({ error: "An active conversation is required for free-form replies." }, 409);
      const { data: inbound } = await auth.admin.from("messages").select("created_at").eq("tenant_id", tenantId).eq("conversation_id", conversation.id).eq("direction", "inbound").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!inbound || Date.now() - new Date(inbound.created_at).getTime() > 24 * 60 * 60 * 1000) return json({ error: "Free-form messages are only allowed within the 24-hour customer-service window. Use an approved template instead." }, 403);
      payload = { messaging_product: "whatsapp", to: to.replace("+", ""), type: "text", text: { preview_url: false, body: text } };
    }

    const token = await decryptToken(integration.encrypted_access_token);
    const response = await fetch("https://graph.facebook.com/" + GRAPH_VERSION + "/" + integration.phone_number_id + "/messages", {
      method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok) {
      console.error("Meta send failed", response.status, JSON.stringify(result).slice(0, 1000));
      return json({ error: "Meta rejected the message. Check the integration and template status." }, 502);
    }
    const metaMessageId = result.messages?.[0]?.id;
    const { data: conversation } = await auth.admin.from("conversations").select("id").eq("tenant_id", tenantId).eq("contact_id", contact.id).maybeSingle();
    if (conversation && metaMessageId) await auth.admin.from("messages").insert({
      tenant_id: tenantId, conversation_id: conversation.id, direction: "outbound",
      actor_type: "agent", message_type: type, body: type === "text" ? payload.text.body : "[Template: " + payload.template.name + "]",
      status: "sent", meta_message_id: metaMessageId, metadata: { meta_status: "accepted" },
    });
    await auth.admin.from("usage_events").insert({ tenant_id: tenantId, event_type: "message_submitted", quantity: 1, reference_id: metaMessageId ?? null, metadata: { channel: "agent" } });
    return json({ ok: true, message_id: metaMessageId ?? null, status: "sent_to_meta" });
  } catch (error) {
    const message = errorMessage(error);
    return json({ error: message }, /sign in|session is invalid/i.test(message) ? 401 : /permission/i.test(message) ? 403 : 400);
  }
});
