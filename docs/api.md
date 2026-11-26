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
  "status": "sent_to_meta",
  "idempotent_replay": false,
  "persistence_warning": false
}
```

This means Meta accepted the request; it is not a guarantee of delivery. Delivery/read/failure status is updated from Meta webhook events. The response can also include `idempotent_replay` and `persistence_warning`.

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

## Code examples

Keep the key in a server-side environment variable named `MOBIWAVE_API_KEY`.

### cURL

```bash
curl --request POST \
  --url https://wap.mobiwave.co.ke/api/v1/messages/send \
  --header "X-API-Key: $MOBIWAVE_API_KEY" \
  --header "Idempotency-Key: order-MW-1042-update-v1" \
  --header "Content-Type: application/json" \
  --data '{
    "to": "+254712345678",
    "template_name": "order_update",
    "language_code": "en",
    "components": []
  }'
```

### JavaScript (Node.js 18+)

```js
const response = await fetch(
  "https://wap.mobiwave.co.ke/api/v1/messages/send",
  {
    method: "POST",
    headers: {
      "X-API-Key": process.env.MOBIWAVE_API_KEY,
      "Idempotency-Key": "order-MW-1042-update-v1",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      to: "+254712345678",
      template_name: "order_update",
      language_code: "en",
      components: []
    })
  }
);
const result = await response.json();
if (!response.ok) throw new Error(result.error || `MobiWave API error: ${response.status}`);
console.log(result);
```

### Python (requests)

```python
import os
import requests

response = requests.post(
    "https://wap.mobiwave.co.ke/api/v1/messages/send",
    headers={
        "X-API-Key": os.environ["MOBIWAVE_API_KEY"],
        "Idempotency-Key": "order-MW-1042-update-v1",
    },
    json={
        "to": "+254712345678",
        "template_name": "order_update",
        "language_code": "en",
        "components": [],
    },
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### PHP (cURL)

```php
<?php
$payload = [
  "to" => "+254712345678",
  "template_name" => "order_update",
  "language_code" => "en",
  "components" => [],
];
$ch = curl_init("https://wap.mobiwave.co.ke/api/v1/messages/send");
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => [
    "X-API-Key: " . getenv("MOBIWAVE_API_KEY"),
    "Idempotency-Key: order-MW-1042-update-v1",
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

## Webhook signature verification example (Node.js)

Verify the exact raw request body before parsing JSON. The signing secret is shown only once when the customer webhook is created.

```js
import crypto from "node:crypto";

function verifyMobiWaveWebhook(rawBody, signature, secret) {
  const expected = "sha256=" + crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  const received = Buffer.from(signature || "");
  const expectedBuffer = Buffer.from(expected);
  return received.length === expectedBuffer.length &&
    crypto.timingSafeEqual(received, expectedBuffer);
}
```

The interactive documentation is also published at [https://wap.mobiwave.co.ke/api-docs/](https://wap.mobiwave.co.ke/api-docs/).
