# MobiWave WA architecture

This document describes the active product: a multi-tenant WhatsApp workspace for Kenyan businesses using only the official Meta WhatsApp Cloud API. AI, chatbot replies, web crawling, and AI memory are outside the product scope.

## Runtime components

- **Dashboard:** React and Vite app for workspace setup, contacts and consent, shared inbox, campaigns, Meta configuration, API keys, and customer webhooks.
- **Supabase Auth and Postgres:** tenant membership, business records, row-level security, message history, consent history, campaign recipients, usage events, and realtime changes.
- **Supabase Edge Functions:** server-side authorization, Meta credential encryption, outbound sends, webhook verification, contact/member operations, media retrieval, and campaign recipient claiming.
- **Meta Cloud API:** the only WhatsApp transport. Meta sends inbound messages and delivery receipts to the verified webhook; outbound messages use a server-side access token.
- **Webhook retry worker:** delivers customer webhooks from persisted delivery records with bounded retries.

## Inbound message flow

1. The webhook verifies Meta's request signature before processing the payload.
2. It resolves the workspace from the WhatsApp phone-number ID and deduplicates messages using Meta's message ID.
3. Contact consent and conversation state are updated, with consent changes added to the audit history.
4. The message and any supported attachment metadata are persisted; Supabase Realtime notifies authorized inbox clients.
5. Delivery receipts update message and campaign-recipient status.

## Human inbox flow

- Agents can see the workspace inbox, assign conversations to workspace members, filter conversations by status or assignee, search contacts, mark conversations read for themselves, reply during Meta's customer-service window, and add private notes.
- Assignment and notes are tenant-scoped. Per-user read markers do not affect other agents' unread state.
- The browser never receives Meta credentials. Attachment previews are fetched by an authenticated server function after checking workspace membership and message ownership.

## Campaign send flow

1. Admins create a campaign using a synced, Meta-approved template and explicitly selected contacts.
2. The campaign stores template parameters and recipient rows. Consent is checked again immediately before each send.
3. The server claims queued recipients atomically with `FOR UPDATE SKIP LOCKED`, marks them `sending`, and sends no more than ten recipients per request.
4. Provider acceptance is recorded as `sent`; delivery and read states change only when Meta sends those receipts.
5. A claimed send with an unknown result is marked failed for review and is not automatically re-sent. Stale claims are treated as unknown, since Meta may have accepted the message before the worker stopped.
6. A monthly message limit of zero means no fixed cap. Positive limits are explicit workspace overrides; usage events still meter sends.

## Tenant security and operational rules

- Resolve membership server-side for every Edge Function operation. Do not trust a browser-provided tenant ID without checking the caller's membership and role.
- Keep service-role credentials, Meta tokens, app secrets, webhook signing secrets, and API-key hashes out of browser code and source control.
- Require recorded opt-in and an approved template for campaign sends. Suppress opted-out contacts. Keep human replies inside the applicable 24-hour service window.
- Keep tenant IDs in reads, writes, webhook routing, campaign claims, media lookup, and customer webhook delivery.
- Apply row-level security to dashboard tables and enforce authorization again in privileged functions.
- Keep webhook processing idempotent, bound retries, record provider IDs, and do not label a message delivered until Meta confirms delivery.

## Historical schema note

Earlier migrations created knowledge, AI-memory, and chatbot configuration tables. They are retained to avoid destructive schema changes, but are not active features and must not be added to the dashboard or message flow without an explicit product decision.
