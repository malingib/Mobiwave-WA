import { requireUser, requireTenantRole } from "../_shared/auth.ts";
import { encryptToken } from "../_shared/meta.ts";
import { corsHeaders, json, errorMessage, readRequestJson } from "../_shared/cors.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const auth = await requireUser(request);
    const body = await readRequestJson(request);
    const tenantId = String(body.tenant_id ?? "");
    if (!tenantId) return json({ error: "tenant_id is required." }, 400);
    await requireTenantRole(auth.admin, tenantId, auth.userId, ["owner", "admin"]);

    if (body.action === "status") {
      const { data, error } = await auth.admin.from("meta_integrations")
        .select("encrypted_app_secret,encrypted_access_token")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      return json({ ok: true, app_secret_configured: Boolean(data?.encrypted_app_secret), access_token_configured: Boolean(data?.encrypted_access_token) });
    }

    const phoneNumberId = String(body.phone_number_id ?? "").trim();
    const wabaId = String(body.waba_id ?? "").trim();
    const wabaTimezone = String(body.waba_timezone ?? "Africa/Nairobi").trim();
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: wabaTimezone }).format(new Date());
    } catch {
      return json({ error: "Provide a valid IANA timezone, such as Africa/Nairobi or Europe/London." }, 400);
    }
    if (wabaTimezone.length > 64) return json({ error: "The WABA timezone must be 64 characters or fewer." }, 400);
    const token = String(body.access_token ?? "").trim();
    const appSecret = String(body.app_secret ?? "").trim();
    if (!/^\d{5,30}$/.test(phoneNumberId) || !/^\d{5,30}$/.test(wabaId)) {
      return json({ error: "Provide the Meta phone number ID and WhatsApp Business Account ID." }, 400);
    }
    if (token && (token.length < 40 || token.length > 5000)) {
      return json({ error: "Provide a valid Meta access token." }, 400);
    }
    if (appSecret && !/^[a-f0-9]{32}$/i.test(appSecret)) {
      return json({ error: "The Meta app secret must be 32 hexadecimal characters." }, 400);
    }
    const { data: existing, error: existingError } = await auth.admin.from("meta_integrations")
      .select("encrypted_access_token,encrypted_app_secret")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (existingError) throw existingError;
    // Saving only the app secret is a normal repair step, so a stored access
    // token may be reused instead of forcing the token to be pasted again.
    if (!token && !existing?.encrypted_access_token) {
      return json({ error: "Enter this client's Meta access token to complete setup." }, 400);
    }
    if (!appSecret && !existing?.encrypted_app_secret) {
      return json({ error: "Enter this client's Meta app secret to complete setup." }, 400);
    }
    const [encryptedToken, encryptedAppSecret] = await Promise.all([
      token ? encryptToken(token) : Promise.resolve(existing?.encrypted_access_token as string),
      appSecret ? encryptToken(appSecret) : Promise.resolve(existing?.encrypted_app_secret as string),
    ]);
    const { error } = await auth.admin.from("meta_integrations").upsert({
      tenant_id: tenantId, phone_number_id: phoneNumberId, waba_id: wabaId,
      waba_timezone: wabaTimezone,
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
