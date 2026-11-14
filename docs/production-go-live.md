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

Team invitations use Supabase Auth `inviteUserByEmail`. Configure a production SMTP provider and confirm the invitation email template is enabled. Keep `https://wap.mobiwave.co.ke/login` on the redirect allowlist, then send an invitation to a controlled test address and verify that accepting it returns to the dashboard with the invited workspace available. The Supabase default email service is not suitable for dependable production delivery.

Save, then test email/password sign-up and sign-in on the production dashboard. Do not add broad wildcard domains.

Live config was updated on 2026-11-13 to use `https://wap.mobiwave.co.ke` as both Site URL and the only redirect pattern, matching the active CORS origin and invitation callback. Email confirmation is required. Leaked-password protection remains disabled: the Management API returned HTTP 402 when enabling it, so revisit it if the project plan/configuration changes. Invitation SMTP and acceptance still need a controlled test.

## 2. Supabase Edge Function secrets

In Supabase Dashboard → Edge Functions → Secrets, configure the following. Values must be created or copied from the relevant provider; never commit them or put them in `VITE_*` variables.

| Secret | Purpose |
|---|---|
| `SUPABASE_URL` | Project URL; available as a Supabase runtime variable in many deployments |
| `SUPABASE_ANON_KEY` | Legacy anon key used by request-scoped server clients where required |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only privileged database access |
| `APP_ENCRYPTION_KEY` | 32 random bytes encoded as 64 hexadecimal characters; losing it makes saved Meta credentials undecryptable |
| `META_WEBHOOK_VERIFY_TOKEN` | Optional legacy verification token; new workspaces use a dashboard-generated token |
| `META_GRAPH_VERSION` | Supported Graph API version, e.g. the version configured for the Meta app |
| `INTERNAL_FUNCTION_TOKEN` | High-entropy random secret used to authorize internal worker calls |

Generate the encryption and internal tokens in a trusted password manager or local secure terminal. Do not send secrets in this chat or in issue/PR comments. Do not place server secrets in Vercel's `VITE_*` variables. The browser's Supabase publishable key is designed to be public; service-role keys are not.

After secrets are saved, verify that all deployed functions use the expected runtime variables. Rotate any credential that has been accidentally exposed.

## 3. Provision platform access, then apply the latest database and Edge Function changes

Each client connects its own Meta app and saves that app's secret in its business account under Integrations. The app secret is encrypted per tenant with `APP_ENCRYPTION_KEY`; it is never entered in the platform console or returned to the browser.

Platform-console access is separate from client workspace membership and client `owner` roles. Only provision a dedicated MobiWave platform operator if cross-tenant operations access is needed. Do not grant that role to a client account. Run this from the Supabase SQL editor after the operator's account exists:

```sql
insert into public.platform_admins (user_id, role)
select id, 'owner'
from auth.users
where lower(email) = lower('DEDICATED_PLATFORM_OWNER_EMAIL')
on conflict (user_id) do update set role = 'owner';
```

Platform owner access grants the aggregate `/admin` console and the owner-only billing ledger; client workspace owner/admin roles remain tenant-scoped. Billing tools cover customer records and manual invoicing/payment reconciliation, not automatic charging. Active tier agreements apply the configured six feature flags plus team and monthly message limits; feature checks run in workspace UI, RLS policies, and privileged send/configuration functions. Agreement status alone does not suspend a workspace. Monthly AI request limits remain catalog metadata because AI is not an active product feature.

As of 2026-11-13, production has the `platform_admins`, `tenant_meta_app_secrets`, `monotonic_message_status`, `campaign_controls`, `tenant_overview_metrics`, `validate_tenant_relationships`, `security_performance_hardening`, `reduce_select_policy_overlap`, `platform_billing_management`, and `platform_billing_fk_indexes` migrations applied. All 19 local Edge Functions are active. The 18 tenant-matching constraints were validated after their historical mismatch checks returned zero. The migrations were applied through the token-authenticated Supabase Management API; the ledger uses execution-time versions that differ from several local migration filenames. Do not use `supabase db push` until migration history has been reconciled; replaying old local migrations could damage production.

The inbox migration enables Realtime and adds consent history, per-agent read markers, private notes, unlimited-by-default message usage, and atomic campaign recipient claims. The status migration makes message and campaign delivery-state updates atomic and monotonic under concurrent webhook events, serializes monthly quota claims across parallel dashboard, API, and campaign sends, and adds tenant-matching foreign keys for related records. The campaign-controls migration gates claims on campaign state and makes pause/cancel releases atomic. The overview migration adds exact tenant-authorized dashboard aggregates and a supporting message timestamp index. The validation migration confirms historical relationships match tenant IDs; the hardening migration adds foreign-key support indexes and explicitly revokes anonymous execution of the platform overview RPC. The policy migration separates writes from member reads to remove duplicate SELECT-policy evaluations while preserving the existing tenant-role predicates.

The 18 tenant-matching foreign keys are now validated in production (`pg_constraint.convalidated = true` for each). Their historical cross-tenant mismatch checks returned zero before validation. The assignee constraint clears assignments when a workspace membership is deleted; conversation read markers are removed with their membership. Recheck the constraints after future data migrations that change these relationships.

