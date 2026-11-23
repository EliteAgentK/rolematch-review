// A candidate who has been published stays visible, wherever the person goes and whatever happens to the service: the disappearing-candidate defect (register R35, R117). Disposable stack only: it restarts the service.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { address, BASE, CARD, createAdmin, dismissNotices, fixture, published, RUN, signedIn } from "./kit";

const expected = JSON.parse(readFileSync(fixture("expected.json"), "utf8")), admin = address("seen"), H = { origin: BASE };
test.describe.configure({ mode: "serial" });
let ctx: BrowserContext, page: Page, otherPortal = "", mainPortal = "";
const card = (p: Page, name: string) => p.locator(CARD("candidate")).filter({ hasText: name }).first();
const up = async (name: string, portal?: string) => (await (await ctx.request.post("/api/documents", { headers: { ...H, ...(portal ? { "x-portal-id": portal } : {}) }, multipart: { kind: "cv", file: { name, mimeType: "application/octet-stream", buffer: readFileSync(fixture(name)) } } })).json()).id as string;
const NAME = expected.CV0501.name;

test.beforeAll(async ({ browser }) => {
  createAdmin(`Seen ${RUN}`, admin, "Seen Admin");
  ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1600, height: 1000 } }); page = await ctx.newPage();
  await signedIn(page, admin);
  mainPortal = (await (await ctx.request.get("/api/portals")).json())[0].id;
  await published(ctx.request, await up("CV0501.docx"));
  otherPortal = (await (await ctx.request.post("/api/portals", { headers: H, data: { name: `Second ${RUN}` } })).json()).id;
  // With two portals and none chosen the person is asked which: this person has chosen their first.
  await page.evaluate((id) => { sessionStorage.setItem("rolematch.portal", id); localStorage.setItem("rolematch.portal", id); }, mainPortal);
});
test.afterAll(async () => { await ctx?.close(); });

test("a published candidate is on the board, and still there after a refresh", async () => {
  await page.reload(); await dismissNotices(page);
  await expect(card(page, NAME)).toBeVisible({ timeout: 30_000 });
  await page.reload(); await dismissNotices(page);
  await expect(card(page, NAME)).toBeVisible({ timeout: 30_000 });
});
test("losing the connection does not lose the candidate: an empty list is never shown for a failed one", async () => {
  await ctx.setOffline(true);
  await page.reload().catch(() => {});
  await page.waitForTimeout(1500);
  await ctx.setOffline(false);
  await page.goto("/dashboard"); await dismissNotices(page);
  await expect(card(page, NAME)).toBeVisible({ timeout: 30_000 });
});
test("switching portal shows that portal's records, and switching back brings the candidate back", async () => {
  await page.locator("#portal-select").selectOption(otherPortal);
  await page.waitForLoadState("load"); await dismissNotices(page);
  await expect(card(page, NAME)).toHaveCount(0, { timeout: 15_000 });
  await page.locator("#portal-select").selectOption(mainPortal);
  await page.waitForLoadState("load"); await dismissNotices(page);
  await expect(card(page, NAME)).toBeVisible({ timeout: 30_000 });
});
test("switching portal in one tab does not move another: its reads and uploads stay in the portal it shows", async () => {
  const second = await ctx.newPage(); await second.goto("/dashboard"); await dismissNotices(second);
  await second.locator("#portal-select").selectOption(otherPortal);
  await second.waitForLoadState("load");
  // the first tab has not moved: what it asks for next still carries its own portal
  const asked = page.waitForRequest((r) => r.url().includes("/api/candidates"), { timeout: 30_000 });
  await page.reload();
  expect((await asked).headers()["x-portal-id"]).toBe(mainPortal);
  await dismissNotices(page);
  await expect(card(page, NAME)).toBeVisible({ timeout: 30_000 });
  await second.close();
});
test("a portal this person was removed from, remembered in the browser, is forgotten rather than leaving an empty board", async () => {
  await page.evaluate(() => { sessionStorage.setItem("rolematch.portal", crypto.randomUUID()); localStorage.setItem("rolematch.portal", crypto.randomUUID()); });
  await page.reload(); await dismissNotices(page);
  // with two portals the person is asked which; choosing shows the candidate
  await page.getByRole("button", { name: /Main portal/ }).click();
  await page.waitForLoadState("load"); await dismissNotices(page);
  await expect(page.locator("#portal-select")).toHaveValue(mainPortal);
  await expect(card(page, NAME)).toBeVisible({ timeout: 30_000 });
});
test("a restart of the whole service loses nothing", async () => {
  execSync(process.env.E2E_RESTART ?? "docker restart iso-api iso-worker", { stdio: "ignore" });
  await expect.poll(async () => (await ctx.request.get("/api/ready").catch(() => null))?.status() ?? 0, { timeout: 90_000 }).toBe(200);
  await page.reload(); await dismissNotices(page);
  await expect(card(page, NAME)).toBeVisible({ timeout: 30_000 });
});
test("a CV being read when the service restarts still arrives: it does not vanish between upload and board", async () => {
  const id = await up("CV0519.pdf");
  execSync(process.env.E2E_RESTART ?? "docker restart iso-api iso-worker", { stdio: "ignore" });
  await expect.poll(async () => (await ctx.request.get("/api/ready").catch(() => null))?.status() ?? 0, { timeout: 90_000 }).toBe(200);
  await published(ctx.request, id);
  await page.reload(); await dismissNotices(page);
  await expect(card(page, expected.CV0519.name)).toBeVisible({ timeout: 30_000 });
});
