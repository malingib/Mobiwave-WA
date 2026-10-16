import { requireUser, requireTenantRole } from "../_shared/auth.ts";
import { encryptToken } from "../_shared/meta.ts";
import { corsHeaders, json, errorMessage } from "../_shared/cors.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const auth = await requireUser(request);
    const body = await request.json();
    const tenantId = String(body.tenant_id ?? "");
    const phoneNumberId = String(body.phone_number_id ?? "").trim();
    const wabaId = String(body.waba_id ?? "").trim();
    const token = String(body.access_token ?? "").trim();
    if (!tenantId || !/^\d{5,30}$/.test(phoneNumberId) || !/^\d{5,30}$/.test(wabaId) || token.length < 40 || token.length > 5000) {
      return json({ error: "Provide tenant_id, Meta phone number ID, WhatsApp Business Account ID and a valid access token." }, 400);
    }
    await requireTenantRole(auth.admin, tenantId, auth.userId, ["owner", "admin"]);
    const encrypted = await encryptToken(token);
    const { error } = await auth.admin.from("meta_integrations").upsert({
      tenant_id: tenantId, phone_number_id: phoneNumberId, waba_id: wabaId,
      encrypted_access_token: encrypted, enabled: false, verified: false, updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    return json({ ok: true, enabled: false, message: "Credentials encrypted and saved. Verify connectivity before enabling messaging." });
  } catch (error) {
    const message = errorMessage(error);
    return json({ error: message }, /sign in|session is invalid/i.test(message) ? 401 : /permission/i.test(message) ? 403 : 400);
  }
});
