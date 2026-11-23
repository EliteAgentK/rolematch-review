import { expect, test, type Page } from "@playwright/test";

const CARD = '[aria-roledescription="selectable candidate card"]';
const cardFor = (page: Page, text: string) => page.locator(CARD).filter({ hasText: text }).first();

async function openBoard(page: Page) {
  await page.goto("/dashboard");
  await expect(page.locator(CARD)).toHaveCount(5, { timeout: 20_000 });
  const essential = page.getByRole("button", { name: "Essential Only" });
  if (await essential.isVisible().catch(() => false)) await essential.click();
}
const settingsNow = async (page: Page) => (await (await page.request.get("/api/settings")).json()) as any;
async function setPanels(page: Page, panels: Record<string, unknown>) {
  const cur = await settingsNow(page);
  const res = await page.request.put("/api/settings", { data: { version: cur.version, panels }, headers: { origin: "http://localhost:8787" } });
  expect(res.ok()).toBe(true);
}

test.beforeEach(async ({ page }) => { await openBoard(page); });

test("the compact card shows the employer and the highest qualification, and no longer the e-mail address", async ({ page }) => {
  const thandi = cardFor(page, "Thandi Mokoena");
  await expect(thandi.getByText("at Cobalt Travel")).toBeVisible();          // current employer, from the role marked Present
  await expect(thandi.getByText("BSc Computer Science")).toBeVisible();       // highest qualification
  await expect(thandi.getByText("thandi.mokoena@example.test")).toHaveCount(0);
  const michael = cardFor(page, "Michael Chen");
  await expect(michael.getByText("at Coastal Timber")).toBeVisible();
  await expect(michael.getByText("BCom Accounting")).toBeVisible();
  // the card is still the same size as every other card
  const heights = await Promise.all((await page.locator(CARD).all()).map(async (c) => Math.round((await c.boundingBox())!.height)));
  expect(new Set(heights).size).toBe(1);
});

