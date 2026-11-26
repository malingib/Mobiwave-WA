# MobiWave WhatsApp Developer API v1

Base URL: `https://wap.mobiwave.co.ke/api/v1`

All API requests are server-to-server. Keep API keys in a backend secret manager; never expose them in browser JavaScript or mobile application bundles.

## Authentication

Create an integration key in **Workspace → Integrations → Developer API**. Each key has a non-secret Client ID, a name, and explicitly selected scopes. The raw secret is shown once.

Send either supported authentication header:

```http
Authorization: Bearer mw_live_YOUR_SECRET
```

or:

```http
X-API-Key: mw_live_YOUR_SECRET
```

All data access is automatically restricted to the workspace that owns the key. A Client ID identifies the integration in logs; it is not an authentication credential.

## API identity

- `GET /health`: authenticated API health check.
- `GET /me`: returns the current integration Client ID, name and granted scopes.

## Common headers

```http
Content-Type: application/json
Idempotency-Key: order-1042-message-v1
```

Use an idempotency key for every message submission. It must contain 8–200 characters from letters, numbers, dot, underscore, colon or hyphen. Reuse the same key and identical request when retrying an uncertain send. Never generate a new key to retry an uncertain provider outcome.

## Rate limits and pagination

- Default limit: 120 API requests per minute per key.
- Exceeding the limit returns HTTP 429.
- List endpoints accept `limit` (1–100, default 50) and `offset` (default 0).
- List responses include `pagination.limit`, `pagination.offset` and `pagination.total`.

## Message sending

### Unified endpoint

`POST /messages`

The unified endpoint accepts the following Meta Cloud API message types: `template`, `text`, `image`, `document`, `audio`, and `video`. All recipients must exist in the workspace contact list and have recorded opt-in consent. Free-form text and media are allowed only inside Meta's 24-hour customer-service window. Template messages require an approved template.

Template:

```json
{
  "to": "+254712345678",
  "type": "template",
  "template": {
    "name": "order_update",
    "language": "en",
    "components": []
  }
}
```

For simple body-only templates, `parameters` may be supplied instead of `components`:

```json
{
  "to": "+254712345678",
  "type": "template",
  "template": {
    "name": "order_update",
    "language": "en",
    "parameters": ["Brighton", "MW-1042"]
  }
}
```

Text:

```json
{
  "to": "+254712345678",
  "type": "text",
  "text": { "body": "Your order has been dispatched." }
}
```

Image:

```json
{
  "to": "+254712345678",
  "type": "image",
  "image": {
    "link": "https://cdn.example.com/product.jpg",
    "caption": "Your product is ready."
  }
}
```

Document:

```json
{
  "to": "+254712345678",
  "type": "document",
  "document": {
    "link": "https://cdn.example.com/invoice.pdf",
    "filename": "invoice.pdf",
    "caption": "Your invoice"
  }
}
```

Audio and video use the same `link` property under `audio` or `video`. Media URLs must be publicly accessible HTTPS URLs. Meta validates media format, size and availability.

Accepted response (HTTP 202):

```json
{
  "ok": true,
  "data": {
    "message_id": "wamid.example",
    "status": "accepted",
    "type": "template",
    "to": "+254712345678"
  },
  "meta": {
    "idempotent_replay": false,
    "persistence_warning": false
  }
}
```

An accepted response means Meta accepted the submission; it does not guarantee delivery. Delivery, read and failure states arrive through Meta callbacks and are visible in message history.

### Backward-compatible endpoint

`POST /messages/send` remains available for existing integrations and continues to accept the original payload:

```json
{
  "to": "+254712345678",
  "template_name": "order_update",
  "language_code": "en",
  "components": []
}
```

It retains the original response shape and template-only behaviour. New integrations should use `POST /messages`.

## Contacts

All contact operations require the corresponding contacts scope.

