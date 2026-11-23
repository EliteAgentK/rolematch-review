// The Overview and its link to the Matching Board (docs/architecture/PLAN_OVERVIEW_LINKS.md), on the live path: signing in opens the Overview in Live, its
// figures loaded behind the loading screen, a Demo click says what it would open and opens nothing, a Live block opens the board in the state it describes with a pill that says so, Clear returns
// the board to everything, the header moves between the two views at once with no second loading screen, and nothing on the page is cut off. Invented documents, the stand-in Claude.
import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { address, BASE, CARD, createAdmin, dismissNotices, fixture, published, RUN, signIn } from "./kit";

const admin = address("overview"), H = { origin: BASE };
test.describe.configure({ mode: "serial" });
let ctx: BrowserContext, page: Page, candidateId = "", jobId = "";

test.beforeAll(async ({ browser }) => {
  createAdmin(`Overview ${RUN}`, admin, "Overview Admin");
  ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1536, height: 864 } }); page = await ctx.newPage();
  await signIn(page, admin); await page.waitForURL(/overview/, { timeout: 60_000 });
  const up = async (name: string, kind: "cv" | "jd", buffer: Buffer, type = "application/octet-stream") => (await (await ctx.request.post("/api/documents", { headers: H, multipart: { kind, file: { name, mimeType: type, buffer } } })).json()).id as string;
  candidateId = await published(ctx.request, await up("CV0501.docx", "cv", readFileSync(fixture("CV0501.docx"))));
  // A second person, so "exactly that record" on the board is a real narrowing.
  await published(ctx.request, await up("second.txt", "cv", Buffer.from("Zanele Second\nzanele.second@example.test\nExperience\nClerk | Elmstead Advisory | 2020 - 2023\n- Filed and reconciled supplier invoices every month.\nEducation\nNational Senior Certificate, 2019"), "text/plain"));
  jobId = await published(ctx.request, await up("job.txt", "jd", Buffer.from("Financial Accountant\nCompany: Elmstead Advisory\nLocation: Johannesburg\nRequirements\n- A degree in accounting and three years of month-end close.\nResponsibilities\n- Prepare the monthly statements and reconcile the ledger.\n"), "text/plain"));
  expect((await ctx.request.put("/api/applications", { headers: H, data: { candidateId, jobId, status: "shortlisted" } })).status()).toBe(200);
});
test.afterAll(async () => { await ctx?.close(); });

const clipped = () => page.evaluate(() => [...document.querySelectorAll(".ov .card")].filter((c) => c.scrollHeight > c.clientHeight + 2).map((c) => c.querySelector("h3")?.textContent ?? "?"));

test("signing in opens the Overview in Live, drawn whole once its figures are here; the Demo's clicks say what they would open", async () => {
  await page.goto("/overview"); await dismissNotices(page);
  await expect(page.locator(".ov .badge")).toHaveText(/Live/i, { timeout: 30_000 });
  await expect(page.locator(".ov .kpi")).toHaveCount(4);
  await expect(page.locator(".ov .notice")).toHaveCount(0);   // the loading screen covered the wait: never a page of empty blocks filling in
  await page.getByRole("button", { name: "Demo", exact: true }).click();
  await expect(page.locator(".ov .badge")).toHaveText(/Demo/i);
  expect(await clipped()).toEqual([]);
  await page.locator(".ov .kpi").filter({ hasText: "Shortlisted" }).click();
  await expect(page.locator(".ov .hint")).toContainText("In Live, this opens the Matching Board");
  await expect(page).toHaveURL(/\/overview$/);
});

