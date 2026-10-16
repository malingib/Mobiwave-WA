export function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2) throw new Error("Invalid hex.");
  return new Uint8Array(hex.match(/.{2}/g)!.map((part) => parseInt(part, 16)));
}

export async function verifyMetaSignature(rawBody: string, signature: string | null): Promise<boolean> {
  const secret = Deno.env.get("META_APP_SECRET");
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const expected = "sha256=" + [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return mismatch === 0;
}

export async function decryptToken(ciphertext: string): Promise<string> {
  const keyHex = Deno.env.get("APP_ENCRYPTION_KEY");
  if (!keyHex || !/^[0-9a-f]{64}$/i.test(keyHex)) throw new Error("APP_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex characters.");
  const raw = hexToBytes(ciphertext);
  if (raw.length < 29) throw new Error("Encrypted token is invalid.");
  const key = await crypto.subtle.importKey("raw", hexToBytes(keyHex).slice().buffer as ArrayBuffer, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, key, raw.slice(12));
  return new TextDecoder().decode(plain);
}

export async function encryptToken(token: string): Promise<string> {
  const keyHex = Deno.env.get("APP_ENCRYPTION_KEY");
  if (!keyHex || !/^[0-9a-f]{64}$/i.test(keyHex)) throw new Error("APP_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex characters.");
  const key = await crypto.subtle.importKey("raw", hexToBytes(keyHex).slice().buffer as ArrayBuffer, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token)));
  const all = new Uint8Array(iv.length + cipher.length); all.set(iv); all.set(cipher, iv.length);
  return [...all].map((b) => b.toString(16).padStart(2, "0")).join("");
}
