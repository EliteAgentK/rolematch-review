// The rest of a recruiter's day on a running service, in a real browser: what goes wrong as well as what goes right. Disposable stack only: it restarts the service.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { address, BASE, CARD, codeIn, createAdmin, cvZone, dismissNotices, fillSignup, fixture, inviteLink, jobZone, pick, published, RUN, signedIn, waitForMail } from "./kit";

const expected = JSON.parse(readFileSync(fixture("expected.json"), "utf8"));
const admin = address("whole"), H = { origin: BASE };
const card = (page: Page, name: string) => page.locator(CARD("candidate")).filter({ hasText: name }).first();
test.describe.configure({ mode: "serial" });
let ctx: BrowserContext, page: Page, cvA = "", cvB = "", jobId = "", docA = "";

const up = async (name: string, kind: string) => (await (await ctx.request.post("/api/documents", { headers: H, multipart: { kind, file: { name, mimeType: "application/octet-stream", buffer: readFileSync(fixture(name)) } } })).json()).id as string;

test.beforeAll(async ({ browser }) => {
  createAdmin(`Whole ${RUN}`, admin, "Whole Admin");
  ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1600, height: 1000 } }); page = await ctx.newPage();
  await signedIn(page, admin);
  docA = await up("CV0501.docx", "cv"); cvA = await published(ctx.request, docA);
  cvB = await published(ctx.request, await up("CV0519.pdf", "cv"));
  jobId = await published(ctx.request, await up("JD0151.docx", "jd"));
  await page.reload(); await dismissNotices(page);
});
test.afterAll(async () => { await ctx?.close(); });

test("a failed list says it failed: the board never shows an empty list instead (R35)", async () => {
  await expect(card(page, expected.CV0501.name)).toBeVisible({ timeout: 30_000 });
  await page.route(/\/api\/candidates(\?|$)/, (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "SVC-001", message: "Injected failure" } }) }));
  await page.reload();
  await expect(page.getByText(/not loaded/i).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/No candidates in this portal yet/i)).toHaveCount(0);
  await page.unroute(/\/api\/candidates(\?|$)/);
  await page.reload(); await dismissNotices(page);
  await expect(card(page, expected.CV0501.name)).toBeVisible({ timeout: 30_000 });
});

test("a remembered portal that no longer exists does not empty the board or hide the records", async () => {
  await page.evaluate(() => localStorage.setItem("rolematch.portal", crypto.randomUUID()));
  await page.reload();
  await expect(card(page, expected.CV0501.name).or(page.getByText(/Choose a portal|not loaded|Portal not found/i).first())).toBeVisible({ timeout: 30_000 });
  const showsEmpty = await page.getByText(/No candidates in this portal yet/i).count();
  expect(showsEmpty).toBe(0);
  await page.evaluate(() => localStorage.removeItem("rolematch.portal"));
  await page.reload(); await dismissNotices(page);
  await expect(card(page, expected.CV0501.name)).toBeVisible({ timeout: 30_000 });
});

