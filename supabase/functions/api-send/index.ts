import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { decryptToken } from "../_shared/meta.ts";
import { emitWebhook } from "../_shared/customer-webhooks.ts";
import { corsHeaders, json } from "../_shared/cors.ts";

const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") || "v23.0";

async function hash(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function replayResponse(attempt: Record<string, unknown>) {
  const status = attempt.status;
  if (status === "accepted" && attempt.meta_message_id) {
    return json({
      ok: true,
      message_id: attempt.meta_message_id,
      status: "sent_to_meta",
      idempotent_replay: true,
    });
  }
  if (status === "rejected") {
    return json({
      error: "The original request was rejected by Meta. Use a new idempotency key for a new attempt.",
      status: "rejected",
      idempotent_replay: true,
    }, 502);
  }
  return json({
    error: "A request with this idempotency key is already being processed or has an uncertain provider outcome. Do not retry with a new key until it has been reconciled.",
    status,
    idempotent_replay: true,
  }, 409);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const suppliedKey = request.headers.get("x-api-key") ?? request.headers.get("Authorization")?.replace(/^Bearer\\s+/i, "") ?? "";
    if (!suppliedKey.startsWith("mw_live_") || suppliedKey.length < 40) return json({ error: "A valid MobiWave API key is required." }, 401);

    const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200 || /[\\r\\n]/.test(idempotencyKey)) {
      return json({ error: "Provide an Idempotency-Key header between 8 and 200 characters." }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: apiKey } = await admin.from("tenant_api_keys").select("id,tenant_id,scopes,expires_at,revoked_at").eq("secret_hash", await hash(suppliedKey)).maybeSingle();
    if (!apiKey || apiKey.revoked_at || (apiKey.expires_at && new Date(apiKey.expires_at).getTime() < Date.now()) || !apiKey.scopes?.includes("messages:send")) {
      return json({ error: "API key is invalid, expired, revoked or lacks permission." }, 401);
    }

    const tenantId = apiKey.tenant_id;
    const body = await request.json();
    const to = String(body.to ?? "");
    const templateName = String(body.template_name ?? "");
    const language = String(body.language_code ?? "en");
    const components = Array.isArray(body.components) ? body.components : [];

    if (!/^\\+[1-9][0-9]{7,14}$/.test(to) || !/^[a-z0-9_]{1,512}$/.test(templateName)) {
      return json({ error: "Use an E.164 recipient and an approved template name." }, 400);
    }

    const requestPayload = { to, template_name: templateName, language_code: language, components };
    const requestHash = await hash(JSON.stringify(requestPayload));

    const { data: limits } = await admin.from("tenant_usage_limits").select("monthly_message_limit").eq("tenant_id", tenantId).maybeSingle();
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const { count: used } = await admin.from("usage_events").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("event_type", "message_submitted").gte("occurred_at", monthStart.toISOString());
    const monthlyLimit = limits?.monthly_message_limit ?? 0;
    if (monthlyLimit > 0 && (used ?? 0) >= monthlyLimit) {
      return json({ error: "This workspace has reached its configured monthly message limit." }, 429);
    }

    const { data: contact } = await admin.from("contacts").select("id,consent_status")
      .eq("tenant_id", tenantId).eq("phone_e164", to).maybeSingle();
    if (!contact || contact.consent_status !== "opted_in") {
      return json({ error: "Recipient must exist in contacts with recorded opt-in consent." }, 403);
    }

    const { data: template } = await admin.from("wa_templates").select("meta_status,components,language_code")
      .eq("tenant_id", tenantId).eq("meta_template_name", templateName).eq("language_code", language).maybeSingle();
    if (!template || template.meta_status !== "approved") {
      return json({ error: "Only approved Meta templates can be sent through the public API." }, 403);
    }

    const { data: integration } = await admin.from("meta_integrations").select("phone_number_id,encrypted_access_token")
      .eq("tenant_id", tenantId).eq("enabled", true).maybeSingle();
    if (!integration?.phone_number_id || !integration.encrypted_access_token) {
      return json({ error: "Official Meta Cloud API is not connected." }, 409);
    }

    // The unique (tenant_id, idempotency_key) index is the atomic claim:
    // only the request that inserts this row may contact Meta.
    const { data: claimed, error: claimError } = await admin.from("outbound_send_attempts").insert({
      tenant_id: tenantId,
      idempotency_key: idempotencyKey,
      request_hash: requestHash,
      contact_id: contact.id,
      message_type: "template",
      request_payload: requestPayload,
      status: "submitting",
      attempts: 1,
    }).select("id,status,request_hash,meta_message_id").single();

    if (claimError || !claimed) {
      if (claimError?.code !== "23505") {
        console.error("Could not claim outbound idempotency key:", claimError?.code ?? "unknown");
        return json({ error: "The send request could not be safely claimed. No message was submitted." }, 503);
      }

      const { data: existing, error: existingError } = await admin.from("outbound_send_attempts")
        .select("id,status,request_hash,meta_message_id")
        .eq("tenant_id", tenantId).eq("idempotency_key", idempotencyKey).maybeSingle();

      if (existingError || !existing) return json({ error: "The original request state could not be verified. Do not retry with a new key." }, 503);
      if (existing.request_hash !== requestHash) {
        return json({ error: "This Idempotency-Key was already used with a different request payload." }, 409);
      }
      return replayResponse(existing);
    }

    let response: Response;
    let result: Record<string, unknown>;
    try {
      response = await fetch("https://graph.facebook.com/" + GRAPH_VERSION + "/" + integration.phone_number_id + "/messages", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + await decryptToken(integration.encrypted_access_token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: to.slice(1),
          type: "template",
          template: { name: templateName, language: { code: language }, components },
        }),
        signal: AbortSignal.timeout(15000),
      });
      result = await response.json() as Record<string, unknown>;
    } catch (error) {
      const detail = error instanceof Error ? error.name : "provider_transport_error";
      await admin.from("outbound_send_attempts").update({
        status: "outcome_unknown",
        error_code: "provider_outcome_unknown",
        error_detail: detail,
        updated_at: new Date().toISOString(),
      }).eq("id", claimed.id).eq("status", "submitting");
      return json({
        error: "The provider outcome is unknown. Reconcile this request before attempting another send.",
        status: "outcome_unknown",
        idempotency_key: idempotencyKey,
      }, 504);
    }

    const messages = Array.isArray(result.messages) ? result.messages as Record<string, unknown>[] : [];
    const metaMessageId = typeof messages[0]?.id === "string" ? messages[0].id as string : null;

    if (!response.ok) {
      const providerError = result.error && typeof result.error === "object" ? result.error as Record<string, unknown> : {};
      await admin.from("outbound_send_attempts").update({
        status: "rejected",
        error_code: String(providerError.code ?? response.status),
        error_detail: "Meta rejected the outbound request.",
        updated_at: new Date().toISOString(),
      }).eq("id", claimed.id).eq("status", "submitting");

      await admin.from("usage_events").insert({
        tenant_id: tenantId,
        event_type: "api_request",
        quantity: 1,
        reference_id: apiKey.id,
        metadata: { outcome: "meta_rejected" },
      });
      return json({ error: "Meta rejected the message. Verify the template and WhatsApp account.", status: "rejected" }, 502);
    }

    if (!metaMessageId) {
      await admin.from("outbound_send_attempts").update({
        status: "outcome_unknown",
        error_code: "missing_provider_message_id",
        error_detail: "Meta returned success without a message identifier.",
        updated_at: new Date().toISOString(),
      }).eq("id", claimed.id).eq("status", "submitting");
      return json({ error: "Meta's response could not be correlated. Reconciliation is required.", status: "outcome_unknown" }, 502);
    }

    const acceptedAt = new Date().toISOString();
    await admin.from("outbound_send_attempts").update({
      status: "accepted",
      meta_message_id: metaMessageId,
      accepted_at: acceptedAt,
      updated_at: acceptedAt,
      error_code: null,
      error_detail: null,
    }).eq("id", claimed.id).eq("status", "submitting");

    let conversationId: string | null = null;
    const { data: conversation, error: conversationError } = await admin.from("conversations")
      .upsert({
        tenant_id: tenantId,
        contact_id: contact.id,
        status: "open",
        last_message_at: acceptedAt,
        updated_at: acceptedAt,
      }, { onConflict: "tenant_id,contact_id" }).select("id").single();

    if (conversationError) {
      console.error("Meta accepted message but conversation persistence failed:", conversationError.code);
    } else {
      conversationId = conversation.id;
    }

    let messageId: string | null = null;
    if (conversationId) {
      const { data: message, error: messageError } = await admin.from("messages").insert({
        tenant_id: tenantId,
        conversation_id: conversationId,
        direction: "outbound",
        actor_type: "agent",
        message_type: "template",
        body: "[Template: " + templateName + "]",
        status: "sent",
        meta_message_id: metaMessageId,
      }).select("id").single();

      if (messageError) {
        console.error("Meta accepted message but message persistence failed:", messageError.code);
      } else {
        messageId = message.id;
      }
    }

    await admin.from("outbound_send_attempts").update({
      conversation_id: conversationId,
      message_id: messageId,
      updated_at: new Date().toISOString(),
    }).eq("id", claimed.id).eq("status", "accepted");

    await admin.from("usage_events").insert([
      { tenant_id: tenantId, event_type: "message_submitted", quantity: 1, reference_id: metaMessageId, metadata: { channel: "api" } },
      { tenant_id: tenantId, event_type: "api_request", quantity: 1, reference_id: apiKey.id, metadata: { outcome: "sent_to_meta" } },
    ]);
    await admin.from("tenant_api_keys").update({ last_used_at: acceptedAt }).eq("id", apiKey.id);
    await emitWebhook(admin, tenantId, "message.outbound", {
      message_id: metaMessageId,
      to,
      template_name: templateName,
      status: "sent_to_meta",
    });

    return json({
      ok: true,
      message_id: metaMessageId,
      status: "sent_to_meta",
      idempotent_replay: false,
      persistence_warning: !messageId,
    });
  } catch (error) {
    console.error("Public API send error:", error instanceof Error ? error.message : "unknown");
    return json({ error: "Request could not be processed." }, 400);
  }
});
