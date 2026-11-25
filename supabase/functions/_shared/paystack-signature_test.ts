import { verifyPaystackWebhookSignature } from "./paystack-signature.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function sign(secret: string, message: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  return [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const output = new Uint8Array(left.length + right.length);
  output.set(left);
  output.set(right, left.length);
  return output;
}

Deno.test("accepts a timestamped Paystack-Signature over the exact raw body", async () => {
  const secret = "whsec_test_signing_secret";
  const timestamp = 1_800_000_000;
  const body = new TextEncoder().encode('{"event":"charge.success","data":{"amount":500000}}');
  const signature = await sign(secret, concat(new TextEncoder().encode(`${timestamp}.`), body));
  const headers = new Headers({ "Paystack-Signature": `t=${timestamp},v1=whk_test:${signature}` });
  assert(await verifyPaystackWebhookSignature(body, headers, { webhookSigningSecret: secret }, timestamp), "valid timestamped signature must pass");
});

Deno.test("rejects stale timestamped Paystack events", async () => {
  const secret = "whsec_test_signing_secret";
  const timestamp = 1_800_000_000;
  const body = new TextEncoder().encode('{"event":"charge.success"}');
  const signature = await sign(secret, concat(new TextEncoder().encode(`${timestamp}.`), body));
  const headers = new Headers({ "Paystack-Signature": `t=${timestamp},v1=whk_test:${signature}` });
  assert(!await verifyPaystackWebhookSignature(body, headers, { webhookSigningSecret: secret }, timestamp + 301), "stale signature must fail");
});

Deno.test("rejects a modified raw webhook body", async () => {
  const secret = "whsec_test_signing_secret";
  const timestamp = 1_800_000_000;
  const signedBody = new TextEncoder().encode('{"event":"charge.success"}');
  const tamperedBody = new TextEncoder().encode('{"event":"charge.failed"}');
  const signature = await sign(secret, concat(new TextEncoder().encode(`${timestamp}.`), signedBody));
  const headers = new Headers({ "Paystack-Signature": `t=${timestamp},v1=whk_test:${signature}` });
  assert(!await verifyPaystackWebhookSignature(tamperedBody, headers, { webhookSigningSecret: secret }, timestamp), "modified body must fail");
});

Deno.test("accepts any valid v1 signature during signing-secret rotation", async () => {
  const secret = "whsec_current_secret";
  const timestamp = 1_800_000_000;
  const body = new TextEncoder().encode('{"event":"charge.success"}');
  const signature = await sign(secret, concat(new TextEncoder().encode(`${timestamp}.`), body));
  const headers = new Headers({ "Paystack-Signature": `t=${timestamp},v1=whk_old:00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000,v1=whk_new:${signature}` });
  assert(await verifyPaystackWebhookSignature(body, headers, { webhookSigningSecret: secret }, timestamp), "one valid rotated signature must pass");
});

Deno.test("supports the legacy X-Paystack-Signature until the new signing secret is active", async () => {
  const secret = "sk_test_legacy_secret";
  const body = new TextEncoder().encode('{"event":"charge.success"}');
  const signature = await sign(secret, body);
  const headers = new Headers({ "X-Paystack-Signature": signature });
  assert(await verifyPaystackWebhookSignature(body, headers, { secretKey: secret }), "valid legacy signature must pass");
});
