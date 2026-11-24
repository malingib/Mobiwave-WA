# MobiWave WA — Deep design-system, UI/UX and frontend audit (2026-11-24)

**Scope:** `src/` frontend (design system, client dashboard, platform owner console), `scripts/` design gate, live Supabase project `jyjgvsljcmvbhovzevaz` (read-only inspection).
**Reference theme:** `https://nexlink.layoutdrop.com/demo/finance.html` (plus `index.html` and the rest of the NexLink page set).
**Method:** full source review, verified build, computed-style checks, design-budget run, typecheck, and live production queries. No files were changed during the audit.

---

## 0. Executive summary

The product has a genuinely good foundation: URL-based routing, honest real-data analytics, a real modal primitive, extensive async race protection, and strong consent/campaign safety UX. The current working tree, however, contains a **critical CSS regression** that breaks the entire visual system on the next deploy, plus a cluster of high-severity correctness and honesty issues.

The NexLink reference is useful as an **information-design and layout system** (light surfaces, indigo accent, 250px sidebar, 80px header, KPI row, chart/table card grid, 10px radii, Instrument Sans). It is **not** a source of product features. The redesign must copy the visual language while mapping every card to MobiWave data or an explicit empty state.

Live production reality (verified 2026-11-24):

| Signal | Live value | Consequence for dashboard design |
|---|---|---|
| Tenants | 2 (1 real, 1 `billing_exempt=true` demo) | Platform tables are tiny; a finance dashboard must show honest zero/empty states, not fabricated revenue. |
| Platform invoices / payments / mpesa transactions | **0 / 0 / 0** | No revenue, MRR, collection rate or "recent transactions" data exists yet. |
| Conversations / messages / contacts | 6 / 89 / 6 | Inbox and message-volume analytics are real and usable. |
| Campaigns / templates / webhook deliveries | 0 / 0 / 0 | Campaign and webhook surfaces must be empty-state-first. |
| Workspace alerts | 2 | Alerts page has real content. |
| Pending migrations | 7 versions, **2 duplicate version numbers** | Duplicates must be resolved before `supabase db push`. |

**Verdict:** fix P0/P1 first, then build the NexLink-style page set against real RPCs, with every "no data" state designed explicitly.

---

## 1. P0 — Critical (fix before any deploy)

### P0-1. Self-referential design tokens break the whole UI
`src/index.css:70-73, 76-77` (uncommitted) declares:

```css
--color-surface: var(--color-surface);
--color-raised: var(--color-raised);
--color-hairline: var(--color-hairline);
--color-hairline-strong: var(--color-hairline-strong);
--color-text: var(--color-text);
--color-text-muted: var(--color-text-muted);
```

A custom property that references itself is **guaranteed-invalid** at computed-value time. Tailwind v4.3.3 emits these cycles verbatim into `:root,:host` (verified by rebuilding). A fresh Playwright computed-style check confirmed `background-color: var(--color-surface)` resolves to `rgba(0,0,0,0)`, borders to currentColor/black, and text colors to inherited values.

`.app-shell` repeats the same cycles at `index.css:358-362`, so it cannot rescue them. Consequences across the app: `.panel`, `.modal-panel` (portaled to `body`, outside the shell), `.btn-secondary`, `.template-stat`, `bg-surface`, `bg-raised`, `text-text`, `border-hairline` lose background/border/text colors — roughly 130 utility usages. The sidebar (`App.tsx:1451`) renders with a **black right border**.

`git show HEAD:src/index.css` contains the correct values. **Fix:** restore `#ffffff`, `#f6f7fb`, `#eeeef3`, `#e3e4ec`, `#0c243c`, `#696981` in `@theme`, remove the self-references in `.app-shell`, and add explicit fallbacks on the portaled modal. Re-run `npm run build`, `npm run check:design`, screenshot baselines.

### P0-2. Duplicate migration versions block production push
`supabase/migrations/` contains two pairs sharing a version number:

- `20261124010000_add_retention_jobs.sql` / `..._corrected.sql`
- `20261124020000_fix_tier_catalog_mismatch.sql` / `..._corrected.sql`

