import { requireUser, requireTenantRole } from "../_shared/auth.ts";
import { emitWebhook } from "../_shared/customer-webhooks.ts";
import { corsHeaders, json, errorMessage } from "../_shared/cors.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const auth = await requireUser(request);
    const body = await request.json();
    const tenantId = String(body.tenant_id ?? ""), conversationId = String(body.conversation_id ?? ""), action = String(body.action ?? "");
    if (!tenantId || !conversationId || !["resolve","pause_bot","resume_bot","assign"].includes(action)) return json({ error: "tenant_id, conversation_id and a supported action are required." }, 400);
    await requireTenantRole(auth.admin, tenantId, auth.userId, ["owner","admin","agent"]);
    if (action === "assign") {
      const assigneeId = body.assigned_to ? String(body.assigned_to) : null;
      if (assigneeId) {
        const { data: member } = await auth.admin.from("tenant_members").select("user_id").eq("tenant_id", tenantId).eq("user_id", assigneeId).maybeSingle();
        if (!member) return json({ error: "The assignee must belong to this workspace." }, 400);
      }
      const { data, error } = await auth.admin.from("conversations").update({ assigned_to: assigneeId, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", conversationId).select("id,assigned_to").maybeSingle();
      if (error || !data) return json({ error: "Conversation not found or assignment failed." }, 404);
      await emitWebhook(auth.admin, tenantId, "conversation.updated", { conversation_id: data.id, assigned_to: data.assigned_to, action });
      return json({ ok: true, conversation: data });
    }
    const patch = action === "resolve"
      ? { status: "resolved", bot_paused: true, updated_at: new Date().toISOString() }
      : action === "pause_bot"
        ? { status: "pending", bot_paused: true, updated_at: new Date().toISOString() }
        : { status: "open", bot_paused: false, updated_at: new Date().toISOString() };
    const { data, error } = await auth.admin.from("conversations").update(patch).eq("tenant_id", tenantId).eq("id", conversationId).select("id,status,bot_paused,contact_id").maybeSingle();
    if (error || !data) return json({ error: "Conversation not found or update failed." }, 404);
    await emitWebhook(auth.admin, tenantId, "conversation.updated", { conversation_id: data.id, status: data.status, bot_paused: data.bot_paused, action });
    return json({ ok: true, conversation: data });
  } catch (error) {
    const message = errorMessage(error);
    return json({ error: message }, /sign in|session is invalid/i.test(message) ? 401 : /permission/i.test(message) ? 403 : 400);
  }
});
