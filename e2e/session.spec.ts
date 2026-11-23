// When a sign-in reaches its length (Settings > access), the page stays where it is: a warning first, then a "Session ended" window to log in
// again, and whatever was typed is still there afterwards. The real ending is proven on the server (server/test/session-length.test.ts); here the
// website is told the session ends in ten minutes and the browser's clock is moved forward, so the browser side can be watched deterministically.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const seed = JSON.parse(readFileSync(join(__dirname, ".seed.json"), "utf8")) as { email: string; run: string };
const password = `pw-${seed.run}-Flow-1!x`;

test("a session that ends asks for the password on the same page, and nothing typed is lost", async ({ page }) => {
  // The browser's clock is controlled, so the test never races real seconds against page loading: the session ends ten minutes after the start.
  const start = Date.now(), endsAt = new Date(start + 10 * 60_000).toISOString();
  await page.clock.install({ time: start });
  await page.route("**/api/auth/me", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, session: { endsAt, warnMinutes: 5 } } });
  });
  await page.goto("/dashboard");
  await expect(page.locator('[aria-roledescription="selectable candidate card"]')).toHaveCount(5, { timeout: 20_000 });   // the board has loaded: typing earlier can be lost when the list first renders, which is not what this test is about
  const search = page.getByPlaceholder(/Search by name/);
  await search.fill("Thandi");   // unsaved work on the page

  await page.clock.fastForward("05:30");   // 4.5 minutes left: inside the 5-minute warning
  await expect(page.getByText(/Your session ends in \d+ minutes?/)).toBeVisible({ timeout: 10_000 });
  await page.clock.fastForward("05:00");   // past the end
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("Session ended")).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByLabel("Email")).toHaveValue(seed.email);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();   // cannot be dismissed without logging in

  await dialog.getByLabel("Password").fill(password);
  await dialog.getByRole("button", { name: "Log in" }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });   // a real sign-in at the sign-in service: a few seconds is normal
  await expect(search).toHaveValue("Thandi");   // still there
  // One device at a time (owner, 16 Nov 2026): this new sign-in ended the run's shared one, so every test after this one found an empty board. They
  // carry on with this sign-in instead.
  await page.context().storageState({ path: join(__dirname, ".auth.json") });
});