| Method | Endpoint | Scope | Description |
|---|---|---|---|
| GET | `/contacts` | `contacts:read` | List contacts |
| POST | `/contacts` | `contacts:write` | Create or upsert a contact by phone |
| GET | `/contacts/{id}` | `contacts:read` | Retrieve a contact |
| PATCH | `/contacts/{id}` | `contacts:write` | Update name, phone or metadata |
| DELETE | `/contacts/{id}` | `contacts:write` | Delete a contact and its linked records |
| POST | `/contacts/{id}/consent` | `contacts:write` | Record opt-in or opt-out |
| GET | `/contacts/{id}/consent` | `contacts:read` | Retrieve consent audit history |

Create/upsert:

```json
{
  "phone": "+254712345678",
  "name": "Jane Doe",
  "consent_status": "opted_in",
  "consent_source": "Website checkout checkbox",
  "metadata": { "customer_ref": "C-1042" }
}
```

For consent status other than `unknown`, a source is required. Record a consent change explicitly:

```json
{
  "status": "opted_out",
  "source": "Customer requested opt-out by support email"
}
```

The consent endpoint stores an audit record with the previous status, new status, source, timestamp and API key that made the change. Do not mark a contact opted in without a valid record of permission.

## Templates

| Method | Endpoint | Scope |
|---|---|---|
| GET | `/templates` | `templates:read` |
| GET | `/templates/{id}` | `templates:read` |

Templates are synchronised from the connected Meta WhatsApp Business Account. Only templates with Meta status `approved` can be sent.

## Messages and delivery history

| Method | Endpoint | Scope |
|---|---|---|
| GET | `/messages` | `messages:read` |
| GET | `/messages/{meta_message_id}` | `messages:read` |

The identifier in the message path is the Meta message ID returned by the send endpoint. List responses are newest first.

## Campaigns

| Method | Endpoint | Scope | Description |
|---|---|---|---|
| POST | `/campaigns` | `campaigns:write` | Create a draft or scheduled campaign |
| GET | `/campaigns` | `campaigns:read` | List campaigns |
| GET | `/campaigns/{id}` | `campaigns:read` | Retrieve campaign |
| POST | `/campaigns/{id}/start` | `campaigns:write` | Queue the campaign for the existing worker to start on its next run |
| POST | `/campaigns/{id}/pause` | `campaigns:write` | Pause campaign |
| POST | `/campaigns/{id}/cancel` | `campaigns:write` | Cancel campaign |

Create a campaign using an approved template and explicit contact IDs:

```json
{
  "name": "November order updates",
  "template_id": "00000000-0000-4000-8000-000000000000",
  "contact_ids": [
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002"
  ],
  "scheduled_at": "2026-12-01T08:00:00+03:00"
}
```

`scheduled_at` is optional and must be in the future. Scheduled campaigns remain drafts until their due time; the existing campaign worker starts them. The start action queues an eligible draft or paused campaign for the existing worker rather than running a long synchronous request. Every recipient must belong to the same workspace and have recorded opt-in consent. Existing campaign batch limits, quota checks, provider reconciliation and uncertain-outcome safeguards remain in force.

## Customer event webhooks

Customer webhooks are configured in **Integrations → Customer webhooks**. This is separate from Meta's inbound webhook callback. Current events include:

- `message.inbound`
- `message.status`
- `message.outbound`
- `campaign.completed`

Each delivery includes `X-MobiWave-Event`, `X-MobiWave-Delivery` and `X-MobiWave-Signature`. The signature is `sha256=<hex>` HMAC-SHA256 over the exact raw JSON body. Verify the signature before parsing the payload and deduplicate using the delivery ID. Failed deliveries are retried with backoff; exhausted deliveries enter the dead state and can be retried from the dashboard.

## Error format

