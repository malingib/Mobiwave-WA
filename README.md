# MobiWave WhatsApp

MobiWave WhatsApp is a multi-tenant WhatsApp messaging and automation platform for Kenyan businesses. WhatsApp connectivity uses the official Meta Cloud API only. AI, chatbot, website crawling and AI-memory features are out of scope; messaging must not depend on AI providers.

## Production resources

- Dashboard: https://mobiwavewa.vercel.app
- Repository: https://github.com/malingib/Mobiwave-WA
- Supabase project ref: `jyjgvsljcmvbhovzevaz`

The frontend has been deployed to the existing Vercel project and the Supabase database migrations and Edge Functions are present in the connected project. A READY deployment and passing CI confirm deployment/build status, not full live behavior. Auth URL configuration, server-side secrets, Meta webhook registration and an end-to-end test with an authorized Meta test number remain required before sending real campaigns.

**Start with [Production go-live checklist](docs/production-go-live.md)** for exact Auth URLs, server secrets, Meta configuration and the scheduled retry worker. Also see [Environment and deployment](docs/environment-and-deployment.md) and [Implementation status](docs/implementation-status.md).

## Current capabilities

- Supabase Auth sign-in/sign-up and workspace creation.
- Human-operated shared inbox, contact consent and opt-out management, approved-template campaigns, message status tracking and delivery retries.
- Official Meta Cloud API credential encryption, verification, template sync, signed webhooks, inbound message ingestion and delivery status updates.
- Contacts and consent state, shared inbox, human replies, approved-template campaign drafts and bounded sending batches.
- Row-level security policies, explicit authenticated Data API grants, tenant API keys, usage metering and signed customer webhooks with retryable deliveries.
- GitHub Actions build/type-check workflow and a scheduled customer-webhook retry workflow (requires repository secrets).

## Fixed product decisions

- **WhatsApp connectivity:** official Meta WhatsApp Cloud API only. No unofficial WhatsApp Web engines, QR pairing, WPPConnect, WAHA or Evolution API.
- **AI:** intentionally excluded from the product so production operation does not depend on AI keys, models, crawling or generated memory.
- **AI memory:** persistent tenant-scoped business memories are reviewed before use. The model is not retrained automatically.
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

Never commit service-role credentials, AI API keys, Meta tokens, app secrets, webhook tokens or real contact lists. The Meta access token is encrypted server-side with AES-GCM. The crawler limits size and page count, validates DNS/redirect targets, and does not crawl other hosts. DNS preflight alone cannot fully eliminate DNS-rebinding races; use an egress proxy enforcing destination IP policy for high-assurance production. Page content is untrusted data and cannot override system instructions.
