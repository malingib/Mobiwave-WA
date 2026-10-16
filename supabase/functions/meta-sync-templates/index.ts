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
    const { data: integration } = await auth.admin.from("meta_integrations").select("waba_id,encrypted_access_token").eq("tenant_id", tenantId).eq("enabled", true).maybeSingle();
    if (!integration?.waba_id || !integration.encrypted_access_token) return json({ error: "Connect and verify Meta Cloud API first." }, 409);
    const token = await decryptToken(integration.encrypted_access_token);
    let nextUrl: string | null = "https://graph.facebook.com/" + GRAPH_VERSION + "/" + integration.waba_id + "/message_templates?fields=id,name,status,category,language,components&limit=100";
    let synced = 0, pages = 0;
    while (nextUrl && pages < 10) {
      const response: Response = await fetch(String(nextUrl), { headers: { "Authorization": "Bearer " + token }, signal: AbortSignal.timeout(12000) });
      const result: any = await response.json();
      if (!response.ok) {
        console.error("Meta template sync failed", response.status, JSON.stringify(result).slice(0,500));
        return json({ error: "Meta could not return message templates. Check WABA permissions." }, 502);
      }
      for (const item of result.data ?? []) {
        const name = String(item.name ?? "");
        const language = String(item.language ?? "en");
        const category = ["MARKETING","UTILITY","AUTHENTICATION"].includes(String(item.category).toUpperCase()) ? String(item.category).toUpperCase() : "UTILITY";
        const status = ["APPROVED","PENDING","REJECTED","PAUSED","DISABLED"].includes(String(item.status).toUpperCase()) ? String(item.status).toLowerCase() : "draft";
        if (!name) continue;
        const { error } = await auth.admin.from("wa_templates").upsert({
          tenant_id: tenantId, meta_template_name: name, language_code: language, category,
          meta_status: status, components: Array.isArray(item.components) ? item.components : [],
          meta_template_id: item.id ? String(item.id) : null, synced_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }, { onConflict: "tenant_id,meta_template_name,language_code" });
        if (error) throw error;
        synced++;
      }
      nextUrl = result.paging?.next ?? null;
      pages++;
      if (nextUrl) {
        const next = new URL(nextUrl);
        if (next.hostname !== "graph.facebook.com" || next.protocol !== "https:") throw new Error("Meta returned an unexpected pagination URL.");
      }
    }
    return json({ ok: true, synced, pages, message: "Template sync completed. Campaigns can use only templates with approved status." });
  } catch (error) {
    const message = errorMessage(error);
    return json({ error: message }, /sign in|session is invalid/i.test(message) ? 401 : /permission/i.test(message) ? 403 : 400);
  }
});
