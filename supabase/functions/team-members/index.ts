import { requireUser, requireTenantRole } from "../_shared/auth.ts";
import { corsHeaders, json, errorMessage, readRequestJson } from "../_shared/cors.ts";

function inviteRedirectUrl(requested: unknown) {
  const configured = (Deno.env.get("INVITE_REDIRECT_ORIGINS") ?? "https://wap.mobiwave.co.ke,http://localhost:5173")
    .split(",").map((value) => value.trim().replace(/\/$/, "")).filter(Boolean);
  const origin = typeof requested === "string" ? requested.trim().replace(/\/$/, "") : "";
  const safe = configured.includes(origin) ? origin : configured[0];
  return safe + "/login";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const auth = await requireUser(request);
    const body = await readRequestJson(request);
    const tenantId = String(body.tenant_id ?? "");
    if (!tenantId) return json({ error: "tenant_id is required." }, 400);
    const action = String(body.action ?? "list");
    const actorRole = await requireTenantRole(auth.admin, tenantId, auth.userId, ["owner", "admin", "agent", "viewer"]);
    if (action === "invite") {
      if (!(["owner", "admin"].includes(actorRole))) return json({ error: "Only workspace owners and admins can invite members." }, 403);
      const email = String(body.email ?? "").trim().toLowerCase();
      const role = String(body.role ?? "agent");
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
      if (!(role === "agent" || role === "viewer" || (role === "admin" && actorRole === "owner"))) return json({ error: "You cannot assign that workspace role." }, 403);

      const findUserByEmail = async () => {
        for (let page = 1; ; page++) {
          const { data, error } = await auth.admin.auth.admin.listUsers({ page, perPage: 1000 });
          if (error) throw error;
          const users = data?.users ?? [];
          const match = users.find((user) => user.email?.toLowerCase() === email);
          if (match) return match;
          if (users.length < 1000) return null;
        }
      };

      let invited = false;
      let targetUser = await findUserByEmail();
      if (!targetUser) {
        const { data, error } = await auth.admin.auth.admin.inviteUserByEmail(email, {
          data: { invited_to_tenant: tenantId },
          redirectTo: inviteRedirectUrl(body.redirect_origin),
        });
        if (error) {
          // A concurrent signup/invite can create the Auth user after the lookup.
          targetUser = await findUserByEmail();
          if (!targetUser) throw error;
        } else {
          targetUser = data.user;
          invited = true;
        }
      }
      if (!targetUser) throw new Error("The invited account could not be resolved.");
      if (targetUser.id === auth.userId) return json({ error: "You already belong to this workspace." }, 409);
      const { data: existing, error: existingError } = await auth.admin.from("tenant_members").select("role").eq("tenant_id", tenantId).eq("user_id", targetUser.id).maybeSingle();
      if (existingError) throw existingError;
      if (existing) return json({ error: "This person already belongs to the workspace." }, 409);
      const { error: membershipError } = await auth.admin.from("tenant_members").insert({ tenant_id: tenantId, user_id: targetUser.id, role });
      if (membershipError) {
        const { data: racedMembership, error: raceError } = await auth.admin.from("tenant_members").select("role").eq("tenant_id", tenantId).eq("user_id", targetUser.id).maybeSingle();
        if (raceError) throw raceError;
        if (!racedMembership) throw membershipError;
        return json({ error: "This person already belongs to the workspace." }, 409);
      }
      return json({ ok: true, invited, member: { user_id: targetUser.id, email, role } }, invited ? 202 : 200);
    }
    if (action !== "list") return json({ error: "Unsupported team action." }, 400);
    const { data: members, error } = await auth.admin.from("tenant_members").select("user_id,role").eq("tenant_id", tenantId).order("created_at").limit(200);
    if (error) throw error;
    const usersById = new Map<string, NonNullable<Awaited<ReturnType<typeof auth.admin.auth.admin.getUserById>>["data"]>["user"]>();
    // Look up only this workspace's capped member set. Scanning Auth's global
    // user directory page by page makes a small team view slower as unrelated
    // accounts accumulate across the platform.
    const memberIds = (members ?? []).map((member) => member.user_id);
    const lookupBatchSize = 8;
    for (let offset = 0; offset < memberIds.length; offset += lookupBatchSize) {
      const batch = memberIds.slice(offset, offset + lookupBatchSize);
      const results = await Promise.all(batch.map((userId) => auth.admin.auth.admin.getUserById(userId)));
      for (const result of results) {
        if (result.error) throw result.error;
        if (result.data.user) usersById.set(result.data.user.id, result.data.user);
      }
    }
    const rows = (members ?? []).map((member) => {
      const user = usersById.get(member.user_id);
      const email = user?.email ?? "";
      const name = String((user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? email) || "Team member");
      return { user_id: member.user_id, role: member.role, name, email };
    });
    return json({ members: rows });
  } catch (error) {
    const message = errorMessage(error);
    return json({ error: message }, /sign in|session is invalid/i.test(message) ? 401 : /permission/i.test(message) ? 403 : 400);
  }
});
