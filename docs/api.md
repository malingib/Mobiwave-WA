# MobiWave WhatsApp API

## Authentication

Create a workspace API key in **Integrations → Tenant API keys**. The raw key is shown once. Store it in your backend's secret manager; never put it in a browser app or public repository.

Base URL:

```
https://wap.mobiwave.co.ke/api/v1
```

MobiWave exposes a branded API endpoint. Backend infrastructure and provider credentials are handled server-side and are not part of the customer integration.

## Send an approved template

`POST /messages/send`

Full endpoint:

```
https://wap.mobiwave.co.ke/api/v1/messages/send
```

Headers:

```
X-API-Key: mw_live_your_secret
Idempotency-Key: your-unique-request-id
Content-Type: application/json
```

Use a new, unique `Idempotency-Key` for each new message request (at least 8 characters). If the network outcome is uncertain, retry with the same key and identical request body; do not generate a new key for that retry.

Request:

```json
{
  "to": "+2547XXXXXXXX",
  "template_name": "approved_template",
  "language_code": "en",
  "components": []
}
```

For templates with variables, `components` must follow Meta's WhatsApp Cloud API message-template component schema and supply the required parameters. Only templates synchronized from Meta and marked approved are accepted.

Success response:

```json
{
  "ok": true,
  "message_id": "wamid...",
  "status": "sent_to_meta"
}
```

This means Meta accepted the request; it is not a guarantee of delivery. Delivery/read/failure status is updated from Meta webhook events.

## Guardrails

- The API key is scoped to one tenant and must have the `messages:send` scope.
- The recipient must already exist in that tenant's contact list and have recorded opt-in consent.
- Opted-out contacts are not eligible for campaigns or this API.
- The message must use an approved Meta template.
- Monthly message usage is metered. A limit of zero means no fixed cap; only a positive workspace override blocks sends.
- API keys can be revoked from the dashboard.
- Requests and message submissions are metered per tenant.
- API keys are stored as SHA-256 hashes; the raw secret is returned only once.
- Idempotency keys prevent a retried request from submitting a duplicate message.
- This API currently supports template messages only. It does not provide arbitrary message relaying or unofficial WhatsApp connectivity.

## Error responses

- `400`: invalid request or idempotency key.
- `401`: missing/invalid/revoked/expired API key.
- `403`: consent or template restriction.
- `409`: Meta integration not configured.
- `429`: an explicitly configured positive monthly message limit was reached.
- `502`: Meta rejected the message or returned an upstream error.
- `504`: provider outcome is uncertain; reconcile or retry with the same idempotency key.

## Customer webhooks

Workspace administrators can configure customer webhook endpoints in **Integrations → Customer webhooks**. Endpoints must use HTTPS and resolve to public IP addresses. Selected events include:
- `message.inbound`
- `message.status`
- `message.outbound`
- `campaign.completed`

Each delivery includes `X-MobiWave-Event`, `X-MobiWave-Delivery`, and `X-MobiWave-Signature`. The signature is `sha256=<hex HMAC-SHA256>` over the exact raw JSON request body using the one-time signing secret shown when the webhook is created. Verify the signature before processing and deduplicate on delivery ID.

MobiWave persists delivery attempts and automatically retries eligible failures with backoff. No internal worker endpoint or infrastructure credential is required from customers.

## Meta callback

Configure the Meta webhook callback URL as:

```
https://wap.mobiwave.co.ke/api/webhooks/whatsapp
```

Use the verification token generated in **Integrations → Meta connection**. Subscribe the WhatsApp Business Account to the `messages` and `message_template_status_update` webhook fields.
