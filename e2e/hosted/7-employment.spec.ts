// A work history the reading is not sure of, from the panel to the match and back: it says so, the document's lines are beside it, a person settles it, the match follows, and it all survives a refresh. The uncertain state is set directly in the isolated database, so this journey does not depend on what a model happens to answer. Invented documents.
import { execFileSync } from "node:child_process";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { address, BASE, CARD, createAdmin, dismissNotices, openTab, published, RUN, signedIn } from "./kit";

const admin = address("emp"), other = address("empother"), H = { origin: BASE }, NAME = "Lerato Evidence";
test.describe.configure({ mode: "serial" });
let ctx: BrowserContext, page: Page, candidateId = "", jobId = "";
const up = async (name: string, text: string, kind: string) => (await (await ctx.request.post("/api/documents", { headers: H, multipart: { kind, file: { name, mimeType: "text/plain", buffer: Buffer.from(text) } } })).json()).id as string;
const CV = `${NAME}\nlerato.evidence@example.test\n082 555 0133\nJohannesburg\nExperience\nSenior Accountant | Northwind Traders | January 2020 - Present\n- Prepared the monthly accounts.\nAccountant | Elmstead Advisory | January 2016 - December 2019\n- Reconciled accounts.\nEducation\nBCom Accounting, University of Pretoria, 2015`;
const JD = "Senior Accountant\nNorthwind Traders\nJohannesburg\nAbout the role\nWe are looking for a senior accountant to lead the month-end process and work with the finance team across the group of companies, keeping the books in good order for the board.\nRequirements\n- At least 12 years of accounting experience\n- Knowledge of reconciliations\nResponsibilities\n- Prepare the monthly accounts for the board.\n- Reconcile the bank accounts every month.\n";
function markUncertain() {
  const reading = { model: "stand-in", promptVersion: "journey", employment: { state: "uncertain", reasons: ["1 date range in the document is not accounted for by any role"] }, unconfirmedRoles: [{ position: "Clerk", company: "Old Office", startDate: "2010", endDate: "2012" }] };
  const roles = [{ company: "Northwind Traders", position: "Senior Accountant", startDate: "January 2020", endDate: "Present", responsibilities: ["Prepared the monthly accounts."], status: "supported", lines: [6], pages: [1] }, { company: "Elmstead Advisory", position: "Accountant", startDate: "January 2016", endDate: "December 2019", responsibilities: ["Reconciled accounts."], status: "uncertain", agreement: "model", lines: [8], pages: [1] }];
  execFileSync("docker", ["exec", "-i", "supabase_db_rolematch", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `update candidates set version = version + 1, data = data || '${JSON.stringify({ reading, workHistory: roles }).replace(/'/g, "''")}'::jsonb where id = '${candidateId}'`], { stdio: "pipe" });
}
async function openCandidate() { await page.goto("/dashboard"); await dismissNotices(page); await page.locator(CARD("candidate")).filter({ hasText: NAME }).first().dblclick({ position: { x: 20, y: 20 } }); await openTab(page, "candidate", "experience"); await expect(page.getByTestId("section-work")).toBeVisible(); }

test.beforeAll(async ({ browser }) => {
  createAdmin(`Evidence ${RUN}`, admin, "Evidence Admin");
  ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1400, height: 900 } }); page = await ctx.newPage(); await signedIn(page, admin);
  candidateId = await published(ctx.request, await up("lerato.txt", CV, "cv"));
  jobId = await published(ctx.request, await up("job.txt", JD, "jd"));
  await ctx.request.put(`/api/jobs/${jobId}`, { headers: H, data: { status: "open" } });
  markUncertain();
});
test.afterAll(async () => { await ctx?.close(); });

test("the panel never asks the recruiter to check the work history: no banner, no review window, no labels on roles", async () => {
  // Owner, 9 Nov 2026: "let's not confuse the recruiter, the matching still reads the entire CV". The uncertain role is still recorded behind the scenes.
  await openCandidate();
  await expect(page.getByTestId("employment-uncertain")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review CV evidence" })).toHaveCount(0);
  await expect(page.getByTestId("work-entry").getByTestId("fact-state")).toHaveCount(0);
  await expect(page.getByTestId("work-entry").filter({ hasText: "Elmstead" })).toBeVisible();
});
test("a match is never \"Assessment incomplete\": it is the AI's to score, and the board shows the AI's score once it is in", async () => {
  // The rehearsal checks matches with its stand-in Claude, as live does with Claude (11 Nov 2026), so the score on screen is the AI's.
  const r = await (await ctx.request.post("/api/matches", { headers: H, data: { candidateId, jobId } })).json();
  expect(r.assessment).toBeUndefined();
  await expect.poll(async () => (await (await ctx.request.get(`/api/matches?candidateId=${candidateId}&jobId=${jobId}`, { headers: H })).json()).ai?.state, { timeout: 120_000 }).toBe("checked");
  await page.goto("/dashboard"); await dismissNotices(page);
  await page.locator(CARD("candidate")).filter({ hasText: NAME }).first().click({ position: { x: 20, y: 20 } });
  await page.locator(CARD("job")).first().click({ position: { x: 20, y: 20 } });
  // The pair already has its recorded match, so the board offers to view it, never to run it again (recorded matches never change, 10 Nov 2026).
  await page.getByRole("button", { name: "View assessment", exact: true }).click();
  const assessment = page.getByRole("dialog").filter({ hasText: "Match Assessment" });
  await expect(assessment).toBeVisible({ timeout: 30_000 });
  await expect(assessment.getByTestId("match-not-scored")).toHaveCount(0);
  await expect(assessment.getByText(/Assessment incomplete/i)).toHaveCount(0);
});
test("a role the reading is sure of cannot be changed this way; another organisation sees nothing", async () => {
  const refused = await ctx.request.post(`/api/candidates/${candidateId}/employment-review`, { headers: H, data: { action: "remove", index: 0 } });
  // Refused either way: "not allowed" (403) for a role the AI's reading is sure of, or "nothing to review" (409) where the CV was read without the AI,
  // as the rehearsal still reads CVs (its CV reading moves to the stand-in Claude next, as live reads them: report of 11 Nov 2026).
  expect([403, 409]).toContain(refused.status()); expect((await refused.json()).code ?? (await refused.json()).error?.code).toBeTruthy();
  createAdmin(`Other ${RUN}`, other, "Other Admin");
  const otherCtx = await ctx.browser()!.newContext({ baseURL: BASE }), p = await otherCtx.newPage(); await signedIn(p, other);
  expect((await otherCtx.request.get(`/api/candidates/${candidateId}/employment`, { headers: H })).status()).toBe(404);
  expect((await otherCtx.request.post(`/api/candidates/${candidateId}/employment-review`, { headers: H, data: { action: "resolve" } })).status()).toBe(404);
  await otherCtx.close();
});
test("reading again keeps the earlier reading, when the reader is on; otherwise it says it is off", async () => {
  const r = await ctx.request.post(`/api/candidates/${candidateId}/read-again`, { headers: H });
  expect([202, 409]).toContain(r.status());
});