## 4. Official Meta WhatsApp Cloud API

1. In Meta for Developers, select the correct app and add/configure the WhatsApp product.
2. Use the intended WhatsApp Business Account (WABA), phone number ID, and a long-lived/system-user access token with only the required permissions.
3. In the Meta app's Webhooks product, configure the callback URL above and the workspace verification token shown in Integrations. Subscribe to WhatsApp `messages` events (and `message_template_status_update` if template review updates are needed).
4. In each client's dashboard → Integrations, enter its phone number ID, WABA ID, access token, and Meta app secret. Verify the connection; MobiWave checks the phone number and subscribes the app to that WABA through `POST /{WABA-ID}/subscribed_apps`. The access token must have the required WhatsApp Business Management permission.
5. Test only with a Meta-authorized recipient by sending a WhatsApp message to the connected Cloud API business number. Confirm the inbound message appears in Inbox, then verify outbound template sends and delivered/read/failed status updates.

Do not run campaigns until the Meta credentials, webhook signature verification, approved templates, and consent records have all been checked.

## 5. Scheduled customer webhook delivery worker

Supabase Cron is configured as the scheduler for both webhook workers. The last recorded production check found both jobs active on a one-minute schedule on 2026-11-03; verify current job status before launch:

- `mobiwave-webhook-worker` → `/functions/v1/webhook-worker`
- `mobiwave-meta-webhook-worker` → `/functions/v1/meta-webhook-worker`

The worker endpoints authenticate internal calls with `INTERNAL_FUNCTION_TOKEN`. The token is stored in Supabase Vault and the Edge Function environment; never expose it in source control or client code. GitHub Actions does not schedule or invoke either worker.

Customer webhook delivery uses a database-side atomic claim and a two-minute lease. The immediate-send and scheduled-worker paths share the same claim operation, use stable idempotency keys, and apply bounded retries with a terminal dead-letter state. External HTTP delivery remains at-least-once; receivers should deduplicate using the supplied idempotency key because exactly-once delivery cannot be guaranteed across network timeouts.

The production Cron history snapshot from 2026-11-03 shows both jobs succeeded every minute from 09:03 through 09:10 UTC. The corresponding pg_net responses at 09:08, 09:09 and 09:10 were HTTP 200 with valid worker JSON responses. Queue counts were zero, so this verifies worker invocation and idle-queue handling at that time, not current job health or successful delivery to a customer's external endpoint.

Database acceptance tests on 2026-11-03 verified customer-delivery first claim, concurrent duplicate suppression (two simultaneous RPC calls produced one claim and one empty result), expired-lease reclaim, and dead-lettering at the eight-attempt limit. A separate simultaneous-claim test of `claim_meta_webhook_events` likewise produced one claim and one empty result. All synthetic tenant, webhook, delivery and Meta event fixtures were deleted after the tests; no outbound HTTP request or Meta side effect was triggered.

## 6. Controlled pilot checklist

- [ ] Auth: sign up, confirm email if enabled, sign in, sign out.
- [ ] Team access: invite a new email and an existing account, confirm role limits (only owners can invite admins), accept the email invitation, and verify the workspace is available after sign-in.
- [ ] Tenant isolation: create two test workspaces/accounts and verify neither can access the other's records.
- [ ] Consent: confirm contacts without recorded opt-in and opted-out contacts cannot enter a marketing send.
- [ ] Templates: sync and select a Meta-approved template only.
- [ ] Campaign controls: pause and resume a multi-batch campaign, cancel a campaign with queued recipients, and confirm the active Meta request may finish while later sends stop.
- [ ] WhatsApp: send one authorized test template; receive a reply; check inbox and message status.
- [ ] Inbox: confirm new messages arrive in real time; assign a conversation, add a private note, and verify unread state is per agent.
- [ ] Media: open an inbound attachment as an authorized workspace agent and verify unauthorized or cross-tenant requests fail.
- [ ] Webhooks: create a dedicated test customer endpoint and verify signed delivery, retries, lease recovery, and idempotency; never use a real customer endpoint for synthetic tests.
- [ ] Review Supabase Security Advisor after setup and monitor Edge Function logs during the pilot.

## Known scope limits

- Campaigns do not auto-launch at a scheduled time or drain their queue in the background; an operator resumes each bounded batch. A batch processes at most ten recipients and yields after 90 seconds to stay below the Edge Function request timeout.
- Unknown Meta send outcomes require manual review and must not be retried automatically.
- Media previews are limited to 8 MB per attachment.
- Pricing cards open an email enquiry and remain indicative. The platform-owner console supports configurable KES/USD tiers, per-tier feature flags, client billing profiles, manually recorded agreements, invoices that can be printed/saved as PDF, external payment records with audited reversals, and voiding unpaid invoices. There is no payment gateway, invoice-email delivery, automated renewal, tax calculation, or customer billing portal. Active tier assignments enforce configured capabilities and team/message limits; agreement status alone does not suspend or unlock a workspace. Confirm contract prices and tax treatment before issuing invoices.
- This remains an MVP foundation. Before broad production rollout, complete load and penetration tests, privacy/compliance review, alerting, and a review of usage limits and billing.
