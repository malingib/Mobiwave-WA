import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { corsHeaders, json } from "../_shared/cors.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const expected = Deno.env.get("INTERNAL_FUNCTION_TOKEN");
  if (!expected || request.headers.get("X-Internal-Token") !== expected) return json({ error: "Unauthorized." }, 401);
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Server environment is not configured." }, 500);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: events, error } = await admin.rpc("claim_meta_webhook_events", { p_limit: 5 });
  if (error) return json({ error: "Could not claim Meta webhook inbox events." }, 500);
  let processed = 0, retrying = 0, deadLettered = 0;
  for (const event of events ?? []) {
    try {
      const payload = event.payload ?? {};
      if (!payload.value || !event.phone_number_id) throw new Error("Stored Meta event envelope is incomplete.");
      const replay = {
        object: "whatsapp_business_account",
        entry: [{ id: payload.entry_id ?? null, changes: [{ field: payload.field ?? "messages", value: payload.value }] }],
      };
      const response = await fetch(url.replace(/\/$/, "") + "/functions/v1/meta-webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": key,
          "Authorization": "Bearer " + key,
          "X-Internal-Replay-Token": expected,
        },
        body: JSON.stringify(replay),
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 1000);
        throw new Error("Meta webhook replay returned " + response.status + ": " + detail);
      }
      const { error: finishError } = await admin.from("meta_webhook_events").update({
        status: "processed", processed_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString(),
      }).eq("id", event.id).eq("status", "processing");
      if (finishError) throw finishError;
      processed++;
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message.slice(0, 1000) : "Unknown replay error";
      const attempts = Number(event.attempts ?? 1);
      const terminal = attempts >= 8;
      const delaySeconds = Math.min(3600, 30 * (2 ** Math.min(attempts - 1, 7)));
      const { error: retryError } = await admin.from("meta_webhook_events").update({
        status: terminal ? "dead_letter" : "retry",
        next_attempt_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
        last_error: detail, updated_at: new Date().toISOString(),
      }).eq("id", event.id).eq("status", "processing");
      if (retryError) console.error("Could not persist Meta webhook retry state", retryError.message);
      if (terminal) deadLettered++; else retrying++;
    }
  }
  return json({ ok: true, claimed: (events ?? []).length, processed, retrying, dead_lettered: deadLettered });
});
