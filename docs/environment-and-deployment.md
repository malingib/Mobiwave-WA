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
- `META_WEBHOOK_VERIFY_TOKEN` — optional legacy verification token. New workspaces generate and store their own webhook verification token from Integrations.
- `META_GRAPH_VERSION` — supported Graph API version for the connected Meta app.
- `INTERNAL_FUNCTION_TOKEN` — high-entropy internal token used by server-to-server worker calls.
- `INVITE_REDIRECT_ORIGINS` — optional comma-separated allowlist of origins accepted for team invitation links. Defaults to `https://wap.mobiwave.co.ke,http://localhost:5173`; any other requested origin falls back to the first entry.

Use unique random values and a password manager. Do not send secrets in chat or commit them to Git. Losing the encryption key prevents decrypting existing saved Meta credentials.

## Supabase Auth

In Supabase Dashboard → Authentication → URL Configuration:

- Site URL: `https://wap.mobiwave.co.ke`
- Redirect URL allowlist: `https://wap.mobiwave.co.ke/**`
- Add `http://localhost:5173/**` only if local development needs it.

## Meta webhook and message delivery

- Callback: `https://wap.mobiwave.co.ke/api/webhooks/whatsapp`
- Configure the callback in each client's Meta app, use that workspace's verification token generated in Integrations, and subscribe the app to the WhatsApp `messages` field. Connection verification also subscribes that app to the client's WABA through `POST /{WABA-ID}/subscribed_apps`; the access token needs WhatsApp Business Management permission.
- The webhook POST handler independently verifies Meta's HMAC signature before processing. Keep platform JWT verification disabled only for `meta-webhook`, `webhook-worker`, and `api-send` as configured; the latter two apply their own internal/API-key authorization.
- Configure the WhatsApp Business Account, phone number ID, access token, and that client's Meta app secret in the dashboard's Integrations view. The app secret is encrypted per business account and used for HMAC verification. Configure the Meta callback and `messages` field first, then verify the connection and sync templates.

## Scheduled webhook retries

Supabase Cron is the intended scheduler for the customer webhook and Meta webhook workers. The last documented production check found both jobs running every minute on 2026-11-03; confirm they remain active and that `INTERNAL_FUNCTION_TOKEN` matches Supabase Vault and Edge Function secrets before launch. GitHub Actions does not schedule or invoke these workers. See the production go-live checklist for worker behavior and the limits of the recorded health checks.

## Safe pilot

Before production campaigns, apply the latest migrations and deploy the matching Edge Functions. Test sign-up/sign-in, workspace creation and tenant isolation; verify consent suppression and approved-template enforcement; send/receive a Meta-authorized test message; confirm delivery statuses; test conversation assignment, notes, unread markers, and media access; test campaign pause/resume/cancel while a batch is running; and test customer webhook signing/retries.

## Scope limits

Campaign sends process at most ten recipients per invocation and return unsent recipients to the queue after a 90-second safety budget. Campaigns require an operator to resume each batch; no scheduled campaign runner is configured. Pause/cancel stops the worker before its next recipient; a recipient already submitted to Meta may still complete. A recipient whose send outcome is ambiguous is held for manual review rather than automatically retried. The customer-webhook worker also stops starting deliveries after 90 seconds; remaining candidates are left unclaimed for the next scheduled run. Message limits default to zero (no fixed cap); a positive workspace override enforces a monthly limit.
