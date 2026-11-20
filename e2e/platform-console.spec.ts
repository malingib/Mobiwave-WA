import { expect, test, type Page, type Route } from "@playwright/test";

const user = {
  id: "e2e-platform-user",
  aud: "authenticated",
  role: "authenticated",
  email: "owner@mobiwave.co.ke",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { full_name: "Platform Owner" },
  created_at: "2026-01-01T00:00:00.000Z",
};

const clientMembership = [{
  tenant_id: "client-2",
  role: "admin",
  tenants: { id: "client-2", name: "Bluewave Logistics", slug: "bluewave-logistics" },
}];

const platformTenants = [
  {
    tenant_id: "client-1",
    name: "Acme Retail",
    slug: "acme-retail",
    created_at: "2026-09-12T09:00:00.000Z",
    member_count: 4,
    contact_count: 128,
    open_conversation_count: 6,
    campaign_count: 3,
    approved_template_count: 5,
    message_count_30d: 412,
    last_message_at: "2026-11-02T08:00:00.000Z",
    whatsapp_connected: true,
    whatsapp_verified: true,
    display_phone_number: "+254700111222",
    is_member: false,
  },
  {
    tenant_id: "client-2",
    name: "Bluewave Logistics",
    slug: "bluewave-logistics",
    created_at: "2026-10-03T11:00:00.000Z",
    member_count: 2,
    contact_count: 44,
    open_conversation_count: 1,
    campaign_count: 1,
    approved_template_count: 2,
    message_count_30d: 96,
    last_message_at: "2026-11-01T15:30:00.000Z",
    whatsapp_connected: false,
    whatsapp_verified: true,
    display_phone_number: "+254711333444",
    is_member: true,
  },
];

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

async function mockPlatformBackend(
  page: Page,
  options: { platformRole?: string | null; memberships?: typeof clientMembership; tenants?: typeof platformTenants } = {},
) {
  const platformRole = options.platformRole === undefined ? "owner" : options.platformRole;
  const memberships = options.memberships ?? [];
  const tenants = options.tenants ?? platformTenants.map((tenant) => ({ ...tenant, is_member: memberships.some((membership) => membership.tenant_id === tenant.tenant_id) }));

  await page.route("**/auth/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") return json(route, {}, 200);
    if (url.pathname.endsWith("/token")) {
      const now = Math.floor(Date.now() / 1000);
      return json(route, {
        access_token: "e2e-platform-access-token",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: now + 3600,
        refresh_token: "e2e-platform-refresh-token",
        user,
      });
    }
    if (url.pathname.endsWith("/user")) return json(route, user);
    return json(route, {});
  });

  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() === "OPTIONS") return json(route, {}, 200);
    if (path.includes("/rpc/platform_tenant_overview")) return json(route, tenants);
    const table = path.split("/").pop() ?? "";
    if (table === "platform_admins") return json(route, platformRole ? [{ role: platformRole }] : []);
    if (table === "tenant_members") return json(route, memberships);
    if (table === "tenants") return json(route, memberships.map((membership) => membership.tenants));
    if (table === "meta_integrations") return json(route, {
      tenant_id: "client-2",
      phone_number_id: "e2e-phone-id",
      waba_id: "e2e-waba-id",
      display_phone_number: "+254711333444",
      verified: true,
      enabled: true,
      verified_name: "Bluewave Logistics",
    });
    return json(route, []);
  });

  await page.route("**/functions/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "OPTIONS") return json(route, {}, 200);
    if (path.endsWith("/team-members")) return json(route, { members: [] });
    if (path.endsWith("/notification-center")) return json(route, { notifications: [], unread_count: 0 });
    return json(route, {});
  });
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(user.email);
  await page.getByRole("textbox", { name: "Password" }).fill("e2e-password-123");
  await page.getByRole("button", { name: /sign in securely/i }).click();
}

async function signInToClientWorkspace(page: Page) {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Your messaging at a glance", exact: true })).toBeVisible();
  await expect(page.locator(".page-crumbs").getByText("Bluewave Logistics")).toBeVisible();
}

test("platform owner sees a separate client-workspace console instead of the client dashboard", async ({ page }) => {
  await mockPlatformBackend(page);
  await signIn(page);

  await expect(page.getByRole("heading", { name: "Client workspaces", exact: true })).toBeVisible();
  await expect(page.locator(".platform-sidebar")).toBeVisible();
  await expect(page.locator("#primary-navigation")).toHaveCount(0);
  await expect(page.getByText("Acme Retail", { exact: true })).toBeVisible();
  await expect(page.getByText("Bluewave Logistics", { exact: true })).toBeVisible();
  await expect(page.getByText("1 of 2 client workspaces have a verified, enabled WhatsApp connection.")).toBeVisible();

  await page.getByRole("button", { name: "Open workspace Acme Retail" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Acme Retail", exact: true })).toBeVisible();
  await expect(page.getByText("This platform account is not a member of this workspace.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Open client workspace/ })).toHaveCount(0);
});

test("platform owner with a client membership can switch into that client workspace", async ({ page }) => {
  await mockPlatformBackend(page, { memberships: clientMembership });
  await signInToClientWorkspace(page);

  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await expect(page.getByRole("link", { name: /Platform console/ })).toBeVisible();
  await page.getByRole("link", { name: /Platform console/ }).click();

  await expect(page.getByRole("heading", { name: "Client workspaces", exact: true })).toBeVisible();
  await expect(page.locator(".platform-sidebar")).toBeVisible();
  await expect(page.getByRole("link", { name: /Client workspace/ }).first()).toBeVisible();

  await page.getByRole("button", { name: "Open workspace Bluewave Logistics" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("You are a member of this workspace.")).toBeVisible();
  await page.getByRole("link", { name: /Open client workspace/ }).click();

  await expect(page).toHaveURL(/\/dashboard\?tenant=client-2/);
  await expect(page.getByRole("heading", { name: "Your messaging at a glance", exact: true })).toBeVisible();
  await expect(page.locator(".page-crumbs").getByText("Bluewave Logistics")).toBeVisible();
});

test("client users receive a 403 when they try to open the platform console", async ({ page }) => {
  await mockPlatformBackend(page, { platformRole: null, memberships: clientMembership });
  await signInToClientWorkspace(page);

  await page.goto("/admin");
  await expect(page.getByText("Platform access only", { exact: true })).toBeVisible();
  await expect(page.getByText(/403/)).toBeVisible();
  await expect(page.locator(".platform-sidebar")).toHaveCount(0);
});
