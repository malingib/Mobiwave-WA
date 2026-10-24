import { requireUser, requireTenantRole } from "../_shared/auth.ts";
import { corsHeaders, json, errorMessage } from "../_shared/cors.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const auth = await requireUser(request);
    const body = await request.json();
    const tenantId = String(body.tenant_id ?? "");
    if (!tenantId) return json({ error: "tenant_id is required." }, 400);
    await requireTenantRole(auth.admin, tenantId, auth.userId, ["owner", "admin", "agent", "viewer"]);
    const { data: members, error } = await auth.admin.from("tenant_members").select("user_id,role").eq("tenant_id", tenantId).order("created_at").limit(200);
    if (error) throw error;
    const rows = await Promise.all((members ?? []).map(async (member) => {
      const { data } = await auth.admin.auth.admin.getUserById(member.user_id);
      const user = data?.user;
      const email = user?.email ?? "";
      const name = String((user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? email) || "Team member");
      return { user_id: member.user_id, role: member.role, name, email };
    }));
    return json({ members: rows });
  } catch (error) {
    const message = errorMessage(error);
    return json({ error: message }, /sign in|session is invalid/i.test(message) ? 401 : /permission/i.test(message) ? 403 : 400);
  }
});
