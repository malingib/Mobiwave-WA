import { checkTenantFeature, requireUser, requireTenantRole } from "../_shared/auth.ts";
import { corsHeaders, json, errorMessage, readRequestJson } from "../_shared/cors.ts";

function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function hash(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const auth = await requireUser(request);
    const body = await readRequestJson(request);
    const tenantId = String(body.tenant_id ?? ""), name = String(body.name ?? "").trim();
    if (!tenantId || name.length < 2 || name.length > 120) return json({ error: "tenant_id and an API key name of 2–120 characters are required." }, 400);
    await requireTenantRole(auth.admin, tenantId, auth.userId, ["owner", "admin"]);
    const feature = await checkTenantFeature(auth.admin, tenantId, "api");
    if (feature.error) return json({ error: feature.error }, 503);
    if (!feature.allowed) return json({ error: "Developer API access is not included in this workspace plan." }, 403);
    const random = crypto.getRandomValues(new Uint8Array(32));
    const token = "mw_live_" + base64url(random);
    const secretHash = await hash(token);
    const prefix = token.slice(0, 16);
    const allowedScopes = ["messages:send", "messages:read", "contacts:read", "contacts:write", "templates:read", "campaigns:read", "campaigns:write"];
    const requestedScopes = Array.isArray(body.scopes) ? [...new Set(body.scopes.filter((scope: unknown) => typeof scope === "string" && allowedScopes.includes(scope as string)))] : ["messages:send"];
    if (!requestedScopes.length || requestedScopes.length !== (Array.isArray(body.scopes) ? new Set(body.scopes).size : 1)) return json({ error: "One or more API scopes are invalid." }, 400);
    const expiresAt = body.expires_at ? new Date(String(body.expires_at)) : null;
    if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) return json({ error: "expires_at must be a valid future timestamp." }, 400);
    const { data, error } = await auth.admin.from("tenant_api_keys").insert({
      tenant_id: tenantId, name, key_prefix: prefix, secret_hash: secretHash, scopes: requestedScopes, expires_at: expiresAt?.toISOString() ?? null, created_by: auth.userId,
    }).select("id,client_id,name,key_prefix,scopes,expires_at,created_at").single();
    if (error) throw error;
    return json({ ok: true, api_key: token, key: data, warning: "Copy this key now. The raw secret is never stored or shown again." });
  } catch (error) {
    const message = errorMessage(error);
    return json({ error: message }, /sign in|session is invalid/i.test(message) ? 401 : /permission/i.test(message) ? 403 : 400);
  }
});