`supabase migration list --linked` shows all four as pending with duplicated versions. **Fix:** keep one file per version (the `_corrected` variants), renumber them to unique versions, and verify the SQL of each before pushing.

### P0-3. Hard-coded testimonials and unverifiable metrics on the public landing page
`src/LandingPage.tsx:75-94` presents three named people with invented quotes, five-star ratings and invented outcomes ("2× faster replies", "Zero opt-out breaches", "Live in 1 day"). `LandingPage.tsx:187-197` hard-codes "50+ businesses onboarded", "12+ integration touchpoints", "6+ core messaging tools". Live production has **2 tenants**. This directly violates `docs/design-redesign-plan.md:201` (verifiable testimonials only) and `:224` (no fabricated customers).

**Fix:** remove the testimonial section and the fabricated proof numbers, or replace them with a clearly labelled sample ledger. Keep only verifiable claims (official Meta Cloud API, 1,000 free service messages).

### P0-4. Out-of-scope AI features advertised in pricing
`src/PricingPage.tsx:179` renders `["ai", "AI assistant"]` and `["automations", "Advanced automations"]`. AI and automations are explicitly excluded by the product guardrails (`README.md:28-33`, `design-redesign-plan.md:25,141`). **Fix:** remove both entries from the rendered feature list; leave dormant DB flags unused in the UI.

### P0-5. Stale credential material in the working tree
`.commandcode/settings.json` (untracked) contains cached shell commands with hard-coded Supabase Management API / webhook secrets in plaintext. **Fix:** remove the values, add `.commandcode/` to `.gitignore` (or scrub the file), and rotate the exposed credentials. The Supabase access token supplied for this session was stored only at `/tmp/opencode/.sb_token` (mode 600, outside the repo).

---

## 2. P1 — High (fix in the same batch)

| ID | Location | Problem | Fix |
|---|---|---|---|
| P1-1 | `index.css:1278-1287` | Portaled modal has invalid background/border (consequence of P0-1) | Fixed by P0-1; add `var(--color-surface, #fff)` fallback |
| P1-2 | `ui.tsx:227-282`, `397,423` | `Modal` effect depends on `onClose`; `useConfirm` passes fresh arrows each render. Every keystroke in the prompt re-runs the effect, refocuses the Close button and steals focus from the input. | Store `onClose` in a ref / memoize arrows; verify typing |
| P1-3 | `index.css:676-678,4676-4679` | Contrast <4.5:1 for 10-12px text: success-on-soft 3.33:1, warning 3.40:1, danger 4.24:1, shell faint text 2.58:1 | Use `#007d54` / `#a15c00` / `#b42318`; raise faint text to `#667085` |
| P1-4 | `index.css:131-135` | Global `:focus-visible` sets `border-radius:6px`, changing the shape of pills/round controls on keyboard focus | Remove `border-radius` from focus rule |
| P1-5 | `scripts/check-design-system.mjs` | `npm run check:design` **fails**: 10 distinct breakpoints vs budget 9; the gate is not in CI | Consolidate breakpoints; add the check to CI |
| P1-6 | `index.css:402,3064,3162,4692` | Header height declared four times (5rem → 4.35rem → 3.85rem → 4rem); effective ~70px, spec says 80px | Single `5rem` token; align `scroll-margin-top` |
| P1-7 | `App.tsx:696-735`, `763-777`, `546-556` | Query failures render as honest empty states; alerts, Meta allowance and integrations can look genuinely empty | Per-section error flags + retry panels |
| P1-8 | `App.tsx:302-309` | Toast tone inferred from substrings in message text ("record", "consent", "token", "api key") → successes never auto-dismiss | Explicit `{text, tone, sticky}` in `setNotice` |
| P1-9 | `BillingPage.tsx:137-139,219-222,361-368` | "Amount due" falls back to plan price with no invoice → false debt and an always-active Pay button | Compute only from issued invoices; disable Pay otherwise |
| P1-10 | `BillingPage.tsx:166-180` | STK push closes with no status feedback or status-check action | Pollable pending-payment state + manual refresh |
| P1-11 | `UsagePage.tsx:221-232` | Meta allowance exhaustion tells users to upgrade the **MobiWave** plan; these are separate products | Point to Meta Billing; remove plan CTA |
| P1-12 | `App.tsx:560-574` | Tier guard returns `true` while plan loads; gated views render then silently redirect | Pending gate + dedicated "not included" screen |
| P1-13 | `LandingPage.tsx:100` vs `PricingPage.tsx:197` | Conflicting price claim (KES 1,500-3,500 vs "indicative" RPC prices) | Derive from `platform_public_tiers` or remove figures |
| P1-14 | `App.tsx:530-532` | Tenant switch leaves drafts (reply text, filters, campaign recipients, webhook URL) from the previous tenant | Reset all tenant-scoped draft state |

