import { expect, test } from "@playwright/test";

// A change to a field read from the CV asks why before it is saved (milestone 1, docs/learning/TRAINING_AND_IMPROVEMENT_PLAN.md). Cancelling keeps
// the form open with what was typed and saves nothing; the chosen reason is recorded with the change. Notes, the recruiter's own work, never ask.
const CARD = '[aria-roledescription="selectable candidate card"]';

test("changing a field read from the CV asks for a reason; cancelling saves nothing; the reason is recorded", async ({ page, request }) => {
  await page.goto("/dashboard");
  await expect(page.locator(CARD)).toHaveCount(5, { timeout: 20_000 });
  const essential = page.getByRole("button", { name: "Essential Only" });
  if (await essential.isVisible().catch(() => false)) await essential.click();
  await page.locator(CARD).filter({ hasText: "Thandi Mokoena" }).first().click({ position: { x: 20, y: 20 } });
  const list: any = await (await request.get("/api/candidates?limit=100")).json();
  const before = list.items.find((c: any) => c.name.includes("Thandi"));

  await page.getByRole("button", { name: /^Edit candidate/i }).click();
  const form = page.getByTestId("edit-form");
  await form.getByLabel("Location").fill("Kimberley, South Africa");
  await page.getByRole("button", { name: "Save changes" }).click();
  const dialog = page.getByRole("dialog", { name: "Why is this changing?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("location");

  await dialog.getByRole("button", { name: /Cancel, don't save/ }).click();
  await expect(dialog).toBeHidden();
  await expect(form.getByLabel("Location")).toHaveValue("Kimberley, South Africa");   // still editing, nothing lost
  expect(((await (await request.get(`/api/candidates/${before.id}`)).json()) as any).version).toBe(before.version);   // nothing saved

  await page.getByRole("button", { name: "Save changes" }).click();
  await dialog.getByRole("button", { name: /There is newer information/ }).click();
  await expect(form).toBeHidden();
  await expect(page.getByText(/Kimberley/).filter({ visible: true }).first()).toBeVisible();   // shown as the town (one display rule, 11 Nov 2026); not the filter's hidden option
  const after: any = await (await request.get(`/api/candidates/${before.id}`)).json();
  expect(after.location).toBe("Kimberley");   // what was typed is kept; a person's place leaves the server as the town only (owner, 11 Nov 2026)
  const trail: any[] = await (await request.get(`/api/audit?entityId=${before.id}`)).json();
  expect(trail.find((a) => a.action === "candidate.edited" && a.detail.changes?.location)?.detail.changeKind).toBe("candidate_update");

  // notes are the recruiter's own work: saved without being asked
  await page.getByTestId("tab-notes").click();   // the notepad has its own tab (10 Nov 2026)
  const notes = page.getByPlaceholder(/Add recruiter observations/);
  await notes.fill("Confirmed by phone.");
  await notes.blur();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => ((await (await request.get(`/api/candidates/${before.id}`)).json()) as any).recruiterNotes).toBe("Confirmed by phone.");

  // put the seed record back for the other tests
  const now: any = await (await request.get(`/api/candidates/${before.id}`)).json();
  const res = await request.put(`/api/candidates/${before.id}`, { data: { version: now.version, location: before.location, recruiterNotes: before.recruiterNotes ?? "", changeKind: "recruiter_preference" }, headers: { origin: "http://localhost:8787" } });
  expect(res.ok()).toBe(true);
});
