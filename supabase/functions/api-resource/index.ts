import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { checkTenantFeature } from "../_shared/auth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key, Authorization, Idempotency-Key",
  "Access-Control-Max-Age": "600",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: cors });
const fail = (status: number, code: string, message: string, details: unknown = null) =>
  json({ ok: false, error: { code, message, details } }, status);
const scopes: Record<string, string> = {
  contacts: "contacts:read", templates: "templates:read", messages: "messages:read",
  campaigns: "campaigns:read",
};
const writeScopes: Record<string, string> = {
  contacts: "contacts:write", campaigns: "campaigns:write", messages: "messages:send",
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function sha256(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function phone(value: unknown) { return typeof value === "string" && /^\+[1-9][0-9]{7,14}$/.test(value); }
function pageParams(url: URL) {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
  return { limit, offset };
}
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const allowedMethods = ["GET", "POST", "PATCH", "DELETE"];
  if (!allowedMethods.includes(request.method)) return fail(405, "METHOD_NOT_ALLOWED", "This method is not supported.");
  try {
    const supplied = request.headers.get("x-api-key") ??
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!supplied.startsWith("mw_live_") || supplied.length < 40)
      return fail(401, "INVALID_API_KEY", "A valid MobiWave API key is required.");

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: key, error: keyError } = await admin.from("tenant_api_keys")
      .select("id,client_id,name,tenant_id,scopes,expires_at,revoked_at")
      .eq("secret_hash", await sha256(supplied)).maybeSingle();
    if (keyError) return fail(503, "AUTH_LOOKUP_FAILED", "API authentication could not be verified.");
    if (!key || key.revoked_at || (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()))
      return fail(401, "INVALID_API_KEY", "The API key is invalid, expired or revoked.");

    const { data: rateAllowed, error: rateError } = await admin.rpc("claim_tenant_api_rate_limit", {
      p_api_key_id: key.id, p_limit: 120,
    });
    if (rateError) return fail(503, "RATE_LIMIT_UNAVAILABLE", "Request limits could not be verified.");
    if (rateAllowed !== true) return fail(429, "RATE_LIMIT_EXCEEDED", "This API key has exceeded 120 requests per minute.");

    const url = new URL(request.url);
    const path = (url.searchParams.get("path") || "").replace(/^\/+|\/+$/g, "");
    const parts = path.split("/").filter(Boolean);
    const resource = parts[0] || "";
    const id = parts[1] || "";
    const action = parts[2] || "";
    const method = request.method;
    await admin.from("tenant_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", key.id);
    const { error: usageLogError } = await admin.from("usage_events").insert({
      tenant_id: key.tenant_id, event_type: "api_request", quantity: 1, reference_id: key.id,
      metadata: { client_id: key.client_id, method, resource: resource || "root" },
    });
    if (usageLogError) return fail(503, "USAGE_LOG_UNAVAILABLE", "API usage could not be recorded; no operation was performed.");
    const body = method === "POST" || method === "PATCH" ? await request.json().catch(() => null) : null;
    if ((method === "POST" || method === "PATCH") && (!body || typeof body !== "object" || Array.isArray(body)))
      return fail(400, "INVALID_JSON", "A valid JSON object is required.");

    if (resource === "health" && method === "GET") return json({ ok: true, data: { version: "v1", status: "operational" } });
    if (resource === "me" && method === "GET") return json({ ok: true, data: { client_id: key.client_id, integration: key.name, scopes: key.scopes } });

    const scope = method === "GET" ? scopes[resource] : writeScopes[resource];
    if (!scope || !Array.isArray(key.scopes) || !key.scopes.includes(scope))
      return fail(403, "INSUFFICIENT_SCOPE", "This API key does not have permission for this operation.", { required_scope: scope ?? null });

    const featureName = resource === "contacts" ? "contacts" : resource === "templates" ? "templates" :
      resource === "campaigns" ? "campaigns" : resource === "messages" ? "api" : null;
    if (featureName) {
      const feature = await checkTenantFeature(admin, key.tenant_id, featureName);
      if (feature.error) return fail(503, "PLAN_CHECK_FAILED", "Workspace plan access could not be verified.");
      if (!feature.allowed) return fail(403, "FEATURE_NOT_INCLUDED", "This feature is not included in the workspace plan.");
    }
    const tenantId = key.tenant_id;
    const { limit, offset } = pageParams(url);

    if (resource === "contacts") {
      if (!id && method === "GET") {
        let q = admin.from("contacts").select("id,phone_e164,display_name,consent_status,consent_source,consent_at,opted_out_at,metadata,created_at,updated_at", { count: "exact" }).eq("tenant_id", tenantId).order("created_at", { ascending: false }).range(offset, offset + limit - 1);
        const status = url.searchParams.get("consent_status");
        if (status && ["unknown", "opted_in", "opted_out"].includes(status)) q = q.eq("consent_status", status);
        const { data, count, error } = await q;
        if (error) throw error;
        return json({ ok: true, data, pagination: { limit, offset, total: count ?? 0 } });
      }
      if (!id && method === "POST") {
        if (!phone(body.phone)) return fail(422, "INVALID_RECIPIENT", "phone must be an E.164 number.");
        const { data: priorContact, error: priorContactError } = await admin.from("contacts").select("id,consent_status,consent_source,consent_at,opted_out_at,display_name,metadata").eq("tenant_id", tenantId).eq("phone_e164", body.phone).maybeSingle();
        if (priorContactError) throw priorContactError;
        const consent = body.consent_status ?? priorContact?.consent_status ?? "unknown";
        if (!["unknown", "opted_in", "opted_out"].includes(consent)) return fail(422, "INVALID_CONSENT", "consent_status must be unknown, opted_in or opted_out.");
        if (body.consent_status !== undefined && consent !== "unknown" && !String(body.consent_source ?? "").trim()) return fail(422, "CONSENT_SOURCE_REQUIRED", "Record the source of consent.");
        const now = new Date().toISOString();
        const consentChanged = Boolean(body.consent_status !== undefined && priorContact?.consent_status !== consent);
        const { data, error } = await admin.from("contacts").upsert({
          tenant_id: tenantId, phone_e164: body.phone,
          display_name: body.name === undefined ? (priorContact?.display_name ?? null) : String(body.name).slice(0, 160),
          consent_status: consent,
          consent_source: body.consent_status === undefined ? (priorContact?.consent_source ?? null) : (body.consent_source ?? null),
          consent_at: consentChanged ? (consent === "opted_in" ? now : null) : (priorContact?.consent_at ?? null),
          opted_out_at: consentChanged ? (consent === "opted_out" ? now : null) : (priorContact?.opted_out_at ?? null),
          metadata: body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? body.metadata : (priorContact?.metadata ?? {}),
        }, { onConflict: "tenant_id,phone_e164" }).select("id,phone_e164,display_name,consent_status,consent_source,consent_at,opted_out_at,metadata,created_at,updated_at").single();
        if (error) throw error;
        if (consentChanged && consent !== "unknown") {
          const { error: auditError } = await admin.from("contact_consent_audit").insert({
            tenant_id: tenantId, contact_id: data.id, api_key_id: key.id,
            previous_status: priorContact?.consent_status ?? "unknown", new_status: consent,
            source: String(body.consent_source).slice(0, 200),
          });
          if (auditError) throw auditError;
        }
        return json({ ok: true, data }, priorContact ? 200 : 201);
      }
      if (!uuid.test(id)) return fail(404, "CONTACT_NOT_FOUND", "Contact not found.");
      const { data: existing, error: lookupError } = await admin.from("contacts").select("id").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
      if (lookupError) throw lookupError;
      if (!existing) return fail(404, "CONTACT_NOT_FOUND", "Contact not found.");
      if (method === "GET" && action === "consent") {
        const { data, error } = await admin.from("contact_consent_audit").select("id,previous_status,new_status,source,changed_at").eq("tenant_id", tenantId).eq("contact_id", id).order("changed_at", { ascending: false }).limit(100);
        if (error) throw error;
        return json({ ok: true, data });
      }
      if (method === "GET") {
        const { data, error } = await admin.from("contacts").select("id,phone_e164,display_name,consent_status,consent_source,consent_at,opted_out_at,metadata,created_at,updated_at").eq("tenant_id", tenantId).eq("id", id).single();
        if (error) throw error;
        return json({ ok: true, data });
      }
      if (method === "PATCH") {
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (body.name !== undefined) patch.display_name = String(body.name).slice(0, 160);
        if (body.metadata !== undefined && body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)) patch.metadata = body.metadata;
        if (body.phone !== undefined) {
          if (!phone(body.phone)) return fail(422, "INVALID_RECIPIENT", "phone must be an E.164 number.");
          patch.phone_e164 = body.phone;
        }
        const { data, error } = await admin.from("contacts").update(patch).eq("tenant_id", tenantId).eq("id", id).select("id,phone_e164,display_name,consent_status,consent_source,consent_at,opted_out_at,metadata,created_at,updated_at").single();
        if (error) throw error;
        return json({ ok: true, data });
      }
      if (method === "DELETE") {
        const { error } = await admin.from("contacts").delete().eq("tenant_id", tenantId).eq("id", id);
        if (error) throw error;
        return json({ ok: true, data: { id, deleted: true } });
      }
      if (method === "POST" && action === "consent") {
        const status = body.status;
        if (!["opted_in", "opted_out"].includes(status)) return fail(422, "INVALID_CONSENT", "status must be opted_in or opted_out.");
        if (!String(body.source ?? "").trim()) return fail(422, "CONSENT_SOURCE_REQUIRED", "A consent source is required.");
        const { data: current, error: currentError } = await admin.from("contacts").select("consent_status,consent_at,opted_out_at").eq("tenant_id", tenantId).eq("id", id).single();
        if (currentError) throw currentError;
        const now = new Date().toISOString();
        const { data, error } = await admin.from("contacts").update({
          consent_status: status, consent_source: String(body.source).slice(0, 200),
          consent_at: status === "opted_in" ? (current.consent_status === status ? current.consent_at : now) : null,
          opted_out_at: status === "opted_out" ? (current.consent_status === status ? current.opted_out_at : now) : null, updated_at: now,
        }).eq("tenant_id", tenantId).eq("id", id).select("id,phone_e164,consent_status,consent_source,consent_at,opted_out_at").single();
        if (error) throw error;
        if (current.consent_status !== status) {
          const { error: auditError } = await admin.from("contact_consent_audit").insert({
            tenant_id: tenantId, contact_id: id, api_key_id: key.id,
            previous_status: current.consent_status, new_status: status, source: String(body.source).slice(0, 200),
          });
          if (auditError) throw auditError;
        }
        return json({ ok: true, data });
      }
    }

    if (resource === "templates" && method === "GET") {
      let q = admin.from("wa_templates").select("id,meta_template_name,language_code,category,meta_status,components,rejection_reason,synced_at,created_at,updated_at", { count: "exact" }).eq("tenant_id", tenantId).order("meta_template_name").range(offset, offset + limit - 1);
      if (id) q = q.eq("id", id);
      const { data, count, error } = await q;
      if (error) throw error;
      if (id && !data?.length) return fail(404, "TEMPLATE_NOT_FOUND", "Template not found.");
      return json({ ok: true, data: id ? data[0] : data, ...(id ? {} : { pagination: { limit, offset, total: count ?? 0 } }) });
    }

    if (resource === "messages" && method === "POST") {
      const type = String(body.type ?? "");
      if (!["template", "text", "image", "document", "audio", "video"].includes(type))
        return fail(422, "UNSUPPORTED_MESSAGE_TYPE", "Supported message types are template, text, image, document, audio and video.");
      if (!phone(body.to)) return fail(422, "INVALID_RECIPIENT", "to must be an E.164 phone number.");
      const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
      if (!/^[A-Za-z0-9._:-]{8,200}$/.test(idempotencyKey)) return fail(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide an Idempotency-Key header between 8 and 200 letters, numbers, . _ : -.");
      const { data: contact, error: contactError } = await admin.from("contacts").select("id,consent_status").eq("tenant_id", tenantId).eq("phone_e164", body.to).maybeSingle();
      if (contactError) throw contactError;
      if (!contact) return fail(404, "CONTACT_NOT_FOUND", "Recipient must exist in this workspace's contacts.");
      if (contact.consent_status !== "opted_in") return fail(403, "CONSENT_REQUIRED", "The recipient must have recorded opt-in consent before API messaging.");
      const internalToken = Deno.env.get("INTERNAL_FUNCTION_TOKEN");
      if (!internalToken) return fail(503, "MESSAGING_NOT_CONFIGURED", "The messaging service is not available for API requests.");
      const outbound: Record<string, unknown> = { tenant_id: tenantId, to: body.to, type };
      if (type === "template") {
        const template = body.template && typeof body.template === "object" ? body.template : {};
        outbound.template_name = template.name;
        outbound.language_code = template.language ?? "en";
        outbound.components = Array.isArray(template.components) ? template.components :
          (Array.isArray(template.parameters) && template.parameters.length ? [{ type: "body", parameters: template.parameters.map((value: unknown) => ({ type: "text", text: String(value) })) }] : []);
      } else if (type === "text") {
        const textBody = typeof body.text === "string" ? body.text : body.text?.body;
        if (typeof textBody !== "string" || !textBody.trim()) return fail(422, "INVALID_MESSAGE", "text.body is required.");
        outbound.text = textBody;
      } else {
        const media = body[type] && typeof body[type] === "object" ? body[type] : {};
        if (typeof media.link !== "string") return fail(422, "INVALID_MEDIA", type + ".link is required.");
        let mediaUrl: URL;
        try { mediaUrl = new URL(media.link); } catch { return fail(422, "INVALID_MEDIA_URL", "Media link must be a valid HTTPS URL."); }
        if (mediaUrl.protocol !== "https:" || mediaUrl.username || mediaUrl.password) return fail(422, "INVALID_MEDIA_URL", "Media link must be a public HTTPS URL.");
        outbound[type] = { link: media.link, ...(media.caption ? { caption: String(media.caption).slice(0, 1024) } : {}), ...(media.filename ? { filename: String(media.filename).slice(0, 255) } : {}) };
      }
      const upstream = await fetch(new URL("/functions/v1/meta-send", Deno.env.get("SUPABASE_URL")!).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Internal-Token": internalToken, "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(outbound),
        signal: AbortSignal.timeout(22000),
      });
      const result = await upstream.json().catch(() => ({}));
      if (!upstream.ok) return fail(upstream.status, result.error_code ?? "MESSAGE_SEND_FAILED", result.error ?? "The message could not be submitted.", { status: result.status ?? null });
      return json({ ok: true, data: { message_id: result.message_id, status: result.status ?? "accepted", type, to: body.to }, meta: { idempotent_replay: result.idempotent_replay ?? false, persistence_warning: result.persistence_warning ?? false } }, 202);
    }

    if (resource === "messages" && method === "GET") {
      let q = admin.from("messages").select("id,conversation_id,direction,actor_type,message_type,body,status,meta_message_id,reply_to_message_id,metadata,created_at", { count: "exact" }).eq("tenant_id", tenantId).order("created_at", { ascending: false }).range(offset, offset + limit - 1);
      if (id) q = q.eq("meta_message_id", id);
      const { data, count, error } = await q;
      if (error) throw error;
      if (id && !data?.length) return fail(404, "MESSAGE_NOT_FOUND", "Message not found.");
      return json({ ok: true, data: id ? data[0] : data, ...(id ? {} : { pagination: { limit, offset, total: count ?? 0 } }) });
    }

    if (resource === "campaigns") {
      if (!id && method === "GET") {
        const { data, count, error } = await admin.from("campaigns").select("id,name,status,template_id,scheduled_at,started_at,finished_at,created_at,updated_at", { count: "exact" }).eq("tenant_id", tenantId).order("created_at", { ascending: false }).range(offset, offset + limit - 1);
        if (error) throw error;
        return json({ ok: true, data, pagination: { limit, offset, total: count ?? 0 } });
      }
      if (!id && method === "POST") {
        const name = String(body.name ?? "").trim();
        const templateId = String(body.template_id ?? "");
        const contactIds = Array.isArray(body.contact_ids) ? [...new Set(body.contact_ids.filter((v: unknown): v is string => typeof v === "string" && uuid.test(v)))] : [];
        const templateParameters = body.template_parameters === undefined ? [] : body.template_parameters;
        if (!Array.isArray(templateParameters)) return fail(422, "INVALID_TEMPLATE_PARAMETERS", "template_parameters must be a Meta template components array.");
        if (name.length < 1 || name.length > 180 || !uuid.test(templateId) || contactIds.length < 1 || contactIds.length > 5000)
          return fail(422, "INVALID_CAMPAIGN", "Provide a name, template_id and 1–5,000 contact_ids.");
        const { data: template, error: templateError } = await admin.from("wa_templates").select("id,meta_status").eq("tenant_id", tenantId).eq("id", templateId).maybeSingle();
        if (templateError) throw templateError;
        if (!template || template.meta_status !== "approved") return fail(403, "TEMPLATE_NOT_APPROVED", "Campaigns require a Meta-approved template.");
        const { data: contacts, error: contactsError } = await admin.from("contacts").select("id,consent_status").eq("tenant_id", tenantId).in("id", contactIds);
        if (contactsError) throw contactsError;
        if ((contacts ?? []).length !== contactIds.length) return fail(422, "CONTACTS_NOT_FOUND", "One or more contacts do not belong to this workspace.");
        if (contacts!.some((c: any) => c.consent_status !== "opted_in")) return fail(403, "CONSENT_REQUIRED", "Every campaign recipient must have recorded opt-in consent.");
        let scheduledAt: string | null = null;
        if (body.scheduled_at !== undefined && body.scheduled_at !== null && body.scheduled_at !== "") {
          const parsedSchedule = new Date(String(body.scheduled_at));
          if (!Number.isFinite(parsedSchedule.getTime()) || parsedSchedule.getTime() <= Date.now()) return fail(422, "INVALID_SCHEDULE", "scheduled_at must be a valid future timestamp.");
          scheduledAt = parsedSchedule.toISOString();
        }
        const { data: campaign, error } = await admin.from("campaigns").insert({ tenant_id: tenantId, name, template_id: templateId, template_parameters: templateParameters, status: "draft", scheduled_at: scheduledAt }).select("id,name,status,template_id,scheduled_at,created_at").single();
        if (error) throw error;
        const { error: recipientsError } = await admin.from("campaign_recipients").insert(contactIds.map((contact_id: string) => ({ tenant_id: tenantId, campaign_id: campaign.id, contact_id })));
        if (recipientsError) {
          await admin.from("campaigns").delete().eq("tenant_id", tenantId).eq("id", campaign.id);
          throw recipientsError;
        }
        return json({ ok: true, data: { ...campaign, recipient_count: contactIds.length } }, 201);
      }
      if (!uuid.test(id)) return fail(404, "CAMPAIGN_NOT_FOUND", "Campaign not found.");
      if (method === "GET") {
        const { data: campaign, error } = await admin.from("campaigns").select("id,name,status,template_id,scheduled_at,started_at,finished_at,created_at,updated_at").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
        if (error) throw error;
        if (!campaign) return fail(404, "CAMPAIGN_NOT_FOUND", "Campaign not found.");
        const { count, error: countError } = await admin.from("campaign_recipients").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("campaign_id", id);
        if (countError) throw countError;
        return json({ ok: true, data: { ...campaign, recipient_count: count ?? 0 } });
      }
      if (method === "POST" && action === "start") {
        const { data: currentCampaign, error: currentError } = await admin.from("campaigns").select("status,scheduled_at,started_at").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
        if (currentError) throw currentError;
        if (!currentCampaign) return fail(404, "CAMPAIGN_NOT_FOUND", "Campaign not found.");
        if (!["draft", "paused", "running"].includes(currentCampaign.status)) return fail(409, "CAMPAIGN_STATE_CONFLICT", "This campaign cannot be started from its current state.");
        const now = new Date().toISOString();
        const patch: Record<string, unknown> = { scheduled_at: now, updated_at: now };
        if (currentCampaign.status === "paused") patch.status = "running";
        if (!currentCampaign.started_at) patch.started_at = now;
        const { data: queued, error: queueError } = await admin.from("campaigns").update(patch).eq("tenant_id", tenantId).eq("id", id).select("id,status,scheduled_at").single();
        if (queueError) throw queueError;
        return json({ ok: true, data: { ...queued, status: "queued_to_start" } }, 202);
      }
      if (method === "POST" && ["pause", "cancel"].includes(action)) {
        const { data: status, error } = await admin.rpc("control_campaign", { p_tenant_id: tenantId, p_campaign_id: id, p_action: action });
        if (error) return fail(/not found/i.test(error.message) ? 404 : 409, "CAMPAIGN_STATE_CONFLICT", error.message);
        return json({ ok: true, data: { id, status } });
      }
    }
    return fail(404, "ENDPOINT_NOT_FOUND", "The requested API endpoint does not exist.");
  } catch (error) {
    console.error("MobiWave public API resource error:", error instanceof Error ? error.message : "unknown");
    return fail(500, "INTERNAL_ERROR", "The request could not be processed.");
  }
});