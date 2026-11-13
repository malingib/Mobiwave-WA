# MobiWave WA deep readiness review — 2026-11-12

## Production verification update — 2026-11-13

This update uses the live Supabase Management API and the current production host. Migrations and Edge Functions were deployed with the supplied Supabase token; no database password was used.

- Applied `platform_admins`, `tenant_meta_app_secrets`, `monotonic_message_status`, `campaign_controls`, `tenant_overview_metrics`, `validate_tenant_relationships`, `security_performance_hardening`, `reduce_select_policy_overlap`, `platform_billing_management`, and `platform_billing_fk_indexes`. The Management API assigned execution-time versions; local/remote migration timestamp drift remains, so do not run `supabase db push` until that history is reconciled.
- Before validating the tenant constraints, read-only anti-join checks returned zero historical mismatches across all 18 relationships. Production now reports all 18 constraints with `convalidated = true`.
- Deployed all 19 local Edge Functions using the Supabase CLI's API bundler. The remote function list reports them `ACTIVE`, including `campaign-control`; pre-existing remote functions without local source were left in place.
- Updated Supabase Auth's Site URL and redirect allowlist to `https://wap.mobiwave.co.ke`, matching the deployed app, invitation callback, and function CORS origin. Email confirmation remains required. SMTP delivery was not exercised.
- The live Security Advisor no longer reports anonymous execution of `platform_tenant_overview`. It reports authenticated `SECURITY DEFINER` warnings for the platform overview and owner-only billing RPCs; each checks `platform_admins` in the database before reading or mutating records. Billing tables have RLS enabled, no direct authenticated table grants, and anonymous RPC execution revoked. Service-only tables with RLS and no client policies are reported at INFO level.
- Supabase rejected enabling leaked-password protection with HTTP 402; the setting remains disabled and is a plan/configuration launch gate.
- The Performance Advisor no longer reports unindexed foreign keys or overlapping permissive SELECT policies after supporting indexes and operation-specific write policies were added. It still reports unused-index INFO notices; those are not grounds for dropping indexes without workload evidence.
- The local production build passes (`npm run build`) and all 19 Edge Function entrypoints pass `deno check`. Vite still reports a 504.74 KB dashboard entry chunk. The production HTML references a different JS asset from the local build, so the current frontend edits are not deployed.

These live checks improve the pilot position, but do not establish full launch readiness. Billing remains manual/incomplete; frontend deployment, SMTP/invitation exercise, Meta send and callback tests, two-tenant adversarial checks, browser performance, quota concurrency, and current scheduler/secret checks remain open.

This review follows the checked-out UI, Edge Functions, migrations, configuration and deployment docs. The original 2026-11-12 assessment was a source review; the dated production verification update below supersedes its earlier statements about remote state. The connected REA session has no binary/app target open, and browser capture has no configured local Chrome CDP endpoint.

## Current position

The product is a React/Vite dashboard backed by Supabase Auth, Postgres/RLS and Edge Functions. It uses Meta's official WhatsApp Cloud API for tenant-specific sending, webhooks, templates and message status. The working product covers workspace membership, contacts and consent, shared inbox, templates, campaigns, Meta integration, customer API keys and outbound webhooks.

The engineering foundation is credible for a controlled pilot after the remaining provider and operational checks below. It is **not ready for unrestricted commercial launch**: the new billing console is a manual ledger without payment-processor collection, customer self-service, automated renewals, tax calculation, or plan-entitlement enforcement; automated campaign continuation is absent, frontend changes are not deployed, and real provider/auth/security checks remain outstanding.

## Findings by area

### UI and UX

- The main dashboard has distinct Overview, Inbox, Contacts, Templates, Campaigns, Alerts, Integrations, Profile and Settings views. Public landing and pricing surfaces are separately lazy-loaded.
- The inbox and contact list use pagination; campaign composition blocks unapproved templates, incomplete variables and media headers that are not uploadable. Consent is checked again before each send.
- Campaigns need an operator to launch every batch. The batch size is capped at ten and has a 90-second safety yield. Pause, resume and cancel controls are deployed; a live concurrency exercise remains outstanding.
- Campaign reporting remains basic: the detail view focuses on total, queued and failed recipients, with limited failure detail. It does not provide campaign analytics or a complete recipient-level delivery report.
- The pricing page was rendered locally at desktop and mobile viewport sizes after clarifying the billing state. Other screens, interaction flows, keyboard navigation and live loading/error states remain unverified in a browser. REA has no app target open.

