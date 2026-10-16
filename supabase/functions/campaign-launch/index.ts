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
    const tenantId = String(body.tenant_id ?? ""), campaignId = String(body.campaign_id ?? "");
    if (!tenantId || !campaignId) return json({ error: "tenant_id and campaign_id are required." }, 400);
    await requireTenantRole(auth.admin, tenantId, auth.userId, ["owner", "admin"]);
    const { data: campaign } = await auth.admin.from("campaigns").select("id,name,status,template_id,template_parameters").eq("tenant_id", tenantId).eq("id", campaignId).maybeSingle();
    if (!campaign) return json({ error: "Campaign not found." }, 404);
    if (!["draft","paused","failed","running"].includes(campaign.status)) return json({ error: "Campaign cannot be launched from its current state." }, 409);
    const { data: integration } = await auth.admin.from("meta_integrations").select("phone_number_id,encrypted_access_token").eq("tenant_id", tenantId).eq("enabled", true).maybeSingle();
    if (!integration?.encrypted_access_token || !integration.phone_number_id) return json({ error: "Connect and verify the official Meta Cloud API first." }, 409);
    const { data: template } = await auth.admin.from("wa_templates").select("meta_template_name,language_code,meta_status,components").eq("tenant_id", tenantId).eq("id", campaign.template_id).maybeSingle();
    if (!template || template.meta_status !== "approved") return json({ error: "Campaign must use a Meta-approved template." }, 403);
    const { data: recipients, error: recipientsError } = await auth.admin.from("campaign_recipients").select("id,contact_id,contacts!inner(phone_e164,consent_status)").eq("tenant_id", tenantId).eq("campaign_id", campaignId).eq("status", "queued").limit(50);
    if (recipientsError) throw recipientsError;
    if (!recipients?.length) return json({ error: "No queued recipients. Add opted-in contacts to the campaign first." }, 400);
    const token = await decryptToken(integration.encrypted_access_token);
    const { data: limits } = await auth.admin.from("tenant_usage_limits").select("monthly_message_limit").eq("tenant_id", tenantId).maybeSingle();
    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0,0,0,0);
    const { count: usedBefore } = await auth.admin.from("usage_events").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("event_type", "message_submitted").gte("occurred_at", monthStart.toISOString());
    const monthlyLimit = limits?.monthly_message_limit ?? 1000;
    await auth.admin.from("campaigns").update({ status: "running", started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", campaignId).eq("tenant_id", tenantId);
    let sent = 0, skipped = 0, failed = 0;
    for (const recipient of recipients as any[]) {
      if ((usedBefore ?? 0) + sent >= monthlyLimit) break;
      const contact = recipient.contacts;
      if (!contact || contact.consent_status !== "opted_in") {
        skipped++;
        await auth.admin.from("campaign_recipients").update({ status: "skipped", error_code: "consent_required" }).eq("id", recipient.id);
        continue;
      }
      const response = await fetch("https://graph.facebook.com/" + GRAPH_VERSION + "/" + integration.phone_number_id + "/messages", {
        method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to: String(contact.phone_e164).replace("+",""), type: "template", template: { name: template.meta_template_name, language: { code: template.language_code }, components: Array.isArray(campaign.template_parameters) ? campaign.template_parameters : [] } }),
        signal: AbortSignal.timeout(12000),
      });
      const result = await response.json();
      if (!response.ok || !result.messages?.[0]?.id) {
        failed++;
        await auth.admin.from("campaign_recipients").update({ status: "failed", attempts: 1, error_code: String(result.error?.code ?? "meta_error"), error_detail: String(result.error?.message ?? "Meta rejected message").slice(0,300) }).eq("id", recipient.id);
      } else {
        sent++;
        await auth.admin.from("usage_events").insert({ tenant_id: tenantId, event_type: "message_submitted", quantity: 1, reference_id: result.messages[0].id, metadata: { channel: "campaign", campaign_id: campaignId } });
        await auth.admin.from("campaign_recipients").update({ status: "sent", attempts: 1, meta_message_id: result.messages[0].id, sent_at: new Date().toISOString() }).eq("id", recipient.id);
      }
    }
    const { count: remaining } = await auth.admin.from("campaign_recipients").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("campaign_id", campaignId).eq("status", "queued");
    const nextStatus = (remaining ?? 0) > 0 ? "running" : failed && !sent ? "failed" : "completed";
    await auth.admin.from("campaigns").update({ status: nextStatus, finished_at: nextStatus === "running" ? null : new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", campaignId).eq("tenant_id", tenantId);
    return json({ ok: true, sent, skipped, failed, remaining: remaining ?? 0, status: nextStatus, message: ((usedBefore ?? 0) + sent >= monthlyLimit ? "Monthly message quota reached. Increase the workspace limit or wait for the next billing month. " : "") + "Each run processes up to 50 recipients. Run again to process remaining queued recipients." });
  } catch (error) {
    const message = errorMessage(error);
    return json({ error: message }, /sign in|session is invalid/i.test(message) ? 401 : /permission/i.test(message) ? 403 : 400);
  }
});
