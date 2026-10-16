import { requireUser, requireTenantRole } from "../_shared/auth.ts";
import { retrieveApprovedContext, buildGroundedPrompt } from "../_shared/knowledge.ts";
import { corsHeaders, json, errorMessage } from "../_shared/cors.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const internalToken = Deno.env.get("INTERNAL_FUNCTION_TOKEN");
    const isInternal = !!internalToken && request.headers.get("X-Internal-Token") === internalToken;
    let admin: any;
    let userId: string | null = null;
    if (isInternal) {
      const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!url || !key) throw new Error("Server environment is not configured.");
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.57.0");
      admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    } else {
      const auth = await requireUser(request); admin = auth.admin; userId = auth.userId;
    }
    const body = await request.json();
    const tenantId = String(body.tenant_id ?? "");
    const question = String(body.question ?? "").trim();
    const conversationId = body.conversation_id ? String(body.conversation_id) : null;
    if (!tenantId || !question || question.length > 5000) return json({ error: "tenant_id and a question of at most 5,000 characters are required." }, 400);
    if (userId) await requireTenantRole(admin, tenantId, userId, ["owner", "admin", "agent"]);
    if (conversationId) {
      const { data: conv, error } = await admin.from("conversations").select("id,tenant_id,bot_paused").eq("id", conversationId).eq("tenant_id", tenantId).maybeSingle();
      if (error || !conv) return json({ error: "Conversation not found." }, 404);
      if (conv.bot_paused) return json({ answer: "A team member is handling this conversation. Please wait for their reply.", handoff: true, evidence: [] });
    }
    const { data: settings, error: settingsError } = await admin.from("tenant_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
    if (settingsError) throw settingsError;
    if (!settings?.ai_enabled) return json({ answer: "I’m unable to answer automatically right now. I’ll ask a team member to help.", handoff: true, evidence: [] });
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0,0,0,0);
    const [{ data: limits }, { count: used }] = await Promise.all([
      admin.from("tenant_usage_limits").select("monthly_ai_request_limit").eq("tenant_id", tenantId).maybeSingle(),
      admin.from("usage_events").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("event_type", "ai_request").gte("occurred_at", monthStart.toISOString()),
    ]);
    if ((used ?? 0) >= (limits?.monthly_ai_request_limit ?? 500)) return json({ answer: "The automated assistant has reached its monthly usage limit. A team member will help.", handoff: true, evidence: [] });
    const model = settings.ai_model || Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini";
    if (!apiKey) return json({ answer: "I can’t access the automated assistant right now. A team member will help you.", handoff: true, evidence: [] });
    const context = await retrieveApprovedContext(admin, tenantId, question);
    if (!context.sources.length && !context.memories.length) return json({ answer: "I don’t have approved information to answer that confidently. I’ll ask a team member to help.", handoff: true, evidence: [] });
    const prompt = buildGroundedPrompt(question, context, settings.system_instructions ?? "");
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model, temperature: 0.1, max_tokens: settings.max_ai_reply_tokens ?? 500,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
      }),
      signal: AbortSignal.timeout(18000),
    });
    if (!response.ok) {
      console.error("AI provider returned", response.status);
      return json({ answer: "I can’t access the automated assistant right now. A team member will help.", handoff: true, evidence: [] });
    }
    await admin.from("usage_events").insert({ tenant_id: tenantId, event_type: "ai_request", quantity: 1, metadata: { channel: "assistant_test" } });
    await admin.from("usage_events").insert({ tenant_id: tenantId, event_type: "ai_request", quantity: 1, metadata: { channel: "assistant_test" } });
    const payload = await response.json();
    let result: any;
    try { result = JSON.parse(payload.choices?.[0]?.message?.content ?? "{}"); } catch { result = {}; }
    const answer = typeof result.answer === "string" ? result.answer.slice(0, 3000) : "";
    const evidence = Array.isArray(result.evidence) ? result.evidence.filter((v: unknown) => typeof v === "string").slice(0, 6) : [];
    const supported = evidence.some((ref: string) => prompt.allowedEvidence.includes(ref)) && answer.length > 0;
    const handoff = result.handoff === true || !supported;
    if (conversationId) {
      if (handoff && settings.human_handoff_enabled) {
        await admin.from("conversations").update({ bot_paused: true, status: "pending", updated_at: new Date().toISOString() }).eq("id", conversationId).eq("tenant_id", tenantId);
      }
      if (!handoff && answer) {
        await admin.from("messages").insert({ tenant_id: tenantId, conversation_id: conversationId, direction: "outbound", actor_type: "bot", message_type: "text", body: answer, status: "queued", metadata: { evidence, model } });
      }
    }
    return json({ answer: handoff ? (answer || "I don’t have enough approved information to answer confidently. I’ll ask a team member to help.") : answer, handoff, evidence, model });
  } catch (error) {
    const message = errorMessage(error);
    return json({ error: message }, /sign in|session is invalid/i.test(message) ? 401 : /permission/i.test(message) ? 403 : 400);
  }
});
