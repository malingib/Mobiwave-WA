# Environment and deployment

## Required browser variables
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (Supabase publishable key is preferred where supported)

Never put `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `APP_ENCRYPTION_KEY`, Meta access tokens, or Meta app secrets in browser variables or committed files.

## Supabase Edge Function secrets
Configure these in the Supabase project before deploying functions:
- `SUPABASE_URL` — provided by the Supabase runtime.
- `SUPABASE_ANON_KEY` — legacy anon key, needed for request-scoped user clients.
- `SUPABASE_SERVICE_ROLE_KEY` — server-side only.
- `APP_ENCRYPTION_KEY` — 32 cryptographically random bytes encoded as 64 hex characters. Keep backups secure; losing it makes saved Meta credentials undecryptable.
- `META_APP_SECRET` — used to verify `X-Hub-Signature-256`.
- `META_WEBHOOK_VERIFY_TOKEN` — a separate random verification string entered in Meta webhook setup.
- `META_GRAPH_VERSION` — supported Graph API version for the connected Meta app.
- `OPENAI_API_KEY` and optionally `OPENAI_MODEL` — only required for AI replies.
- `INTERNAL_FUNCTION_TOKEN` — high-entropy internal token if server-to-server AI function calls are enabled.
- `APP_ALLOWED_ORIGIN` — the exact allowed dashboard origin.

The Meta webhook is the only function configured with platform JWT verification disabled. It independently verifies Meta's HMAC signature before processing POST requests. Other user-facing functions should keep JWT verification enabled.

## Apply and deploy
1. Create a Supabase project in the intended MobiWave organization.
2. Apply the SQL migrations in timestamp order using the Supabase CLI or dashboard SQL editor.
3. Set secrets above. Use unique random values; do not reuse passwords.
4. Deploy each folder under `supabase/functions/` as an Edge Function. Deploy `meta-webhook` and `webhook-worker` with JWT verification disabled; keep JWT verification enabled for other user-facing functions. The webhook worker independently checks `X-Internal-Token`.
5. Configure Auth site URL and redirect URLs for the real dashboard domain.
6. Configure the Meta app's WhatsApp webhook callback to `<SUPABASE_URL>/functions/v1/meta-webhook`, subscribe to WhatsApp message fields, and use the configured verify token.
7. Schedule a trusted server-side POST to `<SUPABASE_URL>/functions/v1/webhook-worker` at least once per minute with `X-Internal-Token: <INTERNAL_FUNCTION_TOKEN>` and `apikey: <SUPABASE_PUBLISHABLE_KEY>`. Never place this token in the frontend.
8. Configure the dashboard's environment variables and deploy the static Vite app.
9. Create a test workspace, add a public help URL you control, crawl it, verify approved memory retrieval, and test Meta messages with a test phone before production rollout.

## Important deployment safety notes
- The crawler accepts only explicit tenant-submitted URLs, follows same-host links only when that scope is selected, limits page size/count, validates redirects and DNS answers, and does not perform general internet search. For high-assurance production, route crawling through an egress proxy that enforces destination IP policy at connection time; DNS preflight alone cannot fully eliminate DNS-rebinding races.
- Respect website terms, robots rules and content permissions. The initial crawler is a bounded HTML/text extractor, not a browser renderer; JS-rendered pages and PDF files are not supported.
- The AI uses approved retrieved chunks and approved memory, not model retraining. Unsupported questions must be handed to a human. The default state keeps AI disabled.
- Campaign sending requires explicit recorded opt-in and an approved Meta template. Each launch request processes up to 10 recipients; repeat while queued recipients remain.
- This repository foundation has not been deployed to a live Supabase project and no live Meta/OpenAI credentials have been supplied in this work session.
