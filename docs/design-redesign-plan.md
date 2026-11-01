# MobiWave WA redesign plan

Status: light visual redesign complete; ready for review and merge.
Scope owner: product + frontend.
Reference reviewed: NexLink CRM admin template (`https://nexlink.layoutdrop.com/demo/index.html`).

The reference is a **visual and layout** reference. It is a generic CRM template with AI chat, knowledge crawling and multiple app surfaces that are outside MobiWave WA's fixed scope. This plan adopts its light surface stack, indigo accent, typography and shell proportions, not its feature set.

## Progress log

- **Phase A — shell and navigation:** complete. App shell, grouped sidebar, Overview default, real tenant data, mobile drawer, auth shell.
- **Phase B — inbox and contacts polish:** complete for this pass. Realtime Overview series updates, status chips, relative timestamps, unread markers, empty chat/composer states, consent summary strip.
- **Phase C — campaign safety UX:** complete for this pass. Campaign detail dialog with stored recipient counts, full template preview, pre-launch safety checklist, failed-recipient review list with Meta error detail, and a safety strip in campaign history.
- **Phase D — integrations and account:** complete for this pass. Health summary cards with anchor navigation, section IDs, removed the out-of-scope knowledge webhook option, restored setup checklist styling, profile account banner, and settings readiness rows.
- **Phase E — landing refinement:** complete for this pass. Verifiable hero metrics, consent/safety evidence section with a labelled sample ledger, safety FAQ entries, responsive dashboard header fix, deterministic donut rendering, and a light `.marketing-theme` scope for public pages.
- **Integration merge:** complete. `main`'s Phase 1 reliability foundation (durable outbound attempts, idempotent sends, unknown-outcome retention, workspace alerts) and the consent-safe contact CSV importer are merged into the redesign on `integration/main-reliability-csv`. Conflicts were resolved in favour of the product shell, with the reliability logic and CSV importer preserved.
- **Phase F — light visual system:** complete. Replaced the Midnight dark shell with the reference's light surface stack, indigo accent and Instrument Sans. Sidebar is 250px, header 80px, cards are white with 10px radii. Public marketing pages, auth, inbox, contacts, campaigns, integrations, alerts, profile and settings now share one light token system. WhatsApp green is reserved for consent, delivery and connection success. There is no dark theme and no theme toggle.
- **Next:** review the integrated branch, then open the merge request against `main`.

## 1. Product guardrails (non-negotiable)

These come from `README.md`, `docs/architecture.md` and `docs/implementation-status.md` and override anything seen in the reference.

- WhatsApp connectivity is the **official Meta WhatsApp Cloud API only**. No WhatsApp Web engines, QR pairing, WPPConnect, WAHA or Evolution API.
- **AI, chatbot replies, website crawling and AI memory are excluded** from the active product. Do not add AI menus, AI chat panes, knowledge builders or crawler screens.
- Campaigns require **recorded opt-in** and **Meta-approved templates**. Opt-outs suppress delivery.
- Human replies stay inside the **24-hour customer-service window**.
- Every read/write is **tenant-scoped**. Authorization is enforced server-side; the browser never receives Meta credentials or service-role keys.
- Unknown provider send outcomes are **held for review**, never auto-retried.

Anything in the reference that conflicts with these rules is rejected in section 5.

## 2. Design principles

1. **Messaging first.** The workspace answers "what needs a reply, who owns it, and what is safe to send?" before anything else.
2. **Calm density.** Dense operational data, quiet surfaces, one accent colour. No decorative dashboards that imply data the product does not have.
3. **Status is colour-coded, not colour-dependent.** Every status pill keeps its text label and dot.
4. **Safety is visible.** Consent, template approval and connection state are shown at the point of action, not buried in settings.
5. **One shell, one navigation model.** Sidebar groups map 1:1 to product areas. No dead links, no placeholder modules.
6. **Mobile is a first-class inbox.** Drawer navigation, list-to-chat switching, 44px touch targets.
7. **Honest empty states.** Show what will appear and how to unblock it; never fabricate metrics.

## 3. Information architecture

Final sidebar structure (core scope only):

