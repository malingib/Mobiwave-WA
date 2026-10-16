# MobiWave WhatsApp — Initial Architecture

## Fixed integration decisions

- WhatsApp transport is the **official Meta WhatsApp Cloud API only**. Do not implement or introduce unofficial WhatsApp Web engines, QR pairing or alternative transport providers.
- AI is an optional chatbot capability, not a replacement for the messaging engine. Core campaigns, agent inbox and status tracking must work when AI is disabled or its provider is unavailable.
- The AI model provider may be configurable behind a server-side interface. This does not permit alternative WhatsApp transport engines.

## System boundaries

- **Web dashboard:** tenant settings, contacts, consent, templates, campaigns, shared inbox, chatbot configuration, reports and API-key management.
- **Application API:** authentication, tenant authorization, validation, rate limits, usage metering and business operations.
- **Meta Cloud API client:** the sole WhatsApp transport integration; handles outbound messages, templates and media supported by Meta.
- **Queue/worker:** scheduled and bulk sends, bounded retries, idempotency and per-tenant throughput controls.
- **Webhook ingress:** verifies Meta webhook setup and authenticity, normalizes inbound messages and delivery events, and deduplicates event processing.
- **AI chatbot service:** builds tenant-scoped prompts/context, retrieves approved knowledge, calls a configured AI model provider and returns a proposed response or escalation decision.
- **Database:** tenant-scoped records, campaign state, conversations, message status history, chatbot configuration, usage and audit events.

## Message and AI flow

1. A Meta webhook arrives and is verified before processing.
2. The event is normalized and persisted idempotently under the correct tenant and WhatsApp number.
3. If chatbot automation is disabled, paused, or the conversation is assigned to an agent, route the event to the inbox only.
4. If automation is enabled, check consent/opt-out state, tenant limits and applicable Meta messaging-window/template requirements.
5. The AI service uses only the tenant's approved instructions and knowledge sources; it must not access another tenant's data.
6. Apply output checks and configured escalation rules. If the model fails or confidence/safety rules require a person, do not loop or invent a response: notify the inbox or use a tenant-approved fallback.
7. Send eligible responses through the official Meta Cloud API and record the provider response and subsequent status events.
8. Allow human agents to take over and pause bot replies for the conversation to prevent competing responses.

## Meta client boundary

Keep Meta-specific logic in a dedicated server-side module. It should cover:

- Sending text, approved templates and supported media.
- Validating configuration and credentials without exposing secrets.
- Verifying webhook challenges/signatures according to current Meta documentation.
- Parsing inbound message and delivery/status events.
- Mapping Meta message IDs and provider errors to internal records.

Do not label an API acceptance response as delivered. Track queued, accepted/sent, delivered, read and failed only when supported by actual provider events.

## Multi-tenant security

- Scope every tenant-owned operation using the authenticated tenant membership resolved server-side; never trust a browser-supplied `tenantId` as authorization.
- Keep Meta and AI credentials on the server, encrypted at rest or in a managed secrets store.
- Hash API keys at rest and show the secret only once when created.
- Apply role-based access control and audit sensitive actions, including credential changes, campaign sends, exports, chatbot configuration and user administration.
- Apply tenant-level campaign, API, AI-token and spend limits.
- Validate contact uploads, normalize phone numbers to E.164 where possible and report invalid rows before sending.
- Keep knowledge retrieval tenant-isolated. Do not use one tenant's messages or documents to answer another tenant's customers.
- Define retention and deletion rules for message content, AI context and provider payloads.

## Consent and messaging controls

- Record opt-in source, timestamp and scope where applicable.
- Maintain tenant-specific suppression lists and process opt-out requests before campaign or bot sends.
- Enforce current Meta template and customer-service-window requirements.
- Block or pause sends if credentials, consent checks or provider configuration are incomplete.
- Never let AI override an opt-out, platform rule or tenant sending limit.

## Reliability

- Use idempotency keys for campaign recipient jobs and webhook event processing.
- Retry transient failures with bounded exponential backoff and jitter; do not blindly retry permanent validation or policy failures.
- Keep dead-letter visibility and operator diagnostics.
- Apply per-tenant concurrency and throughput limits.
- Track provider request IDs, response codes and sanitized error details.
- On AI timeout or provider failure, preserve the inbound message and route it to the inbox; core messaging remains available.

## Suggested initial stack

Use a TypeScript web/API stack and PostgreSQL-compatible database so local development does not require Docker. Managed hosting and database services may be used in production. Confirm framework, hosting and AI model provider before generating the application scaffold. All secrets and outbound provider calls remain server-side.

## Deployment gates

Before production, test tenant isolation, authentication, webhook verification, consent/suppression enforcement, idempotency, retries, secret handling, AI tenant isolation, human handoff and AI-offline behaviour. Start with Meta's test number or an approved test setup before live customer traffic. Check current Meta documentation for API versions and policy requirements during implementation.