### Backend and API

- Outbound dashboard and public API sends use durable attempt records and idempotency keys. API sends now report Meta acceptance as `accepted`, then reconcile provider callbacks; acceptance is not presented as confirmed delivery.
- All send paths use the same monotonic provider-state order (`accepted < sent < failed < delivered < read`). Campaign sends reconcile durable status history after linking a recipient to Meta's message ID, including callbacks that arrived before campaign finalization.
- If Meta accepted a send but a later history/usage write fails, the durable provider outcome remains `accepted`; dashboard, API and campaign paths surface a persistence warning and attempt to create an Alerts entry.
- JSON request bodies parsed by Edge Functions now have a shared 128 KiB streaming limit before parsing; the public Meta webhook keeps its explicit 1 MiB raw-body limit for signature verification, and API-send uses its 128 KiB limit.
- Inbound opt-out keywords now make successful contact suppression a prerequisite for acknowledging the Meta event.
- Customer webhook configuration lookup errors retry through the delivery backoff path; only an actual missing/disabled hook is dead-lettered.
- Manual retry resets the attempt counter so an administrator can re-open a dead-letter delivery as a fresh retry cycle.
- Meta integration lookup errors are retryable, and downstream inbound/status webhook events must reach the customer-webhook queue before the Meta event is marked complete.
- Campaign claims, message-state progression and monthly message-quota reservations now use database RPCs. Failed verification of quota state fails closed.
- Customer webhook deliveries use a durable queue, atomic claims, bounded retries and dead-letter states. Delivery is at-least-once; consumers must deduplicate.
- Manual webhook tests/retries are due immediately before worker claim, and the scheduled worker yields before its 90-second safety budget so unclaimed candidates remain available for the next run.
- Team-member loading makes bounded batches of Auth lookups for only the workspace's capped member list; it does not scan the global Auth directory.
- Workspace owners/admins can invite agents and viewers from Settings; only owners can grant the admin role. Existing Auth accounts are added directly, while new accounts use Supabase Auth invitation email. SMTP delivery and the `/login` redirect allowlist must be configured and exercised before this path is launch-ready.
- Tenant API key creation, function authorization, send flows and callback reconciliation were inspected statically. No production API contract, Meta-authorized send, or cross-tenant adversarial check was executed in this pass.

### Database and tenant isolation

- Core business tables carry `tenant_id`; RLS and server-side tenant-role checks are used. The latest local migration adds composite tenant-matching foreign keys and monotonic message-status updates.
- Conversation assignment was checked in the Edge Function but could also be updated through the authenticated Data API. Production now enforces `(tenant_id, assigned_to)` against workspace membership and removes read markers with the membership. All 18 tenant-matching foreign keys have been validated after historical mismatch checks returned zero.
- The quota reservation and campaign-control RPCs are privileged to `service_role`; direct browser writes to these state transitions are not the intended path.
- Production migration state was confirmed through the Management API. The local and remote migration timestamps differ because the remote ledger stores execution-time versions; using `supabase db push` before reconciliation risks replaying already-applied schema changes.

### Billing and pricing

- `PricingPage.tsx` presents indicative plan amounts, optional setup, and Meta messaging rates. It does not create a checkout session, activate a plan or collect payment.
- The platform-owner billing console now includes configurable tiers, client billing profiles, recorded commercial agreements, invoice issuance/printing, external payment recording and reversal, unpaid-invoice voiding, and an audit ledger. It is a manual operating workflow; there is no payment-provider charge/webhook, email delivery, automated renewal, customer self-service, tax calculation, or plan-entitlement enforcement. A tier assignment does not change workspace access or limits.
- The pricing UI now labels plan amounts indicative, routes plan-specific actions to an email enquiry, and states that checkout and tier activation are not automatic. This makes the current public path clearer but does not close the billing launch gate.
- Message quota is a separate optional workspace override; the default is zero (no fixed platform cap). It is not subscription billing or customer charge reconciliation.
- The manual workflow can support a controlled contract-and-invoice pilot after the public pricing and tax treatment are confirmed. Do not present pricing cards as live self-serve checkout or assume the dashboard status controls product entitlements.

