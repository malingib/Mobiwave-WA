# MobiWave WA: campaign lifecycle and production-readiness audit

**Audit date:** 2026-10-31  
**Scope:** Repository review against the agreed Phase 1–4 roadmap. This is a source review, not a claim that all production behavior has been exercised.

## Executive finding

The application has a useful foundation: official Meta Cloud API integration, tenant-scoped tables and role checks, approved-template checks, opt-out enforcement, atomic campaign recipient claiming, message status ingestion, and retryable customer webhook delivery. The immediate priority is reliability and proof, not a wholesale rewrite or new infrastructure.

**Production readiness is not yet demonstrated.** The reviewed implementation has concrete failure modes around outbound persistence, webhook durability, campaign accounting, and end-to-end verification.

## Phase 1 — P0 findings

### P0.1 Agent-send idempotency and persistence

**Evidence:** `supabase/functions/meta-send/index.ts`

- The function calls Meta before persisting the outbound `messages` row.
- The insert result is ignored. A provider-accepted message can be reported as successful even when the local message record failed to persist.
- There is no client-supplied idempotency key or durable send-attempt record to make client retries safe.
- Usage-event insert and customer-webhook emission outcomes are also not treated as part of a recoverable workflow.

**Required fix:** introduce a tenant-scoped idempotency key and durable outbound attempt/message record before provider submission; persist provider message IDs and state transitions; return the prior result for repeated keys; surface and reconcile ambiguous outcomes instead of blindly retrying. Ensure the UI can distinguish queued, accepted, delivered, failed, and outcome-unknown.

**Safety note:** Meta does not make an arbitrary client retry equivalent to an idempotent send. A timeout after submission must be treated as ambiguous unless provider evidence resolves it.

### P0.2 Durable Meta webhook inbox

**Evidence:** `supabase/functions/meta-webhook/index.ts`

- Signature verification is performed, then inbound messages and statuses are processed synchronously in the webhook request.
- The existing message uniqueness key helps deduplicate inbound message rows, but it is not a durable record of the complete provider webhook event and its processing lifecycle.
- Duplicate insert races can fail the whole request; status updates and some side effects do not check database errors consistently.
- The handler can return 500 after partial writes, so replay behavior needs explicit, testable semantics.

**Required fix:** after signature verification, durably store each webhook payload/event with a stable idempotency key and processing state, acknowledge only after storage succeeds, then process through a bounded worker. Add attempt counts, next-attempt timestamps, last error, processed time, safe replay and dead-letter inspection. Deduplicate both inbound message IDs and status events; make side effects idempotent.

### P0.3 Campaign worker recovery and accounting

**Evidence:** `supabase/functions/campaign-launch/index.ts`, `claim_campaign_recipients` migration and `campaign_recipients` schema.

**Already present:** atomic recipient claims use `FOR UPDATE SKIP LOCKED`; claim attempts and timestamps exist; stale `sending` recipients are moved to an outcome-unknown failure rather than automatically re-sent. These should be retained.

**Risks to resolve:**
- A campaign launch request performs only a batch of up to ten recipients; the repository's scheduled worker setup must be checked to establish that campaigns progress without a user repeatedly clicking launch.
- Campaign recipient outcomes, usage-event inserts, campaign status updates and completion webhook emissions need checked writes and a reconciliation path.
- A provider acceptance followed by a database failure must not be counted as a simple failure that can be safely retried.
- Monthly usage checks performed as count-then-send can race under concurrent sends.
- Unknown outcomes require a deliberate operator resolution/reconciliation flow.

**Required fix:** separate campaign orchestration from per-recipient delivery, run bounded batches from a secured scheduled worker, make state transitions conditional, reconcile provider status callbacks against recipient records, and provide safe pause/resume/cancel behavior. Do not blindly retry ambiguous provider outcomes.

### P0.4 Tenant isolation

**Evidence:** tenant-aware schema/RLS and server-side `requireTenantRole` checks are present in the reviewed paths.

**Not proven:** source inspection and mocked browser tests do not prove isolation across real authenticated users/workspaces. Service-role functions bypass RLS, so every such path must explicitly scope reads/writes to the resolved tenant.