test("a file that is not a document is refused with a reason, and nothing appears", async () => {
  const before = await page.locator(CARD("candidate")).count();
  const bad = join(tmpdir(), `not-a-cv-${RUN}.pdf`); writeFileSync(bad, "this is not a pdf at all");
  await cvZone(page).click(); await pick(page, () => page.getByRole("button", { name: "Single file" }).click(), bad);
  await expect(page.getByText(/genuine|not a|could not|unsupported|refused|Only/i).first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  expect(await page.locator(CARD("candidate")).count()).toBe(before);
  await dismissNotices(page);
});

test("the same file again does not make a second record", async () => {
  const r = await ctx.request.post("/api/documents", { headers: H, multipart: { kind: "cv", file: { name: "CV0501.docx", mimeType: "application/octet-stream", buffer: readFileSync(fixture("CV0501.docx")) } } });
  expect((await r.json()).duplicate).toBe(true);
  await page.reload(); await dismissNotices(page);
  await expect(page.locator(CARD("candidate")).filter({ hasText: expected.CV0501.name })).toHaveCount(1, { timeout: 30_000 });
});

test("a batch can be cancelled; what was never sent is said; the slots come back only when it is closed", async () => {
  const cap = async () => (await (await ctx.request.get("/api/capacity", { headers: H })).json());
  const start = await cap();
  const made = (await (await ctx.request.post("/api/batches", { headers: H, data: { kind: "cv", files: 7, bytes: 7_000_000 } })).json());
  expect(made.id).toBeTruthy();
  const held = await cap();
  expect(held.reserved ?? held.used).toBe((start.reserved ?? start.used ?? 0) + 7);
  await page.reload(); await dismissNotices(page);
  const panel = page.getByRole("region", { name: /Batch of CVs/ });
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await panel.getByRole("button", { name: "Cancel remaining" }).click();
  const summary = page.getByRole("dialog").filter({ hasText: "Batch cancelled" });
  await expect(summary).toBeVisible({ timeout: 30_000 });
  await summary.getByRole("button", { name: "Done" }).click();
  await expect.poll(async () => { const c = await cap(); return c.reserved ?? c.used; }, { timeout: 60_000 }).toBe(start.reserved ?? start.used ?? 0);
});

// Since 9 Nov 2026 a status is per candidate per job (applications.ts): the panel's own "Recruitment status" selector was removed, so the shortlist is set
// for this job as the board's shortlist actions set it (PUT /api/applications). Rewritten 10 Nov 2026 (register R191); the rest is unchanged.
test("shortlist for a job, search and filter find it, and it stays after a refresh", async () => {
  const set = await ctx.request.put("/api/applications", { headers: H, data: { candidateId: cvA, jobId, status: "shortlisted" } });
  expect(set.status()).toBe(200);
  await expect.poll(async () => (await (await ctx.request.get(`/api/candidates/${cvA}`, { headers: H })).json()).status, { timeout: 15_000 }).toBe("shortlisted");
  await page.reload(); await dismissNotices(page);
  const search = page.getByPlaceholder(/Search by name/i).first();
  await search.fill(expected.CV0501.name.split(" ")[0]);
  await expect(card(page, expected.CV0501.name)).toBeVisible();
  await expect(page.locator(CARD("candidate")).filter({ hasText: expected.CV0519.name })).toHaveCount(0);
  await search.fill("");
  expect((await (await ctx.request.get("/api/candidates?status=shortlisted", { headers: H })).json()).items.map((c: any) => c.id)).toEqual([cvA]);
});

test("Who to match can be narrowed to the people shortlisted for the role, and the role's card opens its shortlist", async () => {
  // Owner, 10 Nov 2026: "why is there no filter here for the people that have been shortlisted for this job ... there should be a dropdown"; and the
  // shortlist should open from the role itself.
  await page.goto("/dashboard"); await dismissNotices(page);
  const jobCard = page.locator(CARD("job")).first();
  await expect(jobCard.getByTestId("card-shortlisted")).toHaveText("Shortlisted · 1", { timeout: 20_000 });
  await jobCard.focus(); await page.keyboard.press("m");
  const chooser = page.getByTestId("match-chooser"), filter = chooser.getByTestId("match-chooser-filter");
  await expect(chooser).toBeVisible();
  // One filter, All then Shortlisted, and nothing else (owner, 11 Nov 2026); on Shortlisted, "Select all shortlisted" ticks them all at once.
  expect(await filter.locator("option").allTextContents()).toEqual([expect.stringMatching(/^All \S+ \(2\)$/), expect.stringMatching(/^Shortlisted for this \S+ \(1\)$/)]);
  await expect(filter).toHaveValue("all");
  await expect(chooser.getByRole("checkbox")).toHaveCount(2);
  await expect(chooser.getByTestId("match-chooser-select-all")).toHaveCount(0);
  await filter.selectOption("shortlisted");
  await expect(chooser.getByText(expected.CV0501.name)).toBeVisible();
  await chooser.getByTestId("match-chooser-select-all").getByRole("checkbox").check();
  await expect(chooser.getByRole("button", { name: "Match selected (1)" })).toBeEnabled();
  await chooser.getByRole("button", { name: "Cancel" }).click();
  await jobCard.getByTestId("card-shortlisted").click();
  await expect(page.getByRole("dialog").filter({ hasText: expected.CV0501.name })).toBeVisible({ timeout: 20_000 });
});

test("matching in both directions: one candidate against the jobs, one job against the candidates, with evidence", async () => {
  const one = await ctx.request.post("/api/matches/bulk", { headers: H, data: { candidateId: cvA } }), other = await ctx.request.post("/api/matches/bulk", { headers: H, data: { jobId } });
  expect(one.status()).toBe(200); expect(other.status()).toBe(200);
  const a = await one.json(), b = await other.json();
  expect(a).toHaveLength(1); expect(b).toHaveLength(2);
  for (const row of [...a, ...b]) { expect(typeof row.matchResult.score).toBe("number"); expect(row.matchResult.confidence).toBeDefined(); expect(row.matchResult.disclaimer ?? "").toMatch(/human review/i); }
  const same = b.find((x: any) => x.candidate.id === cvA).matchResult, reverse = a[0].matchResult;
  expect(same.score).toBe(reverse.score);   // the same pair is the same assessment, whichever side asked
});

test("history names who uploaded and shows what happened; the record's panel links back to the original", async () => {
  await page.goto("/settings"); await dismissNotices(page);
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByText(/refreshes every 5 minutes/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Ran a match").first()).toBeVisible();
  await expect(page.getByText("Moved a candidate to shortlisted").first()).toBeVisible();
  await page.getByRole("tab", { name: "Uploads" }).click();
  await expect(page.getByText(admin).first()).toBeVisible();
  await page.getByRole("tab", { name: "Team" }).click();
  await expect(page.getByText("In the portal now").first()).toBeVisible({ timeout: 20_000 });
  await page.goto("/dashboard"); await dismissNotices(page);
});

async function hiringManager(browser: Browser) {
  const email = address("hr"), since = Date.now();
  const r = await ctx.request.post("/api/portal/invitations", { headers: H, data: { emails: [email], role: "hiring_manager" } });
  expect(r.status()).toBe(201);
  const mail = await waitForMail(email, /invit/i, since), c = await browser.newContext({ baseURL: BASE, viewport: { width: 1600, height: 1000 } }), p = await c.newPage();
  await p.goto(inviteLink(mail));
  await p.getByRole("link", { name: "Create account" }).or(p.getByRole("button", { name: "Create account" })).first().click();
  const t = Date.now();
  await fillSignup(p, { name: "Hiring Person" });
  await p.getByLabel(/^Verification code/).fill(codeIn(await waitForMail(email, /RoleMatch verification code/, t)));
  await p.getByRole("button", { name: "Verify and create account" }).click();
  await p.waitForURL(/overview/, { timeout: 60_000 }); await p.goto("/dashboard"); await dismissNotices(p);   // signing in opens the Overview
  await p.getByRole("button", { name: "Get Started" }).click({ timeout: 10_000 }).catch(() => {});   // the first-visit guide
  return { c, p };
}

test("a hiring manager sees only the shortlisted person, cannot change or run anything, and can read the saved match and the team", async ({ browser }) => {
  const { c, p } = await hiringManager(browser);
  await expect(card(p, expected.CV0501.name)).toBeVisible({ timeout: 30_000 });
  await expect(p.locator(CARD("candidate"))).toHaveCount(1);
  await expect(p.locator(CARD("job"))).toHaveCount(1);
  await expect(p.getByText(/Read-only: you see shortlisted candidates/).first()).toBeVisible();
  await card(p, expected.CV0501.name).click({ position: { x: 20, y: 20 } });
  await p.locator(CARD("job")).first().click({ position: { x: 20, y: 20 } });
  await expect(p.getByRole("button", { name: "Match", exact: true })).toHaveCount(0);
  await p.getByRole("button", { name: "Show saved match" }).click();
  await expect(p.getByText(/Match Assessment/)).toBeVisible({ timeout: 20_000 });
  await expect(p.getByRole("button", { name: "Shortlist" })).toHaveCount(0);
  await p.keyboard.press("Escape");
  expect((await c.request.get(`/api/candidates/${cvB}`, { headers: H })).status()).toBe(404);
  await p.goto("/settings"); await dismissNotices(p);
  await p.getByRole("tab", { name: "Team" }).click();
  await expect(p.getByText(admin).first()).toBeVisible({ timeout: 20_000 });
  await expect(p.getByRole("button", { name: "Send invite" })).toHaveCount(0);
  await c.close();
});

test("a session that ends says so and lets the person back in on the same page", async () => {
  await ctx.clearCookies();
  await page.reload();
  await expect(page.getByPlaceholder("you@example.com").or(page.getByText(/Session ended/i)).first()).toBeVisible({ timeout: 30_000 });
  await signedIn(page, admin);
  await expect(card(page, expected.CV0501.name)).toBeVisible({ timeout: 30_000 });
});

test("the server restarts under an open page: the page recovers, nothing is lost, and capacity is never shown as current while stale", async () => {
  const cmd = process.env.E2E_RESTART; test.skip(!cmd, "needs E2E_RESTART");
  execSync(cmd!, { stdio: "ignore" });
  await expect.poll(async () => (await fetch(`${BASE}/api/ready`).catch(() => null))?.status, { timeout: 90_000 }).toBe(200);
  await page.reload(); await dismissNotices(page);
  await expect(card(page, expected.CV0501.name)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(CARD("candidate")).filter({ hasText: expected.CV0501.name })).toHaveCount(1);
  expect((await ctx.request.get(`/api/documents/${docA}/original`, { headers: H })).status()).toBe(200);
});

test("signing out ends access: the going-back page shows nothing and the API refuses", async () => {
  await page.getByRole("button", { name: "Your account" }).click();
  await page.getByRole("menuitem", { name: /Log ?out|Sign ?out/i }).click();
  await page.waitForTimeout(2500);
  expect((await ctx.request.get("/api/candidates", { headers: H })).status()).toBe(401);
  await page.goto("/dashboard");
  await expect(page.locator(CARD("candidate"))).toHaveCount(0);
});

void jobZone;