New structured endpoints use this response envelope:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_RECIPIENT",
    "message": "to must be an E.164 phone number.",
    "details": null
  }
}
```

HTTP status codes:

| Status | Meaning |
|---|---|
| 400 | Invalid request or idempotency key |
| 401 | Missing, invalid, expired or revoked API key |
| 403 | Missing scope, feature access or consent |
| 404 | Resource not found |
| 409 | State or idempotency conflict |
| 413 | Request body exceeds 128 KiB |
| 415 | Unsupported content type |
| 422 | Request validation failed |
| 429 | Per-key rate limit or workspace usage limit |
| 500 | Internal error |
| 502 | Provider error |
| 503 | Temporary service unavailable |
| 504 | Provider outcome could not be confirmed |

## Available scopes

- `messages:send`
- `messages:read`
- `contacts:read`
- `contacts:write`
- `templates:read`
- `campaigns:read`
- `campaigns:write`

Use least privilege. A key can only perform operations covered by its scopes and the workspace's subscription.

## Code examples

Set `MOBIWAVE_API_KEY` in your server environment.

### cURL

```bash
curl https://wap.mobiwave.co.ke/api/v1/messages \
  -X POST \
  -H "Authorization: Bearer $MOBIWAVE_API_KEY" \
  -H "Idempotency-Key: order-1042-message-v1" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+254712345678",
    "type": "template",
    "template": {
      "name": "order_update",
      "language": "en",
      "parameters": ["Jane", "MW-1042"]
    }
  }'
```

### JavaScript (Node.js 18+)

```js
const response = await fetch("https://wap.mobiwave.co.ke/api/v1/messages", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.MOBIWAVE_API_KEY}`,
    "Idempotency-Key": "order-1042-message-v1",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    to: "+254712345678",
    type: "template",
    template: {
      name: "order_update",
      language: "en",
      parameters: ["Jane", "MW-1042"]
    }
  })
});
const result = await response.json();
if (!response.ok) throw new Error(result.error?.message ?? `MobiWave API error: ${response.status}`);
console.log(result.data);
```

### Python (requests)

```python
import os
import requests

response = requests.post(
    "https://wap.mobiwave.co.ke/api/v1/messages",
    headers={
        "Authorization": f"Bearer {os.environ['MOBIWAVE_API_KEY']}",
        "Idempotency-Key": "order-1042-message-v1",
    },
    json={
        "to": "+254712345678",
        "type": "template",
        "template": {
            "name": "order_update",
            "language": "en",
            "parameters": ["Jane", "MW-1042"],
        },
    },
    timeout=30,
)
response.raise_for_status()
print(response.json()["data"])
```

### PHP (cURL)

```php
<?php
$payload = [
  "to" => "+254712345678",
  "type" => "template",
  "template" => [
    "name" => "order_update",
    "language" => "en",
    "parameters" => ["Jane", "MW-1042"],
  ],
];
$ch = curl_init("https://wap.mobiwave.co.ke/api/v1/messages");
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => [
    "Authorization: Bearer " . getenv("MOBIWAVE_API_KEY"),
    "Idempotency-Key: order-1042-message-v1",
    "Content-Type: application/json",
  ],
  CURLOPT_POSTFIELDS => json_encode($payload),
]);
$body = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
if ($body === false || $status < 200 || $status >= 300) {
  throw new RuntimeException("MobiWave API request failed: " . curl_error($ch));
}
curl_close($ch);
echo $body;
```

## Meta callback

Configure the Meta webhook callback URL as:

`https://wap.mobiwave.co.ke/api/webhooks/whatsapp`

Use the verification token generated in **Integrations → Meta connection**. Subscribe the WhatsApp Business Account to the `messages` and `message_template_status_update` fields.

## Compatibility and policy

- The original `POST /messages/send` endpoint remains available for existing template-only integrations.
- New structured API routes use the branded MobiWave domain. Do not call internal Supabase function URLs directly.
- MobiWave uses the official Meta WhatsApp Cloud API. It does not use QR-based or unofficial WhatsApp sessions.
- Meta policies, approved template requirements, quality controls, messaging windows, account limits and message charges continue to apply.
