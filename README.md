# MobiWave WhatsApp

MobiWave WhatsApp is a planned multi-tenant WhatsApp messaging and automation platform for Kenyan businesses. It will provide bulk campaigns, customer conversations, APIs, webhooks, usage controls, billing and optional AI-powered chatbots.

## Current status

The repository contains the initial product brief and architecture. The application and production messaging integration have not yet been implemented.

## Fixed product decisions

- **WhatsApp connectivity:** official Meta WhatsApp Cloud API only. No unofficial WhatsApp Web engines, QR pairing, WPPConnect, WAHA or Evolution API.
- **AI:** optional chatbot capabilities connected to inbound conversations through a separate AI service layer. Messaging and campaigns must continue to work when AI is disabled or unavailable.
- **Knowledge building:** tenants submit the websites, URLs and documents the system is allowed to ingest. No general internet search or arbitrary web scraping is used to answer customer questions.
- **AI memory:** tenant-scoped, reviewable memory can preserve approved business preferences, corrections and reusable resolutions. This is retrieval and curated memory, not automatic retraining of the base model.
- **Multi-tenancy:** isolated business accounts, users, contacts, provider configuration, campaigns, conversations and usage records.
- **Bulk messaging:** contacts/imports, consent records, suppression lists, approved templates, campaign scheduling, status reporting and APIs.
- **Inbox:** inbound/outbound conversation history, assignment, agent replies and human handoff from AI.
- **Developer tools:** tenant-scoped API keys, webhooks, documentation and usage metering.
- **Commercial controls:** plans, quotas, billing and MobiWave operator administration.

## AI chatbot and knowledge scope

- Enable or disable AI per tenant and per WhatsApp number.
- Let a tenant submit a website URL, specific links and supported documents as knowledge sources.
- Crawl only the submitted sources and any same-domain pages the tenant explicitly authorizes within configured limits.
- Extract, deduplicate, version and index source content; display source provenance and refresh status.
- Retrieve answers only from that tenant's approved knowledge and memory. If reliable evidence is missing, offer human handoff rather than inventing facts.
- Support manual and scheduled refreshes, approval controls, source removal and deletion.
- Keep source knowledge, short-lived conversation context and durable approved memory separate.
- Suggest memory candidates from agent corrections and resolved conversations; allow authorized review, editing and deletion.
- Protect against malicious page instructions, server-side request forgery (SSRF), cross-tenant leakage and unnecessary retention of sensitive data.
- Allow escalation to a human agent and pause automation while an agent handles a conversation.
- Keep AI provider credentials server-side and make the AI provider replaceable without adding alternative WhatsApp transport engines.
- Apply tenant-level usage limits, logging, privacy controls and safe failure behaviour.
- Do not allow AI to bypass Meta messaging policies, template requirements, opt-in or opt-out handling.

## MVP implementation sequence

1. Confirm stack and environment configuration.
2. Implement authentication, tenant membership, roles and audit logs.
3. Implement database schema and tenant isolation.
4. Implement the official Meta Cloud API client and webhook verification.
5. Build contacts, consent/suppression controls, templates and campaign queue.
6. Build shared inbox, assignment and message-status history.
7. Build submitted-source ingestion, tenant-isolated knowledge retrieval and memory review controls.
8. Add the optional AI chatbot service and human handoff.
9. Add usage accounting, billing hooks, API docs, tests and deployment checks.

See [`docs/architecture.md`](docs/architecture.md) for the architecture and security rules.

## Security

Never commit API tokens, app secrets, database credentials, webhook verification secrets or real customer contact lists. Use environment variables or a managed secrets store. Keep Meta and AI provider calls on the server side. Enforce tenant authorization server-side on every operation.
