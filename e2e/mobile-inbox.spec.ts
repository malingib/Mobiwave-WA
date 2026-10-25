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

const backendData = new WeakMap<Page, { createdNotes: Array<Record<string, unknown>>; sentMessages: Array<Record<string, unknown>> }>();

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

async function mockBackend(page: Page) {
  const createdNotes: Array<Record<string, unknown>> = [];
  const sentMessages: Array<Record<string, unknown>> = [];

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
    if (request.method() === "OPTIONS") return json(route, {}, 204);

    if (table === "tenant_members") return json(route, tenantMembership);
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
    if (table === "contacts") return json(route, []);
    return json(route, []);
  });

  await page.route("**/functions/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "OPTIONS") return json(route, {}, 204);
    if (path.endsWith("/team-members")) {
      return json(route, { members: [{ user_id: user.id, role: "admin", name: "E2E Agent", email: user.email }] });
    }
    if (path.endsWith("/meta-send")) {
      sentMessages.push((request.postDataJSON() ?? {}) as Record<string, unknown>);
      return json(route, { success: true, message_id: "e2e-message-1" });
    }
    if (path.endsWith("/conversation-control")) return json(route, { success: true });
    if (path.endsWith("/meta-media")) return json(route, { error: "No media in E2E fixture" }, 404);
    return json(route, { success: true });
  });

  const data = { createdNotes, sentMessages };
  backendData.set(page, data);
  return data;
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(user.email);
  await page.getByLabel("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: /sign in securely/i }).click();
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await expect(page.getByText("Demo Business").first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
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
  await expect(page.getByRole("button", { name: "Inbox" })).toHaveAttribute("aria-current", "page");
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

  await page.getByRole("button", { name: /Amina Customer/ }).click();
  await expect(page.locator(".chat-contact-heading").getByText("Amina Customer")).toBeVisible();

  await page.getByRole("button", { name: "Internal note" }).click();
  await page.getByRole("textbox", { name: "Internal note" }).fill("Follow up after confirming delivery.");
  await page.getByRole("button", { name: "Add note" }).click();

  await expect(page.getByText("Internal note added for your team.")).toBeVisible();
  await expect.poll(() => createdNotes.length).toBe(1);
  expect(createdNotes[0]).toMatchObject({
    tenant_id: "e2e-tenant-1",
    conversation_id: "e2e-conversation-1",
    body: "Follow up after confirming delivery.",
  });

  await page.getByRole("button", { name: /Conversations/ }).click();
  await expect(page.getByRole("button", { name: /Amina Customer/ })).toBeVisible();
  await expect(page.getByText("Choose a conversation")).toBeVisible();
});

test("reply action calls the mocked Meta-send integration", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Reply integration is covered in the mobile project.");
  const { sentMessages } = backendData.get(page)!;
  await signIn(page);
  await page.getByRole("button", { name: /Amina Customer/ }).click();
  await page.getByRole("textbox", { name: "Message reply" }).fill("Thanks, we will check this for you.");
  await page.getByRole("button", { name: /^Send/ }).click();
  await expect(page.getByText("Message submitted to Meta.")).toBeVisible();
  await expect.poll(() => sentMessages.length).toBe(1);
  expect(sentMessages[0]).toMatchObject({
    tenant_id: "e2e-tenant-1",
    to: "+254700000001",
    type: "text",
    text: "Thanks, we will check this for you.",
  });
});
