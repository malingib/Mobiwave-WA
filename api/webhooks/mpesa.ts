export const config = { runtime: "edge" };

declare const process: { env: Record<string, string | undefined> };

const jsonHeaders = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

// M-Pesa Daraja callbacks are forwarded to the Supabase edge function.
// The callback URL configured in Daraja must be /api/webhooks/mpesa.
export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed." }), {
      status: 405,
      headers: { ...jsonHeaders, Allow: "POST" },
    });
  }

  const backendUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  if (!backendUrl) {
    return new Response(JSON.stringify({ error: "MobiWave M-Pesa webhook is not configured." }), {
      status: 503,
      headers: jsonHeaders,
    });
  }

  let target: URL;
  try {
    target = new URL("/functions/v1/mpesa-webhook", backendUrl);
  } catch {
    return new Response(JSON.stringify({ error: "MobiWave M-Pesa webhook is not configured." }), {
      status: 503,
      headers: jsonHeaders,
    });
  }

  try {
    const raw = await request.arrayBuffer();
    if (raw.byteLength > 128 * 1024) {
      return new Response(JSON.stringify({ error: "Payload too large." }), { status: 413, headers: jsonHeaders });
    }
    const upstream = await fetch(target.toString(), {
      method: "POST",
      headers: { "Content-Type": request.headers.get("content-type") || "application/json" },
      body: raw,
      redirect: "manual",
      signal: AbortSignal.timeout(25000),
    });
    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: { "Cache-Control": "no-store", "Content-Type": upstream.headers.get("content-type") || "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "M-Pesa webhook processing is temporarily unavailable." }), {
      status: 502,
      headers: jsonHeaders,
    });
  }
}
