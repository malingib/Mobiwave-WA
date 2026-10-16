# MobiWave WhatsApp

MobiWave WhatsApp is a planned multi-tenant WhatsApp messaging and automation platform for Kenyan businesses. It will provide bulk campaigns, customer conversations, APIs, webhooks, usage controls, billing and optional AI-powered chatbots.

## Current status

The repository contains the initial product brief and architecture. The application and production messaging integration have not yet been implemented.

## Fixed product decisions

- **WhatsApp connectivity:** official Meta WhatsApp Cloud API only. No unofficial WhatsApp Web engines, QR pairing, WPPConnect, WAHA or Evolution API.
- **AI:** optional chatbot capabilities connected to inbound conversations through a separate AI service layer. Messaging and campaigns must continue to work when AI is disabled or unavailable.
- **Multi-tenancy:** isolated business accounts, users, contacts, provider configuration, campaigns, conversations and usage records.
- **Bulk messaging:** contacts/imports, consent records, suppression lists, approved templates, campaign scheduling, status reporting and APIs.
- **Inbox:** inbound/outbound conversation history, assignment, agent replies and human handoff from AI.
- **Developer tools:** tenant-scoped API keys, webhooks, documentation and usage metering.
- **Commercial controls:** plans, quotas, billing and MobiWave operator administration.

## AI chatbot scope

- Enable or disable AI per tenant and per WhatsApp number.
- Configure business instructions, FAQs and approved knowledge sources.
- Support conversation context with configurable retention.
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
7. Add an optional AI chatbot service, knowledge configuration and human handoff.
8. Add usage accounting, billing hooks, API docs, tests and deployment checks.

See [`docs/architecture.md`](docs/architecture.md) for the architecture and security rules.

## Security

Never commit API tokens, app secrets, database credentials, webhook verification secrets or real customer contact lists. Use environment variables or a managed secrets store. Keep Meta and AI provider calls on the server side. Enforce tenant authorization server-side on every operation.
