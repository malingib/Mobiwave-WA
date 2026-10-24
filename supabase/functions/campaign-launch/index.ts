import { requireUser, requireTenantRole } from "../_shared/auth.ts";
import { decryptToken } from "../_shared/meta.ts";
import { corsHeaders, json, errorMessage } from "../_shared/cors.ts";
import { emitWebhook } from "../_shared/customer-webhooks.ts";

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
    if (!["draft","paused","running"].includes(campaign.status)) return json({ error: "Campaign cannot be launched from its current state." }, 409);
    const { data: integration } = await auth.admin.from("meta_integrations").select("phone_number_id,encrypted_access_token").eq("tenant_id", tenantId).eq("enabled", true).maybeSingle();
    if (!integration?.encrypted_access_token || !integration.phone_number_id) return json({ error: "Connect and verify the official Meta Cloud API first." }, 409);
    const { data: template } = await auth.admin.from("wa_templates").select("meta_template_name,language_code,meta_status,components").eq("tenant_id", tenantId).eq("id", campaign.template_id).maybeSingle();
    if (!template || template.meta_status !== "approved") return json({ error: "Campaign must use a Meta-approved template." }, 403);
    const { data: limits } = await auth.admin.from("tenant_usage_limits").select("monthly_message_limit").eq("tenant_id", tenantId).maybeSingle();
    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0,0,0,0);
    const { count: usedBefore } = await auth.admin.from("usage_events").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("event_type", "message_submitted").gte("occurred_at", monthStart.toISOString());
    const monthlyLimit = limits?.monthly_message_limit ?? 0;
    const available = monthlyLimit > 0 ? Math.max(0, monthlyLimit - (usedBefore ?? 0)) : 10;
    if (available === 0) return json({ error: "This workspace has reached its configured monthly message limit." }, 429);

    // A request that died after claiming but before recording its outcome must
    // never be silently retried: Meta may already have accepted the message.
    await auth.admin.from("campaign_recipients").update({
      status: "failed", error_code: "send_outcome_unknown",
      error_detail: "The send worker stopped before confirming the result. Check WhatsApp before manually re-queueing.",
      updated_at: new Date().toISOString(),
    }).eq("tenant_id", tenantId).eq("campaign_id", campaignId).eq("status", "sending").lt("claimed_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());

    const { data: claims, error: claimError } = await auth.admin.rpc("claim_campaign_recipients", {
      p_tenant_id: tenantId, p_campaign_id: campaignId, p_limit: Math.min(10, available),
    });
    if (claimError) throw claimError;
    const claimed = (claims ?? []) as { recipient_id: string; contact_id: string }[];
    if (!claimed.length) {
      const [{ count: queued }, { count: sending }, { count: failed }] = await Promise.all([
        auth.admin.from("campaign_recipients").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("campaign_id", campaignId).eq("status", "queued"),
        auth.admin.from("campaign_recipients").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("campaign_id", campaignId).eq("status", "sending"),
        auth.admin.from("campaign_recipients").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("campaign_id", campaignId).eq("status", "failed"),
      ]);
      const remaining = (queued ?? 0) + (sending ?? 0);
      const status = remaining ? "running" : (failed ?? 0) ? "failed" : "completed";
      await auth.admin.from("campaigns").update({ status, finished_at: remaining ? null : new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", campaignId).eq("tenant_id", tenantId);
      return json({ ok: true, sent: 0, skipped: 0, failed: 0, remaining, status, message: remaining ? "Another send batch is already processing this campaign." : "There are no queued recipients." });
    }
    const recipientIds = claimed.map((row) => row.recipient_id);
    const contactIds = claimed.map((row) => row.contact_id);
    const [{ data: recipients, error: recipientsError }, { data: contactRows, error: contactsError }] = await Promise.all([
      auth.admin.from("campaign_recipients").select("id,contact_id").eq("tenant_id", tenantId).in("id", recipientIds),
      auth.admin.from("contacts").select("id,phone_e164,consent_status").eq("tenant_id", tenantId).in("id", contactIds),
    ]);
    if (recipientsError || contactsError) throw recipientsError ?? contactsError;
    const contactById = new Map((contactRows ?? []).map((contact) => [contact.id, contact]));
    const token = await decryptToken(integration.encrypted_access_token);
    await auth.admin.from("campaigns").update({ status: "running", started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", campaignId).eq("tenant_id", tenantId);
    let sent = 0, skipped = 0, failed = 0;
    for (const recipient of (recipients ?? []) as any[]) {
      const contact = contactById.get(recipient.contact_id);
      if (!contact || contact.consent_status !== "opted_in") {
        skipped++;
        await auth.admin.from("campaign_recipients").update({ status: "skipped", error_code: "consent_required", updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", recipient.id).eq("status", "sending");
        continue;
      }
      try {
        const response = await fetch("https://graph.facebook.com/" + GRAPH_VERSION + "/" + integration.phone_number_id + "/messages", {
          method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify({ messaging_product: "whatsapp", to: String(contact.phone_e164).replace("+",""), type: "template", template: { name: template.meta_template_name, language: { code: template.language_code }, components: Array.isArray(campaign.template_parameters) ? campaign.template_parameters : [] } }),
          signal: AbortSignal.timeout(12000),
        });
        const result = await response.json();
        if (!response.ok || !result.messages?.[0]?.id) {
          failed++;
          await auth.admin.from("campaign_recipients").update({ status: "failed", error_code: String(result.error?.code ?? "meta_error"), error_detail: String(result.error?.message ?? "Meta rejected message").slice(0,300), updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", recipient.id).eq("status", "sending");
        } else {
          sent++;
          await auth.admin.from("usage_events").insert({ tenant_id: tenantId, event_type: "message_submitted", quantity: 1, reference_id: result.messages[0].id, metadata: { channel: "campaign", campaign_id: campaignId } });
          await auth.admin.from("campaign_recipients").update({ status: "sent", meta_message_id: result.messages[0].id, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", recipient.id).eq("status", "sending");
        }
      } catch {
        failed++;
        await auth.admin.from("campaign_recipients").update({ status: "failed", error_code: "send_outcome_unknown", error_detail: "The request failed before MobiWave could confirm Meta's response. Check WhatsApp before manually re-queueing.", updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", recipient.id).eq("status", "sending");
      }
    }
    const [{ count: queued }, { count: sending }, { count: failedRecipients }] = await Promise.all([
      auth.admin.from("campaign_recipients").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("campaign_id", campaignId).eq("status", "queued"),
      auth.admin.from("campaign_recipients").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("campaign_id", campaignId).eq("status", "sending"),
      auth.admin.from("campaign_recipients").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("campaign_id", campaignId).eq("status", "failed"),
    ]);
    const remaining = (queued ?? 0) + (sending ?? 0);
    const nextStatus = remaining > 0 ? "running" : (failedRecipients ?? 0) > 0 ? "failed" : "completed";
    await auth.admin.from("campaigns").update({ status: nextStatus, finished_at: nextStatus === "running" ? null : new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", campaignId).eq("tenant_id", tenantId);
    if (nextStatus !== "running") await emitWebhook(auth.admin, tenantId, "campaign.completed", { campaign_id: campaignId, status: nextStatus, sent, skipped, failed });
    return json({ ok: true, sent, skipped, failed, remaining, status: nextStatus, message: remaining > 0 ? "Each run processes up to 10 recipients. Continue to process the remaining queue." : "Campaign batch finished." });
  } catch (error) {
    const message = errorMessage(error);
    return json({ error: message }, /sign in|session is invalid/i.test(message) ? 401 : /permission/i.test(message) ? 403 : 400);
  }
});
