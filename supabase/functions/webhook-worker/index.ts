import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { deliverWebhook } from "../_shared/customer-webhooks.ts";
import { corsHeaders, json } from "../_shared/cors.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const expected = Deno.env.get("INTERNAL_FUNCTION_TOKEN");
  if (!expected || request.headers.get("X-Internal-Token") !== expected) return json({ error: "Unauthorized." }, 401);
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Server environment is not configured." }, 500);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const now = new Date().toISOString();
  const { data, error } = await admin.from("webhook_deliveries").select("id").in("status", ["queued","failed"]).lte("next_attempt_at", now).lt("attempt_count", 8).order("next_attempt_at", { ascending: true }).limit(20);
  if (error) return json({ error: "Could not load due webhook deliveries." }, 500);
  let delivered = 0, retrying = 0, dead = 0;
  for (const row of data ?? []) {
    const result = await deliverWebhook(admin, row.id);
    if (result.ok) delivered++;
    else if (result.retrying) retrying++;
    else dead++;
  }
  return json({ ok: true, processed: (data ?? []).length, delivered, retrying, dead });
});
