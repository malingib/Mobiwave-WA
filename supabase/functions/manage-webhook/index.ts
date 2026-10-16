import { requireUser, requireTenantRole } from "../_shared/auth.ts";
import { encryptToken } from "../_shared/meta.ts";
import { validateWebhookUrl } from "../_shared/customer-webhooks.ts";
import { corsHeaders, json, errorMessage } from "../_shared/cors.ts";

const allowedEvents = new Set(["message.inbound","message.status","message.outbound","conversation.updated","campaign.completed","knowledge.indexed"]);
function secretToken(bytes: Uint8Array) {
  let raw = ""; for (const byte of bytes) raw += String.fromCharCode(byte);
  return "mw_hook_" + btoa(raw).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const auth = await requireUser(request);
    const body = await request.json();
    const tenantId = String(body.tenant_id ?? ""), action = String(body.action ?? "create");
    if (!tenantId) return json({ error: "tenant_id is required." }, 400);
    await requireTenantRole(auth.admin, tenantId, auth.userId, ["owner","admin"]);
    if (action === "create") {
      const name = String(body.name ?? "").trim(), endpoint = String(body.endpoint_url ?? "").trim();
      const events = Array.isArray(body.events) ? body.events.filter((event: unknown) => typeof event === "string" && allowedEvents.has(event)) : [];
      if (name.length < 2 || name.length > 120 || !events.length) return json({ error: "Provide a webhook name and at least one supported event." }, 400);
      const safeUrl = await validateWebhookUrl(endpoint);
      const secret = secretToken(crypto.getRandomValues(new Uint8Array(32)));
      const { data, error } = await auth.admin.from("tenant_webhooks").insert({
        tenant_id: tenantId, name, endpoint_url: safeUrl.toString(), encrypted_secret: await encryptToken(secret),
        events: [...new Set(events)], enabled: true, created_by: auth.userId,
      }).select("id,name,endpoint_url,events,enabled,created_at").single();
      if (error) throw error;
      return json({ ok: true, webhook: data, signing_secret: secret, warning: "Copy the signing secret now. It cannot be retrieved again." });
    }
    const webhookId = String(body.webhook_id ?? "");
    if (!webhookId) return json({ error: "webhook_id is required." }, 400);
    if (action === "disable" || action === "enable") {
      const { error } = await auth.admin.from("tenant_webhooks").update({ enabled: action === "enable", updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", webhookId);
      if (error) throw error;
      return json({ ok: true, enabled: action === "enable" });
    }
    if (action === "delete") {
      const { error } = await auth.admin.from("tenant_webhooks").delete().eq("tenant_id", tenantId).eq("id", webhookId);
      if (error) throw error;
      return json({ ok: true, deleted: true });
    }
    return json({ error: "Unsupported action." }, 400);
  } catch (error) {
    const message = errorMessage(error);
    return json({ error: message }, /sign in|session is invalid/i.test(message) ? 401 : /permission/i.test(message) ? 403 : 400);
  }
});