---

## 3. P2 — Medium (design/quality batch)

### Design system
- **Duplicate overlapping CSS passes** (`index.css:3099-3106, 3173-3182, 3358-3367, 4380-4489`): 42 duplicated selectors; animation added then disabled, hover transform added then removed, panel surfaces redefined four times. Delete superseded passes; keep one rule per component.
- **Radius drift:** 10px → 12px → 11px → 10px across passes; buttons 7px, pills 5px. Use `--radius-panel` / `--radius-control` only.
- **Parallel palettes:** root canvas `#fdfdff` vs `.app-shell` `#f8f9fc` vs marketing `#f7f8fc`; root text `#0c243c` vs shell `#101828`; `--color-brand-blue` duplicates `--color-brand-600`. Pick one scale.
- **`KpiCard` tones** are styled only under `.platform-shell` / `.app-shell .overview-page`; Overview icons use brittle `:nth-child(1..4)` colouring (`index.css:3843-3846`). Define `.kpi-tone-*` globally.
- **Touch targets** below 44px: `.btn-sm` 32px, `.icon-btn` 36px, billing small buttons 30px, mobile nav links ~40px. Add `@media (hover:none)` minimums.
- **Typography:** three font families (Instrument Sans, Inter, Outfit) in one blocking Google Fonts import, no `preconnect`; `Outfit` is silently replaced by Instrument Sans inside the shell. 25 distinct arbitrary `text-[Npx]` sizes.
- **Old-palette literals survive** the token update (`#f83636`, `#f5a70d`, `rgba(248,54,54,…)`, `rgba(245,167,13,…)` in ~31 places).
- **`templates.css:1-30`** duplicates its entire rule set; the first block uses undefined legacy vars (`--text`, `--brand`, `--border`, `--surface`).
- **Dead/weak primitives:** `LiveDot` (`ui.tsx:212-217`) has identical ternary branches and is unused; `Status` (`ui.tsx:45-57`) misses `success`, `error`, `ok`, `inactive`, `disconnected`; modal focus trap can be escaped by clicking non-focusable area; unmounted `useConfirm` promises never settle.
- **`.reveal { opacity:0 }`** hides content if `IntersectionObserver` never fires (`ui.tsx:176-210`); make visible by default.

### Client dashboard
- `TemplatesPage.tsx:21-37,163-179,215-222` reinvents heading/status/empty/error primitives instead of using `ui.tsx`.
- `Overview.tsx:115-169` onboarding banner stays visible with all steps green; uses raw `blue-*`/`green-*` utilities.
- `Overview.tsx:180-186,218-232` "Messages" KPI is always 14 days while the chart toggles 7/14 days.
- `TeamPage.tsx:102-135` role change/removal have no in-flight guard; `:45-60` retains stale members after a failed switch.
- `BillingPage.tsx:378-393` invoice "Total" shows `subtotal_minor` and hides `paid_minor` and `due_on`.
- `ContactCsvImport.tsx:115-124` one unbounded upsert with no rejection report.
- `App.tsx:1372` tautological assignee filter branch; `App.tsx:1702` `aria-label` on a generic `<i>`; `App.tsx:1537-1543` promises non-existent "advanced analytics".
- `ErrorPages.tsx:63-72` 404 "Try again" just reloads the same 404.

