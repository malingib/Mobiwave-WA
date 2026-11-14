import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

export type AuthContext = { userId: string; db: SupabaseClient; admin: SupabaseClient };
export type TierFeature = "inbox" | "contacts" | "templates" | "campaigns" | "api" | "webhooks";

export async function requireUser(request: Request): Promise<AuthContext> {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) throw new Error("Sign in is required.");
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) throw new Error("Server environment is not configured.");
  const db = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.auth.getUser(authorization.slice(7));
  if (error || !data.user) throw new Error("Session is invalid or expired.");
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return { userId: data.user.id, db, admin };
}

export async function requireTenantRole(admin: SupabaseClient, tenantId: string, userId: string, roles: string[] = ["owner", "admin"]) {
  const { data, error } = await admin.from("tenant_members").select("role").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();
  if (error || !data || !roles.includes(data.role)) throw new Error("You do not have permission to perform this action.");
  return data.role as string;
}

export async function checkTenantFeature(admin: SupabaseClient, tenantId: string, feature: TierFeature) {
  const { data: subscription, error } = await admin.from("platform_customer_subscriptions")
    .select("status,tier:platform_billing_tiers(feature_flags)")
    .eq("tenant_id", tenantId).maybeSingle();
  if (error) return { allowed: false, error: "Plan access could not be verified." };
  if (subscription?.status !== "active") return { allowed: true, error: null };
  const tier = Array.isArray(subscription.tier) ? subscription.tier[0] : subscription.tier;
  return { allowed: Boolean(tier && tier.feature_flags?.[feature] !== false), error: null };
}
