import { json } from "./cors.ts";

export async function hashRequest(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function validIdempotencyKey(value: string): boolean {
  return value.length >= 8 && value.length <= 200 && !/[\\r\\n]/.test(value);
}

export function replayResponse(attempt: Record<string, unknown>): Response {
  const status = attempt.status;
  if (status === "accepted" && attempt.meta_message_id) {
    return json({ ok: true, message_id: attempt.meta_message_id, status: "sent_to_meta", idempotent_replay: true });
  }
  if (status === "rejected") {
    const limited = attempt.error_code === "monthly_limit_reached";
    return json({
      error: limited
        ? "The original request was rejected because the workspace reached its monthly message limit."
        : "The original request was rejected by Meta. Use a new idempotency key for a new attempt.",
      status: "rejected",
      idempotent_replay: true,
    }, limited ? 429 : 502);
  }
  return json({
    error: "A request with this idempotency key is already being processed or has an uncertain provider outcome. Do not retry with a new key until it has been reconciled.",
    status,
    idempotent_replay: true,
  }, 409);
}

export function resolveExistingAttempt(
  attempt: Record<string, unknown> | null,
  requestHash: string,
): Response | null {
  if (!attempt) return null;
  if (attempt.request_hash !== requestHash) {
    return json({ error: "This Idempotency-Key was already used with a different request payload." }, 409);
  }
  return replayResponse(attempt);
}
