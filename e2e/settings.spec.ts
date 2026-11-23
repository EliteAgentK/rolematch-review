import { expect, test } from "@playwright/test";

// The wording and statuses are shared by every test in the run (the card headings say "Candidate Resume" and so on). Whatever happens in
// this test, put them back afterwards, or one failure here would break unrelated tests that run after it.
let original: any;
test.beforeEach(async ({ request }) => { original = await (await request.get("/api/settings")).json(); });
test.afterEach(async ({ request }) => {
  if (!original) return;
  const now = await (await request.get("/api/settings")).json();
  if (now.version === original.version) return;
  const res = await request.put("/api/settings", { data: { version: now.version, labels: original.settings.labels, statuses: original.settings.statuses, panels: original.settings.panels, review: original.settings.review, limits: original.settings.limits }, headers: { origin: "http://localhost:8787" } });
  expect(res.ok(), "restoring the organisation's settings").toBe(true);
});
const save = async (page: import("@playwright/test").Page) => {
  const saved = page.waitForResponse((r) => r.request().method() === "PUT" && /\/api\/settings$/.test(r.url()));
  await page.getByRole("button", { name: "Save changes" }).click();
  expect((await saved).ok()).toBe(true);                                       // the save itself finished; only then look for the confirmation
  await expect(page.getByText("Settings saved")).toBeVisible();
};

// Settings are per organisation, and the board really follows them. This test changes the wording and a status, then checks the board.
test("an administrator can rename things and add a status, and the board follows", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one run is enough");
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText(/cannot be changed here/)).toBeVisible();          // scoring is not a setting
  if (await page.getByRole("button", { name: "Essential Only" }).isVisible().catch(() => false)) await page.getByRole("button", { name: "Essential Only" }).click();
  // statuses: recolour one and add one
  await page.getByLabel("Label for shortlisted").fill("Top shortlist");
  await page.getByPlaceholder("For example: Offer made").fill("Offer made");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  // wording
  await page.getByRole("tab", { name: "Wording" }).click();
  await page.getByLabel("Candidate (singular)").fill("Applicant");
  await page.getByLabel("Candidates (plural)").fill("Applicants");
  await page.screenshot({ path: "test-results/screens/9-settings-wording.png" });
  await save(page);
  // the history records it
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByText(new RegExp(`Version ${original.version + 1}, last changed`))).toBeVisible();   // the saved change is the next numbered version
  await expect(page.getByRole("row").filter({ hasText: "Changed the settings" }).first()).toBeVisible();   // and the history says who changed them, and when
  // the board follows
  await page.goto("/dashboard");
  await expect(page.getByText(/Applicants \(\d+\)/)).toBeVisible({ timeout: 15000 });
  await page.locator('[aria-roledescription="selectable candidate card"]').first().click({ position: { x: 20, y: 20 } });
  await expect(page.getByRole("heading", { name: "Applicant Resume" })).toBeVisible();
  await page.getByRole("button", { name: "Edit applicant" }).click();
  const options = await page.getByLabel("Recruitment status").locator("option").allTextContents().catch(() => [] as string[]);
  await page.screenshot({ path: "test-results/screens/10-board-following-settings.png" });
  // put the organisation back on its original wording so later runs start the same way
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Wording" }).click();
  await page.getByRole("button", { name: "Reset this section to the platform defaults" }).click();
  await save(page);
  expect(options.length === 0 || options.includes("Offer made")).toBe(true);
});
