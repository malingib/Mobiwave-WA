import { test, type Page, type Route } from "@playwright/test";

const user = {
  id: "e2e-user-1", aud: "authenticated", role: "authenticated", email: "agent@example.com",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { full_name: "E2E Agent" }, created_at: "2026-01-01T00:00:00.000Z",
};

const tenantMembership = [{ tenant_id: "e2e-tenant-1", role: "admin", tenants: { id: "e2e-tenant-1", name: "Demo Business", slug: "demo-business" } }];

const conversations = [
  { id: "c1", status: "open", assigned_to: null, last_message_at: "2026-10-30T09:12:00.000Z", contacts: { display_name: "Amina Customer", phone_e164: "+254700000001" } },
  { id: "c2", status: "pending", assigned_to: null, last_message_at: "2026-10-30T08:40:00.000Z", contacts: { display_name: "Brian Otieno", phone_e164: "+254711000222" } },
  { id: "c3", status: "open", assigned_to: null, last_message_at: "2026-10-29T17:05:00.000Z", contacts: { display_name: "Charity Wanjiru", phone_e164: "+254722000333" } },
  { id: "c4", status: "resolved", assigned_to: null, last_message_at: "2026-10-29T11:22:00.000Z", contacts: { display_name: "David Kamau", phone_e164: "+254733000444" } },
  { id: "c5", status: "open", assigned_to: null, last_message_at: "2026-10-28T15:31:00.000Z", contacts: { display_name: "Esther Njeri", phone_e164: "+254744000555" } },
  { id: "c6", status: "resolved", assigned_to: null, last_message_at: "2026-10-28T10:02:00.000Z", contacts: { display_name: "Felix Mwangi", phone_e164: "+254755000666" } },
];

const contacts = [
  { id: "p1", phone_e164: "+254700000001", display_name: "Amina Customer", consent_status: "opted_in", consent_source: "Website form", consent_at: "2026-10-02T10:00:00.000Z", opted_out_at: null },
  { id: "p2", phone_e164: "+254711000222", display_name: "Brian Otieno", consent_status: "opted_in", consent_source: "In-store signup", consent_at: "2026-10-04T10:00:00.000Z", opted_out_at: null },
  { id: "p3", phone_e164: "+254722000333", display_name: "Charity Wanjiru", consent_status: "opted_in", consent_source: "WhatsApp keyword", consent_at: "2026-10-06T10:00:00.000Z", opted_out_at: null },
  { id: "p4", phone_e164: "+254733000444", display_name: "David Kamau", consent_status: "opted_out", consent_source: "Customer request", consent_at: null, opted_out_at: "2026-10-09T10:00:00.000Z" },
  { id: "p5", phone_e164: "+254744000555", display_name: "Esther Njeri", consent_status: "opted_in", consent_source: "Website form", consent_at: "2026-10-11T10:00:00.000Z", opted_out_at: null },
  { id: "p6", phone_e164: "+254755000666", display_name: "Felix Mwangi", consent_status: "unknown", consent_source: "", consent_at: null, opted_out_at: null },
];

const templates = [
  { id: "t1", meta_template_name: "order_update", language_code: "en", category: "UTILITY", meta_status: "approved", components: [] },
  { id: "t2", meta_template_name: "appointment_reminder", language_code: "en", category: "UTILITY", meta_status: "approved", components: [] },
  { id: "t3", meta_template_name: "weekend_offer", language_code: "en", category: "MARKETING", meta_status: "pending", components: [] },
];

const campaigns = [
  { id: "k1", name: "October service update", status: "running", created_at: "2026-10-24T10:00:00.000Z", template_id: "t1" },
  { id: "k2", name: "Appointment reminders", status: "draft", created_at: "2026-10-26T10:00:00.000Z", template_id: "t2" },
];

const metaIntegration = {
  tenant_id: "e2e-tenant-1", phone_number_id: "e2e-phone-id", waba_id: "e2e-waba-id",
  display_phone_number: "+254 700 000 000", verified: true, enabled: true, verified_name: "Demo Business",
  last_error_code: null, last_health_check_at: "2026-10-30T08:00:00.000Z",
};

