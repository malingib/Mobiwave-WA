import { checkTenantFeature, requireUser, requireTenantRole } from "../_shared/auth.ts";
import { decryptToken } from "../_shared/meta.ts";
import { corsHeaders, json, errorMessage, readRequestJson } from "../_shared/cors.ts";

const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") || "v23.0";
const maxBytes = 8 * 1024 * 1024;
const allowedTypes = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "audio/ogg", "audio/mpeg", "audio/mp4", "audio/aac", "audio/amr", "audio/webm",
  "video/mp4", "video/3gpp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword", "text/plain", "application/octet-stream",
]);

function isMetaMediaUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol === "https:" && (host === "lookaside.fbsbx.com" || host.endsWith(".fbcdn.net"))) return url;
    return null;
  } catch { return null; }
}

async function downloadMetaMedia(initialUrl: string, token: string): Promise<Response> {
  let current = isMetaMediaUrl(initialUrl);
  if (!current) throw new Error("Meta returned an unsupported attachment host.");
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetch(current, { headers: { Authorization: "Bearer " + token }, redirect: "manual", signal: AbortSignal.timeout(15000) });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("Meta attachment redirect did not include a destination.");
    const next = isMetaMediaUrl(new URL(location, current).toString());
    if (!next) throw new Error("Meta redirected the attachment to an unsupported host.");
    current = next;
  }
  throw new Error("Meta attachment exceeded the redirect limit.");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  let stage = "authentication";
  try {
    const auth = await requireUser(request);
    stage = "request";
    const body = await readRequestJson(request);
    const tenantId = String(body.tenant_id ?? "");
    const mediaId = String(body.media_id ?? "");
    if (!tenantId || !/^\d{5,80}$/.test(mediaId)) return json({ error: "A tenant and valid media id are required." }, 400);
    stage = "authorization";
    await requireTenantRole(auth.admin, tenantId, auth.userId, ["owner", "admin", "agent"]);
    const feature = await checkTenantFeature(auth.admin, tenantId, "inbox");
    if (feature.error) return json({ error: feature.error }, 503);
    if (!feature.allowed) return json({ error: "Inbox attachments are not included in this workspace plan." }, 403);
    const { data: message, error: messageError } = await auth.admin.from("messages").select("id").eq("tenant_id", tenantId).contains("metadata", { media_id: mediaId }).maybeSingle();
    if (messageError) throw new Error("Attachment authorization could not be verified.");
    if (!message) return json({ error: "Attachment not found in this workspace." }, 404);
    const { data: integration, error: integrationError } = await auth.admin.from("meta_integrations").select("encrypted_access_token").eq("tenant_id", tenantId).eq("enabled", true).maybeSingle();
    if (integrationError) throw new Error("WhatsApp connection could not be verified.");
    if (!integration?.encrypted_access_token) return json({ error: "WhatsApp is not connected." }, 409);
    const token = await decryptToken(integration.encrypted_access_token);
    stage = "meta_media_metadata";
    const metadataResponse = await fetch("https://graph.facebook.com/" + GRAPH_VERSION + "/" + mediaId, { headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(10000) });
    if (!metadataResponse.ok) {
      console.error("meta-media metadata request failed", { status: metadataResponse.status, mediaId });
      return json({ error: "Meta could not provide this attachment (HTTP " + metadataResponse.status + ")." }, 502);
    }
    const metadata = await metadataResponse.json();
    const mediaUrl = String(metadata?.url ?? "");
    if (!mediaUrl) return json({ error: "Meta did not return an attachment URL." }, 502);
    stage = "meta_media_download";
    const mediaResponse = await downloadMetaMedia(mediaUrl, token);
    if (!mediaResponse.ok) {
      console.error("meta-media download failed", { status: mediaResponse.status, mediaId });
      return json({ error: "Attachment download failed (HTTP " + mediaResponse.status + ")." }, 502);
    }
    const contentType = (mediaResponse.headers.get("content-type") ?? "application/octet-stream").split(";")[0].toLowerCase();
    if (!allowedTypes.has(contentType)) return json({ error: "This attachment type cannot be downloaded (" + contentType + ")." }, 415);
    const length = Number(mediaResponse.headers.get("content-length") ?? 0);
    if (length > maxBytes) return json({ error: "Attachment exceeds the 8 MB preview limit." }, 413);
    stage = "stream_media";
    if (!mediaResponse.body) return json({ error: "Attachment response was empty." }, 502);
    const safeFilename = String(body.filename ?? "WhatsApp attachment")
      .replace(/[\\r\\n"]/g, "_")
      .replace(/[\\/\\\\]/g, "_")
      .slice(0, 180) || "WhatsApp attachment";
    let streamedBytes = 0;
    const limitedBody = mediaResponse.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        streamedBytes += chunk.byteLength;
        if (streamedBytes > maxBytes) {
          controller.error(new Error("Attachment exceeds the 8 MB preview limit."));
          return;
        }
        controller.enqueue(chunk);
      },
    }));
    const disposition = contentType.startsWith("image/") || contentType.startsWith("audio/") || contentType.startsWith("video/")
      ? "inline"
      : "attachment";
    const headers = new Headers(corsHeaders);
    headers.set("Content-Type", contentType);
    headers.set("Content-Disposition", disposition + '; filename="' + safeFilename + '"');
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Vary", "Authorization");
    if (Number.isFinite(length) && length > 0) headers.set("Content-Length", String(length));
    return new Response(limitedBody, { status: 200, headers });
  } catch (error) {
    const message = errorMessage(error);
    console.error("meta-media request failed", { stage, error: message });
    return json({ error: message }, /sign in|session is invalid/i.test(message) ? 401 : /permission/i.test(message) ? 403 : 502);
  }
});
