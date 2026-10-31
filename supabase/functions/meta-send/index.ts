import { requireUser, requireTenantRole } from "../_shared/auth.ts";
import { decryptToken } from "../_shared/meta.ts";
import { emitWebhook } from "../_shared/customer-webhooks.ts";
import { corsHeaders, json, errorMessage } from "../_shared/cors.ts";

const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") || "v23.0";
async function sha256(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const auth = await requireUser(request);
    const body = await request.json();
    const tenantId = String(body.tenant_id ?? ""), to = String(body.to ?? "");
    const idempotencyKey = String(request.headers.get("idempotency-key") ?? body.idempotency_key ?? "");
    const type = body.type === "template" ? "template" : "text";
    if (!tenantId || !/^\+[1-9][0-9]{7,14}$/.test(to)) return json({ error: "A tenant_id and E.164 recipient phone number are required." }, 400);
    if (!/^[A-Za-z0-9._:-]{8,200}$/.test(idempotencyKey)) return json({ error: "Provide a stable Idempotency-Key (8–200 letters, numbers, or . _ : -) and reuse it only for this send operation." }, 400);
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
    const monthlyLimit = limits?.monthly_message_limit ?? 0;
    if (monthlyLimit > 0 && (used ?? 0) >= monthlyLimit) return json({ error: "This workspace has reached its configured monthly message limit." }, 429);

    let payload: any;
    let conversationId: string | null = null;
    if (type === "template") {
      if (contact.consent_status !== "opted_in") return json({ error: "Template messages require recorded opt-in consent." }, 403);
      const name = String(body.template_name ?? "");
      const language = String(body.language_code ?? "en");
      if (!/^[a-z0-9_]{1,512}$/.test(name) || !/^[a-zA-Z_]{2,10}(-[a-zA-Z0-9]{2,10})?$/.test(language)) return json({ error: "Invalid template name or language code." }, 400);
      const { data: template } = await auth.admin.from("wa_templates").select("meta_status,components,category").eq("tenant_id", tenantId).eq("meta_template_name", name).eq("language_code", language).maybeSingle();
      if (!template || template.meta_status !== "approved") return json({ error: "Only Meta-approved templates can be sent outside the customer-service window." }, 403);
      payload = { messaging_product: "whatsapp", to: to.replace("+", ""), type: "template", template: { name, language: { code: language }, components: Array.isArray(body.components) ? body.components : [] } };
      const { data: existingConversation } = await auth.admin.from("conversations").select("id").eq("tenant_id", tenantId).eq("contact_id", contact.id).maybeSingle();
      conversationId = existingConversation?.id ?? null;
    } else {
      const text = String(body.text ?? "").trim();
      if (!text || text.length > 4000) return json({ error: "Text must contain 1–4,000 characters." }, 400);
      const { data: conversation } = await auth.admin.from("conversations").select("id").eq("tenant_id", tenantId).eq("contact_id", contact.id).maybeSingle();
      if (!conversation) return json({ error: "An active conversation is required for free-form replies." }, 409);
      conversationId = conversation.id;
      const { data: inbound } = await auth.admin.from("messages").select("created_at").eq("tenant_id", tenantId).eq("conversation_id", conversation.id).eq("direction", "inbound").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!inbound || Date.now() - new Date(inbound.created_at).getTime() > 24 * 60 * 60 * 1000) return json({ error: "Free-form messages are only allowed within the 24-hour customer-service window. Use an approved template instead." }, 403);
      payload = { messaging_product: "whatsapp", to: to.replace("+", ""), type: "text", text: { preview_url: false, body: text } };
    }

    const requestHash = await sha256(JSON.stringify({ tenantId, contactId: contact.id, type, payload }));
    const { data: prior, error: priorError } = await auth.admin.from("outbound_send_attempts").select("request_hash,status,meta_message_id,error_detail").eq("tenant_id", tenantId).eq("idempotency_key", idempotencyKey).maybeSingle();
    if (priorError) throw priorError;
    if (prior) {
      if (prior.request_hash !== requestHash) return json({ error: "This idempotency key was already used for a different request." }, 409);
      if (prior.status === "accepted") return json({ ok: true, message_id: prior.meta_message_id, status: "sent_to_meta", idempotent_replay: true });
      if (prior.status === "rejected") return json({ error: prior.error_detail || "Meta rejected this message.", idempotent_replay: true }, 502);
      return json({ error: "A send attempt with this key is already in progress or has an unknown provider outcome. It was not resent to prevent duplicate delivery.", status: prior.status, idempotent_replay: true }, 409);
    }

    const { data: attempt, error: attemptError } = await auth.admin.from("outbound_send_attempts").insert({
      tenant_id: tenantId, idempotency_key: idempotencyKey, request_hash: requestHash,
      contact_id: contact.id, conversation_id: conversationId, message_type: type,
      request_payload: payload, status: "prepared",
    }).select("id").single();
    if (attemptError) {
      if (attemptError.code === "23505") return json({ error: "A request with this idempotency key is being processed. Retry the same key to retrieve its outcome; it will not be sent twice." }, 409);
      throw attemptError;
    }
    const { error: markError } = await auth.admin.from("outbound_send_attempts").update({ status: "submitting", attempts: 1, updated_at: new Date().toISOString() }).eq("id", attempt.id).eq("tenant_id", tenantId);
    if (markError) throw markError;

    let response: Response;
    let result: any;
    try {
      const token = await decryptToken(integration.encrypted_access_token);
      response = await fetch("https://graph.facebook.com/" + GRAPH_VERSION + "/" + integration.phone_number_id + "/messages", {
        method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
      });
      result = await response.json();
    } catch (error) {
      await auth.admin.from("outbound_send_attempts").update({ status: "outcome_unknown", error_code: "provider_transport_unknown", error_detail: "The provider request may have reached Meta; reconcile before any manual retry.", updated_at: new Date().toISOString() }).eq("id", attempt.id);
      await auth.admin.from("workspace_notifications").insert({ tenant_id: tenantId, recipient_user_id: auth.userId, category: "send_error", severity: "critical", title: "WhatsApp send outcome unknown", body: "Meta may have accepted this message, but MobiWave could not confirm the response. Do not resend. Reconcile the provider message status first.", entity_type: "outbound_send_attempt", entity_id: attempt.id, dedupe_key: "send-outcome-unknown:" + attempt.id, metadata: { error_code: "provider_transport_unknown", idempotency_key: idempotencyKey, occurred_at: new Date().toISOString() } });
      return json({ error: "Meta's outcome could not be confirmed. This request was recorded and will not be automatically resent; reconcile the outcome before retrying.", status: "outcome_unknown" }, 502);
    }
    if (!response.ok || !result.messages?.[0]?.id) {
      const detail = String(result.error?.message ?? "Meta rejected the message. Check the integration and template status.").slice(0, 500);
      const { error: rejectError } = await auth.admin.from("outbound_send_attempts").update({ status: "rejected", error_code: String(result.error?.code ?? response.status), error_detail: detail, updated_at: new Date().toISOString() }).eq("id", attempt.id);
      if (rejectError) throw rejectError;
      await auth.admin.from("workspace_notifications").insert({ tenant_id: tenantId, recipient_user_id: auth.userId, category: "send_error", severity: "error", title: "WhatsApp message rejected by Meta", body: detail, entity_type: "outbound_send_attempt", entity_id: attempt.id, dedupe_key: "send-rejected:" + attempt.id, metadata: { error_code: String(result.error?.code ?? response.status), http_status: response.status, occurred_at: new Date().toISOString() } });
      console.error("Meta send rejected", response.status, JSON.stringify(result).slice(0, 1000));
      return json({ error: "Meta rejected the message. Check the integration and template status." }, 502);
    }

    const metaMessageId = String(result.messages[0].id);
    let messageId: string | null = null;
    if (conversationId) {
      const { data: savedMessage, error: messageError } = await auth.admin.from("messages").insert({
        tenant_id: tenantId, conversation_id: conversationId, direction: "outbound",
        actor_type: "agent", message_type: type, body: type === "text" ? payload.text.body : "[Template: " + payload.template.name + "]",
        status: "accepted", meta_message_id: metaMessageId, metadata: { meta_status: "accepted", outbound_attempt_id: attempt.id },
      }).select("id").single();
      if (messageError) {
        await auth.admin.from("outbound_send_attempts").update({ status: "outcome_unknown", meta_message_id: metaMessageId, error_code: "message_persistence_failed", error_detail: "Meta accepted the message but message history persistence failed; reconcile without resending.", updated_at: new Date().toISOString() }).eq("id", attempt.id);
        await auth.admin.from("workspace_notifications").insert({ tenant_id: tenantId, recipient_user_id: auth.userId, category: "send_error", severity: "critical", title: "Message accepted but history was not saved", body: "Meta accepted the message, but MobiWave could not persist its message history. Do not resend. Reconcile using the Meta message ID.", entity_type: "outbound_send_attempt", entity_id: attempt.id, dedupe_key: "message-persistence-failed:" + attempt.id, metadata: { error_code: "message_persistence_failed", meta_message_id: metaMessageId, occurred_at: new Date().toISOString() } });
        return json({ error: "Meta accepted the message, but history persistence failed. The send is recorded for reconciliation and must not be resent.", message_id: metaMessageId, status: "outcome_unknown" }, 500);
      }
      messageId = savedMessage.id;
    }
    const { error: acceptedError } = await auth.admin.from("outbound_send_attempts").update({
      status: "accepted", meta_message_id: metaMessageId, message_id: messageId,
      accepted_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", attempt.id).eq("tenant_id", tenantId);
    if (acceptedError) {
      console.error("Meta accepted send but attempt finalization failed", attempt.id, acceptedError.message);
      await auth.admin.from("workspace_notifications").insert({ tenant_id: tenantId, recipient_user_id: auth.userId, category: "send_error", severity: "critical", title: "Meta accepted message; reconciliation required", body: "Meta accepted this message, but MobiWave could not finalize its send record. Do not resend. Reconcile the recorded provider message ID.", entity_type: "outbound_send_attempt", entity_id: attempt.id, dedupe_key: "attempt-finalization-failed:" + attempt.id, metadata: { error_code: "attempt_finalization_failed", meta_message_id: metaMessageId, occurred_at: new Date().toISOString() } });
      return json({ error: "Meta accepted the message; the durable attempt needs reconciliation. Do not resend this request key.", message_id: metaMessageId, status: "outcome_unknown" }, 500);
    }
    const { error: usageError } = await auth.admin.from("usage_events").insert({ tenant_id: tenantId, event_type: "message_submitted", quantity: 1, reference_id: metaMessageId, metadata: { channel: "agent", outbound_attempt_id: attempt.id } });
    if (usageError) console.error("Usage event persistence failed after Meta acceptance", attempt.id, usageError.message);
    await emitWebhook(auth.admin, tenantId, "message.outbound", { message_id: metaMessageId, to, type, status: "sent_to_meta" });
    return json({ ok: true, message_id: metaMessageId, status: "sent_to_meta" });
  } catch (error) {
    const message = errorMessage(error);
    return json({ error: message }, /sign in|session is invalid/i.test(message) ? 401 : /permission/i.test(message) ? 403 : 400);
  }
});
