export type PaystackMode = "test" | "live";

export function parsePaystackMode(value: string | undefined): PaystackMode | null {
  const normalized = value?.trim().toLowerCase();
  return normalized === "test" || normalized === "live" ? normalized : null;
}

export function paystackKeyMatchesMode(secretKey: string, mode: PaystackMode): boolean {
  return mode === "test" ? secretKey.startsWith("sk_test_") : secretKey.startsWith("sk_live_");
}

export function paystackDomainMatchesMode(domain: unknown, mode: PaystackMode): boolean {
  return typeof domain === "string" && domain.trim().toLowerCase() === mode;
}

export function paystackEnvironmentIsValid(
  configuredMode: string | undefined,
  secretKey: string,
): configuredMode is PaystackMode {
  const mode = parsePaystackMode(configuredMode);
  return mode !== null && paystackKeyMatchesMode(secretKey, mode);
}