### Performance and scale

- Current production build: dashboard entry `504.74 KB` raw / `139.98 KB` gzip; lazy Overview chunk `419.71 KB` / `120.96 KB` gzip. Vite warns that a chunk exceeds 500 KB. The app is split by some routes, but the authenticated dashboard remains a large entry bundle.
- Overview now requests exact tenant counts and a 14-day UTC message series from a new RLS-respecting Postgres function instead of counting paginated UI lists and a 5,000-row message sample. The migration is applied; the frontend using it is not yet deployed.
- Campaign sending deliberately processes a maximum of ten recipients per request. It requires a manual next-batch action; no scheduled campaign runner is configured.
- No browser-based Core Web Vitals, load test, database query plan or concurrent end-to-end send measurement was available. Build output is not runtime performance evidence.

### Security and operational risk

- Meta credentials are stored encrypted and scoped per tenant. Inbound Meta signatures and customer webhook signatures are checked. Customer webhook delivery re-resolves and checks all A/AAAA answers, then uses `Deno.connect` to pin the TCP peer and `Deno.startTls` with the original hostname for certificate validation and SNI. It sends HTTP/1.1 directly and does not follow redirects. This closes the source-level DNS check/connect gap; exercise the implementation in the actual Supabase Edge Runtime against public, private, rebinding and timeout destinations before enabling arbitrary endpoints in production.
- The same-tenant foreign keys are applied and validated after all 18 historical mismatch counts returned zero.
- Supabase Security Advisor previously reported leaked-password protection disabled. Enable it in the project before customer onboarding.
- Durable audit events for integration changes, campaign controls, consent changes, API-key changes, member/role changes and billing adjustments were not found as a complete audit trail.
- The production checks listed in the runbook are historical. Cron jobs, internal-token parity, Auth URLs, secrets, current Vercel deployment and Meta subscription must be rechecked against live systems.

## Work completed in this review chain

- Added source changes for stale UI request protection, inbox pagination, safer retry fingerprints, guarded tenant loaders, acceptance-aware API send state, checked quota/persistence paths, webhook status persistence and bounded campaign batches.
- Fixed test/retry webhook deliveries being scheduled an hour in the future despite an immediate claim, and bounded the scheduled webhook worker to 90 seconds.
- Bounded public Meta webhook/API-send bodies before parsing to reduce memory pressure from oversized requests.
- Made the opt-out database write checked so webhook processing retries if consent suppression cannot be persisted.
- Kept transient webhook-configuration read failures retryable rather than terminating customer delivery.
- Fixed manual dead-letter retry to reset the bounded-attempt counter before immediate reclaim.
- Kept transient Meta tenant-resolution failures and customer-event outbox insertion failures retryable through the durable Meta event inbox.
- Separated confirmed Meta acceptance from later history/usage persistence failures, with operator-visible warnings instead of treating those writes as ordinary success.
- Added monotonic message state, atomic quota reservation and same-tenant relational constraints in a local migration.
- Added server-guarded campaign pause/cancel transitions, running-state recipient claims and state-aware release of claimed work. A running Meta request may finish after pause/cancel; remaining recipients are not submitted by the worker after it observes the state change.
- Unified provider-state ranking across dashboard/API sends and campaign reconciliation; early Meta status callbacks are reapplied after campaign recipients are linked to their provider ID, including durable recovery after finalization failure.
- Added database-level same-workspace integrity for conversation assignees and per-user read markers, covering direct Data API writes in addition to Edge Function checks.
- Added security headers and immutable caching for hashed assets; updated deployment/readiness documentation.
- Replaced partial Overview KPIs with tenant-authorized database aggregates for contacts, consent, conversations, unread count, campaigns, templates and daily messages; added the supporting message timestamp index and refreshes on relevant realtime changes.
- Surfaced unfinished campaigns in the Overview KPI row and corrected its state set to include drafts, scheduled, queued, running and paused campaigns.
- Added a Settings flow for workspace invitations, with server-side role enforcement and a distinct existing-account path; updated go-live steps for Auth SMTP, redirect allowlisting, and invite acceptance.
- Made plan selection an email enquiry, labeled prices indicative, and clarified that checkout and tier activation are not implemented; removed unsupported tier-specific API/webhook promises.
- Added a shared streaming JSON byte limit to every Edge Function that parses a request body, preventing oversized payload buffering across authenticated endpoints.
- Closed the customer webhook DNS-rebinding gap in source by connecting to a validated public IP, then starting TLS with the original hostname; expanded rejection of non-global IPv4/IPv6 destinations. The request uses a small HTTP/1.1 exchange so it does not depend on Deno 2.9-only transport features; runtime integration still needs a controlled Edge Function exercise.
- No OpenWA or other third-party source was copied into the repository.

