# Paystack setup for MobiWave WA

## Environment and payment model

Start in Paystack **Test Mode**. MobiWave WA uses Paystack-hosted checkout for platform subscription invoices. The browser never receives a Paystack secret key and never supplies the payment amount. The checkout Edge Function calculates the outstanding invoice balance from the billing ledger.

The workspace's own M-Pesa/Daraja configuration is unrelated and is not used to pay MobiWave subscription invoices. Do not add a workspace Till, shortcode, consumer key, or passkey to Paystack checkout metadata.

## Paystack dashboard

1. Sign in to the MobiWave merchant Paystack account and enable **Test Mode**.
2. Open **Developers → API configuration** and copy the Test Secret Key (`sk_test_...`).
3. Under **Webhook signing secret**, generate a Test signing secret (`whsec_...`). Keep it separate from the API secret key.
4. Set the Test Webhook URL to:

   `https://jyjgvsljcmvbhovzevaz.supabase.co/functions/v1/paystack-webhook`

5. Confirm KES is enabled for the integration and that the account's available checkout channels include the payment methods MobiWave intends to offer (including M-PESA where enabled for the account).
6. Keep Live Mode disabled until the complete test and acceptance matrix has passed.

## Supabase Edge Function secrets

In the Supabase Dashboard, open project **Mobiwave WA** → **Edge Functions** → **Secrets** and add:

| Name | Value |
| --- | --- |
| `PAYSTACK_SECRET_KEY` | Test Secret Key beginning `sk_test_` |
| `PAYSTACK_WEBHOOK_SECRET` | Test webhook signing secret beginning `whsec_` |

Do not add either secret to Vercel, Vite variables, source code, SQL migrations, GitHub Actions variables, or browser storage. The Edge Functions use Supabase's built-in `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` environment variables.

No Paystack public key is needed for this hosted-checkout implementation.

## Deployed endpoint URLs

- Authenticated checkout: `https://jyjgvsljcmvbhovzevaz.supabase.co/functions/v1/create-subscription-checkout`
- Public signed webhook: `https://jyjgvsljcmvbhovzevaz.supabase.co/functions/v1/paystack-webhook`

The webhook URL entered in Paystack is the second URL above.

## Payment and settlement rules

- A customer can only initiate checkout for an invoice belonging to a workspace where they are a member.
- Amount, currency, invoice, and billing email are loaded or validated server-side.
- Checkout is for the exact outstanding invoice balance; partial payments and client-selected amounts are not accepted.
- The webhook signature is verified against the raw body. The timestamped `Paystack-Signature` header is preferred; legacy `X-Paystack-Signature` is supported only for transition.
- A successful webhook is independently verified against Paystack's Transaction Verify API.
- The invoice is settled once, using a unique provider reference. Duplicate webhook delivery is idempotent.
- Amount, currency, email, invoice balance, or reference mismatches are placed in manual review and do not activate a subscription.
- Only an invoice containing a monthly subscription line activates or reactivates the subscription. An assisted-setup-only invoice does not change subscription access.
- Paystack's merchant settlement configuration determines where funds settle. No customer workspace M-Pesa credentials or Till numbers are sent in the API request.

## Before enabling Live Mode

1. Apply and validate the Paystack billing migration.
2. Deploy both Edge Functions with JWT verification enabled for checkout and disabled for the signed webhook.
3. Set Test Mode secrets in Supabase.
4. Test a successful KES checkout, failed payment, abandoned checkout, duplicate webhook, invalid signature, stale signature, wrong amount, wrong currency, wrong email, wrong invoice, and concurrent checkout attempts.
5. Confirm the invoice is paid once, the ledger has one successful transaction, and only the correct subscription is activated.
6. Confirm the settlement appears in the MobiWave Paystack dashboard and matches the MobiWave merchant settlement configuration.
7. Only then replace the Test secrets with Live secrets and configure the separate Live webhook URL in Live Mode.
