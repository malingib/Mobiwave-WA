# MobiWave WhatsApp API

## Authentication

Create a workspace API key in **Integrations → Tenant API keys**. The raw key is shown once. Store it in your backend's secret manager; never put it in a browser app or public repository.

Base URL:

```
https://YOUR_PROJECT_REF.supabase.co/functions/v1
```

## Send an approved template

`POST /api-send`

Headers:

```
apikey: YOUR_SUPABASE_PUBLISHABLE_KEY
X-API-Key: mw_live_your_secret
Content-Type: application/json
```

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

- The API key is scoped to one tenant and currently has the `messages:send` scope.
- The recipient must already exist in that tenant's contact list and have recorded opt-in consent.
- Opted-out contacts are not eligible for campaigns or this API.
- The message must use an approved Meta template.
- Monthly message usage is metered. A limit of zero means no fixed cap; only a positive workspace override blocks sends.
- API keys can be revoked from the dashboard.
- Requests and message submissions are metered per tenant.
- API keys are stored as SHA-256 hashes; the raw secret is returned only once.
- This initial API endpoint supports template messages only. It does not provide general web search, arbitrary message relaying, or unofficial WhatsApp connectivity.

## Error responses

- `400`: invalid request.
- `401`: missing/invalid/revoked/expired API key.
- `403`: consent or template restriction.
- `409`: Meta integration not configured.
- `429`: an explicitly configured positive monthly message limit was reached.
- `502`: Meta rejected the message or returned an upstream error.

## Customer webhooks

Workspace administrators can configure customer webhook endpoints in **Integrations → Customer webhooks**. Endpoints must use HTTPS and resolve to public IP addresses. Selected events include:
- `message.inbound`
- `message.status`
- `message.outbound`
- `campaign.completed`

Each delivery includes `X-MobiWave-Event`, `X-MobiWave-Delivery`, and `X-MobiWave-Signature`. The signature is `sha256=<hex HMAC-SHA256>` over the exact raw JSON request body using the one-time signing secret shown when the webhook is created. Verify the signature before processing and deduplicate on delivery ID.

Delivery attempts are persisted. Failed deliveries retry with exponential backoff up to eight attempts, then become dead-letter records. Deploy `webhook-worker` and schedule it to run at least once per minute using a trusted scheduler that sends `X-Internal-Token`. Never call that worker from a browser or expose the internal token.

Meta's inbound provider webhook is separate at `/meta-webhook` and validates Meta's `X-Hub-Signature-256` using the configured Meta app secret.
