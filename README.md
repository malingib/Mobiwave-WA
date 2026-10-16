# MobiWave WhatsApp

MobiWave WhatsApp is a multi-tenant WhatsApp messaging and automation platform for Kenyan businesses. WhatsApp transport is the official Meta Cloud API only; AI is an optional service layer.

## Current implementation

This branch contains a React/Vite dashboard and Supabase backend foundation for:
- Supabase Auth sign-in/sign-up and workspace creation.
- Tenant-scoped knowledge sources, bounded website ingestion, HTML/text extraction, content versioning, chunks and full-text retrieval.
- Curated AI memory, manual approval/rejection and review-only suggestions from resolved conversations.
- Grounded AI answer testing and optional inbound chatbot replies with human handoff.
- Official Meta Cloud API credential encryption, verification, template sync, signed webhooks, inbound message ingestion and delivery status updates.
- Contacts and consent state, shared inbox, human replies, approved-template campaign drafts and bounded sending batches.
- Row-level security policies, explicit authenticated Data API grants, tenant API keys, usage metering and signed customer webhooks with retryable deliveries.
- GitHub Actions build workflow.

This is **not yet deployed to a live Supabase or Meta environment**. Credentials, migrations, edge functions, Auth redirect settings, Meta webhook setup and the frontend deployment must be configured before production use. Review `docs/implementation-status.md` and `docs/environment-and-deployment.md`.

## Fixed product decisions

- **WhatsApp connectivity:** official Meta WhatsApp Cloud API only. No unofficial WhatsApp Web engines, QR pairing, WPPConnect, WAHA or Evolution API.
- **AI:** optional chatbot; campaigns and the shared inbox continue to function with AI disabled or unavailable.
- **Knowledge building:** only tenant-submitted URLs and the same host when explicitly selected are eligible for crawling. No general internet search fallback.
- **AI memory:** persistent tenant-scoped business memories are reviewed before use. The model is not retrained automatically.
- **Consent:** marketing campaigns require recorded opt-in and approved Meta templates. Opt-outs suppress campaign delivery. Human service replies are separately constrained to the 24-hour customer-service window.
- **Tenant isolation:** database policies and server-side membership checks are required for every customer operation.

## Local development

1. Install Node.js 22 or a supported current LTS.
2. Copy `.env.example` to `.env.local` and configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Install packages with `npm install`.
4. Run `npm run dev`.
5. Apply the SQL migrations and deploy Edge Functions before using persistent app actions.

No Docker dependency is required for frontend development. See `docs/environment-and-deployment.md` for Supabase secrets, Meta setup, and deployment steps.

## Security notes

Never commit service-role credentials, AI API keys, Meta tokens, app secrets, webhook tokens or real contact lists. The Meta access token is encrypted server-side with AES-GCM. The crawler limits size and page count, validates DNS/redirect targets, and does not crawl other hosts. DNS preflight alone cannot fully eliminate DNS-rebinding races; use an egress proxy enforcing destination IP policy for high-assurance production. Page content is untrusted data and cannot override system instructions.
