export const config = { runtime: "edge" };
declare const process: { env: Record<string, string | undefined> };
const baseHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key, Authorization, Idempotency-Key",
  "Access-Control-Max-Age": "600",
};
function reply(payload: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(payload), { status, headers: baseHeaders });
}
export default async function handler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: baseHeaders });
  const backendUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  if (!backendUrl) return reply({ ok: false, error: { code: "SERVICE_UNAVAILABLE", message: "MobiWave API is not configured." } }, 503);
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/v1\/?/, "").replace(/\/$/, "");
  if (!path) return reply({ ok: true, data: { name: "MobiWave Developer API", version: "v1" } }, 200);
  const auth = request.headers.get("authorization");
  const apiKey = request.headers.get("x-api-key");
  if (!auth && !apiKey) return reply({ ok: false, error: { code: "UNAUTHENTICATED", message: "A MobiWave API key is required." } }, 401);
  let body: ArrayBuffer | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.arrayBuffer();
    if (!body.byteLength || body.byteLength > 128 * 1024) return reply({ ok: false, error: { code: "INVALID_BODY_SIZE", message: "Request body must be between 1 byte and 128 KiB." } }, 413);
  }
  const isUnifiedSend = path === "messages" && request.method === "POST";
  const upstreamPath = isUnifiedSend ? "api-send" : "api-resource";
  const target = new URL("/functions/v1/" + upstreamPath, backendUrl);
  if (!isUnifiedSend) target.searchParams.set("path", path);
  url.searchParams.forEach((value, key) => { if (key !== "path") target.searchParams.append(key, value); });
  const headers = new Headers({ "Content-Type": "application/json" });
  if (auth) headers.set("Authorization", auth);
  if (apiKey) headers.set("X-API-Key", apiKey);
  for (const name of ["idempotency-key"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (isUnifiedSend) {
    if (!request.headers.get("idempotency-key")) return reply({ ok: false, error: { code: "IDEMPOTENCY_KEY_REQUIRED", message: "Provide an Idempotency-Key header between 8 and 200 characters." } }, 400);
    let parsed: any;
    try { parsed = JSON.parse(new TextDecoder().decode(body)); } catch { return reply({ ok: false, error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, 400); }
    if (parsed.type !== "template") return reply({ ok: false, error: { code: "MESSAGE_TYPE_NOT_ENABLED", message: "The unified endpoint currently accepts template messages. Text and media message types will be enabled after their Meta policy, consent and idempotency tests pass." } }, 422);
    const template = parsed.template ?? {};
    body = new TextEncoder().encode(JSON.stringify({
      to: parsed.to,
      template_name: template.name,
      language_code: template.language ?? "en",
      components: Array.isArray(template.components) ? template.components :
        (Array.isArray(template.parameters) && template.parameters.length ? [{ type: "body", parameters: template.parameters.map((text: unknown) => ({ type: "text", text: String(text) })) }] : []),
    })).buffer;
  }
  try {
    const upstream = await fetch(target.toString(), {
      method: request.method, headers, body, redirect: "manual", signal: AbortSignal.timeout(25000),
    });
    if (upstream.status >= 300 && upstream.status < 400) return reply({ ok: false, error: { code: "UPSTREAM_UNAVAILABLE", message: "MobiWave API service is temporarily unavailable." } }, 502);
    const responseBody = await upstream.arrayBuffer();
    const responseHeaders = new Headers(baseHeaders);
    const contentType = upstream.headers.get("content-type");
    if (contentType) responseHeaders.set("Content-Type", contentType);
    return new Response(responseBody, { status: upstream.status, headers: responseHeaders });
  } catch {
    return reply({ ok: false, error: { code: "UPSTREAM_TIMEOUT", message: "MobiWave could not confirm the request outcome. Reuse the same idempotency key when checking a message send.", status: "outcome_unknown" } }, 504);
  }
}