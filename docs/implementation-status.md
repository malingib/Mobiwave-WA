# Implementation status

## Branch

`feat/knowledge-builder-foundation`

## Implemented in the repository

### Dashboard
- React/Vite responsive dashboard, Supabase Auth sign-in/sign-up, workspace creation and workspace selector.
- Knowledge source management with single-URL and same-host crawl scopes, source status, refresh and deletion.
- AI memory queue with manual memory entry, approval/rejection/deletion, and review-only suggestions extracted from resolved conversations.
- Chatbot configuration, AI answer test, and handoff controls.
- Contacts with opt-in/opt-out status, shared inbox, agent replies, approved-template campaign drafts and campaign batch launcher.
- Meta integration setup, token verification and template sync screens.

### Backend
- Tenant-scoped PostgreSQL schema for workspace membership, sources, documents/chunks, ingestion runs, AI memory, settings, contacts, Meta integration, templates, campaigns, recipients, conversations, messages and webhook events.
- RLS policies, explicit authenticated Data API grants and a tenant-scoped full-text retrieval RPC restricted to the service role.
- Supabase Edge Functions for workspace provisioning, bounded source ingestion, grounded AI replies, review-only memory suggestions, Meta credential encryption/verification, template sync, signed Meta webhooks, inbound conversation processing, message sending and consent-checked campaign batches.
- Meta credentials are encrypted with AES-GCM; browser roles cannot select the encrypted token column.
- CI workflow for TypeScript/Vite build.

## Product safety rules implemented
- Official Meta WhatsApp Cloud API only; no alternative WhatsApp engines or QR pairing.\n- Tenant API keys are hashed, shown once, revocable and scoped to approved-template sending; monthly message/AI request usage events and basic quotas are implemented.
- No general internet search fallback. Only tenant-submitted sources are eligible for knowledge ingestion.
- AI responses require an exact reference to retrieved approved evidence; otherwise the chatbot hands off.
- Memory generated from conversations remains in the review queue and is not automatically approved.
- AI starts disabled for each workspace.
- Marketing campaigns require recorded opt-in and an approved Meta template; opted-out contacts are suppressed.
- Free-form agent replies require a recent inbound message inside the 24-hour customer-service window.
- Webhook POST requests require Meta HMAC signature verification and inbound message IDs are used for idempotency.
- Crawler bounds page count and body size, checks DNS and redirects, stays on the explicitly authorized host, and applies robots path rules.

## Not yet complete or verified
- The branch has not been deployed to a live Supabase project, and no live project credentials were provided.
- The current build has not been verified in this environment; the GitHub Actions result must be checked before merging.
- The crawler is a bounded HTML/text extractor, not a headless browser; PDFs, JavaScript-rendered content and authenticated pages are not supported. DNS preflight cannot completely prevent DNS rebinding; high-assurance production should use an egress proxy enforcing IP restrictions at connection time.
- No scheduled crawl/refresh worker, durable campaign scheduler/queue worker, complete delivery analytics, billing/subscription collection, team invitation UI or full audit log yet. Customer webhook retries require the configured webhook-worker to be scheduled. The public API currently supports approved-template sends and basic monthly quota enforcement.
- Campaign launcher processes at most 10 queued recipients per invocation; remaining batches must be run again. Dynamic template parameters are supported as JSON but require validation against each template's expected parameters.
- No live Meta webhook has been registered and no real message has been sent or received.
- AI provider credentials and usage limits have not been configured. The chatbot and memory suggestion feature require the optional AI key.
- Automated tests, load tests, penetration testing and production privacy/compliance review remain necessary.

## Required setup before a live pilot

Follow `docs/environment-and-deployment.md`. Apply SQL migrations in timestamp order, configure Edge Function secrets, deploy the functions, configure Auth URLs, verify the Meta Cloud API, sync templates, register the webhook and test with an authorized test number before enabling real campaigns.