test("in Live, the Shortlisted block opens the board on the shortlisted, says so, and the way back returns everything", async () => {
  await page.getByRole("button", { name: "Live", exact: true }).click();
  await expect(page.locator(".ov .badge")).toHaveText(/Live/i);
  await expect(page.locator(".ov .kpi").filter({ hasText: "Shortlisted" }).locator(".num")).toHaveText("1", { timeout: 20_000 });
  await page.locator(".ov .kpi").filter({ hasText: "Shortlisted" }).click();
  await page.waitForURL(/\/dashboard/);
  // At once, from the records the Overview already loaded: never the plain board first while a fresh load runs (owner, 11 Nov 2026).
  await expect(page.getByText("Showing from the Overview:")).toBeVisible({ timeout: 2000 });
  await expect(page.getByText("Shortlisted candidates", { exact: false }).first()).toBeVisible();
  await expect(page.locator(CARD("candidate"))).toHaveCount(1);
  expect(new URL(page.url()).search).toBe("");   // the link is taken off once acted on
  await page.getByTestId("show-whole-board").click();
  await expect(page.getByText("Showing from the Overview:")).toHaveCount(0);
  // The header's Matching Board, pressed on the board, is the way back too.
  await page.goto("/dashboard?focus=shortlisted"); await expect(page.getByText("Showing from the Overview:")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: "Matching Board" }).click();
  await expect(page.getByText("Showing from the Overview:")).toHaveCount(0);
});

test("an activity line shows who, their address and when, and opens its records on the board", async () => {
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.waitForURL(/\/overview/);
  await page.getByRole("button", { name: "Live", exact: true }).click();
  const line = page.locator(".ov button.ev").filter({ hasText: "to shortlisted" }).first();
  await expect(line).toBeVisible({ timeout: 20_000 });
  await line.click();
  const detail = page.getByRole("dialog", { name: "What happened" });
  await expect(detail).toContainText(admin);
  await detail.getByRole("button", { name: "Open on the Matching Board" }).click();
  await page.waitForURL(/\/dashboard/);
  await expect(page.getByTestId("candidate-tabs")).toBeVisible({ timeout: 20_000 });
  // Exactly that record, the bar saying so, and the way back to the whole board (owner, 11 Nov 2026: "I should never be stuck on a screen").
  await expect(page.getByText("Showing from the Overview:")).toBeVisible();
  await expect(page.locator(CARD("candidate"))).toHaveCount(1);
  await page.getByTestId("show-whole-board").click();
  await expect(page.getByText("Showing from the Overview:")).toHaveCount(0);
  await expect.poll(() => page.locator(CARD("candidate")).count()).toBeGreaterThan(1);
});

test("signed out, the Overview goes to sign-in and shows nothing, Demo included", async ({ browser }) => {
  const anon = await browser.newContext({ baseURL: BASE }), p = await anon.newPage();
  await p.goto("/overview");
  await p.waitForURL(/\/login/, { timeout: 20_000 });
  await expect(p.locator(".ov .kpi")).toHaveCount(0);
  await anon.close();
});

test("once in, the Matching Board and the Overview open at once, with no second loading screen", async () => {
  // Counts every time the RoleMatch loading screen appears while moving between the two (owner, 10 Nov 2026: "a whole new loading screen came up, once
  // you're in it should be easy toggling"). The moves are within the page, so the count survives them.
  await page.evaluate(() => { const w = window as any; w.loaders = 0; new MutationObserver(() => { const on = !!document.querySelector('[data-testid="brand-loader"]'); if (on && !w.loaderOn) w.loaders++; w.loaderOn = on; }).observe(document.body, { childList: true, subtree: true }); });
  const views = page.getByRole("navigation", { name: "Views" });
  for (let i = 0; i < 2; i++) for (const [name, url, ready] of [["Matching Board", /\/dashboard/, page.getByText(/^Upload CVs$/)], ["Overview", /\/overview/, page.locator(".ov .kpi").first()]] as const) {
    const t0 = Date.now();
    await views.getByRole("button", { name, exact: true }).click();
    await page.waitForURL(url); await expect(ready).toBeVisible();
    expect(Date.now() - t0, `${name} took too long to show`).toBeLessThan(1000);
  }
  expect(await page.evaluate(() => (window as any).loaders)).toBe(0);
});

