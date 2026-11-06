import { requireUser, requireTenantRole } from "../_shared/auth.ts";
import { decryptToken } from "../_shared/meta.ts";
import { corsHeaders, json, errorMessage } from "../_shared/cors.ts";

const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") || "v23.0";
const allowedStatus = new Set(["APPROVED", "PENDING", "REJECTED", "PAUSED", "DISABLED"]);

function buildComponents(body: Record<string, unknown>) {
  const category = String(body.category ?? "").toUpperCase();
  if (category === "AUTHENTICATION") {
    const expirationRaw = body.code_expiration_minutes;
    const expiration = expirationRaw === "" || expirationRaw == null ? null : Number(expirationRaw);
    if (expiration !== null && (!Number.isInteger(expiration) || expiration < 1 || expiration > 90)) {
      throw new Error("Authentication code expiry must be between 1 and 90 minutes.");
    }
    return [
      { type: "BODY", add_security_recommendation: body.add_security_recommendation !== false },
      ...(expiration === null ? [] : [{ type: "FOOTER", code_expiration_minutes: expiration }]),
      { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: "Copy code" }] },
    ];
  }
  const text = String(body.body ?? "").trim();
  const header = String(body.header ?? "").trim();
  const footer = String(body.footer ?? "").trim();
  const quickReply = String(body.quick_reply ?? "").trim();
  const examples = Array.isArray(body.examples) ? body.examples.map((value) => String(value).trim()) : [];
  if (!text || text.length > 1024) throw new Error("Message body is required and must be 1,024 characters or fewer.");
  if (header.length > 60 || footer.length > 60 || quickReply.length > 25) throw new Error("Header/footer must be 60 characters or fewer and quick reply text must be 25 characters or fewer.");
  const variableIndexes = [...text.matchAll(/\\{\\{\\s*(\\d+)\\s*\\}\\}/g)].map((match) => Number(match[1]));
  const unique = [...new Set(variableIndexes)].sort((a, b) => a - b);
  if (unique.some((value, index) => value !== index + 1)) throw new Error("Body variables must be numbered sequentially starting at {{1}}.");
  if (unique.length !== examples.length || examples.some((value) => !value)) throw new Error("Provide exactly one non-empty example value for each body variable.");
  const components: Record<string, unknown>[] = [];
  if (header) components.push({ type: "HEADER", format: "TEXT", text: header });
  components.push({ type: "BODY", text, ...(unique.length ? { example: { body_text: [examples] } } : {}) });
  if (footer) components.push({ type: "FOOTER", text: footer });
  if (quickReply) components.push({ type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: quickReply }] });
  return components;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const auth = await requireUser(request);
    const body = await request.json();
    const tenantId = String(body.tenant_id ?? "");
    const name = String(body.name ?? "").trim().toLowerCase();
    const category = String(body.category ?? "").trim().toUpperCase();
    const language = String(body.language ?? "en").trim();
    if (!tenantId) return json({ error: "tenant_id is required." }, 400);
    if (!/^[a-z0-9_]{1,512}$/.test(name)) return json({ error: "Template names must use lowercase letters, numbers and underscores." }, 400);
    if (!["MARKETING", "UTILITY", "AUTHENTICATION"].includes(category)) return json({ error: "Choose a supported template category." }, 400);
    if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(language)) return json({ error: "Use a valid language code such as en or en_US." }, 400);
    await requireTenantRole(auth.admin, tenantId, auth.userId, ["owner", "admin"]);
    const { data: integration, error: integrationError } = await auth.admin.from("meta_integrations")
      .select("waba_id,encrypted_access_token").eq("tenant_id", tenantId).eq("enabled", true).eq("verified", true).maybeSingle();
    if (integrationError) throw integrationError;
    if (!integration?.waba_id || !integration.encrypted_access_token) return json({ error: "Connect and verify this workspace's Meta Cloud API before submitting templates." }, 409);
    const { data: existing, error: existingError } = await auth.admin.from("wa_templates")
      .select("id,meta_template_id,meta_status").eq("tenant_id", tenantId)
      .eq("meta_template_name", name).eq("language_code", language).maybeSingle();
    if (existingError) throw existingError;
    if (existing?.meta_template_id) return json({ error: "A template with this name and language is already registered. Use a new template name for another submission." }, 409);

    const components = buildComponents({ ...body, category });
    const token = await decryptToken(integration.encrypted_access_token);
    const response = await fetch("https://graph.facebook.com/" + GRAPH_VERSION + "/" + integration.waba_id + "/message_templates", {
      method: "POST",
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ name, language, category, components }),
      signal: AbortSignal.timeout(15000),
    });
    const result: any = await response.json();
    if (!response.ok || !result.id) {
      const detail = String(result?.error?.error_user_msg ?? result?.error?.message ?? "Meta rejected the template submission request.");
      console.error("Meta template submission failed", response.status, JSON.stringify(result).slice(0, 1200));
      return json({ error: detail.slice(0, 700), meta_error_code: result?.error?.code ?? null }, response.status === 429 ? 429 : 422);
    }
    const returnedStatus = String(result.status ?? "PENDING").toUpperCase();
    const status = allowedStatus.has(returnedStatus) ? returnedStatus.toLowerCase() : "pending";
    const { data: saved, error: saveError } = await auth.admin.from("wa_templates").upsert({
      tenant_id: tenantId,
      meta_template_name: name,
      language_code: language,
      category,
      meta_status: status,
      components,
      meta_template_id: String(result.id),
      rejection_reason: null,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id,meta_template_name,language_code" })
      .select("id,meta_template_name,language_code,category,meta_status,meta_template_id").single();
    if (saveError) throw saveError;
    return json({ ok: true, template: saved, message: "Template submission accepted by Meta's API. Review is not complete until Meta sends an approval status." });
  } catch (error) {
    const message = errorMessage(error);
    return json({ error: message }, /sign in|session is invalid/i.test(message) ? 401 : /permission/i.test(message) ? 403 : 400);
  }
});
