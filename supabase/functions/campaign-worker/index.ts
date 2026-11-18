import {
  internalTokenMatches,
  serviceRoleClient,
} from "../_shared/auth.ts";
import { corsHeaders, json } from "../_shared/cors.ts";

// Continues campaign batches that a human started, and starts scheduled drafts
// that have come due. Invoked once a minute by pg_cron with the internal token.
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!internalTokenMatches(request)) return json({ error: "Unauthorized." }, 401);

  const admin = serviceRoleClient();
  const invocationStartedAt = Date.now();
  const now = new Date().toISOString();
  const idleBefore = new Date(Date.now() - 60_000).toISOString();

  const [{ data: running, error: runningError }, { data: scheduled, error: scheduledError }] = await Promise.all([
    admin.from("campaigns")
      .select("id,tenant_id,status,scheduled_at")
      .eq("status", "running")
      .lt("updated_at", idleBefore)
      .order("updated_at", { ascending: true })
      .limit(5),
    admin.from("campaigns")
      .select("id,tenant_id,status,scheduled_at")
      .eq("status", "draft")
      .not("scheduled_at", "is", null)
      .lte("scheduled_at", now)
      .order("scheduled_at", { ascending: true })
      .limit(5),
  ]);
  if (runningError || scheduledError) {
    console.error("Campaign worker could not load work", runningError?.code ?? scheduledError?.code);
    return json({ error: "Campaign work could not be loaded." }, 500);
  }

  const seen = new Set<string>();
  const work = [...(running ?? []), ...(scheduled ?? [])].filter((campaign) => {
    if (seen.has(campaign.id)) return false;
    seen.add(campaign.id);
    return true;
  });

  let triggered = 0, failed = 0, skipped = 0;
  const results: Array<{ campaign_id: string; status: number | string }> = [];
  for (const campaign of work) {
    if (Date.now() - invocationStartedAt >= 60_000) {
      skipped += work.length - results.length;
      break;
    }
    try {
      const response = await fetch(Deno.env.get("SUPABASE_URL")!.replace(/\/$/, "") + "/functions/v1/campaign-launch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": Deno.env.get("SUPABASE_ANON_KEY") ?? "",
          "X-Internal-Token": request.headers.get("X-Internal-Token") ?? "",
        },
        body: JSON.stringify({ tenant_id: campaign.tenant_id, campaign_id: campaign.id }),
        signal: AbortSignal.timeout(110_000),
      });
      const detail = await response.text().catch(() => "");
      results.push({ campaign_id: campaign.id, status: response.status });
      if (response.ok) {
        triggered++;
        continue;
      }
      failed++;
      console.error("Campaign worker launch failed", campaign.id, response.status, detail.slice(0, 500));
      if (campaign.status === "draft") {
        // Stop auto-retrying a scheduled draft that cannot launch. The draft
        // stays available for a person to fix and send manually.
        await admin.from("campaigns").update({ scheduled_at: null, updated_at: new Date().toISOString() })
          .eq("id", campaign.id).eq("tenant_id", campaign.tenant_id).eq("status", "draft");
      } else if (response.status === 403) {
        // A plan that no longer allows campaigns should pause the queue instead
        // of failing the same batch every minute.
        await admin.from("campaigns").update({ status: "paused", updated_at: new Date().toISOString() })
          .eq("id", campaign.id).eq("tenant_id", campaign.tenant_id).eq("status", "running");
      }
    } catch (cause) {
      failed++;
      results.push({ campaign_id: campaign.id, status: "error" });
      console.error("Campaign worker request failed", campaign.id, cause instanceof Error ? cause.message : "unknown");
    }
  }

  return json({
    ok: true,
    scanned: work.length,
    triggered,
    failed,
    skipped,
    results,
  });
});
