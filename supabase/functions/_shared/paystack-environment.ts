export function isTestPaystackKey(secretKey: string): boolean {
  return secretKey.startsWith("sk_test_");
}

export function isTestPaystackDomain(domain: unknown): boolean {
  return typeof domain === "string" && domain.trim().toLowerCase() === "test";
}
