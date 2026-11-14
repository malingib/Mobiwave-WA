# Implementation status

## Production foundation

The dashboard and backend foundation are merged into `main`. The existing Vercel production deployment was reported READY from commit `bd3f1b5aa789be07e691cdc0cede0c3651ef9897`; deployment readiness is not the same as a successful live end-to-end test.

## Implemented

- React/Vite dashboard with Supabase Auth UI and workspace selector.
- Messaging-first dashboard with no AI-provider dependency.
- Contacts, consent and opt-out state, shared inbox, agent replies, and conversation handoff.
- Tenant-scoped Meta WhatsApp Cloud API access tokens and app secrets, encrypted storage, template sync, signed inbound webhook handling, and message status ingestion.
- Campaign drafts and consent-checked, approved-template sending batches with server-guarded pause, resume, and cancel controls.
- Atomic campaign-recipient claims, unknown-send outcome protection, and no fixed monthly platform-message cap by default.
- Campaign state transitions are serialized with recipient claims; paused/cancelled states are preserved by batch finalization, queued recipients are skipped on cancellation, and claimed recipients are released safely when a worker observes a control action.
- Realtime shared inbox with per-agent unread state, assignments, filters, internal notes, paginated contact search, consent history, and guarded Meta media previews.
- Guided template-variable preview for text body/header and URL-button parameters.
- Tenant API keys, usage events, customer webhooks, and retryable webhook delivery worker.
- Platform owner client overview and owner-only manual billing ledger: KES/USD tier catalog, client billing profiles, tier assignment, invoices, payment entries/reversals, voids, and audit records.
- All six tier capabilities are configurable and, for active agreements, applied through workspace navigation, RLS policies, and privileged messaging/API/template/webhook functions. Team and monthly message limits remain enforced; the AI request allowance is reserved for future product use.
- Supabase schema migrations, row-level security policies, CI type-check/build, and Vercel production environment variables for the frontend.

## Added production-readiness work

- Customer webhook delivery is concurrency-safe through a database atomic claim and two-minute lease shared by immediate and scheduled delivery paths.
- Manual webhook test and retry actions are due immediately before claiming; the scheduled delivery worker stops selecting new work after a 90-second safety budget, leaving unclaimed deliveries for the next run.
- Meta webhook and public message API request bodies are bounded during streaming reads before parsing.
- Inbound opt-out words are acknowledged only after the tenant contact suppression update succeeds; failures leave the durable Meta event retryable.
- Customer webhook configuration lookup failures now use delivery retry/backoff instead of being misclassified as a deleted subscription.
- Manually retrying a failed/dead customer webhook starts a new bounded attempt cycle, so dead-letter deliveries are actually claimable again.
- Meta webhook tenant-lookup failures now trigger provider retry, and inbound/status customer-webhook queue writes must persist before the durable Meta event is finalized.
- Accepted sends that lose message-history or usage persistence remain reported as Meta-accepted, create a workspace alert when possible, and surface a warning in dashboard/API/campaign responses.
- Supabase Cron is the configured scheduler for the customer and Meta webhook workers; the last documented production check on 2026-11-03 found both active every minute. Reconfirm current status before launch. The GitHub Actions webhook-worker schedule has been removed.
- Worker authentication uses the internal function token stored in Supabase Vault and Edge Function secrets.
- The latest production Cron history was verified on 2026-11-03: both jobs succeeded every minute through 09:10 UTC; pg_net returned HTTP 200 for both workers. The queues were empty, so no customer/Meta delivery was exercised.
- Concurrent database tests verified that customer webhook and Meta event claims are exclusive under two simultaneous RPC calls. Customer retry/lease recovery and terminal dead-letter behavior were also tested. All synthetic rows were removed; no external HTTP or Meta side effect was triggered.

## Still requires account-owner configuration or real provider credentials

- Supabase Auth Site URL and redirect allowlist must be saved in the Supabase dashboard.
- Supabase Auth leaked-password protection is disabled per Security Advisor and must be enabled by an authorized project owner in Auth → Settings → Password Security.
- Supabase Edge Function secrets must be entered securely in Supabase; this integration does not expose a secret-management operation.
- GitHub Actions repository secrets must be added securely in GitHub; this integration does not expose an Actions-secret write operation.
- Each client's Meta app/WABA/phone number/access token/app secret/webhook configuration must be completed in Meta and verified against an authorized test number.
- A controlled end-to-end delivery test against a dedicated HTTPS test receiver is still required; do not use a live customer endpoint.
- A Meta-authorized test recipient and active WABA integration are required to verify a real inbound message and outbound delivery/status lifecycle.
- No live end-to-end WhatsApp test has been confirmed in this work session.

## Safety constraints

- Official Meta Cloud API only; no unofficial WhatsApp Web engines or QR pairing.
- Only tenant-submitted URLs are eligible for knowledge crawling; no general internet search fallback.
- AI, chatbot replies, website crawling and AI memory are excluded from the active product scope.
- Historical knowledge, AI-memory and chatbot tables remain in older migrations but are not active product features.
- Campaigns require recorded opt-in and approved templates; opted-out contacts are suppressed.
- Never put service-role keys, Meta tokens, encryption keys, AI provider keys, or internal tokens in browser variables or source control.

See `docs/production-go-live.md` and `docs/environment-and-deployment.md`.
