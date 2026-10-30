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
      "content-range": "0-0/1",
    },
    body: JSON.stringify(body),
  });
}

async function mockBackend(page: Page, role = "admin") {
  const createdNotes: Array<Record<string, unknown>> = [];
  const sentMessages: Array<Record<string, unknown>> = [];
  const createdContacts: Array<Record<string, unknown>> = [];

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
    if (path.endsWith("/team-members")) {
      return json(route, { members: [{ user_id: user.id, role, name: "E2E Agent", email: user.email }] });
    }
    if (path.endsWith("/meta-send")) {
      sentMessages.push((request.postDataJSON() ?? {}) as Record<string, unknown>);
      return json(route, { success: true, message_id: "e2e-message-1" });
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
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await expect(page.locator(".breadcrumbs").getByText("Demo Business")).toBeVisible();
}

test.beforeEach(async ({ page }, testInfo) => {
  await mockBackend(page, testInfo.title.includes("agent role") ? "agent" : "admin");
});

test("public landing page loads and labels preview metrics as sample data", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/illustrative preview.*sample data/i)).toBeVisible();
  await expect(page.getByText("ONE NUMBER, ONE BUSINESS ACCOUNT")).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
});

test("sign-in opens the authenticated inbox with the selected business account", async ({ page }) => {
  await signIn(page);
  await expect(page.getByText("Amina Customer")).toBeVisible();
  await expect(page.locator('#primary-navigation [aria-current="page"]')).toHaveAttribute("aria-label", "Inbox");
});

test("mobile navigation opens, closes on Escape, and closes after navigation", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Mobile drawer behaviour is covered in the mobile project.");
  await signIn(page);

  const menu = page.getByRole("button", { name: "Open navigation" });
  const sidebar = page.locator("#primary-navigation");
  await menu.click();
  await expect(sidebar).toHaveClass(/is-open/);
  await expect(page.getByRole("button", { name: "Contacts" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(sidebar).not.toHaveClass(/is-open/);

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Contacts" }).click();
  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
  await expect(sidebar).not.toHaveClass(/is-open/);
});

test("mobile inbox switches between conversation list and chat and submits an internal note", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Mobile conversation layout is covered in the mobile project.");
  const { createdNotes } = backendData.get(page)!;
  await signIn(page);

  await test.step("open the customer conversation", async () => {
    await page.locator(".conversation-item").filter({ hasText: "Amina Customer" }).click({ timeout: 7000 });
    await expect(page.locator(".chat-contact-heading")).toContainText("Amina Customer");
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
  await page.locator(".conversation-item").filter({ hasText: "Amina Customer" }).click({ timeout: 7000 });
  await page.locator('textarea[aria-label="Message reply"]').fill("Thanks, we will check this for you.");
  await page.locator(".chat-reply").getByRole("button", { name: /^Send/ }).click({ timeout: 7000 });
  await expect(page.getByText("Message submitted to Meta.")).toBeVisible({ timeout: 7000 });
  await expect.poll(() => sentMessages.length).toBe(1);
  expect(sentMessages[0]).toMatchObject({ tenant_id: "e2e-tenant-1", to: "+254700000001", type: "text", text: "Thanks, we will check this for you." });
});


test("workspace navigation exposes all six sections without losing the active business context", async ({ page }) => {
  await signIn(page);
  const sections = [
    ["Contacts", "Contacts"],
    ["Campaigns", "Campaigns"],
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
  await page.locator("#primary-navigation").getByRole("button", { name: "Contacts" }).click();

  await page.getByLabel("Phone number (E.164) *").fill("+254722334455");
  await page.getByLabel("I have verifiable permission to send WhatsApp messages to this contact.").check();
  const consentSource = page.getByLabel("Consent source / record *");
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

  await page.locator("#primary-navigation").getByRole("button", { name: "Contacts" }).click();
  await expect(page.getByRole("heading", { name: "Contacts", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add contact", exact: true })).toHaveCount(0);

  await page.locator("#primary-navigation").getByRole("button", { name: "Campaigns" }).click();
  await expect(page.getByRole("heading", { name: "Campaigns", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create campaign", exact: true })).toHaveCount(0);

  await page.locator("#primary-navigation").getByRole("button", { name: "Integrations" }).click();
  await expect(page.getByText("WhatsApp Business Platform", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Phone Number ID *")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Generate verification token/ })).toHaveCount(0);
});
