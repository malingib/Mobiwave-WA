# Environment and deployment

## Existing deployment

The dashboard is deployed to the existing Vercel project at https://wap.mobiwave.co.ke and uses Supabase project ref `jyjgvsljcmvbhovzevaz`. Use [production-go-live.md](production-go-live.md) for the exact production setup checklist.

## Browser variables

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (Supabase publishable key is preferred where supported)

These are public browser configuration values. Never put `SUPABASE_SERVICE_ROLE_KEY`, `APP_ENCRYPTION_KEY`, Meta access tokens, Meta app secrets, or internal tokens in browser variables or committed files.

## Supabase Edge Function secrets

Configure server-side secrets in the Supabase project dashboard:

- `SUPABASE_URL` — provided by the Supabase runtime.
- `SUPABASE_ANON_KEY` — legacy anon key, needed for request-scoped user clients.
- `SUPABASE_SERVICE_ROLE_KEY` — server-side only.
- `APP_ENCRYPTION_KEY` — 32 cryptographically random bytes encoded as 64 hex characters. Keep backups secure; losing it makes saved Meta credentials undecryptable.
- `META_APP_SECRET` — used to verify `X-Hub-Signature-256`.
- `META_WEBHOOK_VERIFY_TOKEN` — optional legacy verification token. New workspaces generate and store their own webhook verification token from Integrations.
- `META_GRAPH_VERSION` — supported Graph API version for the connected Meta app.
- `INTERNAL_FUNCTION_TOKEN` — high-entropy internal token used by server-to-server worker calls.

Use unique random values and a password manager. Do not send secrets in chat or commit them to Git. Losing the encryption key prevents decrypting existing saved Meta credentials.

## Supabase Auth

In Supabase Dashboard → Authentication → URL Configuration:

- Site URL: `https://wap.mobiwave.co.ke`
- Redirect URL allowlist: `https://wap.mobiwave.co.ke/**`
- Add `http://localhost:5173/**` only if local development needs it.

## Meta webhook and message delivery

- Callback: `https://wap.mobiwave.co.ke/api/webhooks/whatsapp`
- Configure the callback in the Meta app, use the workspace verification token generated in Integrations, and subscribe to WhatsApp message events.
- The webhook POST handler independently verifies Meta's HMAC signature before processing. Keep platform JWT verification disabled only for `meta-webhook`, `webhook-worker`, and `api-send` as configured; the latter two apply their own internal/API-key authorization.
- Configure the WhatsApp Business Account, phone number ID, and appropriate long-lived/system-user token in the dashboard's Integrations view. Verify the connection and sync templates.

## Scheduled customer webhook retries

The workflow `.github/workflows/webhook-worker.yml` invokes the Supabase `webhook-worker` every five minutes and supports manual dispatch. Add these repository Actions secrets in GitHub → Settings → Secrets and variables → Actions:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `INTERNAL_FUNCTION_TOKEN` (must match the Supabase Edge Function secret exactly)

The GitHub schedule can be delayed. This worker is for bounded retry processing and does not promise a real-time SLA.

## Safe pilot

Before production campaigns, apply the latest migrations and deploy the matching Edge Functions. Test sign-up/sign-in, workspace creation and tenant isolation; verify consent suppression and approved-template enforcement; send/receive a Meta-authorized test message; confirm delivery statuses; test conversation assignment, notes, unread markers, and media access; and test customer webhook signing/retries.

## Scope limits

Campaign sends process at most ten recipients per invocation. A recipient whose send outcome is ambiguous is held for manual review rather than automatically retried. Message limits default to zero (no fixed cap); a positive workspace override enforces a monthly limit.