test("a saved match opened from the Overview shows its assessment at once, and is never run again", async () => {
  // Owner, 10 Nov 2026: a strongest match "was supposed to take you to the page of the details ... not to the board to go match it yourself".
  const ran = await ctx.request.post("/api/matches", { headers: H, data: { candidateId, jobId } });
  expect(ran.status()).toBe(200);
  await page.goto(`/dashboard?focus=match&c=${candidateId}&j=${jobId}`);   // no dismissNotices here: it would press the assessment's own Close
  const assessment = page.getByRole("dialog").filter({ hasText: "Match Assessment" });
  await expect(assessment).toBeVisible({ timeout: 20_000 });
  // Nothing of the assessment shows beneath its buttons: where the window scrolls, the bar sits on the scrolling area's bottom edge (owner, 10 Nov 2026).
  expect(await assessment.getByTestId("match-actions").evaluate((bar) => { let s: HTMLElement | null = bar.parentElement; while (s && !/auto|scroll/.test(getComputedStyle(s).overflowY)) s = s.parentElement;
    return !s || s.scrollHeight <= s.clientHeight + 1 || s.scrollTop + s.clientHeight >= s.scrollHeight - 1 || Math.abs(bar.getBoundingClientRect().bottom - s.getBoundingClientRect().bottom) <= 1; })).toBe(true);
  // As the owner goes: from the Overview, a "Matched" activity line opens its saved assessment right there (owner, 11 Nov 2026: "when I press that
  // Musa match, all I get is the board opening up, so what's the point of the button"), and no new match is run.
  await page.keyboard.press("Escape"); await expect(assessment).toHaveCount(0);
  await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: "Overview", exact: true }).click(); await page.waitForURL(/\/overview/);
  await page.locator(".ov button.ev").filter({ hasText: "Matched" }).first().click();
  await page.getByRole("dialog", { name: "What happened" }).getByRole("button", { name: "View assessment" }).click();
  await expect(page.getByTestId("saved-assessment").getByText(/^Match Assessment: .+ & .+/)).toBeVisible({ timeout: 2000 });
  expect(new URL(page.url()).pathname).toBe("/overview");
  const runs = await (await ctx.request.get(`/api/overview?days=7`, { headers: H })).json();
  expect(runs.activity.filter((a: any) => /^Matched/.test(a.what)).length).toBe(1);   // one recorded match, however often it is opened
});

test("a strongest match opens its saved assessment on the Overview within two seconds, never on the board", async () => {
  // Owner, 11 Nov 2026, the third time of asking: "it must be this page that shows up whenever I click the strongest matches, even if they change ... I
  // don't wanna be taken to the board to see this, I want to immediately see this"; "no more than a quick 2 second loading screen". The rehearsal checks
  // matches with its stand-in Claude, as live does with Claude, so the block is filled the way the owner sees it.
  const ran = await ctx.request.post("/api/matches", { headers: H, data: { candidateId, jobId } });
  expect(ran.status()).toBe(200);
  await expect.poll(async () => ((await (await ctx.request.get(`/api/overview?days=30`, { headers: H })).json()).strongest ?? []).length, { timeout: 120_000 }).toBeGreaterThan(0);
  await page.goto("/overview"); await dismissNotices(page);
  const first = page.locator(".ov .bm .person").first();
  await expect(first).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);   // as a person does: the page is open a moment before the click
  const t0 = Date.now();
  await first.click();
  const assessment = page.getByTestId("saved-assessment");
  await expect(assessment.getByText(/^Match Assessment: .+ & .+/)).toBeVisible({ timeout: 2000 });
  expect(Date.now() - t0, "the assessment took too long to show").toBeLessThan(2000);
  await expect(assessment.getByTestId("match-actions")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/overview");   // never the board
  await assessment.getByRole("button", { name: "Close" }).last().click();
  await expect(assessment).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe("/overview");
});
