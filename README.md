# MobiWave WhatsApp

MobiWave WhatsApp is a multi-tenant WhatsApp messaging and automation platform for Kenyan businesses. WhatsApp connectivity uses the official Meta Cloud API only. AI, chatbot, website crawling and AI-memory features are out of scope; messaging must not depend on AI providers.

## Production resources

- Dashboard: https://wap.mobiwave.co.ke
- Repository: https://github.com/malingib/Mobiwave-WA
- Supabase project ref: `jyjgvsljcmvbhovzevaz`

The frontend has been deployed to the existing Vercel project and the Supabase database migrations and Edge Functions are present in the connected project. A READY deployment and passing CI confirm deployment/build status, not full live behavior. Auth URL configuration, server-side secrets, Meta webhook registration and an end-to-end test with an authorized Meta test number remain required before sending real campaigns.

**Start with [Production go-live checklist](docs/production-go-live.md)** for exact Auth URLs, server secrets, Meta configuration and the scheduled retry worker. Also see [Environment and deployment](docs/environment-and-deployment.md) and [Implementation status](docs/implementation-status.md).

## Current capabilities

- Supabase Auth sign-in/sign-up and workspace creation.
- Human-operated shared inbox, contact consent and opt-out management, approved-template campaigns, message status tracking and delivery retries.
- Realtime inbox updates, assignment, status/unread/assignee filters, per-agent unread markers, internal notes, and guarded attachment previews.
- Paginated server-side contact search and a consent-change audit history, including inbound opt-out signals.
- Guided Meta template-variable preview for campaign body/header fields and URL buttons; media-header templates are clearly blocked until upload support exists.
- Campaign recipients are claimed atomically; unknown provider outcomes are held for review instead of retried, with no fixed monthly message cap by default.
- Official Meta Cloud API credential encryption, verification, template sync, signed webhooks, inbound message ingestion and delivery status updates.
- Contacts and consent state, shared inbox, human replies, approved-template campaign drafts and bounded sending batches.
- Row-level security policies, explicit authenticated Data API grants, tenant API keys, usage metering and signed customer webhooks with retryable deliveries.
- GitHub Actions build/type-check workflow and a scheduled customer-webhook retry workflow (requires repository secrets).

## Fixed product decisions

- **WhatsApp connectivity:** official Meta WhatsApp Cloud API only. No unofficial WhatsApp Web engines, QR pairing, WPPConnect, WAHA or Evolution API.
- **AI and crawling:** intentionally excluded from the active product. Earlier migrations retain unused knowledge and memory tables for compatibility; do not expose or expand them as product features.
- **Consent:** marketing campaigns require recorded opt-in and approved Meta templates. Opt-outs suppress campaign delivery. Human service replies are separately constrained to the 24-hour customer-service window.
- **Tenant isolation:** database policies and server-side membership checks are required for every customer operation.

## Local development

1. Install Node.js 22 or a supported current LTS.
2. Copy `.env.example` to `.env.local` and configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Install packages with `npm install`.
4. Run `npm run dev`.
5. Apply migrations and deploy Edge Functions before using persistent app actions.

No Docker dependency is required for frontend development.

## Security notes

Never commit service-role credentials, Meta tokens, app secrets, webhook tokens or real contact lists. The Meta access token is encrypted server-side with AES-GCM. Supabase service-role credentials must remain server-side.
