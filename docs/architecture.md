# Initial Architecture

## System boundaries

- **Web dashboard:** tenant administration, contacts, consent, templates, campaigns, conversations, reports and API-key management.
- **Application API:** authenticated business operations, tenant authorization, validation, rate limits and usage metering.
- **Provider adapters:** a stable internal interface for Meta WhatsApp Cloud API and any future experimental provider.
- **Queue/worker:** scheduled and bulk sends, bounded retries, idempotency and per-tenant throughput controls.
- **Webhook ingress:** verifies provider signatures/tokens, normalizes inbound messages and delivery events, and records provider event IDs to prevent duplicate processing.
- **Database:** tenant-scoped records, immutable audit events where appropriate, campaign state and message status history.

## Provider interface

Keep application workflows independent of a specific vendor. The interface should cover:

- `sendText`
- `sendTemplate`
- `sendMedia`
- `validateCredentials`
- `verifyWebhook` / `parseWebhookEvent`
- `getCapabilities`

Provider-specific IDs and raw event payloads should be retained safely for debugging, subject to data minimization and retention rules. Normalize statuses such as accepted, sent, delivered, read, failed and inbound-received without assuming every provider supports every state.

## Multi-tenant security

- Every tenant-owned query must be scoped by authenticated tenant identity on the server.
- Never trust a `tenantId` supplied by the browser as proof of authorization.
- Store provider credentials server-side, encrypted at rest or in a secrets manager.
- Hash API keys at rest; show the secret only once at creation.
- Add role-based access control and audit logging for credential changes, campaign sends, exports and user administration.
- Apply tenant-level rate limits, campaign quotas and usage metering.
- Validate uploaded contact files, normalize phone numbers to E.164 where possible, and report invalid rows before sending.

## Consent and messaging controls

- Record the source, timestamp and scope of each contact's opt-in where applicable.
- Maintain tenant-specific suppression lists and process opt-out requests before any campaign send.
- Enforce provider template and messaging-window requirements where applicable.
- Pause or block campaigns when credentials, consent checks or provider configuration are incomplete.
- Distinguish queued, provider-accepted, sent, delivered, read and failed states. Do not report a message as delivered merely because an API request succeeded.

## Reliability

- Use an idempotency key for campaign recipient jobs and webhook event processing.
- Retry transient failures with exponential backoff and jitter; do not retry permanent validation or policy failures blindly.
- Keep retry budgets and dead-letter visibility for operators.
- Apply per-tenant concurrency and throughput limits to prevent one customer from starving others.
- Track provider request IDs, response codes and sanitized error details.

## Suggested initial stack

Choose a TypeScript web/API stack and PostgreSQL-compatible database so the product can be developed and tested without requiring Docker on the developer workstation. Production deployment may use managed services. Final framework and hosting choices should be confirmed before the application scaffold is generated.

## Deployment gates

Before a production launch, require automated tests for tenant isolation, authentication, webhook verification, consent/suppression enforcement, idempotency, retry behaviour and secret handling. Use a Meta test number or approved sandbox configuration before live customer traffic.
