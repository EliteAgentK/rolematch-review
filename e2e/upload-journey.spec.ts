import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// What API uploads cannot show: a person clicking the upload zone, the browser's file picker opening, staging a batch a pick at a time, and what they then see. Every file goes through a real file chooser event. Invented people (server/test/fixtures/journey).
const DIR = join(__dirname, "../server/test/fixtures/journey"), file = (n: string) => join(DIR, n);
const expected = JSON.parse(readFileSync(file("expected.json"), "utf8"));
const CARD = '[aria-roledescription="selectable candidate card"]', ZONE = /^Upload CVs$/;
const control = (what: string) => fetch(`${process.env.JOURNEY_CONTROL}/${what}`);

async function signIn(page: Page) {
  await page.goto("/login");
  const notice = page.getByRole("button", { name: "Essential Only" }); if (await notice.isVisible({ timeout: 3000 }).catch(() => false)) await notice.click();
  await page.getByPlaceholder("you@example.com").fill(process.env.JOURNEY_EMAIL!); await page.locator('button[type="submit"]').first().click();
  await page.getByPlaceholder("Your password").fill(process.env.JOURNEY_PASSWORD!); await page.locator('button[type="submit"]').last().click();
  await page.waitForURL(/overview/, { timeout: 30_000 }); await page.goto("/dashboard");   // signing in opens the Overview; this journey is on the board
}
const zone = (page: Page) => page.getByText(ZONE).first();
const pick = async (page: Page, click: () => Promise<void>, files: string | string[]) => { const [chooser] = await Promise.all([page.waitForEvent("filechooser"), click()]); await chooser.setFiles(files); return chooser; };
const cardFor = (page: Page, name: string) => page.locator(CARD).filter({ hasText: name }).first();
const skipTour = async (page: Page) => { for (const name of ["Skip", "Skip tour", "Close"]) { const b = page.getByRole("button", { name, exact: true }).first(); if (await b.isVisible({ timeout: 800 }).catch(() => false)) await b.click().catch(() => {}); } };

/** A finished batch is reported once, in a dialog a person acknowledges: it must say what happened, reconciled to the files chosen. */
async function acknowledgeBatch(page: Page, files: number) {
  const dialog = page.getByRole("dialog").filter({ hasText: "Batch finished" }); await expect(dialog).toBeVisible({ timeout: 300_000 });
  await expect(dialog.getByText(new RegExp(`^${files} files`))).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click(); await expect(dialog).toHaveCount(0);
}
/** The panel a recruiter reads, checked against the invented person's reference. */
async function checkPanel(page: Page, id: string, opts: { email?: boolean; phone?: boolean; allSkills?: boolean } = {}) {
  const e = expected[id]; await cardFor(page, e.name).click();
  await expect(page.getByText("Candidate Resume")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: e.name }).or(page.getByText(e.name).nth(1)).first()).toBeVisible();
  await page.getByTestId("tab-overview").click();   // contact details are on the Overview; the panel remembers the last tab
  if (opts.email !== false) { const mail = page.getByText(e.email).first(); await expect(mail).toBeVisible(); expect(await mail.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), "the e-mail address is shown whole").toBe(true); }
  if (opts.phone !== false) await expect(page.getByText(e.phone).first()).toBeVisible();
  await page.getByTestId("tab-skills").click();   // the panel has tabs (10 Nov 2026)
  const shown = await page.locator('[data-testid="panel-skill"]').allInnerTexts();
  if (opts.allSkills) expect(shown.map((x) => x.trim().toLowerCase()).sort()).toEqual(expect.arrayContaining(e.skills.map((x: string) => x.toLowerCase()).sort()));
  await expect(page.getByRole("link", { name: "View Original CV" }).or(page.getByText("View Original CV")).first()).toBeVisible();
}

