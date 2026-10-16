# MobiWave WhatsApp — Initial Architecture

## Fixed integration decisions

- WhatsApp transport is the **official Meta WhatsApp Cloud API only**. Do not implement or introduce unofficial WhatsApp Web engines, QR pairing or alternative transport providers.
- AI is an optional chatbot capability, not a replacement for the messaging engine. Core campaigns, agent inbox and status tracking must work when AI is disabled or its provider is unavailable.
- The AI model provider may be configurable behind a server-side interface. This does not permit alternative WhatsApp transport engines.
- The knowledge scraper is **source-restricted**: it may ingest only websites and URLs explicitly submitted by the tenant. It must not perform general web search or scrape unrelated sites to answer questions.

## System boundaries

- **Web dashboard:** tenant settings, contacts, consent, templates, campaigns, shared inbox, chatbot configuration, knowledge sources, memory review, reports and API-key management.
- **Application API:** authentication, tenant authorization, validation, rate limits, usage metering and business operations.
- **Meta Cloud API client:** the sole WhatsApp transport integration; handles outbound messages, templates and media supported by Meta.
- **Queue/worker:** scheduled and bulk sends, bounded retries, idempotency, source crawling/indexing jobs and per-tenant throughput controls.
- **Webhook ingress:** verifies Meta webhook setup and authenticity, normalizes inbound messages and delivery events, and deduplicates event processing.
- **Knowledge ingestion service:** fetches only tenant-submitted URLs and links discovered within an explicitly approved scope, extracts readable content, detects changes, records provenance and indexes approved material.
- **Knowledge retrieval service:** searches only the current tenant's approved and indexed content to ground chatbot answers.
- **AI chatbot service:** builds tenant-scoped prompts/context, retrieves approved knowledge, calls a configured AI model provider and returns a proposed response or escalation decision.
- **Memory service:** stores tenant-specific, controlled long-term items such as approved business preferences, confirmed corrections and reusable resolutions; memory is distinct from source documents and short-lived conversation context.
- **Database:** tenant-scoped records, campaign state, conversations, message status history, knowledge sources and versions, memory entries, chatbot configuration, usage and audit events.

## Message and AI flow

1. A Meta webhook arrives and is verified before processing.
2. The event is normalized and persisted idempotently under the correct tenant and WhatsApp number.
3. If chatbot automation is disabled, paused, or the conversation is assigned to an agent, route the event to the inbox only.
4. If automation is enabled, check consent/opt-out state, tenant limits and applicable Meta messaging-window/template requirements.
5. Retrieve relevant content only from that tenant's approved knowledge base and permitted memory. Do not use open-ended web search or scrape the internet to answer a customer.
6. The AI generates an answer grounded in retrieved material and configured business instructions. If reliable support is missing, it should say it cannot confirm the answer and offer human handoff rather than inventing facts.
7. Apply output checks and configured escalation rules. If the model fails or confidence/safety rules require a person, notify the inbox or use a tenant-approved fallback.
8. Send eligible responses through the official Meta Cloud API and record the provider response and subsequent status events.
9. Allow human agents to take over and pause bot replies for the conversation to prevent competing responses.

## Submitted-source knowledge builder

- Tenants may submit a website root URL, individual URLs, or supported documents through the dashboard.
- Crawl only the submitted URLs and pages within a clearly configured scope. Same-domain discovery may be enabled only as an explicit choice, with crawl depth/page limits; do not follow external links unless the tenant explicitly adds those URLs as sources.
- Validate URLs and every redirect destination to block localhost, private/internal IP ranges, link-local addresses, cloud metadata endpoints and other SSRF targets. Re-check DNS and resolved IPs at fetch time and after redirects.
- Respect robots.txt and site terms/access controls where applicable; do not bypass authentication, paywalls, CAPTCHAs or technical restrictions. Apply sensible rate limits and identify the crawler.
- Extract readable content, canonical URL, title, fetch time, content hash and source metadata. Remove boilerplate and duplicates, split content into searchable chunks, and index it for keyword and semantic retrieval.
- Keep each crawl run and indexed version traceable to its source. Show ingestion status, errors, last checked time and content preview to the tenant.
- Support manual refresh and configurable scheduled refresh. Re-index changed content and mark removed or inaccessible source content stale; do not silently treat old content as current.
- New or changed content should follow tenant-configurable approval rules. For an MVP, make sources visible and allow tenant admins to disable or remove a source and purge its indexed chunks.
- Treat scraped text as untrusted reference material, not instructions. Ignore embedded instructions that attempt to change system behaviour, reveal secrets, bypass policy or access other tenants' data.
- Do not scrape search-engine results or arbitrary internet pages as a fallback when the knowledge base has no answer.

## AI memory and learning

- Do not claim the base model is permanently learning or being retrained from each conversation. Improve answers through retrieval, curated memory and reviewed corrections.
- Keep separate stores for (1) source knowledge, (2) short-lived conversation context and (3) durable tenant memory.
- Candidate memories may be suggested from repeated questions, agent corrections and resolved conversations, but require configured approval before becoming durable memory.
- Store memory with tenant ID, origin, creation/update time, approval state, optional expiry and deletion controls. Record why it was saved and support review, edit and deletion by authorized tenant admins.
- Do not save passwords, payment-card data, authentication secrets or unnecessary sensitive personal data as memory. Do not use one tenant's conversations to train or answer for another tenant.
- Provide tenant controls for retention, export and deletion of source documents, chunks, conversation context and memory entries.
- Retrieve only relevant approved memory at answer time. If memory conflicts with a newer approved source, use a defined freshness/priority rule and flag ambiguity rather than guessing.

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
- Validate submitted URLs and redirects against SSRF and internal-network access. Apply fetch timeouts, response-size limits, content-type allowlists and per-tenant crawl budgets.
- Define retention and deletion rules for message content, AI context, scraped source text, embeddings, memory and provider payloads.

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
- Crawl jobs must have bounded retries, timeouts, page limits and response-size limits. A failed refresh must not erase the last known good version without an explicit policy.

## Suggested initial stack

Use a TypeScript web/API stack and PostgreSQL-compatible database so local development does not require Docker. A managed PostgreSQL service with vector search can support tenant-scoped keyword and semantic retrieval. Managed hosting and database services may be used in production. Confirm framework, hosting and AI model provider before generating the application scaffold. All secrets and outbound provider calls remain server-side.

## Deployment gates

Before production, test tenant isolation, authentication, webhook verification, consent/suppression enforcement, idempotency, retries, secret handling, AI tenant isolation, human handoff, source URL scope enforcement, SSRF protections, prompt-injection resistance, memory approval/deletion and AI-offline behaviour. Start with Meta's test number or an approved test setup before live customer traffic. Check current Meta documentation for API versions and policy requirements during implementation.
