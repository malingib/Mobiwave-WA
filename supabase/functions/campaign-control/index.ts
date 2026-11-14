import { checkTenantFeature, requireUser, requireTenantRole } from "../_shared/auth.ts";
import { corsHeaders, json, errorMessage, readRequestJson } from "../_shared/cors.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const auth = await requireUser(request);
    const body = await readRequestJson(request);
    const tenantId = String(body.tenant_id ?? "");
    const campaignId = String(body.campaign_id ?? "");
    const action = String(body.action ?? "");
    if (!tenantId || !campaignId || !["pause", "cancel"].includes(action)) {
      return json({ error: "tenant_id, campaign_id and a supported action are required." }, 400);
    }
    await requireTenantRole(auth.admin, tenantId, auth.userId, ["owner", "admin"]);
    const feature = await checkTenantFeature(auth.admin, tenantId, "campaigns");
    if (feature.error) return json({ error: feature.error }, 503);
    if (!feature.allowed) return json({ error: "Campaign controls are not included in this workspace plan." }, 403);
    const { data: status, error } = await auth.admin.rpc("control_campaign", {
      p_tenant_id: tenantId,
      p_campaign_id: campaignId,
      p_action: action,
    });
    if (error) {
      if (error.message.includes("Campaign not found")) return json({ error: "Campaign not found." }, 404);
      if (/campaign|current state/i.test(error.message)) return json({ error: error.message }, 409);
      throw error;
    }
    return json({ ok: true, campaign_id: campaignId, status });
  } catch (error) {
    const message = errorMessage(error);
    return json({ error: message }, /sign in|session is invalid/i.test(message) ? 401 : /permission/i.test(message) ? 403 : 400);
  }
});
