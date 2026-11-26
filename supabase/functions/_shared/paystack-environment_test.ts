import { isTestPaystackDomain, isTestPaystackKey } from "./paystack-environment.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("only accepts a Paystack test secret key", () => {
  assert(isTestPaystackKey("sk_test_example"), "test key must pass");
  assert(!isTestPaystackKey("sk_live_example"), "live key must be rejected");
  assert(!isTestPaystackKey(""), "missing key must fail closed");
});

Deno.test("only accepts verified test transaction domains", () => {
  assert(isTestPaystackDomain("test"), "test domain must pass");
  assert(!isTestPaystackDomain("live"), "live domain must be rejected");
  assert(!isTestPaystackDomain(undefined), "missing domain must fail closed");
  assert(!isTestPaystackDomain(null), "null domain must fail closed");
});