### Platform console (owner view)
- **No sub-routing** (`App.tsx:1383-1388,1434-1442`; `PlatformConsole.tsx:204,358-362`): `/admin/billing` and `/admin/audit` silently render "Client workspaces"; refresh/back lose the section. Drive `section` from the URL.
- **Finance KPIs are computed from an RPC capped at 200 invoices** (`20261113192431_…sql:182`; `PlatformBilling.tsx:100-103,240-245`). With more invoices, revenue/outstanding/paid are silently wrong. Needs a proper aggregate RPC.
- **Paid manual invoices stay `status='issued'`** (`20261113192431_…sql:420-435`): health and tenant-detail open/overdue counts are permanently inflated while the UI shows "Paid".
- **Errors render as zero/empty data** (`PlatformConsole.tsx:490,569,625-629,651-658,726-759`; `PlatformBilling.tsx:237-245`): a failed overview shows "0 client workspaces" and "No client workspaces yet"; failed audit shows "No audit entries yet". Branch on error before rendering derived KPIs.
- **Dialogs bypass the shared `Modal`** (`PlatformConsole.tsx:310-322,776-778`; `PlatformBilling.tsx:307,323,338,343`): no focus trap, initial focus or focus restore. Closed off-canvas sidebar stays keyboard-focusable (`:375`).
- **No charts in the platform console** while the client uses Recharts. The "Live" badge on the connection gauge is static (`:729`) although data is loaded once on mount.
- **Owner gating is UI-only** (`PlatformConsole.tsx:213,408,412,475`; `PlatformBilling.tsx:57`): RPCs enforce owner, but the component does not. Pass the role down and guard the section.
- **Mixed currencies aggregated as KES** (`PlatformBilling.tsx:16,243-244,258`); schema permits KES and USD.
- **No `withTimeout` or response validation on billing reads/writes** (`PlatformBilling.tsx:83,85,109`): a stalled request leaves a permanent spinner; a malformed response crashes `data.customers.length`.
- **Duplicate heading** "Billing & accounts" (breadcrumb + page heading). AI-request-limit tier field is a placeholder despite AI removal.
- **E2E coverage gaps**: no billing CRUD, non-owner roles, error/empty, mobile or deep links; fixtures lack `platform_billing_data` so entering Billing in tests would crash.

### Backend / data-integrity issues that affect the build
- **D1 — parallel payment ledgers**: `platform_payments` is never written by the live money path (`platform_invoice_payments` is), yet remains member-readable. Any report using it understates revenue.
- **D2 — paid invoices never transition** in the manual payment RPC (see above).
- **D3 — platform-admin email oracle**: `check_platform_admin(uuid)` is SECURITY DEFINER, granted to all authenticated users, and returns admin emails; `is_platform_admin(uuid)` lacks `revoke from public, anon`.
- **D4 — retention migrations are broken and dangerous**: `cleanup_old_usage_events()` filters a nonexistent `event_time` (column is `occurred_at`); `cron.schedule(name, fn())` passes `void` instead of a SQL text command; financial records/payments would be deleted; duplicate version prefixes. **Do not push until rewritten.**
- **D5 — audit gaps**: dunning suspension/reminder writes and dunning-template edits produce no audit entries.
- **D6 — name-based billing exemption** (`%demo%`/`%test%`): a real tenant renamed to include "demo" becomes permanently unsuspendable.
- **D7/D8 — currency and VAT**: schema allows KES/USD but aggregates assume KES; `vat-calculation.ts` is unused and invoices have no VAT columns despite the documented "KES + VAT" decision.
- **D9 — 200-invoice cap** also blocks pagination; **D10 — timezone mismatch** for overdue between UI (Africa/Nairobi) and SQL (`current_date`).

---

## 4. NexLink → MobiWave redesign mapping

The theme is copied at the level of **surface, typography, spacing and information architecture**. Feature names from the template are never copied.