```
WORKSPACE
  Overview            /dashboard            analytics + readiness

MESSAGING
  Inbox               /dashboard/inbox      shared inbox, assignments, notes
  Contacts            /dashboard/contacts   consent + suppression source of truth
  Campaigns           /dashboard/campaigns  approved-template outbound

MONITORING
  Alerts              /dashboard/alerts     provider failures and operational issues

ADMINISTRATION
  Integrations        /dashboard/integrations  Meta connection, API keys, webhooks

ACCOUNT
  Profile             /dashboard/profile
  Settings            /dashboard/settings
```

Rules:

- `Overview` is the default authenticated view.
- Navigation groups are stable; new items need a matching implemented screen and documented scope approval.
- Inbox shows a live unread count badge.
- The workspace switcher stays at the top of the sidebar; tenant identity is always visible.
- On mobile the same list renders in a drawer; selecting an item closes the drawer.
- No AI, knowledge, blog, calendar, email, forms/tables or “extended UI” menu entries.

## 4. Screen plan

### 4.1 Public landing page

Keep the current messaging-first narrative and sample-data labelling. Improvements in priority order:

1. Hero: one sentence, official Cloud API proof, shared-inbox preview, primary CTA.
2. Proof strip: only claims that are operationally true.
3. Feature grid: inbox, consent-aware campaigns, contacts, API/webhooks, tenant separation.
4. Use cases: support, service updates, reminders, sales follow-up.
5. How it works: workspace → Meta connection → daily work.
6. FAQ: Meta requirements, consent, pricing clarity, no unofficial tools.
7. Final CTA + footer.

Do not add AI, automation, crawling or “unlimited messaging” claims.

### 4.2 Overview

The existing `src/dashboard/Overview.tsx` becomes the default view. It must contain:

- KPI row: messages (14 days), open conversations/unread, opted-in contacts, WhatsApp connection state.
- Message volume area chart with 7/14-day toggle.
- Conversations-by-status donut.
- Recent conversations with jump-to-inbox.
- Consent mix bar chart.
- Messaging readiness checklist (number connected, approved templates, opted-in audience).

Additions queued for later phases (not this change): campaign performance and agent response metrics once the data is exposed by the API.

### 4.3 Inbox

Keep the shipped behaviour: realtime updates, status/assignee/unread filters, search, per-agent read state, assignments, internal notes, guarded media, 24-hour reply guard.

Redesign work: list/chat visual hierarchy, clearer unread markers, sticky chat header, composer states, and mobile list↔chat transition.

### 4.4 Contacts

Keep CSV-safe, paginated server search, consent history and suppression. Redesign work: consent-first table, clearer source/evidence column, bulk-safe actions, and import only when the consent-safe importer ships.

The consent-safe CSV importer now ships on the integration branch. It maps phone, name and consent-evidence columns, validates E.164 numbers, skips duplicates, imports every row as consent-unknown, and never grants marketing consent. It is visible to owners and admins only.

### 4.5 Campaigns

Keep approved-template selection, variable preview, opt-in recipient picking, bounded batches and unknown-outcome review.

Redesign work: composer layout, recipient selection summary, per-campaign detail view, and explicit safety callouts before launch. Do not add A/B testing, drip sequences or send-time optimisation until the backend supports them.

### 4.6 Integrations

Keep Meta credential save/verify, webhook token generation, template sync, tenant API keys and customer webhooks with delivery history.

Redesign work: split into clear sections (Connection, Meta webhook, Developer API, Customer webhooks), surface health/error state first, and add sentinel warnings around secrets.

### 4.7 Profile and Settings

Keep Supabase Auth updates, role display and sign-out. Redesign work: account card, security notes, and workspace membership summary. No notification preferences until preferences exist server-side.

### 4.8 Alerts

Keep the provider-failure alert surface delivered by the reliability work. Alerts are tenant-scoped, show severity, Meta error code/title, reference ID and timestamp, and support per-alert and bulk acknowledgement. The sidebar shows an unread count. Alerts are read-only operational evidence; they never trigger an automatic retry.

## 5. Explicitly rejected from the reference