test("a recruiter note shows a small icon on the card, and is kept in the panel's notes tab", async ({ page }, info) => {
  const card = cardFor(page, "Ruan van der Merwe");
  await expect(card.getByRole("img", { name: "Has recruiter notes" })).toHaveCount(0); // no note yet: no icon
  await card.click({ position: { x: 20, y: 20 } });
  await page.getByTestId("tab-notes").click();   // the notepad has its own tab (10 Nov 2026)
  const notepad = page.getByPlaceholder("Add recruiter observations");
  await notepad.fill("Phoned on Monday: available from 1 December.");
  const saved = page.waitForResponse((r) => /\/api\/candidates\//.test(r.url()) && r.request().method() !== "GET");
  await page.getByRole("heading", { name: "Candidate Resume" }).click();            // click away: the note is saved
  expect((await saved).ok()).toBe(true);                                             // wait for the save itself, not a fixed time: it goes to a remote database
  await expect(card.getByRole("img", { name: "Has recruiter notes" })).toBeVisible();
  // after a reload the note is still there, and its tab counts it
  await page.reload();
  await expect(page.locator(CARD)).toHaveCount(5, { timeout: 20_000 });
  await cardFor(page, "Ruan van der Merwe").click({ position: { x: 20, y: 20 } });
  await expect(page.getByTestId("tab-notes")).toContainText("1");
  await page.getByTestId("tab-notes").click();
  const pad = page.getByPlaceholder("Add recruiter observations");
  await expect(pad).toHaveValue(/available from 1 December/);
  if (info.project.name === "desktop") await page.screenshot({ path: "test-results/screens/11-note-icon-and-notepad.png" });
  // clean up so every run starts the same
  await pad.fill(""); await page.getByRole("heading", { name: "Candidate Resume" }).click();
  await expect(cardFor(page, "Ruan van der Merwe").getByRole("img", { name: "Has recruiter notes" })).toHaveCount(0);
});

test("a CV with no summary of its own gets a plainly labelled 'profile at a glance' instead of an empty box", async ({ page }) => {
  await cardFor(page, "Zanele Khumalo").click({ position: { x: 20, y: 20 } });           // her CV has no summary section
  await expect(page.getByTestId("who-today")).toContainText("HR Manager at Rand Auto Parts");
  await expect(page.getByText(/put together from the fields read from the CV/)).toBeVisible();
  await expect(page.getByTestId("no-summary")).toHaveCount(0);
  await cardFor(page, "Thandi Mokoena").click({ position: { x: 20, y: 20 } });           // hers has one: shown as written, with no fallback notice
  await expect(page.getByText(/Full-stack developer with eight years/)).toBeVisible();
  await expect(page.getByText(/put together from the fields read from the CV/)).toHaveCount(0);
});

test("the fallback can be switched off in settings, and then says so honestly", async ({ page }) => {
  await setPanels(page, { summaryFallback: false });
  try {
    await page.reload(); await expect(page.locator(CARD)).toHaveCount(5, { timeout: 20_000 });
    await cardFor(page, "Zanele Khumalo").click({ position: { x: 20, y: 20 } });
    await expect(page.getByTestId("no-summary")).toBeVisible();
    await expect(page.getByText(/put together from the fields read from the CV/)).toHaveCount(0);
  } finally { await setPanels(page, { summaryFallback: true }); }
});

test("the panel shows the organisation's number of skills and roles, with the rest one click away", async ({ page }) => {
  await cardFor(page, "Thandi Mokoena").click({ position: { x: 20, y: 20 } });
  await page.getByTestId("tab-skills").click();   // the panel has tabs (10 Nov 2026)
  const skills = page.getByTestId("panel-skill");
  await expect(skills).toHaveCount(8);                              // the default is eight
  const more = page.getByRole("button", { name: /^View \d+ more$/ }).last();
  await expect(more).toHaveText("View 2 more");                                           // Thandi's CV lists 10 skills
  await more.click();
  await expect(skills).toHaveCount(10);
  await page.getByRole("button", { name: "Show fewer skills" }).click();
  await expect(skills).toHaveCount(8);
  // roles: change the setting to one role and the rest sit behind the one fold button every list uses ("View 1 more")
  await setPanels(page, { panelRoles: 1 });
  try {
    await page.reload(); await expect(page.locator(CARD)).toHaveCount(5, { timeout: 20_000 });
    await cardFor(page, "Thandi Mokoena").click({ position: { x: 20, y: 20 } });
    await page.getByTestId("tab-experience").click();
    await expect(page.getByText("Senior Developer", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Developer", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "View 1 more" }).click();
    await expect(page.getByText("Developer", { exact: true })).toBeVisible();
  } finally { await setPanels(page, { panelRoles: 3 }); }
});

test("how many skills a card shows is the organisation's setting", async ({ page }) => {
  await setPanels(page, { cardSkills: 2 });
  try {
    await page.reload(); await expect(page.locator(CARD)).toHaveCount(5, { timeout: 20_000 });
    const card = cardFor(page, "Thandi Mokoena");
    await expect(card.getByTestId("skill-chip")).toHaveCount(2);
    await expect(card.getByRole("button", { name: /View 8 more skills/ })).toBeVisible();   // 10 skills: 2 shown, exactly 8 more
  } finally { await setPanels(page, { cardSkills: 3 }); }
});

test("the Education section lists degrees, diplomas, school and certifications together, each saying what it is and whether it was finished", async ({ page }) => {
  await cardFor(page, "Thandi Mokoena").click({ position: { x: 20, y: 20 } });
  await page.getByTestId("tab-education").click();
  const education = page.getByTestId("panel-education");
  await expect(education).toBeVisible();
  const first = education.getByTestId("education-entry").first();
  await expect(first).toContainText("BSc Computer Science");
  await expect(first.getByTestId("education-type")).toHaveText("Bachelor's degree");   // what it is
  await expect(first.getByTestId("education-status")).toHaveText("Completed");          // and whether it was finished (the CV gives 2015)
  // there is no separate Certifications or Languages section: certifications are entries of Education
  await expect(page.getByText("Certifications", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Languages", { exact: true })).toHaveCount(0);
  // the reason for a status is one hover away
  await first.getByTestId("education-status").hover();
  await expect(page.getByRole("tooltip")).toContainText(/2015|year/);
});