| NexLink page/widget | MobiWave equivalent | Data source | Status |
|---|---|---|---|
| Default Dashboard | Client Overview | `get_tenant_overview`, message series | Exists — restyle |
| Finance Dashboard (Revenue/Expenses/Net profit/Pending invoices) | **Client Billing** (amount due, paid, Meta pass-through, allowance) | `tenant_billing_summary`, `tenant_meta_allowance`, invoices | Exists — expand + restyle |
| Finance charts (Revenue vs Expenses, Expense breakdown, Monthly target) | Client Usage (daily sent/received, allowance by category, plan limit) | `tenant_usage_series`, `tenant_meta_allowance` | Exists — add charts |
| Recent Transactions table | Invoice/payment history table | `platform_invoice_payments`, `platform_invoices` | Needs data (0 today) |
| Team Management | Client Team | `team-members` function | Exists — restyle |
| Customers | Client Contacts | `contacts`, consent events | Exists — restyle |
| User Management | Platform Client workspaces | `tenants`, `platform_customer_accounts` | Exists — restyle |
| Activities / Audit | Platform Audit log | `platform_billing_audit`, auth audit | Exists — restyle |
| Service health / cron table | Platform Service health | `platform_system_health` RPC | Exists — restyle |
| Review / Deals / Employees / Blog / Calendar / Email / AI chat | **Not built** | No matching domain; AI explicitly out of scope | Rejected by guardrails |
| Marketing "50+ businesses" / testimonials | Verifiable claims only | Live counts / consented case study | Remove or replace |

**Rule for the build:** where the live table is empty (invoices, payments, campaigns, templates), the page ships with a designed empty state that says what will appear and how to unblock it. No demo numbers.

---

## 5. Production action plan (authorised)

1. **Do not push the retention migrations as written.** Rewrite one safe migration: `occurred_at`, correct `cron.schedule(name, cron, 'select public.fn()')` signature, service-role-only SECURITY DEFINER, no deletion of invoices/payments. Remove both duplicate-version pairs.
2. Resolve the remaining duplicate migration versions and verify the tier-catalog SQL.
3. `supabase db push --linked` for the corrected pending migrations.
4. Deploy/remove Edge Functions to match the source tree (deleted `team-management`, `unified-api`; removed AI functions).
5. Verify: migration table, RLS policies, function auth, tier catalog, dunning cron, live counts.
6. Add the owner finance aggregate RPC (`platform_finance_summary`, paged `platform_transactions`) before building the NexLink-style finance page, so KPIs are not computed from a capped 200-row array.
7. Build and deploy the frontend **only after** P0-1 is fixed.

### New pages that are groundable today vs. needs-new-RPC

| Page | Groundable now | Blocked on |
|---|---|---|
| Client Billing / Usage / Team / Contacts / Inbox / Campaigns / Templates / Alerts / Integrations | Yes — presentation + empty states | — |
| Client invoice detail & receipts | No | `tenant_invoice_detail`, `tenant_payment_receipts` |
| Client Meta cost estimate | No | platform Meta rate card + cost RPC |
| Platform Clients / Health / Audit / Billing CRUD | Yes, presentation + fixes | — |
| Platform Finance KPI row & recent transactions | Partly (payments exist but 0 live) | aggregate + paged transaction RPC |
| Revenue vs expenses / expense breakdown / monthly target | **No** | new expense/target tables — must not fabricate |
| Dunning command center, integration health matrix, cross-tenant alerts | Partly | new owner RPCs |

---

## 6. Work completed in this session

