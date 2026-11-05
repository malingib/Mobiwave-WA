import { expect, test, type Page, type Route } from "@playwright/test";

const user = {
  id: "e2e-user-1",
  aud: "authenticated",
  role: "authenticated",
  email: "agent@example.com",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { full_name: "E2E Agent" },
  created_at: "2026-01-01T00:00:00.000Z",
};

const tenantMembership = [{
  tenant_id: "e2e-tenant-1",
  role: "admin",
  tenants: { id: "e2e-tenant-1", name: "Demo Business", slug: "demo-business" },
}];

const backendData = new WeakMap<Page, { createdNotes: Array<Record<string, unknown>>; sentMessages: Array<Record<string, unknown>>; createdContacts: Array<Record<string, unknown>> }>();

const conversation = {
  id: "e2e-conversation-1",
  status: "open",
  assigned_to: null,
  last_message_at: "2026-10-25T10:00:00.000Z",
  contacts: { display_name: "Amina Customer", phone_e164: "+254700000001" },
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "apikey, authorization, content-type, x-client-info, prefer, accept, range, content-range",
      "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "access-control-expose-headers": "content-range",
      "content-range": "0-0/1",
    },
    body: JSON.stringify(body),
  });
}

async function mockBackend(page: Page, role = "admin") {
  const createdNotes: Array<Record<string, unknown>> = [];
  const sentMessages: Array<Record<string, unknown>> = [];
  const createdContacts: Array<Record<string, unknown>> = [];
  let alertRead = false;

  await page.route("**/auth/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") return json(route, {}, 200);
    if (url.pathname.endsWith("/token")) {
      const now = Math.floor(Date.now() / 1000);
      return json(route, {
        access_token: "e2e-access-token",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: now + 3600,
        refresh_token: "e2e-refresh-token",
        user,
      });
    }
    if (url.pathname.endsWith("/user")) return json(route, user);
    return json(route, {});
  });

  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const table = url.pathname.split("/").pop() ?? "";
    if (request.method() === "OPTIONS") return json(route, {}, 200);

    if (table === "tenant_members") return json(route, tenantMembership.map((membership) => ({ ...membership, role })));
    if (table === "conversations") return json(route, [conversation]);
    if (table === "meta_integrations") return json(route, {
      tenant_id: "e2e-tenant-1",
      phone_number_id: "e2e-phone-id",
      waba_id: "e2e-waba-id",
      display_phone_number: "+254700000000",
      verified: true,
      enabled: true,
      verified_name: "Demo Business",
    });
    if (table === "conversation_notes" && request.method() === "POST") {
      createdNotes.push(request.postDataJSON() as Record<string, unknown>);
      return json(route, [], 201);
    }
    if (table === "messages") return json(route, []);
    if (table === "contacts" && request.method() === "POST") {
      createdContacts.push(request.postDataJSON() as Record<string, unknown>);
      return json(route, [], 201);
    }
    if (table === "contacts") return json(route, []);
    return json(route, []);
  });

  await page.route("**/functions/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "OPTIONS") return json(route, {}, 200);
    if (path.endsWith("/notification-center")) {
      const payload = request.postDataJSON() as Record<string, unknown>;
      if (payload.action === "mark_read" || payload.action === "mark_all_read") alertRead = true;
      return json(route, { notifications: [{ id: "alert-1", category: "send_error", severity: "error", title: "WhatsApp delivery failed", body: "Meta could not deliver this message.", metadata: { error_code: "131026" }, created_at: "2026-10-31T10:00:00.000Z", read_at: alertRead ? "2026-10-31T10:01:00.000Z" : null }], unread_count: alertRead ? 0 : 1 });
    }
    if (path.endsWith("/team-members")) {
      return json(route, { members: [{ user_id: user.id, role, name: "E2E Agent", email: user.email }] });
    }
    if (path.endsWith("/meta-send")) {
      sentMessages.push((request.postDataJSON() ?? {}) as Record<string, unknown>);
      return json(route, { ok: true, message_id: "e2e-message-1", status: "accepted" });
    }
    if (path.endsWith("/conversation-control")) return json(route, { success: true });
    if (path.endsWith("/meta-media")) return json(route, { error: "No media in E2E fixture" }, 404);
    return json(route, { success: true });
  });

  const data = { createdNotes, sentMessages, createdContacts };
  backendData.set(page, data);
  return data;
}

