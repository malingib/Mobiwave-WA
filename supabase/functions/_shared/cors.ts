export const corsHeaders = {
  // Production frontend origin. Keep this aligned with the Vercel custom domain.
  // The previous APP_ALLOWED_ORIGIN secret pointed at the retired Vercel alias.
  "Access-Control-Allow-Origin": "https://wap.mobiwave.co.ke",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, x-api-key, content-type, x-hub-signature-256",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Vary": "Origin",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}
