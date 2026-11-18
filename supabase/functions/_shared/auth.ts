import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

export type AuthContext = { userId: string; db: SupabaseClient; admin: SupabaseClient };
export type TierFeature = "inbox" | "contacts" | "templates" | "campaigns" | "api" | "webhooks";
export type TenantEntitlements = {
  state: "exempt" | "unassigned" | "active" | "trialing" | "grace" | "past_due" | "suspended" | "paused" | "canceled";
  subscription_status: string | null;
  can_send: boolean;
  billing_exempt: boolean;
  has_subscription: boolean;
  trial_ends_on: string | null;
  grace_ends_on: string | null;
  days_remaining: number | null;
  currency: string | null;
  monthly_price_minor: number | null;
  starts_on: string | null;
  ends_on: string | null;
  tier: null | {
    id: string;
    slug: string;
    name: string;
    feature_flags: Record<string, boolean>;
    max_team_members: number;
    monthly_message_limit: number;
  };
};

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

export function serviceRoleClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) throw new Error("Server environment is not configured.");
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Scheduled workers authenticate with a shared secret instead of a user JWT.
// Only functions that run platform-scheduled background work should accept it.
export function internalTokenMatches(request: Request): boolean {
  const expected = Deno.env.get("INTERNAL_FUNCTION_TOKEN");
  const supplied = request.headers.get("X-Internal-Token");
  if (!expected || !supplied || expected.length !== supplied.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index++) {
    mismatch |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return mismatch === 0;
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
  if (!subscription || !["active", "trialing", "grace"].includes(subscription.status)) return { allowed: true, error: null };
  const tier = Array.isArray(subscription.tier) ? subscription.tier[0] : subscription.tier;
  return { allowed: Boolean(tier && tier.feature_flags?.[feature] !== false), error: null };
}

export async function tenantEntitlements(admin: SupabaseClient, tenantId: string) {
  const { data, error } = await admin.rpc("tenant_entitlements", { p_tenant_id: tenantId });
  if (error) return { data: null, error: "Plan access could not be verified." } as const;
  return { data: data as TenantEntitlements, error: null } as const;
}

function entitlementMessage(entitlements: TenantEntitlements | null) {
  switch (entitlements?.state) {
    case "unassigned":
      return "This workspace does not have a subscription yet. Assign a plan to start sending. Inbound messages remain available.";
    case "grace":
      return entitlements.grace_ends_on
        ? "This workspace's payment is overdue. Sending is available during the grace period ending " + entitlements.grace_ends_on + ". Settle the invoice to avoid interruption."
        : "This workspace's payment is overdue. Settle the invoice to keep sending.";
    case "suspended":
    case "canceled":
    case "paused":
      return "Sending is paused because this workspace's subscription is not active. Update billing to resume. Inbound messages remain available.";
    default:
      return "This workspace's subscription does not currently allow sending. Update billing to resume.";
  }
}

// Sending-only gate. Reading the inbox, contacts and message history is never
// blocked by billing state; only outbound provider submission is.
export async function checkSendAccess(admin: SupabaseClient, tenantId: string) {
  const { data, error } = await tenantEntitlements(admin, tenantId);
  if (error) {
    return { allowed: false, error, httpStatus: 503, state: null, entitlements: null } as const;
  }
  if (!data?.can_send) {
    return {
      allowed: false,
      error: entitlementMessage(data),
      httpStatus: 402,
      state: data?.state ?? null,
      entitlements: data,
    } as const;
  }
  return { allowed: true, error: null, httpStatus: 200, state: data.state, entitlements: data } as const;
}

// Constant-time comparison for shared secrets supplied in headers.
export function sharedSecretMatches(expected: string | undefined, supplied: string | null | undefined): boolean {
  if (!expected || !supplied || expected.length !== supplied.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index++) {
    mismatch |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return mismatch === 0;
}