function messageRows() {
  const rows: Array<{ direction: string; created_at: string }> = [];
  for (let day = 0; day < 14; day += 1) {
    const date = new Date();
    date.setDate(date.getDate() - (13 - day));
    const inbound = 6 + ((day * 7) % 11) + (day % 3);
    const outbound = 4 + ((day * 5) % 9) + (day % 2);
    for (let i = 0; i < inbound; i += 1) rows.push({ direction: "inbound", created_at: new Date(date.setHours(9, i, 0, 0)).toISOString() });
    for (let i = 0; i < outbound; i += 1) rows.push({ direction: "outbound", created_at: new Date(date.setHours(11, i, 0, 0)).toISOString() });
  }
  return rows;
}

async function json(route: Route, body: unknown, total = 1) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "apikey, authorization, content-type, x-client-info, prefer, accept, range, content-range",
      "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "content-range": `0-${Math.max(total - 1, 0)}/${total}`,
    },
    body: JSON.stringify(body),
  });
}

async function mockBackend(page: Page) {
  await page.route("**/auth/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") return json(route, {});
    if (url.pathname.endsWith("/token")) {
      const now = Math.floor(Date.now() / 1000);
      return json(route, { access_token: "e2e", token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: "e2e-r", user });
    }
    if (url.pathname.endsWith("/user")) return json(route, user);
    return json(route, {});
  });

  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const table = url.pathname.split("/").pop() ?? "";
    if (request.method() === "OPTIONS") return json(route, {});
    if (table === "tenant_members") return json(route, tenantMembership);
    if (table === "conversations") return json(route, conversations, conversations.length);
    if (table === "contacts") return json(route, contacts, contacts.length);
    if (table === "wa_templates") return json(route, templates, templates.length);
    if (table === "campaigns") return json(route, campaigns, campaigns.length);
    if (table === "meta_integrations") return json(route, metaIntegration);
    if (table === "messages") {
      return json(route, url.searchParams.has("conversation_id") ? [] : messageRows(), 0);
    }
    return json(route, []);
  });

  await page.route("**/functions/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "OPTIONS") return json(route, {});
    if (path.endsWith("/team-members")) return json(route, { members: [{ user_id: user.id, role: "admin", name: "E2E Agent", email: user.email }] });
    return json(route, { success: true });
  });
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(user.email);
  await page.getByRole("textbox", { name: "Password" }).fill("e2e-password-123");
  await page.getByRole("button", { name: /sign in securely/i }).click();
  await page.getByRole("heading", { name: /Welcome back/ }).waitFor();
  await page.waitForTimeout(1200);
}

test.beforeEach(async ({ page }) => { await mockBackend(page); });

test("shots landing desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForTimeout(800);
  await page.screenshot({ path: "/tmp/opencode/shots/landing-hero.png" });
  for (let y = 700; y < 6000; y += 600) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(180);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/opencode/shots/landing-full.png", fullPage: true });
});

test("shots landing mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.waitForTimeout(900);
  await page.screenshot({ path: "/tmp/opencode/shots/landing-mobile.png" });
});

test("shots dashboard", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await signIn(page);
  await page.screenshot({ path: "/tmp/opencode/shots/overview.png" });
  await page.locator("#primary-navigation").getByRole("button", { name: "Inbox", exact: true }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: "/tmp/opencode/shots/inbox.png" });
  await page.locator("#primary-navigation").getByRole("button", { name: "Contacts", exact: true }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/opencode/shots/contacts.png" });
});

test("shots mobile dashboard", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.screenshot({ path: "/tmp/opencode/shots/overview-mobile.png" });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/opencode/shots/nav-mobile.png" });
});

test("shots pricing", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/pricing");
  await page.waitForTimeout(800);
  await page.screenshot({ path: "/tmp/opencode/shots/pricing.png", fullPage: false });
});
