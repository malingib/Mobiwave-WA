import {
  parsePaystackMode,
  paystackDomainMatchesMode,
  paystackEnvironmentIsValid,
  paystackKeyMatchesMode,
} from "./paystack-environment.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("requires an explicit supported Paystack mode", () => {
  assert(parsePaystackMode(undefined) === null, "missing mode must fail");
  assert(parsePaystackMode("") === null, "empty mode must fail");
  assert(parsePaystackMode("production") === null, "unsupported mode must fail");
  assert(parsePaystackMode(" TEST ") === "test", "test mode should normalize");
});

Deno.test("accepts only a secret key matching the configured mode", () => {
  assert(paystackKeyMatchesMode("sk_test_example", "test"), "test key must match test mode");
  assert(!paystackKeyMatchesMode("sk_live_example", "test"), "live key must not match test mode");
  assert(paystackKeyMatchesMode("sk_live_example", "live"), "live key must match live mode");
  assert(!paystackKeyMatchesMode("sk_test_example", "live"), "test key must not match live mode");
  assert(!paystackEnvironmentIsValid(undefined, "sk_test_example"), "missing mode must fail closed");
  assert(!paystackEnvironmentIsValid("test", "sk_live_example"), "mismatched key must fail closed");
  assert(paystackEnvironmentIsValid("test", "sk_test_example"), "matching test configuration must pass");
});

Deno.test("requires the verified Paystack transaction domain to match configured mode", () => {
  assert(paystackDomainMatchesMode("test", "test"), "test domain must match test mode");
  assert(!paystackDomainMatchesMode("live", "test"), "live transaction must be rejected in test mode");
  assert(!paystackDomainMatchesMode(undefined, "test"), "missing domain must fail closed");
  assert(!paystackDomainMatchesMode("test", "live"), "test transaction must be rejected in live mode");
});
