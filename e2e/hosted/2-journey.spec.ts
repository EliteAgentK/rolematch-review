// The demonstration journey on the running service: upload through the file picker one at a time and as a batch, progress and one summary, saved panels, matching on request with its evidence, and everything still there after a refresh and a new sign-in.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { address, BASE, CARD, createAdmin, cvZone, dismissNotices, fixture, jobZone, openTab, pick, RUN, signedIn } from "./kit";

const expected = JSON.parse(readFileSync(fixture("expected.json"), "utf8"));
const admin = address("journey");
const card = (page: Page, name: string) => page.locator(CARD("candidate")).filter({ hasText: name }).first();
test.beforeAll(() => createAdmin(`Journey ${RUN}`, admin, "Journey Admin"));
test.describe.configure({ mode: "serial" });

async function checkPanel(page: Page, id: string, allSkills = true) {
  const e = expected[id];
  await card(page, e.name).click();
  await expect(page.getByText("Candidate Resume")).toBeVisible({ timeout: 20_000 });
  await openTab(page, "candidate", "overview");   // contact details are on the Overview, skills on their own tab
  await expect(page.getByText(e.email).first()).toBeVisible();
  await expect(page.getByText(e.phone).first()).toBeVisible();
  await openTab(page, "candidate", "skills");
  const shown = (await page.locator('[data-testid="panel-skill"]').allInnerTexts()).map((x) => x.trim().toLowerCase());
  if (allSkills) for (const s of e.skills) expect(shown, `skill ${s} in the panel`).toContain(s.toLowerCase());
  await expect(page.getByRole("link", { name: "View Original CV" }).or(page.getByText("View Original CV")).first()).toBeVisible();
}

test("one CV and one job through the picker; staying out of the panel until read; saved details; the original opens", async ({ page }) => {
  await signedIn(page, admin);
  await cvZone(page).click(); await expect(page.getByText("How many are you adding?")).toBeVisible();
  await pick(page, () => page.getByRole("button", { name: "Single file" }).click(), fixture("CV0501.docx"));
  await expect(card(page, expected.CV0501.name)).toBeVisible({ timeout: 180_000 });
  await checkPanel(page, "CV0501");
  const href = await page.getByRole("link", { name: "View Original CV" }).first().getAttribute("href");
  expect(href).toBeTruthy();
  const original = await page.request.get(href!, { headers: { origin: BASE } });
  expect(original.status()).toBe(200);
  expect((await page.context().browser()!.newContext({ baseURL: BASE }).then((c) => c.request.get(href!, { headers: { origin: BASE } }))).status()).toBe(401);   // nobody signed in gets it
  await page.keyboard.press("Escape");
  await jobZone(page).click();
  await pick(page, () => page.getByRole("button", { name: "Single file" }).click(), fixture("JD0151.docx"));
  await expect(page.locator(CARD("job"))).toHaveCount(1, { timeout: 180_000 });
});