test("single upload, batch staging, saved records, panels, refresh, sign out, recovery", async ({ page }) => {
  await signIn(page); await skipTour(page);
  // ---------- single: click the zone, it asks how many, Single file opens the picker
  await zone(page).click(); await expect(page.getByText("How many are you adding?")).toBeVisible();
  const single = await pick(page, () => page.getByRole("button", { name: "Single file" }).click(), file("CV0501.docx"));
  expect(single.isMultiple()).toBe(false);
  await expect(page.getByText(/CV processing/i).first()).toBeVisible({ timeout: 15_000 }).catch(() => {});   // a Word file is read in well under a second, so the card may already have gone
  await expect(cardFor(page, expected.CV0501.name)).toBeVisible({ timeout: 60_000 });
  await checkPanel(page, "CV0501", { allSkills: true });

  // ---------- batch: gather a pick at a time, remove one, add a folder, and nothing is sent until Upload
  let sent = 0; page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/documents")) sent++; });
  await zone(page).click(); await page.getByRole("button", { name: "Batch" }).click();
  await expect(page.getByText("Add files or folders to the batch")).toBeVisible();
  const first = await pick(page, () => page.getByRole("button", { name: "Add files" }).click(), [file("CV0530.pdf"), file("CV0554.pdf")]);
  expect(first.isMultiple()).toBe(true);
  await expect(page.getByText("2 files ready to upload")).toBeVisible();
  await pick(page, () => page.getByRole("button", { name: "Add files" }).click(), [file("CV0525.pdf"), file("CV0530.pdf")]);   // the same file again is not added twice
  await expect(page.getByText("3 files ready to upload")).toBeVisible();
  await page.getByRole("button", { name: "Remove CV0525.pdf" }).click();
  await expect(page.getByText("2 files ready to upload")).toBeVisible();
  await pick(page, () => page.getByRole("button", { name: "Add a folder" }).click(), join(DIR, "folder"));
  await expect(page.getByText("4 files ready to upload")).toBeVisible();
  await expect(page.getByRole("list", { name: "Files in this batch" }).getByText(/folder\/CV0502.docx/)).toBeVisible();
  expect(sent).toBe(0);   // staged, and nothing has gone anywhere
  await page.screenshot({ path: "test-results/screens/journey-batch-staged.png" });
  await page.getByRole("button", { name: "Upload 4 files" }).click();
  await expect(page.getByRole("region", { name: /Batch of CVs/ })).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: "test-results/screens/journey-batch-sending.png" });
  await acknowledgeBatch(page, 4);
  await page.screenshot({ path: "test-results/screens/journey-batch-finished.png" });
  for (const id of ["CV0530", "CV0554", "CV0502", "CV0503"]) await expect(cardFor(page, expected[id].name)).toBeVisible({ timeout: 30_000 });
  await checkPanel(page, "CV0502", { allSkills: true }); await checkPanel(page, "CV0530");

  // ---------- a job description goes up the same way
  await page.getByText(/^Upload job descriptions$/).first().click();
  await pick(page, () => page.getByRole("button", { name: "Single file" }).click(), file("JD0151.docx"));
  await expect(page.locator('[aria-roledescription="selectable job card"]')).toHaveCount(1, { timeout: 60_000 });

  // ---------- refresh keeps them, and the original is still linked
  await page.reload(); await skipTour(page);
  for (const id of ["CV0501", "CV0530", "CV0554", "CV0502", "CV0503"]) await expect(cardFor(page, expected[id].name)).toBeVisible({ timeout: 30_000 });
  await checkPanel(page, "CV0501");

  // ---------- sign out and back in
  await page.goto("/login"); await page.context().clearCookies(); await signIn(page); await skipTour(page);
  for (const id of ["CV0501", "CV0530", "CV0554", "CV0502", "CV0503"]) await expect(cardFor(page, expected[id].name)).toBeVisible({ timeout: 30_000 });

  // ---------- recovery: a scan and a photo go up through the picker, and the server is restarted while they are being read
  await zone(page).click(); await page.getByRole("button", { name: "Batch" }).click();
  await pick(page, () => page.getByRole("button", { name: "Add files" }).click(), [file("CV0525.pdf"), file("CV0519.pdf")]);
  await page.getByRole("button", { name: "Upload 2 files" }).click();
  await expect(page.getByRole("region", { name: /Batch of CVs/ }).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await expect(cardFor(page, expected.CV0525.name)).toHaveCount(0); await expect(cardFor(page, expected.CV0519.name)).toHaveCount(0);   // still being read, so not on the board: this is work in progress, and the restart hits it
  await page.screenshot({ path: "test-results/screens/journey-before-restart.png" });
  await control("restart");
  await page.reload(); await skipTour(page);
  await acknowledgeBatch(page, 2);   // the batch was interrupted by the restart, and still closes with both files accounted for
  await expect(cardFor(page, expected.CV0525.name)).toBeVisible({ timeout: 30_000 });
  await expect(cardFor(page, expected.CV0519.name)).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: "test-results/screens/journey-after-restart.png" });
  expect(await page.locator(CARD).filter({ hasText: expected.CV0525.name }).count()).toBe(1);   // once, not twice
  for (const id of ["CV0501", "CV0530", "CV0554", "CV0502", "CV0503"]) await expect(cardFor(page, expected[id].name)).toBeVisible();
});