async function navigateTo(page: Page, label: string) {
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page.locator(`#primary-navigation .nav-item[aria-label="${label}"]`).click();
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(user.email);
  await page.getByRole("textbox", { name: "Password" }).fill("e2e-password-123");
  await page.getByRole("button", { name: /sign in securely/i }).click();
  await expect(page.getByRole("heading", { name: "Your messaging at a glance", exact: true })).toBeVisible();
  await expect(page.locator('#primary-navigation [aria-current="page"]')).toHaveAttribute("aria-label", "Overview");
  await expect(page.locator(".breadcrumbs").getByText("Demo Business")).toBeVisible();
}

/* Opens a dashboard view from either the desktop sidebar or the mobile drawer. */
async function openView(page: Page, view: string) {
  const drawerButton = page.getByRole("button", { name: "Open navigation" });
  if (await drawerButton.isVisible()) await drawerButton.click();
  await page.locator("#primary-navigation").getByRole("button", { name: view, exact: true }).click();
  await expect(page.getByRole("heading", { name: view, exact: true })).toBeVisible();
}

test.beforeEach(async ({ page }, testInfo) => {
  await mockBackend(page, testInfo.title.includes("agent role") ? "agent" : "admin");
});

test("public landing page loads and labels preview metrics as sample data", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/Product preview · illustrative sample data/i)).toBeVisible();
  await expect(page.getByText(/WhatsApp business messaging for Kenya/i).first()).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
});

test("sign-in opens the workspace overview and clears its success notice", async ({ page }) => {
  await signIn(page);
  await expect(page.locator(".toast").filter({ hasText: "Signed in." })).toBeHidden({ timeout: 6000 });
  await expect(page.getByText("Amina Customer")).toBeVisible();
  await expect(page.locator('#primary-navigation [aria-current="page"]')).toHaveAttribute("aria-label", "Overview");
  await openView(page, "Inbox");
  await expect(page.locator(".conversation-item").filter({ hasText: "Amina Customer" })).toBeVisible();
});

test("mobile navigation opens, closes on Escape, and closes after navigation", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Mobile drawer behaviour is covered in the mobile project.");
  await signIn(page);

  const menu = page.getByRole("button", { name: "Open navigation" });
  const sidebar = page.locator("#primary-navigation");
  await menu.click();
  await expect(sidebar).not.toHaveClass(/-translate-x-full/);
  await expect(page.getByRole("button", { name: "Contacts" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(sidebar).toHaveClass(/-translate-x-full/);

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Contacts" }).click();
  await expect(page.getByRole("heading", { name: "Contacts", exact: true })).toBeVisible();
  await expect(sidebar).toHaveClass(/-translate-x-full/);
});

test("mobile inbox switches between conversation list and chat and submits an internal note", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Mobile conversation layout is covered in the mobile project.");
  const { createdNotes } = backendData.get(page)!;
  await signIn(page);
  await openView(page, "Inbox");

  await test.step("open the customer conversation", async () => {
    await page.locator(".conversation-item").filter({ hasText: "Amina Customer" }).click({ timeout: 7000 });
    await expect(page.locator(".chat-contact-heading")).toContainText("Amina Customer");
    await expect(page.getByRole("log", { name: "Conversation messages" })).toBeVisible();
  });

  await test.step("add an internal note", async () => {
    await page.locator(".composer-tabs").getByRole("button", { name: "Internal note" }).click({ timeout: 7000 });
    await page.locator('textarea[aria-label="Internal note"]').fill("Follow up after confirming delivery.");
    await page.locator(".chat-reply").getByRole("button", { name: /Add note/ }).click({ timeout: 7000 });
    await expect(page.getByText("Internal note added for your team.")).toBeVisible({ timeout: 7000 });
    await expect.poll(() => createdNotes.length).toBe(1);
    expect(createdNotes[0]).toMatchObject({ tenant_id: "e2e-tenant-1", conversation_id: "e2e-conversation-1", body: "Follow up after confirming delivery." });
  });

  await test.step("return to the conversation list", async () => {
    await page.locator(".inbox-back-button").click({ timeout: 7000 });
    await expect(page.locator(".conversation-list .conversation-item").filter({ hasText: "Amina Customer" })).toBeVisible();
    await expect(page.getByText("Choose a conversation")).not.toBeVisible();
  });
});

test("reply action calls the mocked Meta-send integration", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Reply integration is covered in the mobile project.");
  const { sentMessages } = backendData.get(page)!;
  await signIn(page);
  await openView(page, "Inbox");
  await page.locator(".conversation-item").filter({ hasText: "Amina Customer" }).click({ timeout: 7000 });
  await page.locator('textarea[aria-label="Message reply"]').fill("Thanks, we will check this for you.");
  await page.locator(".chat-reply").getByRole("button", { name: /^Send/ }).click({ timeout: 7000 });
  await expect(page.getByText("Message accepted by Meta. Delivery confirmation will arrive separately.")).toBeVisible({ timeout: 7000 });
  await expect.poll(() => sentMessages.length).toBe(1);
  expect(sentMessages[0]).toMatchObject({ tenant_id: "e2e-tenant-1", to: "+254700000001", type: "text", text: "Thanks, we will check this for you." });
  expect(sentMessages[0].idempotency_key).toMatch(/^[0-9a-f-]{36}$/i);
});