**Required tests:** use two controlled test workspaces and distinct users. Verify cross-tenant read/update/delete denial for contacts, campaigns, recipients, messages, conversations, notes, templates, integrations, usage and webhooks; verify Edge Function tenant-role checks; verify guessed foreign tenant and resource IDs do not leak data. Avoid destructive testing against real customer records.

### P0.5 Real Meta test-number E2E

The implementation status documentation states that no live end-to-end WhatsApp test has been confirmed. CI and mocked Playwright tests are not substitutes.

**Required controlled test:** an authorized Meta test WABA/phone number and an explicitly consented test recipient; verify approved template send, Meta acceptance ID, inbound reply, delivery/read/failure status callbacks, duplicate webhook delivery, opt-out suppression, persisted inbox history and usage accounting. Never send test traffic to real customers without explicit authorization.

### P0.6 Security and audit controls

- The latest reviewed Supabase security advisor result included a warning that leaked-password protection is disabled. Enable it in the Supabase Auth security settings and verify the setting.
- Add durable audit events for sensitive actions: integration changes, campaign creation/launch/pause/cancel, template sync, consent/opt-out changes, API-key changes, member/role changes and billing adjustments.
- Ensure logs never include Meta access tokens, service-role keys, internal tokens, full sensitive payloads or unnecessary personal data.
- Test RLS, role authorization, webhook signature failure, API key scope/rate limits, and secrets handling.
- Record migration history carefully: live migration versions and repository filenames were previously observed to differ. Reconcile using additive migrations and actual migration state; do not replay broad DDL or rewrite applied migrations blindly.

## Phase 2 — Bulk messaging experience

| Capability | Audit result / next verification |
|---|---|
| Contact import | Verify actual import UI, field mapping, invalid rows, deduplication and error export; implement if absent. |
| Segmentation | Verify tags, custom fields, saved filters, exclusions and consent-aware audience previews. |
| Campaign creation | Confirm end-to-end draft → audience → approved template → variable mapping → preview → confirmation. |
| Media and buttons | Confirm template component parameter validation for headers, body variables, URL buttons and media. |
| Scheduling | Verify scheduler actually claims due campaigns; scheduled status alone is not execution. |
| Pause/resume/cancel | Enforce transitions server-side and prevent new claims after pause/cancel. |
| Recipient reports | Show queued, sending, accepted/sent, delivered, read, failed, skipped and outcome-unknown with reasons. |
| Cost/export | Separate estimated Meta charge, actual provider charge and MobiWave fee; export recipients and reconciliation data. |

Campaign UX must be a first-class navigation area, separate from the inbox, with its own campaign list, creation wizard, detail view, recipient report and analytics.

## Phase 3 — Customer engagement

Review and then implement only the actual gaps: team queues, saved replies, collision prevention, contact tags and priority, business hours, assignment automation, SLA/escalation, customer timeline, agent performance reporting. Preserve existing assignment, notes and read-state work.

## Phase 4 — Commercial platform

Treat wallet/billing, plan enforcement, developer API portal, webhook management, CRM/commerce/payment integrations, and SMS/MobiWave channel integrations as a distinct commercial domain. Do not couple billing mutations directly to inbox components. Provider costs, customer charges, usage ledger entries and M-Pesa reconciliation must be independently auditable.

## Recommended implementation order

1. Add focused regression tests and fix agent-send durable persistence/idempotency.
2. Implement durable Meta webhook event storage and replay.
3. Harden campaign recipient state transitions, scheduling/worker progress and reconciliation.
4. Run two-workspace authorization/RLS tests.
5. Complete a controlled live Meta test-number E2E after credentials and recipient authorization are available.
6. Enable and verify leaked-password protection; add audit logging.
7. Finish the campaign creation and reporting lifecycle, then proceed to inbox operations and commercial integrations.

## Acceptance criteria

Phase 1 is complete only when:
- repeated requests with the same idempotency key do not create a second provider send;
- every provider submission has a durable state and reconciliable result;
- verified webhook payloads are durably stored before acknowledgement and can be replayed safely;
- campaign batches recover without silently losing or duplicating recipients;
- two-workspace tests demonstrate tenant boundaries;
- controlled live Meta send/receive/status tests pass;
- required security settings and audit events are verified.

**Do not claim production-ready based only on a successful build, deployment, or mocked browser suite.**
