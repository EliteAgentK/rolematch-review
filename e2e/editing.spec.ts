import { expect, test, type Page } from "@playwright/test";

// What a recruiter may edit is the organisation's decision. By default: corrections to who the person is, never what the CV states.
const CARD = '[aria-roledescription="selectable candidate card"]';
let original: any;
test.beforeEach(async ({ request }) => { original = await (await request.get("/api/settings")).json(); });
test.afterEach(async ({ request }) => {   // whatever happens here, put the organisation's policy back
  const now = await (await request.get("/api/settings")).json();
  if (JSON.stringify(now.settings.editing) === JSON.stringify(original.settings.editing)) return;
  const res = await request.put("/api/settings", { data: { version: now.version, editing: original.settings.editing }, headers: { origin: "http://localhost:8787" } });
  expect(res.ok(), "restoring the edit policy").toBe(true);
});

async function openEditing(page: Page) {
  await page.goto("/dashboard");
  await expect(page.locator(CARD)).toHaveCount(5, { timeout: 20_000 });
  const essential = page.getByRole("button", { name: "Essential Only" });
  if (await essential.isVisible().catch(() => false)) await essential.click();
  await page.locator(CARD).filter({ hasText: "Thandi Mokoena" }).first().click({ position: { x: 20, y: 20 } });
  await page.getByRole("button", { name: /^Edit candidate/i }).click();
  await expect(page.getByTestId("edit-form")).toBeVisible();
}

test("by default a recruiter can correct who the person is, and what the CV states is shown locked", async ({ page }) => {
  await openEditing(page);
  const form = page.getByTestId("edit-form");
  await expect(form.getByLabel("Email address")).toBeVisible();     // editable
  await expect(form.getByLabel("Phone number")).toBeVisible();
  await expect(form.getByLabel("Location")).toBeVisible();
  await expect(form.getByLabel("Recruitment status")).toHaveCount(0); // a status is per job since 10 Nov 2026: set from a match or a job's shortlist, not here
  for (const locked of ["Occupation", "Skills", "Professional summary"]) {
    await expect(form.getByTestId("locked-field").filter({ hasText: locked })).toBeVisible();   // locked, with the reason one hover away
    await expect(form.getByRole("textbox", { name: locked })).toHaveCount(0);   // and no input to type in
  }
  await form.getByTestId("locked-field").filter({ hasText: "Skills" }).getByText("not editable").hover();
  await expect(page.getByRole("tooltip")).toContainText(/evidence|CV/i);
});

test("an administrator can unlock a field in Settings, and the form then offers it", async ({ page, request }) => {
  const now = await (await request.get("/api/settings")).json();
  const res = await request.put("/api/settings", { data: { version: now.version, editing: { ...now.settings.editing, candidate: { ...now.settings.editing.candidate, summary: true } } }, headers: { origin: "http://localhost:8787" } });
  expect(res.ok()).toBe(true);
  await openEditing(page);
  await expect(page.getByTestId("edit-form").getByLabel("Professional summary")).toBeVisible();   // now an input
  await expect(page.getByTestId("edit-form").getByTestId("locked-field").filter({ hasText: "Professional summary" })).toHaveCount(0);
});

test("Settings lists every field with its reason, and what the platform works out is not offered at all", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("tab", { name: "What can be edited" }).click();
  const candidate = page.getByTestId("edit-policy-candidate");
  await expect(candidate.getByText("Email address")).toBeVisible();
  await expect(candidate.getByText("Work history")).toBeVisible();
  await expect(candidate.getByText(/Years of experience|Relevant years/i)).toHaveCount(0);
  await expect(page.getByTestId("edit-policy-job").getByText("Mandatory requirements")).toBeVisible();
});
