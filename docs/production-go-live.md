# Production go-live checklist

This runbook is for the existing MobiWave WhatsApp deployment. Do not create another Vercel or Supabase project.

## Existing deployment

- Dashboard: https://mobiwavewa.vercel.app
- Git repository: https://github.com/malingib/Mobiwave-WA
- Supabase project ref: `jyjgvsljcmvbhovzevaz`
- Supabase function base: `https://jyjgvsljcmvbhovzevaz.supabase.co/functions/v1`
- Meta webhook callback: `https://jyjgvsljcmvbhovzevaz.supabase.co/functions/v1/meta-webhook`

The Vercel production deployment was reported READY and the production frontend variables were configured. READY means the deployment completed; it is not proof that sign-up, database access, or Meta messaging passed an end-to-end test.

## 1. Supabase Auth URLs

In Supabase Dashboard → Authentication → URL Configuration, set:

- Site URL: `https://mobiwavewa.vercel.app`
- Redirect URL allowlist: `https://mobiwavewa.vercel.app/**`
- For local development only, add `http://localhost:5173/**` if needed.

Save, then test email/password sign-up and sign-in on the production dashboard. Do not add broad wildcard domains.

## 2. Supabase Edge Function secrets

In Supabase Dashboard → Edge Functions → Secrets, configure the following. Values must be created or copied from the relevant provider; never commit them or put them in `VITE_*` variables.

| Secret | Purpose |
|---|---|
| `SUPABASE_URL` | Project URL; available as a Supabase runtime variable in many deployments |
| `SUPABASE_ANON_KEY` | Legacy anon key used by request-scoped server clients where required |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only privileged database access |
| `APP_ENCRYPTION_KEY` | 32 random bytes encoded as 64 hexadecimal characters; losing it makes saved Meta credentials undecryptable |
| `META_APP_SECRET` | Verifies Meta webhook HMAC signatures |
| `META_WEBHOOK_VERIFY_TOKEN` | Random verification string entered in Meta webhook configuration |
| `META_GRAPH_VERSION` | Supported Graph API version, e.g. the version configured for the Meta app |
| `INTERNAL_FUNCTION_TOKEN` | High-entropy random secret used to authorize internal worker calls |
| `APP_ALLOWED_ORIGIN` | Exact dashboard origin: `https://mobiwavewa.vercel.app` |
| `OPENAI_API_KEY` | Optional; only required to enable AI replies and memory suggestions |
| `OPENAI_MODEL` | Optional model override if AI is enabled |

Generate the encryption and internal tokens in a trusted password manager or local secure terminal. Do not send secrets in this chat or in issue/PR comments. Do not place server secrets in Vercel's `VITE_*` variables. The browser's Supabase publishable key is designed to be public; service-role keys are not.

After secrets are saved, verify that all deployed functions use the expected runtime variables. Rotate any credential that has been accidentally exposed.

## 3. Official Meta WhatsApp Cloud API

1. In Meta for Developers, select the correct app and add/configure the WhatsApp product.
2. Use the intended WhatsApp Business Account (WABA), phone number ID, and a long-lived/system-user access token with only the required permissions.
3. In Webhooks, configure the callback URL above and the exact `META_WEBHOOK_VERIFY_TOKEN` value. Subscribe to WhatsApp `messages` events (this includes message status updates).
4. In the dashboard → Integrations, enter the phone number ID, WABA ID, and access token. Verify the connection and sync templates.
5. Test only with a Meta-authorized test recipient first. Confirm inbound messages, outbound template sends, and delivered/read/failed status updates.

Do not run campaigns until the Meta credentials, webhook signature verification, approved templates, and consent records have all been checked.

## 4. Scheduled customer webhook delivery worker

A GitHub Actions workflow at `.github/workflows/webhook-worker.yml` runs every five minutes and supports manual dispatch. It calls the authenticated Supabase `webhook-worker` function.

Add these three repository Actions secrets under GitHub → Settings → Secrets and variables → Actions:

- `SUPABASE_URL` = `https://jyjgvsljcmvbhovzevaz.supabase.co`
- `SUPABASE_PUBLISHABLE_KEY` = the project's publishable key
- `INTERNAL_FUNCTION_TOKEN` = exactly the same value configured as the Supabase Edge Function secret

The workflow fails clearly if a required secret is missing. GitHub schedule events can be delayed, so treat this as retry processing, not a real-time SLA. The worker processes a bounded batch each run and retries deliveries with backoff.

## 5. Controlled pilot checklist

- [ ] Auth: sign up, confirm email if enabled, sign in, sign out.
- [ ] Tenant isolation: create two test workspaces/accounts and verify neither can access the other's records.
- [ ] Knowledge: submit a website URL you are authorized to crawl; ingest and verify source status and evidence-based answers. Do not use the crawler as a general web search tool.
- [ ] Consent: confirm contacts without recorded opt-in and opted-out contacts cannot enter a marketing send.
- [ ] Templates: sync and select a Meta-approved template only.
- [ ] WhatsApp: send one authorized test template; receive a reply; check inbox and message status.
- [ ] Handoff: pause the bot and confirm a human reply is allowed only within the 24-hour service window.
- [ ] Webhooks: create a test customer endpoint and verify signed delivery, retries, and idempotency.
- [ ] Optional AI: configure the AI key only if required; verify unsupported questions hand off to a human.
- [ ] Review Supabase Security Advisor after setup and monitor Edge Function logs during the pilot.

## Known scope limits

- Campaign launcher is intentionally bounded per invocation; run subsequent batches until the queue is drained.
- Crawler supports bounded HTML/text extraction, not PDFs, authenticated pages, or JavaScript-rendered sites.
- This is an MVP foundation. Before broad production rollout, add load/penetration tests, privacy/compliance review, backup/restore verification, alerting, and a review of usage limits and billing.
