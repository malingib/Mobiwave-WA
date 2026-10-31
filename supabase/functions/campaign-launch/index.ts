import { requireUser, requireTenantRole } from "../_shared/auth.ts";
import { corsHeaders, json, errorMessage } from "../_shared/cors.ts";
import { emitWebhook } from "../_shared/customer-webhooks.ts";

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
      status: "outcome_unknown", error_code: "send_outcome_unknown",
      error_detail: "The send worker stopped before confirming the result. Check WhatsApp before manually re-queueing.",
      updated_at: new Date().toISOString(),
    }).eq("tenant_id", tenantId).eq("campaign_id", campaignId).eq("status", "sending").lt("claimed_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());

    // Reconcile deterministic recipient attempts before claiming any new work.
    const { data: uncertainRecipients, error: uncertainError } = await auth.admin.from("campaign_recipients").select("id").eq("tenant_id", tenantId).eq("campaign_id", campaignId).in("status", ["failed", "outcome_unknown"]).eq("error_code", "send_outcome_unknown").limit(100);
    if (uncertainError) throw uncertainError;
    for (const row of uncertainRecipients ?? []) {
      const key = "campaign:" + campaignId + ":" + row.id;
      const { data: attempt, error: attemptError } = await auth.admin.from("outbound_send_attempts").select("status,meta_message_id,error_code,error_detail").eq("tenant_id", tenantId).eq("idempotency_key", key).maybeSingle();
      if (attemptError) throw attemptError;
      if (!attempt) continue;
      if (attempt.status === "accepted" && attempt.meta_message_id) {
        const { data: latestStatus, error: statusError } = await auth.admin.from("message_status_events").select("status,provider_timestamp").eq("tenant_id", tenantId).eq("meta_message_id", attempt.meta_message_id).order("provider_timestamp", { ascending: false }).limit(1).maybeSingle();
        if (statusError) throw statusError;
        const status = latestStatus?.status ?? "accepted";
        const patch: Record<string, unknown> = { status, meta_message_id: attempt.meta_message_id, updated_at: new Date().toISOString() };
        if (status === "sent") patch.sent_at = latestStatus?.provider_timestamp ?? new Date().toISOString();
        if (status === "delivered") patch.delivered_at = latestStatus?.provider_timestamp ?? new Date().toISOString();
        if (status === "read") patch.read_at = latestStatus?.provider_timestamp ?? new Date().toISOString();
        await auth.admin.from("campaign_recipients").update(patch).eq("tenant_id", tenantId).eq("id", row.id).in("status", ["failed", "outcome_unknown"]);
      } else if (attempt.status === "rejected") {
        await auth.admin.from("campaign_recipients").update({ error_code: attempt.error_code ?? "meta_rejected", error_detail: attempt.error_detail ?? "Meta rejected this recipient.", updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", row.id).eq("status", "failed");
      }
    }

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
        const idempotencyKey = "campaign:" + campaignId + ":" + recipient.id;
        const sendResponse = await fetch(Deno.env.get("SUPABASE_URL")!.replace(/\/$/, "") + "/functions/v1/meta-send", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": request.headers.get("Authorization") ?? "",
            "apikey": Deno.env.get("SUPABASE_ANON_KEY") ?? "",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            tenant_id: tenantId, to: contact.phone_e164, type: "template",
            template_name: template.meta_template_name, language_code: template.language_code,
            components: Array.isArray(campaign.template_parameters) ? campaign.template_parameters : [],
            idempotency_key: idempotencyKey,
          }),
          signal: AbortSignal.timeout(20000),
        });
        const result = await sendResponse.json();
        if (!sendResponse.ok || !result.message_id) {
          failed++;
          const unknown = ["outcome_unknown", "submitting", "prepared"].includes(String(result.status ?? ""));
          await auth.admin.from("campaign_recipients").update({ status: unknown ? "outcome_unknown" : "failed", error_code: unknown ? "send_outcome_unknown" : String(result.status ?? "meta_send_failed"), error_detail: String(result.error ?? "The durable send service did not confirm Meta acceptance. Do not manually requeue an unknown outcome.").slice(0, 500), updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", recipient.id).eq("status", "sending");
          await auth.admin.from("workspace_notifications").insert({ tenant_id: tenantId, recipient_user_id: null, category: "campaign_error", severity: unknown ? "critical" : "error", title: unknown ? "Campaign recipient outcome unknown" : "Campaign recipient send failed", body: String(result.error ?? "The durable send service did not confirm Meta acceptance.").slice(0, 900), entity_type: "campaign_recipient", entity_id: recipient.id, dedupe_key: "campaign-send:" + recipient.id, metadata: { campaign_id: campaignId, error_code: unknown ? "send_outcome_unknown" : String(result.status ?? "meta_send_failed"), idempotency_key: idempotencyKey } });
        } else {
          sent++;
          const { error: recipientUpdateError } = await auth.admin.from("campaign_recipients").update({ status: "accepted", meta_message_id: result.message_id, accepted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", recipient.id).eq("status", "sending");
          if (recipientUpdateError) throw recipientUpdateError;
        }
      } catch (cause) {
        failed++;
        await auth.admin.from("campaign_recipients").update({ status: "outcome_unknown", error_code: "send_outcome_unknown", error_detail: "The durable send request did not return a confirmed outcome. The deterministic recipient key is retained; reconcile before any resend.", updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", recipient.id).eq("status", "sending");
        console.error("Campaign recipient durable send failed", recipient.id, cause instanceof Error ? cause.message : "unknown");
      }
    }
    const [{ count: queued }, { count: sending }, { count: failedCount }, { count: unknownCount }] = await Promise.all([
      auth.admin.from("campaign_recipients").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("campaign_id", campaignId).eq("status", "queued"),
      auth.admin.from("campaign_recipients").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("campaign_id", campaignId).eq("status", "sending"),
      auth.admin.from("campaign_recipients").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("campaign_id", campaignId).eq("status", "failed"),
      auth.admin.from("campaign_recipients").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("campaign_id", campaignId).eq("status", "outcome_unknown"),
    ]);
    const failedRecipients = (failedCount ?? 0) + (unknownCount ?? 0);
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
