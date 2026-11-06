export const config = { runtime: "edge" };

declare const process: { env: Record<string, string | undefined> };

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function reply(payload: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(payload), { status, headers });
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-API-Key, Authorization, Idempotency-Key",
        "Access-Control-Max-Age": "600",
      },
    });
  }

  if (request.method !== "POST") {
    return reply({ error: "Method not allowed." }, 405);
  }

  const backendUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  if (!backendUrl) {
    return reply({ error: "MobiWave messaging API is not configured." }, 503);
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return reply({ error: "Content-Type must be application/json." }, 415);
  }

  const apiKey = request.headers.get("x-api-key");
  const authorization = request.headers.get("authorization");
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!apiKey && !authorization) {
    return reply({ error: "A MobiWave workspace API key is required." }, 401);
  }
  if (!idempotencyKey || idempotencyKey.trim().length < 8 || idempotencyKey.length > 200) {
    return reply({ error: "Provide an Idempotency-Key header between 8 and 200 characters." }, 400);
  }

  let body: ArrayBuffer;
  try {
    body = await request.arrayBuffer();
  } catch {
    return reply({ error: "The request body could not be read." }, 400);
  }
  if (body.byteLength === 0 || body.byteLength > 64 * 1024) {
    return reply({ error: "The JSON request body must be between 1 byte and 64 KB." }, 413);
  }

  let target: URL;
  try {
    target = new URL("/functions/v1/api-send", backendUrl);
  } catch {
    return reply({ error: "MobiWave messaging API is not configured." }, 503);
  }

  const upstreamHeaders = new Headers({ "Content-Type": "application/json" });
  if (apiKey) upstreamHeaders.set("X-API-Key", apiKey);
  if (authorization) upstreamHeaders.set("Authorization", authorization);
  upstreamHeaders.set("Idempotency-Key", idempotencyKey);

  try {
    const upstream = await fetch(target.toString(), {
      method: "POST",
      headers: upstreamHeaders,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    });

    if (upstream.status >= 300 && upstream.status < 400) {
      return reply({ error: "MobiWave messaging service is temporarily unavailable." }, 502);
    }

    const responseBody = await upstream.arrayBuffer();
    const responseContentType = upstream.headers.get("content-type");
    const responseHeaders = new Headers({ "Cache-Control": "no-store" });
    if (responseContentType) responseHeaders.set("Content-Type", responseContentType);
    return new Response(responseBody, { status: upstream.status, headers: responseHeaders });
  } catch {
    return reply({
      error: "MobiWave could not confirm the send request outcome. Reuse the same Idempotency-Key when checking or retrying.",
      status: "outcome_unknown",
    }, 504);
  }
}
