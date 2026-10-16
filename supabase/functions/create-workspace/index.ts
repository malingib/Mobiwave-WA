import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { corsHeaders, json, errorMessage } from "../_shared/cors.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("Sign in is required.");
    const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userData, error: userError } = await userClient.auth.getUser(authHeader.slice(7));
    if (userError || !userData.user) throw new Error("Session is invalid or expired.");
    const body = await request.json();
    const name = String(body.name ?? "").trim();
    const slug = String(body.slug ?? "").trim().toLowerCase();
    if (name.length < 2 || name.length > 160 || !/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug)) return json({ error: "Workspace name must be 2–160 characters; slug must be 3–64 lowercase letters, numbers or hyphens." }, 400);
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: tenant, error: tenantError } = await admin.from("tenants").insert({ name, slug }).select("id,name,slug").single();
    if (tenantError) return json({ error: tenantError.code === "23505" ? "That workspace URL is already in use." : "Could not create workspace." }, 400);
    const { error: memberError } = await admin.from("tenant_members").insert({ tenant_id: tenant.id, user_id: userData.user.id, role: "owner" });
    if (memberError) throw memberError;
    const { error: settingsError } = await admin.from("tenant_settings").insert({ tenant_id: tenant.id, ai_enabled: false });
    if (settingsError) throw settingsError;
    const { error: limitError } = await admin.from("tenant_usage_limits").insert({ tenant_id: tenant.id, monthly_message_limit: 1000, monthly_ai_request_limit: 500 });
    if (limitError) throw limitError;
    return json({ ok: true, tenant });
  } catch (error) {
    const message = errorMessage(error);
    return json({ error: message }, /sign in|session is invalid/i.test(message) ? 401 : 400);
  }
});