test("uncertain inbox send reuses its idempotency key after a page reload", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Send retry integration is covered in the mobile project.");
  const { sentMessages } = backendData.get(page)!;
  let calls = 0;
  await page.route("**/functions/v1/meta-send", async (route) => {
    if (route.request().method() === "OPTIONS") return json(route, {}, 200);
    sentMessages.push(route.request().postDataJSON() as Record<string, unknown>);
    calls++;
    if (calls === 1) return json(route, { error: "Provider outcome could not be confirmed.", status: "outcome_unknown" }, 502);
    return json(route, { ok: true, message_id: "e2e-message-reconciled", status: "accepted" });
  });
  await signIn(page);
  await openView(page, "Inbox");
  await page.locator(".conversation-item").filter({ hasText: "Amina Customer" }).click({ timeout: 7000 });
  const composer = page.locator('textarea[aria-label="Message reply"]');
  await composer.fill("Please confirm your delivery address.");
  await page.locator(".chat-reply").getByRole("button", { name: /^Send/ }).click({ timeout: 7000 });
  await expect.poll(() => calls).toBe(1);
  await expect(page.getByRole("alert")).toContainText(/could not|non-2xx|failed/i);
  await expect(page.getByText("Message accepted by Meta. Delivery confirmation will arrive separately.")).toHaveCount(0);
  const firstKey = sentMessages[0].idempotency_key;
  expect(firstKey).toMatch(/^[0-9a-f-]{36}$/i);
  await expect(composer).toHaveValue("Please confirm your delivery address.");
  await page.reload();
  await openView(page, "Inbox");
  await page.locator(".conversation-item").filter({ hasText: "Amina Customer" }).click({ timeout: 7000 });
  await page.locator('textarea[aria-label="Message reply"]').fill("Please confirm your delivery address.");
  await page.locator(".chat-reply").getByRole("button", { name: /^Send/ }).click({ timeout: 7000 });
  await expect.poll(() => calls).toBe(2);
  expect(sentMessages[1].idempotency_key).toBe(firstKey);
  await expect(page.getByText("Message accepted by Meta. Delivery confirmation will arrive separately.")).toBeVisible({ timeout: 7000 });
});

