import { requireUser, requireTenantRole } from "../_shared/auth.ts";
import { decryptToken } from "../_shared/meta.ts";
import { corsHeaders, json, errorMessage } from "../_shared/cors.ts";

const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") || "v23.0";
const maxBytes = 8 * 1024 * 1024;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const auth = await requireUser(request);
    const body = await request.json();
    const tenantId = String(body.tenant_id ?? "");
    const mediaId = String(body.media_id ?? "");
    if (!tenantId || !/^\d{5,80}$/.test(mediaId)) return json({ error: "A tenant and valid media id are required." }, 400);
    await requireTenantRole(auth.admin, tenantId, auth.userId, ["owner", "admin", "agent"]);
    const { data: message } = await auth.admin.from("messages").select("id").eq("tenant_id", tenantId).contains("metadata", { media_id: mediaId }).maybeSingle();
    if (!message) return json({ error: "Attachment not found in this workspace." }, 404);
    const { data: integration } = await auth.admin.from("meta_integrations").select("encrypted_access_token").eq("tenant_id", tenantId).eq("enabled", true).maybeSingle();
    if (!integration?.encrypted_access_token) return json({ error: "WhatsApp is not connected." }, 409);
    const token = await decryptToken(integration.encrypted_access_token);
    const metadataResponse = await fetch("https://graph.facebook.com/" + GRAPH_VERSION + "/" + mediaId, {
      headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(10000),
    });
    if (!metadataResponse.ok) return json({ error: "Meta could not provide this attachment." }, 502);
    const mediaUrl = String((await metadataResponse.json()).url ?? "");
    const parsed = new URL(mediaUrl);
    if (parsed.protocol !== "https:" || !(parsed.hostname === "lookaside.fbsbx.com" || parsed.hostname.endsWith(".fbcdn.net"))) return json({ error: "Meta returned an unsupported attachment host." }, 502);
    const mediaResponse = await fetch(parsed, { headers: { Authorization: "Bearer " + token }, redirect: "error", signal: AbortSignal.timeout(15000) });
    if (!mediaResponse.ok) return json({ error: "Attachment download failed." }, 502);
    const contentType = (mediaResponse.headers.get("content-type") ?? "application/octet-stream").split(";")[0].toLowerCase();
    const allowed = new Set(["image/jpeg", "image/png", "image/webp", "audio/ogg", "audio/mpeg", "audio/mp4", "video/mp4", "application/pdf", "application/octet-stream"]);
    if (!allowed.has(contentType)) return json({ error: "This attachment type cannot be previewed." }, 415);
    const length = Number(mediaResponse.headers.get("content-length") ?? 0);
    if (length > maxBytes) return json({ error: "Attachment exceeds the 8 MB preview limit." }, 413);
    const reader = mediaResponse.body?.getReader();
    if (!reader) return json({ error: "Attachment response was empty." }, 502);
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) { await reader.cancel(); return json({ error: "Attachment exceeds the 8 MB preview limit." }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let byteOffset = 0;
    for (const chunk of chunks) { bytes.set(chunk, byteOffset); byteOffset += chunk.length; }
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return json({ base64: btoa(binary), content_type: contentType });
  } catch (error) {
    const message = errorMessage(error);
    return json({ error: message }, /sign in|session is invalid/i.test(message) ? 401 : /permission/i.test(message) ? 403 : 400);
  }
});