**Frontend / design**
- [x] P0-1: removed all self-referential CSS tokens; rebuilt CSS shows `--color-surface:#fff` and `--color-text:#0c243c`. `.app-shell` no longer shadows the token set. `:focus-visible` no longer warps control shapes.
- [x] Design gate passes (`npm run check:design`): collapsed the 480px breakpoint into 640px; token scopes 2→1; no duplicate app-shell token block.
- [x] P1-2: modal focus trap no longer re-runs on every parent render — the prompt input keeps focus while typing.
- [x] P1-8: notice auto-dismiss no longer infers tone from message text; benign confirmations clear normally.
- [x] P1-10/P1-11: Meta allowance notices now point to Meta Billing (separate from the MobiWave plan).
- [x] P0-3/P0-4: removed invented testimonials, fabricated proof metrics and out-of-scope AI/automation pricing rows; hero proof now uses verifiable facts only; landing price claim points to the Pricing page.
- [x] Client Billing: removed false "amount due" fallback, added NexLink-style "Billed vs paid" bar chart, billable-category donut, Meta allowance target ring and a recent-invoices table with Total/Paid/Balance/Due/Status.
- [x] Client Usage: added message-volume area chart and billable-category donut from existing RPC data.
- [x] Client Overview: onboarding checklist now collapses to a "ready" state using design tokens; the Messages KPI follows the 7/14-day chart range.
- [x] Platform Billing: added an Overview tab with billed-vs-paid chart, payment-method breakdown, recent-transactions table and honest empty states; hardened RPC response validation and cleared stale data on error.
- [x] Added `src/components/finance.tsx` — shared NexLink-style chart/donut/target/table widgets so client and owner surfaces use one vocabulary.
- [x] `.commandcode/` and `e2e-shots/` excluded from git to avoid committing cached credentials/artifacts.
- [x] **Modal UI/UX pass**: shared `Modal` now traps focus even when focus escapes to `<body>`, keeps `onClose` in a ref so dialogs don't re-initialise on every render, and restores focus on close. `useConfirm` resolves pending promises on unmount. Migrated all four raw PlatformBilling dialogs and the PlatformConsole tenant-detail dialog onto the shared primitive (focus trap, Escape, scroll lock, focus return, backdrop close). Standardised panel radius to `--radius-panel`.
- [x] Client payment modal: Kenyan M-Pesa number validation, pending-payment state with a "Check payment status" action instead of a dead-end success toast, and clear error/success ARIA roles.
- [x] **Client management modal UX overhaul**: 
  - Added form validation with required field indicators and error messages
  - Visual badges for outstanding and paid amounts in the modal header
  - Summary of changes before saving with clear before/after indicators
  - Confirmation dialog when closing with unsaved changes to prevent data loss
  - Improved field hints and descriptions for better user guidance
  - Status change confirmation for destructive actions (cancellation)
  - Better visual hierarchy and spacing with proper field grouping
  - Enhanced close functionality with overlay click support and proper Escape key handling
- [x] **Onboarding banner close button**: Added a close button to the "Getting started with MobiWave WA" banner in the Overview dashboard, allowing users to dismiss the onboarding checklist when they don't need it
- [x] **Alerts navigation and dropdown**: Removed the "Alerts" button from the left navigation and replaced it with a dropdown notification system in the top right. The bell icon now shows a combined count of alerts, includes a dropdown with recent alerts, "View all" and "Mark as read" options, and closes when clicking outside

**Production (authorised)**
- [x] Replaced the two broken retention migrations with one safe version (`20261124100000_add_safe_retention_jobs.sql`): correct `occurred_at`, valid `cron.schedule` signature, service-role-only, no deletion of financial records.
- [x] Replaced the duplicate tier-slug migrations with one normalising migration (`20261124101000`); live Basic slug is now `basic`.
- [x] Reworked the billing-exemption migration to preserve live values and add an owner-only audited setter instead of a name pattern.
- [x] Added `20261124102000_invoice_payment_status_consistency.sql`: trigger + backfill so paid invoices stop counting as open/overdue.
- [x] Fixed ordering bugs in the AI/team-member cleanup migrations (policies were dropped after their tables).
- [x] Applied all six pending migrations to the live project and verified: no AI/knowledge tables, correct tier slug, retention cron registered.
- [x] Deleted the four unsourced AI functions from production and redeployed all 25 sourced Edge Functions from the current tree.

**Verification**
- [x] `npm run typecheck` clean
- [x] `npm run build` clean
- [x] `npm run check:design` passes
- [x] `npm run test:e2e` — 62 passed, 4 skipped (desktop + mobile)
- [x] Fresh screenshots regenerated; Overview renders the light theme correctly

## 7. Remaining work (deferred — needs backend or product decision)

- Owner finance aggregates: `platform_finance_summary` + paged `platform_transactions` RPCs so KPIs are never computed from the 200-invoice-capped list.
- Expense/target data model before adding "Revenue vs expenses", "Expense breakdown" or "Monthly target" as literal finance pages — these do not exist in the product and must not be fabricated.
- VAT columns + use the existing unused `vat-calculation.ts`; group mixed KES/USD aggregates.
- Platform sub-routing (`/admin/billing`, `/admin/audit`) and migration of platform dialogs to the shared `Modal`.
- Name-based billing exemption replacement is now owner-only via RPC; expose it in the platform UI.
- Add `check:design` to CI, and e2e coverage for billing/CSV/campaign error states.
