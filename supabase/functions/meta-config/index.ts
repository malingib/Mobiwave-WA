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
    if (!tenantId) return json({ error: "tenant_id is required." }, 400);
    await requireTenantRole(auth.admin, tenantId, auth.userId, ["owner", "admin"]);

    if (body.action === "status") {
      const { data, error } = await auth.admin.from("meta_integrations")
        .select("encrypted_app_secret")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      return json({ ok: true, app_secret_configured: Boolean(data?.encrypted_app_secret) });
    }

    const phoneNumberId = String(body.phone_number_id ?? "").trim();
    const wabaId = String(body.waba_id ?? "").trim();
    const token = String(body.access_token ?? "").trim();
    const appSecret = String(body.app_secret ?? "").trim();
    if (!/^\d{5,30}$/.test(phoneNumberId) || !/^\d{5,30}$/.test(wabaId) || token.length < 40 || token.length > 5000) {
      return json({ error: "Provide the Meta phone number ID, WhatsApp Business Account ID and a valid access token." }, 400);
    }
    if (appSecret && !/^[a-f0-9]{32}$/i.test(appSecret)) {
      return json({ error: "The Meta app secret must be 32 hexadecimal characters." }, 400);
    }
    const { data: existing, error: existingError } = await auth.admin.from("meta_integrations")
      .select("encrypted_app_secret")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!appSecret && !existing?.encrypted_app_secret) {
      return json({ error: "Enter this client's Meta app secret to complete setup." }, 400);
    }
    const [encryptedToken, encryptedAppSecret] = await Promise.all([
      encryptToken(token),
      appSecret ? encryptToken(appSecret) : Promise.resolve(existing?.encrypted_app_secret as string),
    ]);
    const { error } = await auth.admin.from("meta_integrations").upsert({
      tenant_id: tenantId, phone_number_id: phoneNumberId, waba_id: wabaId,
      encrypted_access_token: encryptedToken, encrypted_app_secret: encryptedAppSecret,
      enabled: false, verified: false, updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    return json({ ok: true, enabled: false, app_secret_configured: true, message: "Client Meta credentials encrypted and saved. Verify connectivity before enabling messaging." });
  } catch (error) {
    const message = errorMessage(error);
    return json({ error: message }, /sign in|session is invalid/i.test(message) ? 401 : /permission/i.test(message) ? 403 : 400);
  }
});
