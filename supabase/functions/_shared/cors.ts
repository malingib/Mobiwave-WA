export const corsHeaders = {
  // Production frontend origin. Keep this aligned with the Vercel custom domain.
  // The previous APP_ALLOWED_ORIGIN secret pointed at the retired Vercel alias.
  "Access-Control-Allow-Origin": "https://wap.mobiwave.co.ke",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, x-api-key, idempotency-key, content-type, x-hub-signature-256",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Vary": "Origin",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function readRequestText(request: Request, maxBytes: number): Promise<string | null> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function readRequestJson(request: Request, maxBytes = 128 * 1024): Promise<any> {
  const body = await readRequestText(request, maxBytes);
  if (body === null) throw new Error("Request body exceeds the allowed size.");
  if (!body.trim()) throw new Error("Request body is required.");
  try { return JSON.parse(body); }
  catch { throw new Error("Request body must contain valid JSON."); }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}
