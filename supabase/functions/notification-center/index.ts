import { requireUser, requireTenantRole } from "../_shared/auth.ts";
import { corsHeaders, json } from "../_shared/cors.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const auth = await requireUser(request);
    const body = await request.json();
    const tenantId = String(body.tenant_id ?? "");
    const action = String(body.action ?? "list");
    if (!tenantId) return json({ error: "tenant_id is required." }, 400);
    await requireTenantRole(auth.admin, tenantId, auth.userId, ["owner", "admin", "agent", "viewer"]);
    if (action === "mark_read") {
      const id = String(body.notification_id ?? "");
      if (!id) return json({ error: "notification_id is required." }, 400);
      const { data, error } = await auth.admin.from("workspace_notifications").update({ read_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", id).or("recipient_user_id.is.null,recipient_user_id.eq." + auth.userId).select("id").maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: "Notification not found in this workspace." }, 404);
    } else if (action === "mark_all_read") {
      const { error } = await auth.admin.from("workspace_notifications").update({ read_at: new Date().toISOString() }).eq("tenant_id", tenantId).is("read_at", null).or("recipient_user_id.is.null,recipient_user_id.eq." + auth.userId);
      if (error) throw error;
    } else if (action !== "list") return json({ error: "Unsupported notification action." }, 400);
    const limit = Math.max(1, Math.min(100, Number(body.limit) || 50));
    const { data, error } = await auth.admin.from("workspace_notifications").select("id,category,severity,title,body,entity_type,entity_id,metadata,created_at,read_at").eq("tenant_id", tenantId).or("recipient_user_id.is.null,recipient_user_id.eq." + auth.userId).order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    const notifications = data ?? [];
    return json({ notifications, unread_count: notifications.filter((item) => !item.read_at).length });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Notification request failed." }, 403);
  }
});
