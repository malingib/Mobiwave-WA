export type PaystackSignatureSecrets = {
  webhookSigningSecret?: string;
  secretKey?: string;
};

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-f]{128}$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function hmacSha512(secret: string, message: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const messageBuffer = new ArrayBuffer(message.byteLength);
  new Uint8Array(messageBuffer).set(message);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, messageBuffer));
}

export async function verifyPaystackWebhookSignature(
  rawBody: Uint8Array,
  headers: Headers,
  secrets: PaystackSignatureSecrets,
  nowSeconds = Date.now() / 1000,
): Promise<boolean> {
  const modern = headers.get("Paystack-Signature");
  if (modern && secrets.webhookSigningSecret) {
    const fields = modern.split(",").map((part) => part.trim());
    const timestamp = fields.find((part) => part.startsWith("t="))?.slice(2);
    const signatures = fields
      .filter((part) => part.startsWith("v1="))
      .map((part) => part.slice(3).split(":", 2)[1] || "");
    const signedAt = Number(timestamp);
    if (!Number.isInteger(signedAt) || Math.abs(nowSeconds - signedAt) > 300 || signatures.length === 0) return false;

    const prefix = new TextEncoder().encode(`${timestamp}.`);
    const signedBody = new Uint8Array(prefix.length + rawBody.length);
    signedBody.set(prefix);
    signedBody.set(rawBody, prefix.length);
    const expected = await hmacSha512(secrets.webhookSigningSecret, signedBody);
    return signatures.some((signature) => {
      const received = hexToBytes(signature);
      return received !== null && constantTimeEqual(expected, received);
    });
  }

  // Backward compatibility for the deprecated X-Paystack-Signature header.
  const legacy = headers.get("X-Paystack-Signature");
  if (legacy && secrets.secretKey) {
    const received = hexToBytes(legacy);
    if (!received) return false;
    const expected = await hmacSha512(secrets.secretKey, rawBody);
    return constantTimeEqual(expected, received);
  }
  return false;
}