| NexLink element | Decision | Reason |
|---|---|---|
| AI ChatBot menu and chat app | Reject | AI/chatbot is out of product scope. |
| Knowledge base and website crawler | Reject | Crawling/AI memory excluded; only dormant historical tables exist. |
| Multiple CRM dashboards (sales, finance, employee, deals) | Reject | No matching backend domain; would be fake UI. |
| Blog, calendar, email client, authentication page pack | Reject for now | Not core WhatsApp messaging; adds dead surface area. |
| Forms/tables and extended UI catalogue | Reject | Template-demo content, not product navigation. |
| Unofficial WhatsApp connection options | Reject | Violates the official-Cloud-API-only rule. |
| Purple Bootstrap theme, generic admin chrome | Adapt | Adopt the light surface stack, indigo accent, Instrument Sans and 250px/80px shell proportions; reject the template demo content. |

## 6. Design system

Source of truth: `src/index.css` (`@theme` tokens) and `src/components/ui.tsx`.

- **Surfaces:** canvas `#FDFDFF`, surface `#FFFFFF`, raised `#F6F7FB`, hairline `#EEEEF3`, strong hairline `#E3E4EC`.
- **Brand:** indigo anchor `brand-600 #5955D1`; hover `brand-700 #4A46BD`; CTA text on brand is white.
- **WhatsApp green:** `success #009966` and `success-soft #E8F8F1` for consent, delivery and connection success only.
- **Text:** `text #0C243C`, `text-muted #696981`, `text-faint #9A9AB0`.
- **Accent series:** indigo `#5955D1`, light indigo `#A9A6F5`, green `#009966`, amber `#F5A70D`, red `#F83636`.
- **Type:** Instrument Sans, display headings with tight tracking; 12–14px operational text.
- **Shape:** 10px panels, 8px controls, 8px compact buttons.
- **Status:** success/warning/danger/neutral pills with dot + label.
- **Theme:** light only. There is no dark theme and no theme toggle.

Required shell components:

- `app-shell` flex frame.
- Sidebar: brand, workspace switcher, grouped nav, help card, user card; 250px wide on desktop.
- Sticky top bar: mobile menu, breadcrumbs, connection state, alerts shortcut, refresh, profile shortcut; 80px tall.
- `content` container with consistent padding and max width.
- Mobile backdrop + drawer with Escape/route close.

## 7. Phased delivery

### Phase A — shell and navigation (this change)

- Add Overview to the view model and make it the default.
- Group sidebar navigation into Workspace / Messaging / Administration / Account.
- Build the app shell, sticky top bar and mobile drawer.
- Feed Overview real tenant data (conversations, contacts, campaigns, templates, 14-day message series).
- Keep every existing screen and action working.

Acceptance: type-check and production build pass; sign-in lands on Overview; every sidebar item opens an implemented screen; mobile drawer opens, closes on Escape, and closes after navigation.

### Phase B — inbox and contacts polish

- Conversation list/chat spacing, sticky headers, clearer composer modes.
- Consent-first contact table and source/evidence display.
- Empty/error state pass across all screens.

### Phase C — campaign safety UX

- Campaign detail view, recipient summary, pre-launch safety checklist.
- Unknown-outcome review queue presentation.

### Phase D — integrations and account

- Sectioned Integrations layout and health-first status.
- Profile/settings consolidation and security copy review.

### Phase E — landing page refinement

- Hero/proof tightening, testimonial or evidence section only if verifiable.
- Performance and accessibility pass.

### Phase F — integration merge

- Merge `main`'s Phase 1 reliability foundation and the consent-safe contact CSV importer.
- Keep the campaign safety dialog, Overview and public marketing scope intact.
- Preserve Alerts as a first-class monitoring view with unread counts and acknowledgement.
- Re-run typecheck, production build and the Playwright suite after conflict resolution.

### Phase G — light visual system

- Replace the Midnight tokens with the reference light stack and indigo brand.
- Switch typography to Instrument Sans and update shell proportions (250px sidebar, 80px header).
- Restyle shared panels, KPI cards, widgets, tables, modals, auth and public pages.
- Keep WhatsApp green only for consent, delivery and connection states.
- Remove dark-theme assumptions; the product is light-only with no theme toggle.
- Re-run typecheck, production build, Playwright and the screenshot suite.

## 8. Non-goals

- No AI features, no chatbot, no crawler, no knowledge management UI.
- No unofficial WhatsApp transport.
- No fabricated analytics, fake customers, or demo modules in the production navigation.
- No new billing, calendar, email or blog surface without a shipped backend and explicit scope approval.
