// The same screens in every engine, size and colour mode (playwright.browsers.config.ts). Each screen must: load without errors in the browser console,
// never scroll sideways, keep its key parts visible and usable, and leave a screenshot per engine, size and mode for a person to look over
// (e2e/browsers-results/screens/<engine-size-mode>/<screen>.png). Behaviour is tested in depth elsewhere (board.spec.ts and the rest); this is about every
// browser showing it properly (owner, 9 Nov 2026: "it needs to be perfect in all browsers").
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const CARD = { candidate: '[aria-roledescription="selectable candidate card"]', job: '[aria-roledescription="selectable job card"]' };
const problems = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const seen: string[] = [];
  problems.set(page, seen);
  page.on("pageerror", (e) => seen.push(`page error: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) seen.push(`console: ${m.text().slice(0, 200)}`); });
});

/** What every screen must hold to in every browser, and its screenshot for a person to look over. */
async function wellShown(page: Page, info: TestInfo, screen: string) {
  await page.waitForLoadState("networkidle").catch(() => {});
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(sideways, `${screen} scrolls sideways by ${sideways}px`).toBeLessThanOrEqual(1);
  expect(problems.get(page) ?? [], `${screen}: errors in the browser`).toEqual([]);
  const dir = join("e2e", "browsers-results", "screens", info.project.name);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${screen}.png`), fullPage: true });
}

async function dismissCookies(page: Page) {
  const essential = page.getByRole("button", { name: "Essential Only" });
  if (await essential.isVisible().catch(() => false)) await essential.click();
}

async function openBoard(page: Page) {
  await page.goto("/dashboard");
  await expect(page.locator(CARD.candidate)).toHaveCount(5, { timeout: 30_000 });
  await dismissCookies(page);
  await expect(page.locator(CARD.job)).toHaveCount(5);
}

test("public pages: home, features, pricing and sign-in", async ({ page }, info) => {
  for (const [path, screen] of [["/", "home"], ["/features", "features"], ["/pricing", "pricing"], ["/login", "sign-in"]] as const) {
    await page.context().clearCookies();
    await page.goto(path);
    await dismissCookies(page);
    await expect(page.locator("h1, h2").first()).toBeVisible();
    if (screen === "home") {
      // "Superpower" is SVG text filled with the flowing gradient (on iPhone Safari CSS gradient text sat in a pale box): drawn, filled, in place.
      const word = page.getByTestId("superpower");
      await expect(word).toBeVisible();
      expect(await word.locator("text").getAttribute("fill")).toBe("url(#superpower-colours)");
      const box = (await word.boundingBox())!;
      expect(box.width).toBeGreaterThan(150);
    }
    await wellShown(page, info, screen);
  }
});

test("the board: cards of one height, nothing spilling out of a card", async ({ page }, info) => {
  await openBoard(page);
  for (const kind of ["candidate", "job"] as const) {
    const cards = page.locator(CARD[kind]);
    const heights = new Set<number>();
    for (let i = 0; i < 5; i++) heights.add(Math.round((await cards.nth(i).boundingBox())!.height));
    expect([...heights], `${kind} cards should all be one height`).toHaveLength(1);
    // Every line of text inside a card stays inside the card.
    const spill = await cards.evaluateAll((els) => els.flatMap((card) => {
      const c = card.getBoundingClientRect();
      return [...card.querySelectorAll("p, span, div")].filter((e) => e.childElementCount === 0 && (e.textContent ?? "").trim()).flatMap((e) => {
        const r = e.getBoundingClientRect();
        return r.width && (r.right > c.right + 1 || r.left < c.left - 1 || r.bottom > c.bottom + 1) ? [`"${(e.textContent ?? "").trim().slice(0, 30)}"`] : [];
      });
    }));
    expect(spill, `${kind} card text outside its card`).toEqual([]);
  }
  await wellShown(page, info, "board");
});

