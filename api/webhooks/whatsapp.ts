export const config = { runtime: "edge" };

declare const process: { env: Record<string, string | undefined> };

const jsonHeaders = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed." }), {
      status: 405,
      headers: { ...jsonHeaders, Allow: "GET, POST" },
    });
  }

  const backendUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  if (!backendUrl) {
    return new Response(JSON.stringify({ error: "MobiWave WhatsApp webhook is not configured." }), {
      status: 503,
      headers: jsonHeaders,
    });
  }

  let target: URL;
  try {
    target = new URL("/functions/v1/meta-webhook", backendUrl);
    target.search = new URL(request.url).search;
  } catch {
    return new Response(JSON.stringify({ error: "MobiWave WhatsApp webhook is not configured." }), {
      status: 503,
      headers: jsonHeaders,
    });
  }

  const headers = new Headers();
  for (const name of ["content-type", "x-hub-signature-256", "user-agent", "accept"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  try {
    const upstream = await fetch(target.toString(), {
      method: request.method,
      headers,
      body: request.method === "POST" ? await request.arrayBuffer() : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(25000),
    });

    // Never redirect callers to the internal processing host.
    if (upstream.status >= 300 && upstream.status < 400) {
      return new Response(JSON.stringify({ error: "Webhook processing is temporarily unavailable." }), {
        status: 502,
        headers: jsonHeaders,
      });
    }

    // Avoid leaking backend diagnostics while allowing Meta to retry server failures.
    if (upstream.status >= 500) {
      return new Response(JSON.stringify({ error: "Webhook processing failed. Meta may retry this event." }), {
        status: upstream.status,
        headers: jsonHeaders,
      });
    }

    const responseHeaders = new Headers({ "Cache-Control": "no-store" });
    const contentType = upstream.headers.get("content-type");
    if (contentType) responseHeaders.set("Content-Type", contentType);
    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return new Response(JSON.stringify({ error: "Webhook processing is temporarily unavailable. Meta may retry this event." }), {
      status: 502,
      headers: jsonHeaders,
    });
  }
}
