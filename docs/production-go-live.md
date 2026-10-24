# Production go-live checklist

This runbook is for the existing MobiWave WhatsApp deployment. Do not create another Vercel or Supabase project.

## Existing deployment

- Dashboard: https://wap.mobiwave.co.ke
- Git repository: https://github.com/malingib/Mobiwave-WA
- Supabase project ref: `jyjgvsljcmvbhovzevaz`
- Supabase function base: `https://jyjgvsljcmvbhovzevaz.supabase.co/functions/v1`
- Meta webhook callback: `https://wap.mobiwave.co.ke/api/webhooks/whatsapp`

The Vercel production deployment was reported READY and the production frontend variables were configured. READY means the deployment completed; it is not proof that sign-up, database access, or Meta messaging passed an end-to-end test.

## 1. Supabase Auth URLs

In Supabase Dashboard → Authentication → URL Configuration, set:

- Site URL: `https://wap.mobiwave.co.ke`
- Redirect URL allowlist: `https://wap.mobiwave.co.ke/**`
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
| `META_WEBHOOK_VERIFY_TOKEN` | Optional legacy verification token; new workspaces use a dashboard-generated token |
| `META_GRAPH_VERSION` | Supported Graph API version, e.g. the version configured for the Meta app |
| `INTERNAL_FUNCTION_TOKEN` | High-entropy random secret used to authorize internal worker calls |

Generate the encryption and internal tokens in a trusted password manager or local secure terminal. Do not send secrets in this chat or in issue/PR comments. Do not place server secrets in Vercel's `VITE_*` variables. The browser's Supabase publishable key is designed to be public; service-role keys are not.

After secrets are saved, verify that all deployed functions use the expected runtime variables. Rotate any credential that has been accidentally exposed.

## 3. Apply the latest database and Edge Function changes

Before testing the updated dashboard, apply the migration `20261024110000_inbox_collaboration_and_send_safety.sql` and deploy `campaign-launch`, `conversation-control`, `team-members`, `meta-webhook`, `meta-media`, `meta-send`, `api-send`, and `create-workspace`. This migration enables Realtime for inbox tables and adds consent history, per-agent read markers, private notes, unlimited-by-default message usage, and atomic campaign recipient claims.

## 4. Official Meta WhatsApp Cloud API

1. In Meta for Developers, select the correct app and add/configure the WhatsApp product.
2. Use the intended WhatsApp Business Account (WABA), phone number ID, and a long-lived/system-user access token with only the required permissions.
3. In Webhooks, configure the callback URL above and the workspace verification token shown in Integrations. Subscribe to WhatsApp `messages` events (this includes message status updates).
4. In the dashboard → Integrations, enter the phone number ID, WABA ID, and access token. Verify the connection and sync templates.
5. Test only with a Meta-authorized test recipient first. Confirm inbound messages, outbound template sends, and delivered/read/failed status updates.

Do not run campaigns until the Meta credentials, webhook signature verification, approved templates, and consent records have all been checked.

## 5. Scheduled customer webhook delivery worker

A GitHub Actions workflow at `.github/workflows/webhook-worker.yml` runs every five minutes and supports manual dispatch. It calls the authenticated Supabase `webhook-worker` function.

Add these three repository Actions secrets under GitHub → Settings → Secrets and variables → Actions:

- `SUPABASE_URL` = `https://jyjgvsljcmvbhovzevaz.supabase.co`
- `SUPABASE_PUBLISHABLE_KEY` = the project's publishable key
- `INTERNAL_FUNCTION_TOKEN` = exactly the same value configured as the Supabase Edge Function secret

The workflow fails clearly if a required secret is missing. GitHub schedule events can be delayed, so treat this as retry processing, not a real-time SLA. The worker processes a bounded batch each run and retries deliveries with backoff.

## 6. Controlled pilot checklist

- [ ] Auth: sign up, confirm email if enabled, sign in, sign out.
- [ ] Tenant isolation: create two test workspaces/accounts and verify neither can access the other's records.
- [ ] Consent: confirm contacts without recorded opt-in and opted-out contacts cannot enter a marketing send.
- [ ] Templates: sync and select a Meta-approved template only.
- [ ] WhatsApp: send one authorized test template; receive a reply; check inbox and message status.
- [ ] Inbox: confirm new messages arrive in real time; assign a conversation, add a private note, and verify unread state is per agent.
- [ ] Media: open an inbound attachment as an authorized workspace agent and verify unauthorized or cross-tenant requests fail.
- [ ] Webhooks: create a test customer endpoint and verify signed delivery, retries, and idempotency.
- [ ] Review Supabase Security Advisor after setup and monitor Edge Function logs during the pilot.

## Known scope limits

- Campaign launcher is intentionally bounded per invocation; run subsequent batches until the queue is drained.
- Campaign sends process at most ten recipients per invocation; unknown Meta send outcomes require manual review and must not be retried automatically.
- Media previews are limited to 8 MB per attachment.
- This is an MVP foundation. Before broad production rollout, add load/penetration tests, privacy/compliance review, backup/restore verification, alerting, and a review of usage limits and billing.