test("a candidate's panel opens, shows who they are today, and closes with its X", async ({ page }, info) => {
  await openBoard(page);
  await page.locator(CARD.candidate).filter({ hasText: "Thandi" }).first().click({ position: { x: 20, y: 20 } });
  await expect(page.getByText("Professional Summary")).toBeVisible();
  await expect(page.getByTestId("who-today")).toBeVisible();
  await wellShown(page, info, "candidate-panel");
  // The X is what a click lands on (on 9 Nov a header covered it, so the click went to the title), and it closes the panel.
  const close = page.getByRole("button", { name: "Close panel" }).first();
  await close.scrollIntoViewIfNeeded();
  const cover = await close.evaluate((el) => { const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !hit ? "nothing at all (off screen)" : el === hit || el.contains(hit) ? "" : `${hit.tagName.toLowerCase()} "${(hit.textContent ?? "").trim().slice(0, 40)}" (${hit.getAttribute("class")?.slice(0, 40) ?? ""})`; });
  expect(cover, "what covers the panel's X").toBe("");
  await close.click();
  await expect(page.getByText("Professional Summary")).toHaveCount(0);
});

test("a job's panel offers View shortlist beside Edit job", async ({ page }, info) => {
  await openBoard(page);
  await page.locator(CARD.job).first().click({ position: { x: 20, y: 20 } });
  await expect(page.getByRole("button", { name: /View shortlist/ })).toBeVisible();
  await wellShown(page, info, "job-panel");
});

test("selecting several candidates: the bar offers Read again and Delete", async ({ page }, info) => {
  await openBoard(page);
  await page.getByRole("button", { name: "Select", exact: true }).first().click();
  const bar = page.getByTestId("bulk-bar").first();
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: /^All/ }).click();
  await expect(bar.getByRole("button", { name: "Read again" })).toBeEnabled();
  await expect(bar.getByRole("button", { name: "Delete" })).toBeEnabled();
  await wellShown(page, info, "select-bar");
  await bar.getByRole("button", { name: "Cancel" }).click();
  await expect(bar).toHaveCount(0);
});

for (const at of ["/profile", "/settings"]) test(`${at.slice(1)} leads back to the board`, async ({ page }, info) => {
  await page.goto(at);
  await dismissCookies(page);
  const back = page.getByTestId("back-to-board");
  await expect(back).toBeVisible();
  await wellShown(page, info, `back-${at.slice(1)}`);
  await back.click();
  await expect(page).toHaveURL(/\/dashboard/);
});

// The profile page is the signed-in account as the server holds it (code review, 16 Nov 2026): never an invented demo person, and nothing an earlier
// version kept about someone in this browser survives a page load.
test("profile shows the signed-in account, and nothing personal from an earlier version stays in the browser", async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("rolematch_current_user", "u1"); localStorage.setItem("profile_u1", JSON.stringify({ firstName: "Someone", lastName: "Else", phone: "082 000 0000" })); } catch { /* blocked */ } });
  await page.goto("/profile");
  await dismissCookies(page);
  const me: any = await (await page.request.get("/api/auth/me")).json();
  await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible();
  await expect(page.getByText(me.user.email, { exact: true }).first()).toBeVisible();
  const org: any = await (await page.request.get("/api/settings")).json();
  await expect(page.getByText(org.orgName, { exact: true }).last()).toBeVisible();   // the organisation's real name on the page itself, not only in the header
  await expect(page.getByText(/TechVision|Someone Else|082 000 0000/)).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k === "rolematch_current_user" || k.startsWith("profile_")))).toEqual([]);
  await expect(page.getByRole("button", { name: "Send me a code to change it" })).toBeVisible();
});

test("Settings: every tab opens", async ({ page }, info) => {
  await page.goto("/settings");
  await dismissCookies(page);
  for (const tab of ["Security", "Organisation", "People", "Statuses", "Wording", "Team", "What can be edited", "History"]) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(page.getByRole("tabpanel").first()).toBeVisible();
  }
  await page.getByRole("tab", { name: "Statuses" }).click();
  await wellShown(page, info, "settings");
});
