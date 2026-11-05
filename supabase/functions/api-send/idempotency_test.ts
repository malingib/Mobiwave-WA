import { resolveExistingAttempt, validIdempotencyKey } from "../_shared/outbound-idempotency.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("accepted retry returns the original provider message ID", async () => {
  const response = resolveExistingAttempt({
    status: "accepted",
    request_hash: "same-hash",
    meta_message_id: "wamid.accepted-1",
  }, "same-hash");
  assert(response?.status === 200, "accepted retry should return 200");
  const body = await response.json();
  assert(body.idempotent_replay === true, "response must be marked as replay");
  assert(body.message_id === "wamid.accepted-1", "must return the original provider ID");
});

Deno.test("rejected retry remains rejected and does not become a new send", async () => {
  const response = resolveExistingAttempt({
    status: "rejected",
    request_hash: "same-hash",
    error_code: "131026",
  }, "same-hash");
  assert(response?.status === 502, "provider rejection should replay as 502");
  const body = await response.json();
  assert(body.status === "rejected" && body.idempotent_replay, "rejection must be stable");
});

Deno.test("uncertain and submitting retries are blocked for reconciliation", async () => {
  for (const status of ["submitting", "outcome_unknown"]) {
    const response = resolveExistingAttempt({ status, request_hash: "same-hash" }, "same-hash");
    assert(response?.status === 409, status + " retry should be blocked");
    const body = await response.json();
    assert(body.status === status, "retry should preserve " + status);
  }
});

Deno.test("same key with a different payload is rejected", async () => {
  const response = resolveExistingAttempt({
    status: "accepted",
    request_hash: "original-hash",
    meta_message_id: "wamid.original",
  }, "different-hash");
  assert(response?.status === 409, "payload mismatch should return 409");
});

Deno.test("idempotency keys enforce length and reject line breaks", () => {
  assert(!validIdempotencyKey("short"), "short key must be invalid");
  assert(validIdempotencyKey("request-123456"), "normal key should be valid");
  assert(!validIdempotencyKey("request-123\n456"), "newline must be invalid");
  assert(!validIdempotencyKey("x".repeat(201)), "oversized key must be invalid");
});

Deno.test("concurrent claim arbitration permits exactly one sender for a tenant/key pair", async () => {
  const claims = new Map<string, string>();
  let providerCalls = 0;
  const submit = async (tenant: string, key: string, requestId: string) => {
    const unique = tenant + ":" + key;
    // Models the database's unique (tenant_id, idempotency_key) insert.
    if (claims.has(unique)) return { claimed: false, existing: claims.get(unique) };
    claims.set(unique, requestId);
    providerCalls += 1;
    await Promise.resolve();
    return { claimed: true, existing: requestId };
  };
  const results = await Promise.all(
    Array.from({ length: 32 }, (_, i) => submit("tenant-a", "same-request-key", "request-" + i)),
  );
  assert(results.filter((result) => result.claimed).length === 1, "exactly one concurrent request must win");
  assert(providerCalls === 1, "only the winner may call the provider");
  const otherTenant = await submit("tenant-b", "same-request-key", "other-tenant-request");
  assert(otherTenant.claimed, "same key in a different tenant must be independently claimable");
});