## Open-source research

- **OpenWA (`ridbay/openwa`)**: its own README says it uses reverse-engineered `whatsapp-web.js` / Baileys, identifies account restriction/ban risk and says compliance-sensitive deployments should use Meta's official Cloud API. Do not substitute it for this product's transport. [OpenWA repository](https://github.com/ridbay/openwa)
- **Kapso WhatsApp Cloud Inbox**: MIT-licensed; useful as an interaction and product reference, but the repository is built around Kapso's service and is not a drop-in for this Supabase tenancy model. [Repository](https://github.com/gokapso/whatsapp-cloud-inbox), [license](https://github.com/gokapso/whatsapp-cloud-inbox/blob/main/LICENSE)
- **Kapso TypeScript Cloud API client**: current `master` package metadata declares version 0.4.0, MIT and Node `>=20.19`; its client accepts an injectable `fetch`, and it offers typed Cloud API resources, template builders and Meta signature helpers. It may reduce hand-maintained request shapes, but it is not yet an adopted dependency: verify its built package in Supabase's Deno 2.1.4 runtime and review the transitive `zod` dependency before deciding. Existing `fetch` code is small and central to the send-safety/idempotency path, so replacing it without a compatibility spike would add risk. [Repository and README](https://github.com/gokapso/whatsapp-cloud-api-js), [package metadata](https://github.com/gokapso/whatsapp-cloud-api-js/blob/master/package.json)
- **Meta Cloud API SDK (`froggy1014/meta-cloud-api`)**: GitHub currently shows package version 3.13.0, MIT and Node `>=20.12.0`; the package documents a workerd runtime smoke script and covers much more of the Graph API. That makes it a candidate for an isolated Edge Runtime compatibility spike, not an immediate replacement: the published package's export conditions and Supabase's Deno 2.1.4 need to be exercised together, and this app's idempotency/quota/failure-reconciliation state machine must remain authoritative. No code was copied. [Repository](https://github.com/froggy1014/meta-cloud-api), [package metadata](https://github.com/froggy1014/meta-cloud-api/blob/main/package.json), [license](https://github.com/froggy1014/meta-cloud-api/blob/main/LICENSE)
- **Vercel `guarded-fetch`**: Apache-2.0 and documents connect-time IP pinning with Undici. It requires Node 20.19+ and Undici, so it is not a direct fit for the Supabase Deno Edge Runtime. Its connect-time validation principle informed the native Deno implementation; no source was copied. [Repository and README](https://github.com/vercel-labs/guarded-fetch)
- **Deno TCP/TLS APIs**: Deno documents `Deno.connect` and `Deno.startTls`, and Supabase documents native TCP support in Edge Functions. This supports a pinned peer while preserving hostname-based TLS checks. The Deno 2.1.4 Node HTTP shim explicitly marks custom `lookup` as unimplemented, so `https.Agent({ lookup })` is not a viable fallback. [Deno network API](https://docs.deno.com/api/deno/network/), [Supabase Edge Functions docs](https://supabase.com/docs/guides/database/connecting-to-postgres/serverless-drivers), [Deno 2.1.4 HTTP shim](https://github.com/denoland/deno/blob/v2.1.4/ext/node/polyfills/http.ts)
- **Chatwoot**: its non-enterprise source is MIT, with a separate license for `enterprise/`, and it contains useful inbox workflows. It is a much larger Rails/Redis product; use it for UX/API reference, not as a code transplant into this Vite/Supabase app. [License](https://github.com/chatwoot/chatwoot/blob/develop/LICENSE)
- **Meta examples**: useful for official Cloud API and signature-validation behavior, but the repository uses Meta Platform Policy terms; treat it as an implementation reference and inspect terms before copying. [Examples](https://github.com/fbsamples/whatsapp-api-examples)
- Meta's own Node SDK repository is archived, so it is not a maintained default dependency. [Archived SDK](https://github.com/WhatsApp/WhatsApp-Nodejs-SDK)

## Launch gates

1. Reconcile local and remote migration timestamps without replaying already-applied SQL; keep future migrations aligned with the production ledger.
2. Deploy the current Vite frontend build to the existing Vercel project and verify its assets and dashboard flows on the canonical host.
3. Recheck Supabase Cron, Vault/function token parity, invitation SMTP/template delivery and current Vercel deployment. Leaked-password protection remains unavailable under the current plan/configuration (Management API returned HTTP 402).
4. Run controlled tests with two dedicated workspaces and Meta-authorized test numbers: sign-up, invite acceptance and role boundaries, consent suppression, template enforcement, send idempotency, callbacks, quota concurrency, campaign pause/resume/cancel, webhook retry and media authorization.
5. Decide and implement the subscription/payment model or explicitly prepare manual invoicing and remove any implication that self-serve checkout is active.
6. Exercise the pinned customer-webhook transport in Supabase Edge Runtime; create sensitive-action audit events; measure browser performance and reduce the dashboard entry bundle.

## Verification performed

- `npm run build` passes TypeScript and Vite production build; Vite reports the 500 KB chunk warning above.
- `deno check supabase/functions/*/index.ts` passes for all Edge Functions.
- `deno check` passes for the webhook delivery and management functions after adding the pinned TCP/TLS exchange.
- `git diff --check` passes.
- `npm run build` passes after the Overview aggregation wiring; Vite still reports the large dashboard entry chunk.
- `npm run build` passes after the pricing-flow, Overview KPI and team-invitation changes; the 504.74 KB dashboard entry warning remains. Local Chrome captures show the pricing notice and plan layout at 1280×1000 and 390×844; this does not validate other routes or interactive behavior.
- `deno check supabase/functions/team-members/index.ts` passes. Supabase SMTP/template delivery and invite acceptance are not verified against a live project.
- `deno check` passes for `meta-send`, `api-send` and `campaign-launch` after shared status ranking and early-callback reconciliation; the race behavior still needs a live Edge Runtime/database concurrency exercise.
- Overview aggregation and RLS authorization are present in production. Their behavior still needs a controlled authenticated cross-tenant exercise.
- DNS pinning compiles, but has not been exercised in a running Supabase Edge Runtime; no end-to-end webhook request was sent during this pass. The response body excerpt is intentionally omitted; only the HTTP status is persisted.
- No Meta-authorized send, invitation email delivery, cross-tenant adversarial run, current Vercel frontend deploy, or browser performance measurement was performed. Production migration and Edge Function deployment were verified through the live Supabase APIs.

## Additional production facts — 2026-11-13

- Supabase Security Advisor shows `platform_tenant_overview()` is executable by authenticated users because the platform console calls it from a signed-in session. The function body checks membership in `platform_admins`; anonymous execution was explicitly revoked and is no longer flagged.
- Security Advisor still flags leaked-password protection as disabled. The Management API returned HTTP 402 when enabling it, and the setting remains off.
- Performance Advisor reports no unindexed foreign keys or multiple permissive SELECT policies after the supporting indexes and operation-specific write policies were applied. It continues to report unused-index INFO notices.
- Both `wap.mobiwave.co.ke` and `mobiwavewa.vercel.app` served the same Vercel page at inspection time, but Supabase Auth now permits the canonical custom domain only. The Vercel alias is not the supported login origin.
- The Vercel page's JavaScript asset hash differs from the local production build hash. The local frontend changes still need a Vercel deployment.
- The source work remains uncommitted in the local worktree.
