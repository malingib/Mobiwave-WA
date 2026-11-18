import { test } from "@playwright/test";

test("tpl pages", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const [name, url] of [["customers", "https://nexlink.layoutdrop.com/demo/customers.html"], ["chat", "https://nexlink.layoutdrop.com/demo/chat.html"], ["settings", "https://nexlink.layoutdrop.com/demo/settings.html"]] as const) {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `/tmp/opencode/shots/tpl-${name}.png` });
  }
});
