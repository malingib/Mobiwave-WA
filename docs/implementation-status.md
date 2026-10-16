# Implementation status

## Production foundation

The dashboard and backend foundation are merged into `main`. The existing Vercel production deployment was reported READY from commit `bd3f1b5aa789be07e691cdc0cede0c3651ef9897`; deployment readiness is not the same as a successful live end-to-end test.

## Implemented

- React/Vite dashboard with Supabase Auth UI and workspace selector.
- Tenant-scoped knowledge sources and bounded website ingestion; full-text retrieval and curated AI memory review.
- Contacts, consent and opt-out state, shared inbox, agent replies, and conversation handoff.
- Official Meta WhatsApp Cloud API integration, encrypted stored credentials, template sync, signed inbound webhook handling, and message status ingestion.
- Campaign drafts and consent-checked, approved-template sending batches.
- Tenant API keys, usage events, customer webhooks, and retryable webhook delivery worker.
- Supabase schema migrations, row-level security policies, CI type-check/build, and Vercel production environment variables for the frontend.

## Added production-readiness work

- A GitHub Actions webhook worker schedule is defined in `.github/workflows/webhook-worker.yml` (every five minutes plus manual dispatch). It requires repository Actions secrets `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `INTERNAL_FUNCTION_TOKEN`.
- `docs/production-go-live.md` documents the existing production resources, exact Auth URL settings, Edge Function secrets, Meta webhook setup, worker setup, and controlled pilot checklist.

## Still requires account-owner configuration or real provider credentials

- Supabase Auth Site URL and redirect allowlist must be saved in the Supabase dashboard.
- Supabase Edge Function secrets must be entered securely in Supabase; this integration does not expose a secret-management operation.
- GitHub Actions repository secrets must be added securely in GitHub; this integration does not expose an Actions-secret write operation.
- Meta app/WABA/phone number/access token/webhook configuration must be completed in Meta and verified against an authorized test number.
- The worker schedule must be tested after its three GitHub secrets are added.
- No live end-to-end WhatsApp test has been confirmed in this work session.

## Safety constraints

- Official Meta Cloud API only; no unofficial WhatsApp Web engines or QR pairing.
- Only tenant-submitted URLs are eligible for knowledge crawling; no general internet search fallback.
- AI remains optional and starts disabled; suggested memories require human approval.
- Campaigns require recorded opt-in and approved templates; opted-out contacts are suppressed.
- Never put service-role keys, Meta tokens, encryption keys, AI provider keys, or internal tokens in browser variables or source control.

See `docs/production-go-live.md` and `docs/environment-and-deployment.md`.