test("webhook verification token is displayed after the backend confirms it is saved", async ({ page }) => {
  await mockBackend(page);
  await page.route("**/functions/v1/meta-webhook-config", async (route) => {
    if (route.request().method() === "OPTIONS") return json(route, {}, 200);
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    expect(payload.tenant_id).toBe("e2e-tenant-1");
    expect(payload.verification_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    return json(route, { ok: true, message: "Webhook verification token stored as a hash." });
  });
  await signIn(page);
  await openView(page, "Integrations");
  await page.getByRole("button", { name: "Generate verification token" }).click();
  await expect(page.getByText(/^[A-Za-z0-9_-]{43}$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy token" })).toBeVisible();
});

test("workspace navigation exposes all eight sections without losing the active business context", async ({ page }) => {
  await signIn(page);
  const sections = [
    ["Overview", "Your messaging at a glance"],
    ["Contacts", "Contacts"],
    ["Campaigns", "Campaigns"],
    ["Alerts", "Alerts"],
    ["Integrations", "Integrations"],
    ["Profile", "Your profile"],
    ["Settings", "Settings"],
    ["Inbox", "Inbox"],
  ] as const;

  for (const [navigationLabel, heading] of sections) {
    await navigateTo(page, navigationLabel);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expect(page.locator(".breadcrumbs").getByText("Demo Business")).toBeVisible();
  }
});

test("adding a contact without claiming consent stores an unknown consent state", async ({ page }) => {
  const { createdContacts } = backendData.get(page)!;
  await signIn(page);
  await navigateTo(page, "Contacts");

  await page.locator('.field').filter({ hasText: "Phone number (E.164)" }).locator("input").fill("+254711223344");
  await page.locator('input[placeholder="Customer name"]').fill("Unconfirmed Customer");
  await page.getByRole("button", { name: /Add contact/ }).click();

  await expect(page.getByText("Contact added.")).toBeVisible();
  await expect.poll(() => createdContacts.length).toBe(1);
  expect(createdContacts[0]).toMatchObject({
    tenant_id: "e2e-tenant-1",
    phone_e164: "+254711223344",
    display_name: "Unconfirmed Customer",
    consent_status: "unknown",
    consent_source: null,
    consent_at: null,
  });
});

test("claiming opt-in consent requires a consent source before a contact can be submitted", async ({ page }) => {
  const { createdContacts } = backendData.get(page)!;
  await signIn(page);
  await navigateTo(page, "Contacts");

  await page.locator('.field').filter({ hasText: "Phone number (E.164)" }).locator("input").fill("+254722334455");
  await page.getByLabel("I have verifiable permission to send WhatsApp messages to this contact.").check();
  const consentSource = page.locator(".field").filter({ hasText: "Consent source / record *" }).locator("input");
  await expect(consentSource).toBeVisible();
  await expect(consentSource).toHaveAttribute("required", "");
  await expect.poll(() => createdContacts.length).toBe(0);

  await consentSource.fill("Website signup form · 2026-10-30");
  await page.getByRole("button", { name: /Add contact/ }).click();
  await expect(page.getByText("Contact added.")).toBeVisible();
  await expect.poll(() => createdContacts.length).toBe(1);
  expect(createdContacts[0]).toMatchObject({
    tenant_id: "e2e-tenant-1",
    phone_e164: "+254722334455",
    consent_status: "opted_in",
    consent_source: "Website signup form · 2026-10-30",
  });
});

test("integration administration exposes official Meta Cloud API setup and webhook guidance", async ({ page }) => {
  await signIn(page);
  await navigateTo(page, "Integrations");

  await expect(page.getByText("WhatsApp Business Platform", { exact: true })).toBeVisible();
  await expect(page.getByText("Official Meta Cloud API")).toBeVisible();
  await expect(page.locator('input[placeholder="Numeric ID from Meta"]')).toBeVisible();
  await expect(page.locator('input[placeholder="Numeric WABA ID"]')).toBeVisible();
  await expect(page.locator('input[placeholder="Paste Meta access token"]')).toHaveAttribute("type", "password");
  await expect(page.getByText("Advanced: customer event webhooks")).toBeVisible();
});


test("agent role can work in the inbox but cannot access administrative contact, campaign, or integration controls", async ({ page }) => {
  await signIn(page);

  await navigateTo(page, "Contacts");
  await expect(page.getByRole("heading", { name: "Contacts", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add contact", exact: true })).toHaveCount(0);

  await navigateTo(page, "Campaigns");
  await expect(page.getByRole("heading", { name: "Campaigns", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create campaign", exact: true })).toHaveCount(0);

  await navigateTo(page, "Integrations");
  await expect(page.getByText("WhatsApp Business Platform", { exact: true })).toBeVisible();
  await expect(page.locator('input[placeholder="Numeric ID from Meta"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Generate verification token/ })).toHaveCount(0);
});

test("workspace alerts show provider failure details and support acknowledgement", async ({ page }) => {
  await signIn(page);
  await navigateTo(page, "Alerts");
  await expect(page.getByRole("heading", { name: "Alerts", exact: true })).toBeVisible();
  await expect(page.getByText("1 unread alerts")).toBeVisible();
  await expect(page.getByRole("list", { name: "Workspace alerts" })).toBeVisible();
  await expect(page.getByText("WhatsApp delivery failed")).toBeVisible();
  await expect(page.getByText("Error code: 131026")).toBeVisible();
  await page.getByRole("button", { name: "Mark read" }).click();
  await expect(page.getByText("0 unread alerts")).toBeVisible();
});
