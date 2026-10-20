# Environment and deployment

## Existing deployment

The dashboard is deployed to the existing Vercel project at https://mobiwavewa.vercel.app and uses Supabase project ref `jyjgvsljcmvbhovzevaz`. Use [production-go-live.md](production-go-live.md) for the exact production setup checklist.

## Browser variables

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (Supabase publishable key is preferred where supported)

These are public browser configuration values. Never put `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `APP_ENCRYPTION_KEY`, Meta access tokens, Meta app secrets, or internal tokens in browser variables or committed files.

## Supabase Edge Function secrets

Configure server-side secrets in the Supabase project dashboard:

- `SUPABASE_URL` — provided by the Supabase runtime.
- `SUPABASE_ANON_KEY` — legacy anon key, needed for request-scoped user clients.
- `SUPABASE_SERVICE_ROLE_KEY` — server-side only.
- `APP_ENCRYPTION_KEY` — 32 cryptographically random bytes encoded as 64 hex characters. Keep backups secure; losing it makes saved Meta credentials undecryptable.
- `META_APP_SECRET` — used to verify `X-Hub-Signature-256`.
- `META_WEBHOOK_VERIFY_TOKEN` — a separate random verification string entered in Meta webhook setup.
- `META_GRAPH_VERSION` — supported Graph API version for the connected Meta app.
- `OPENAI_API_KEY` and optionally `OPENAI_MODEL` — only required for AI replies and memory suggestions.
- `INTERNAL_FUNCTION_TOKEN` — high-entropy internal token used by server-to-server worker calls.
- `APP_ALLOWED_ORIGIN` — exact dashboard origin: `https://mobiwavewa.vercel.app`.

Use unique random values and a password manager. Do not send secrets in chat or commit them to Git. Configure `CRAWL_RENDERER_SECRET` on both Vercel (server-side only, never a `VITE_*` variable) and Supabase Edge Function secrets; set `CRAWL_RENDERER_URL` only once the production endpoint is deployed. Losing the encryption key prevents decrypting existing saved Meta credentials.

## Supabase Auth

In Supabase Dashboard → Authentication → URL Configuration:

- Site URL: `https://mobiwavewa.vercel.app`
- Redirect URL allowlist: `https://mobiwavewa.vercel.app/**`
- Add `http://localhost:5173/**` only if local development needs it.

## Meta webhook and message delivery

- Callback: `https://jyjgvsljcmvbhovzevaz.supabase.co/functions/v1/meta-webhook`
- Configure the callback in the Meta app, use the exact `META_WEBHOOK_VERIFY_TOKEN`, and subscribe to WhatsApp message events.
- The webhook POST handler independently verifies Meta's HMAC signature before processing. Keep platform JWT verification disabled only for `meta-webhook`, `webhook-worker`, and `api-send` as configured; the latter two apply their own internal/API-key authorization.
- Configure the WhatsApp Business Account, phone number ID, and appropriate long-lived/system-user token in the dashboard's Integrations view. Verify the connection and sync templates.

## Scheduled customer webhook retries

The workflow `.github/workflows/webhook-worker.yml` invokes the Supabase `webhook-worker` every five minutes and supports manual dispatch. Add these repository Actions secrets in GitHub → Settings → Secrets and variables → Actions:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `INTERNAL_FUNCTION_TOKEN` (must match the Supabase Edge Function secret exactly)

The GitHub schedule can be delayed. This worker is for bounded retry processing and does not promise a real-time SLA.

## Safe pilot

Before production campaigns, test sign-up/sign-in, workspace creation and tenant isolation; ingest a website you are authorized to crawl; verify consent suppression and approved-template enforcement; send/receive a Meta-authorized test message; confirm delivery statuses; and test customer webhook signing/retries. AI is optional and should remain disabled until its provider secret and human-handoff behavior have been verified.

## Scope limits

The crawler supports bounded HTML/text extraction and an optional authenticated Playwright fallback for JavaScript-rendered pages; PDFs and authenticated pages remain unsupported. Respect website terms, robots rules and content permissions. DNS preflight alone cannot fully eliminate DNS-rebinding races; for high-assurance production, route crawling through an egress proxy enforcing destination IP policy at connection time. Campaign launches are bounded per invocation; continue processing batches while recipients remain queued.