test("a batch: added a pick at a time, one removed, nothing sent until Upload, capacity shown, one summary at the end", async ({ page }) => {
  await signedIn(page, admin);
  let sent = 0; page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/documents")) sent++; });
  await cvZone(page).click(); await page.getByRole("button", { name: "Batch" }).click();
  await pick(page, () => page.getByRole("button", { name: "Add files" }).click(), [fixture("CV0530.pdf"), fixture("CV0554.pdf")]);
  await expect(page.getByText("2 files ready to upload")).toBeVisible();
  await pick(page, () => page.getByRole("button", { name: "Add files" }).click(), [fixture("CV0525.pdf"), fixture("CV0530.pdf")]);   // the same file twice is added once
  await expect(page.getByText("3 files ready to upload")).toBeVisible();
  await page.getByRole("button", { name: "Remove CV0525.pdf" }).click();
  await expect(page.getByText("2 files ready to upload")).toBeVisible();
  expect(sent).toBe(0);
  const t0 = Date.now();
  await page.getByRole("button", { name: "Upload 2 files" }).click();
  await expect(page.getByRole("region", { name: /Batch of CVs/ })).toBeVisible({ timeout: 60_000 });
  // The batch is shown once, as the whole upload's progress: its files have no rows of their own (owner, 10 Nov 2026).
  await expect(page.getByLabel("Files being read")).toHaveCount(0);
  await expect(page.getByRole("region", { name: /Batch of CVs/ }).getByRole("progressbar")).toHaveCount(1);
  const during = await (await page.request.get("/api/capacity", { headers: { origin: BASE } })).json();
  expect(during.reserved ?? during.used ?? 0).toBeGreaterThan(0);   // the slots are held while the batch is open
  const summary = page.getByRole("dialog").filter({ hasText: "Batch finished" });
  await expect(summary).toBeVisible({ timeout: 480_000 });
  console.log(`batch of 2 PDFs finished in ${Math.round((Date.now() - t0) / 1000)} s`);
  await expect(summary.getByText(/^2 files/)).toBeVisible();
  await expect(page.getByRole("dialog").filter({ hasText: "Batch finished" })).toHaveCount(1);   // one summary, not one per file
  await summary.getByRole("button", { name: "Done" }).click();
  for (const id of ["CV0530", "CV0554"]) await expect(card(page, expected[id].name)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^(Upload received|File checks|Making the file smaller|Reading document|Extracting structured data|Validating evidence|Being read by the AI|Waiting|Sending)$/)).toHaveCount(0);   // nothing is left looking busy once the batch is done
  await checkPanel(page, "CV0530", false);
});

// Register R96: a long line in the main column ran into the sidebar and took skills with it. With the model reading the whole CV and the rules' list held to the document, every skill reaches the panel (5 Nov, release 7a3d8a5).
test("every skill of a two-column PDF reaches the panel (R96)", async ({ page }) => {
  // How well the AI reads a tricky layout is the real AI's to show: against the rehearsal's stand-in (E2E_STANDIN_AI) this proves nothing either way.
  test.skip(process.env.E2E_STANDIN_AI === "1", "measures the real AI's reading of a two-column CV; the rehearsal's stand-in only shows the path works");
  await signedIn(page, admin);
  await checkPanel(page, "CV0530");
});

test("Match appears only with both slots filled, runs only when pressed, and never shows a score that is not the AI's final one", async ({ page }) => {
  await signedIn(page, admin);
  let posts = 0; page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/api/matches")) posts++; });
  const match = page.getByRole("button", { name: "Match", exact: true });
  await expect(match).toHaveCount(0);
  await card(page, expected.CV0501.name).click({ position: { x: 20, y: 20 } });
  await expect(match).toHaveCount(0);
  await page.locator(CARD("job")).first().click({ position: { x: 20, y: 20 } });
  await expect(match).toBeVisible();
  await page.waitForTimeout(1500); expect(posts).toBe(0);
  await match.click();
  await expect.poll(() => posts, { timeout: 10_000 }).toBe(1);   // the request goes out after the click, not in the same instant (it raced on 10 Nov 2026)
  await page.waitForTimeout(1500); expect(posts).toBe(1);        // and only one
  // Matching is the AI's alone (owner, 9 Nov 2026). The rehearsal scores with its stand-in Claude as live does with Claude (11 Nov 2026): the score on
  // screen is the AI's final one, never a rules score shown in the meantime and never "not scored" once the AI has answered.
  const assessment = page.getByRole("dialog").filter({ hasText: "Match Assessment" });
  await expect(assessment).toBeVisible({ timeout: 60_000 });
  await expect(assessment.getByTestId("match-not-scored")).toHaveCount(0, { timeout: 60_000 });
});

test("after a refresh and a new sign-in everything is still there, once each", async ({ page }) => {
  await signedIn(page, admin);
  await page.reload(); await dismissNotices(page);
  for (const id of ["CV0501", "CV0530", "CV0554"]) { await expect(card(page, expected[id].name)).toBeVisible({ timeout: 30_000 }); expect(await page.locator(CARD("candidate")).filter({ hasText: expected[id].name }).count()).toBe(1); }
  await page.context().clearCookies();
  await signedIn(page, admin);
  for (const id of ["CV0501", "CV0530", "CV0554"]) await expect(card(page, expected[id].name)).toBeVisible({ timeout: 30_000 });
});
