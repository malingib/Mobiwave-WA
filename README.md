# MobiWave WhatsApp

MobiWave WhatsApp is a planned multi-tenant messaging platform for Kenyan businesses, combining WhatsApp campaign management, customer conversations, APIs, webhooks, usage controls and billing.

## Current status

This repository is being initialized. No production messaging integration is implemented yet.

## Product direction

- Multi-tenant customer accounts with strict tenant isolation.
- Campaign creation, contact imports, opt-in records, suppression lists and delivery reporting.
- Template management and message sending through provider adapters.
- Webhooks for inbound messages and delivery/status events.
- API keys, usage limits, audit logs and admin controls.
- Official Meta WhatsApp Cloud API as the preferred production provider.
- Optional WhatsApp Web-based providers only as separately configured, clearly labelled experimental integrations; they must not be represented as official or guaranteed reliable.
- MobiWave-branded customer dashboard and developer documentation.

## Non-goals for the initial MVP

- Unsolicited messaging or tools to evade platform limits.
- Storing provider access tokens in frontend code.
- Sending messages before the tenant's provider credentials and consent requirements are configured.
- Treating a queued message as delivered without a provider status event.

## Proposed implementation sequence

1. Confirm the application architecture and environment configuration.
2. Implement authentication, tenant model, roles and audit events.
3. Add provider interface and Meta Cloud API adapter.
4. Add contacts, consent/suppression controls, templates and campaign queue.
5. Add webhooks, status tracking, retry rules and usage accounting.
6. Build dashboard, API documentation, automated tests and deployment checks.

See [`docs/architecture.md`](docs/architecture.md) for the initial architecture notes.

## Security

Never commit API tokens, app secrets, database credentials, webhook verification secrets or real customer contact lists. Use environment variables or a managed secrets store. Keep all provider calls on the server side.
