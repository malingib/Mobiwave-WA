import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { requireUser, requireTenantRole } from "../_shared/auth.ts";
import { corsHeaders, json, errorMessage } from "../_shared/cors.ts";

async function sha256(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const auth = await requireUser(request);
    const body = await request.json();
    const tenantId = String(body.tenant_id ?? "");
    const token = String(body.verification_token ?? "");
    if (!tenantId || !/^[A-Za-z0-9_-]{32,100}$/.test(token)) return json({ error: "A tenant and a valid generated verification token are required." }, 400);
    await requireTenantRole(auth.admin, tenantId, auth.userId, ["owner", "admin"]);
    // The webhook handshake can be configured before the phone credentials are saved.
    // Upsert only the tenant ID and token hash so an existing active integration keeps
    // its encrypted token, phone number, WABA, and verification state unchanged.
    const { error } = await auth.admin.from("meta_integrations").upsert({
      tenant_id: tenantId,
      webhook_verify_token_hash: await sha256(token),
      updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id" });
    if (error) throw error;
    return json({ ok: true, message: "Webhook verification token stored as a hash." });
  } catch (error) {
    const message = errorMessage(error);
    return json({ error: message }, /sign in|session is invalid/i.test(message) ? 401 : /permission|role/i.test(message) ? 403 : 500);
  }
});
