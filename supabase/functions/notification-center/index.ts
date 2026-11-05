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
      const { data: notification, error: lookupError } = await auth.admin
        .from("workspace_notifications")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .or("recipient_user_id.is.null,recipient_user_id.eq." + auth.userId)
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (!notification) return json({ error: "Notification not found in this workspace." }, 404);
      const { error } = await auth.admin.from("workspace_notification_reads").upsert({
        tenant_id: tenantId,
        notification_id: id,
        user_id: auth.userId,
        read_at: new Date().toISOString(),
      }, { onConflict: "notification_id,user_id" });
      if (error) throw error;
    } else if (action === "mark_all_read") {
      const { data: notifications, error: lookupError } = await auth.admin
        .from("workspace_notifications")
        .select("id")
        .eq("tenant_id", tenantId)
        .or("recipient_user_id.is.null,recipient_user_id.eq." + auth.userId);
      if (lookupError) throw lookupError;
      const now = new Date().toISOString();
      const reads = (notifications ?? []).map((item) => ({
        tenant_id: tenantId,
        notification_id: item.id,
        user_id: auth.userId,
        read_at: now,
      }));
      if (reads.length) {
        const { error } = await auth.admin.from("workspace_notification_reads").upsert(reads, { onConflict: "notification_id,user_id" });
        if (error) throw error;
      }
    } else if (action !== "list") {
      return json({ error: "Unsupported notification action." }, 400);
    }

    const limit = Math.max(1, Math.min(100, Number(body.limit) || 50));
    const [listResult, readResult, countResult] = await Promise.all([
      auth.admin.from("workspace_notifications")
        .select("id,category,severity,title,body,entity_type,entity_id,metadata,created_at")
        .eq("tenant_id", tenantId)
        .or("recipient_user_id.is.null,recipient_user_id.eq." + auth.userId)
        .order("created_at", { ascending: false })
        .limit(limit),
      auth.admin.from("workspace_notification_reads")
        .select("notification_id,read_at")
        .eq("tenant_id", tenantId)
        .eq("user_id", auth.userId),
      auth.admin.rpc("count_unread_workspace_notifications", { p_tenant_id: tenantId, p_user_id: auth.userId }),
    ]);
    if (listResult.error || readResult.error || countResult.error) {
      throw listResult.error ?? readResult.error ?? countResult.error;
    }
    const readAtByNotification = new Map((readResult.data ?? []).map((row) => [row.notification_id, row.read_at]));
    const notifications = (listResult.data ?? []).map((row) => ({
      ...row,
      read_at: readAtByNotification.get(row.id) ?? null,
    }));
    return json({ notifications, unread_count: Number(countResult.data ?? 0) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Notification request failed.";
    const status = /sign in|session is invalid/i.test(message) ? 401 : /permission|role/i.test(message) ? 403 : 500;
    return json({ error: message }, status);
  }
});
