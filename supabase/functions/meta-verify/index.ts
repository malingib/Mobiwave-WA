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
    const tenantId = String(body.tenant_id ?? "");
    if (!tenantId) return json({ error: "tenant_id is required." }, 400);
    await requireTenantRole(auth.admin, tenantId, auth.userId, ["owner", "admin"]);
    const { data: integration, error } = await auth.admin.from("meta_integrations").select("tenant_id,phone_number_id,encrypted_access_token").eq("tenant_id", tenantId).maybeSingle();
    if (error || !integration?.encrypted_access_token || !integration.phone_number_id) return json({ error: "Save Meta credentials before verifying." }, 409);
    const token = await decryptToken(integration.encrypted_access_token);
    const response = await fetch("https://graph.facebook.com/" + GRAPH_VERSION + "/" + integration.phone_number_id + "?fields=id,display_phone_number,verified_name", {
      headers: { "Authorization": "Bearer " + token }, signal: AbortSignal.timeout(12000),
    });
    const result = await response.json();
    if (!response.ok || !result.id) {
      await auth.admin.from("meta_integrations").update({ verified: false, enabled: false, last_error_code: "meta_verification_failed", last_health_check_at: new Date().toISOString() }).eq("tenant_id", tenantId);
      return json({ error: "Meta could not verify these credentials. Check token permissions and Phone Number ID." }, 400);
    }
    const { error: updateError } = await auth.admin.from("meta_integrations").update({
      verified: true, enabled: true, display_phone_number: result.display_phone_number ?? null,
      verified_name: result.verified_name ?? null, last_error_code: null, last_health_check_at: new Date().toISOString(),
      api_version: GRAPH_VERSION, updated_at: new Date().toISOString(),
    }).eq("tenant_id", tenantId);
    if (updateError) throw updateError;
    return json({ ok: true, verified: true, enabled: true, display_phone_number: result.display_phone_number ?? null, verified_name: result.verified_name ?? null });
  } catch (error) {
    const message = errorMessage(error);
    return json({ error: message }, /sign in|session is invalid/i.test(message) ? 401 : /permission/i.test(message) ? 403 : 400);
  }
});
