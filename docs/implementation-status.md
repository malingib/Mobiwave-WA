# Implementation status

## Production foundation

The dashboard and backend foundation are merged into `main`. The existing Vercel production deployment was reported READY from commit `bd3f1b5aa789be07e691cdc0cede0c3651ef9897`; deployment readiness is not the same as a successful live end-to-end test.

## Implemented

- React/Vite dashboard with Supabase Auth UI and workspace selector.
- Messaging-first dashboard with no AI-provider dependency.
- Contacts, consent and opt-out state, shared inbox, agent replies, and conversation handoff.
- Official Meta WhatsApp Cloud API integration, encrypted stored credentials, template sync, signed inbound webhook handling, and message status ingestion.
- Campaign drafts and consent-checked, approved-template sending batches.
- Atomic campaign-recipient claims, unknown-send outcome protection, and no fixed monthly platform-message cap by default.
- Realtime shared inbox with per-agent unread state, assignments, filters, internal notes, paginated contact search, consent history, and guarded Meta media previews.
- Guided template-variable preview for text body/header and URL-button parameters.
- Tenant API keys, usage events, customer webhooks, and retryable webhook delivery worker.
- Supabase schema migrations, row-level security policies, CI type-check/build, and Vercel production environment variables for the frontend.

## Added production-readiness work

- Customer webhook delivery is concurrency-safe through a database atomic claim and two-minute lease shared by immediate and scheduled delivery paths.
- Supabase Cron is the sole scheduler for the customer and Meta webhook workers; both are active every minute. The GitHub Actions webhook-worker schedule has been removed.
- Worker authentication uses the internal function token stored in Supabase Vault and Edge Function secrets.
- The latest production Cron history was verified on 2026-11-03: both worker jobs succeeded for three consecutive minute intervals. This proves invocation only, not customer-endpoint delivery.

## Still requires account-owner configuration or real provider credentials

- Supabase Auth Site URL and redirect allowlist must be saved in the Supabase dashboard.
- Supabase Edge Function secrets must be entered securely in Supabase; this integration does not expose a secret-management operation.
- GitHub Actions repository secrets must be added securely in GitHub; this integration does not expose an Actions-secret write operation.
- Meta app/WABA/phone number/access token/webhook configuration must be completed in Meta and verified against an authorized test number.
- A controlled end-to-end delivery test against a dedicated HTTPS test receiver is still required; do not use a live customer endpoint.
- No live end-to-end WhatsApp test has been confirmed in this work session.

## Safety constraints

- Official Meta Cloud API only; no unofficial WhatsApp Web engines or QR pairing.
- Only tenant-submitted URLs are eligible for knowledge crawling; no general internet search fallback.
- AI, chatbot replies, website crawling and AI memory are excluded from the active product scope.
- Historical knowledge, AI-memory and chatbot tables remain in older migrations but are not active product features.
- Campaigns require recorded opt-in and approved templates; opted-out contacts are suppressed.
- Never put service-role keys, Meta tokens, encryption keys, AI provider keys, or internal tokens in browser variables or source control.

See `docs/production-go-live.md` and `docs/environment-and-deployment.md`.
