import { expect, test, type Locator, type Page } from "@playwright/test";
import { LONG_COMPANY, LONG_JOB, LONG_NAME, LONG_ROLE } from "./global-setup";

const SHOTS = "test-results/screens";
const CARD = { candidate: '[aria-roledescription="selectable candidate card"]', job: '[aria-roledescription="selectable job card"]' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const candidateCards = (page: Page) => page.locator(CARD.candidate);
const jobCards = (page: Page) => page.locator(CARD.job);

async function openBoard(page: Page) {
  await page.goto("/dashboard");
  await expect(candidateCards(page)).toHaveCount(5, { timeout: 20_000 });
  const essentialOnly = page.getByRole("button", { name: "Essential Only" });
  if (await essentialOnly.isVisible().catch(() => false)) await essentialOnly.click(); // the cookie notice is a real, fixed element at the bottom of the screen
  await expect(jobCards(page)).toHaveCount(5);
  // the guided tour is only for new accounts; a returning user does not get it, and neither does the test
  await expect(page.getByText("Getting Started with")).toHaveCount(0);
}
const heightOf = async (l: Locator) => Math.round((await l.boundingBox())!.height);
/** True when the element shows all of its text (nothing is cut off by a line limit or an ellipsis). */
// (a clamped paragraph reports a taller scrollHeight than clientHeight when any line is hidden)
const fullyShown = (l: Locator) => l.evaluate((el) => el.scrollHeight <= el.clientHeight + 1);
const lineCount = (l: Locator) => l.evaluate((el) => Math.round(el.clientHeight / parseFloat(getComputedStyle(el).lineHeight)));
const cardFor = (page: Page, kind: "candidate" | "job", text: string) => page.locator(CARD[kind]).filter({ hasText: text }).first();
/** Drags one card onto another or onto the Shortlist Matching Zone. Playwright's own dragTo presses on the card, scrolls the target into view, and only
 * then moves: the browser starts a drag at that first move, from whatever is under the pointer after the scroll. So when the target was off screen the
 * drag picked up another card or nothing at all, and the board tests failed by turns on which run needed a scroll (found 20 Nov 2026). Here the drag
 * starts on the card before anything scrolls. */
async function dragOnto(page: Page, source: Locator, target: Locator) {
  await source.hover();
  const from = (await source.boundingBox())!;
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 2 });
  await target.scrollIntoViewIfNeeded();
  const to = (await target.boundingBox())!;
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 2 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => { await openBoard(page); });

test("candidate and job cards show full names, occupations, titles and companies, in at most two lines", async ({ page }, info) => {
  const c = cardFor(page, "candidate", "Westhuizen");
  const name = c.getByText(LONG_NAME, { exact: true }), role = c.getByText(LONG_ROLE, { exact: true });
  await expect(name).toBeVisible(); await expect(role).toBeVisible();
  expect(await fullyShown(name)).toBe(true); expect(await fullyShown(role)).toBe(true);
  expect(await lineCount(name)).toBeLessThanOrEqual(2); expect(await lineCount(role)).toBeLessThanOrEqual(2);
  const j = cardFor(page, "job", "Platform Reliability");
  const title = j.getByText(LONG_JOB, { exact: true }), company = j.getByText(LONG_COMPANY, { exact: true });
  await expect(title).toBeVisible(); await expect(company).toBeVisible();
  expect(await fullyShown(title)).toBe(true); expect(await fullyShown(company)).toBe(true);
  expect(await lineCount(title)).toBeLessThanOrEqual(2); expect(await lineCount(company)).toBeLessThanOrEqual(2);
  // every short name is shown whole too
  for (const n of ["Thandi Mokoena", "Ruan van der Merwe", "Michael Chen", "Zanele Khumalo"]) expect(await fullyShown(candidateCards(page).getByText(n, { exact: true }))).toBe(true);
  if (info.project.name === "desktop") { await page.locator(CARD.candidate).first().scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOTS}/1-cards-full-names.png` }); }
});

test("every candidate card has the same height, and every job card has the same height; nothing spills out of a card", async ({ page }) => {
  const ch = await Promise.all((await candidateCards(page).all()).map(heightOf));
  const jh = await Promise.all((await jobCards(page).all()).map(heightOf));
  expect(new Set(ch).size).toBe(1);
  expect(new Set(jh).size).toBe(1);
  for (const card of [...(await candidateCards(page).all()), ...(await jobCards(page).all())]) {
    expect(await card.evaluate((el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  }
});

test("a card shows three skills and an exact 'View X more'; the full list opens without resizing the card or losing the selection", async ({ page }, info) => {
  const apiCandidates: any = await (await page.request.get("/api/candidates?limit=100")).json();
  const thandi = apiCandidates.items.find((c: any) => c.name === "Thandi Mokoena");
  const total = new Set<string>(thandi.skills).size;
  expect(total).toBeGreaterThan(3);
  const card = cardFor(page, "candidate", "Thandi Mokoena");
  await card.click({ position: { x: 20, y: 20 } }); // select it
  await expect(card).toHaveAttribute("aria-label", /selected/);
  await expect(card.getByTestId("skill-chip")).toHaveCount(3);
  const more = card.getByRole("button", { name: new RegExp(`View ${total - 3} more skills`) });
  await expect(more).toHaveText(`View ${total - 3} more`);
  const before = await heightOf(card);
  await more.click();
  const panel = page.locator(".chakra-popover__content").filter({ hasText: `All ${total} skills` });
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("all-skill-chip")).toHaveCount(total); // every extracted skill is available
  await sleep(500); // let the panel finish opening before the picture
  if (info.project.name === "desktop") await page.screenshot({ path: `${SHOTS}/2-view-more-skills.png` });
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(more).toBeFocused(); // focus comes back to where the recruiter was
  expect(await heightOf(card)).toBe(before);
  await expect(card).toHaveAttribute("aria-label", /selected/); // still selected after opening and closing the list
  // the same for a job card
  const apiJobs: any = await (await page.request.get("/api/jobs?limit=100")).json();
  const job = apiJobs.items.find((j: any) => /Platform Reliability/.test(j.title));
  const jtotal = new Set<string>(job.skills).size;
  const jcard = cardFor(page, "job", "Platform Reliability");
  await expect(jcard.getByTestId("skill-chip")).toHaveCount(Math.min(3, jtotal));
  if (jtotal > 3) {
    await expect(jcard.getByRole("button", { name: new RegExp(`View ${jtotal - 3} more`) })).toBeVisible();
    await jcard.getByRole("button", { name: new RegExp(`View ${jtotal - 3} more`) }).click();
    await expect(page.locator(".chakra-popover__content").filter({ hasText: `All ${jtotal} skills` }).getByTestId("all-skill-chip")).toHaveCount(jtotal);
  }
});

test("the candidate panel scrolls as one document: its heading and buttons are not pinned", async ({ page }, info) => {
  await cardFor(page, "candidate", "Westhuizen").click({ position: { x: 20, y: 20 } });
  const heading = page.getByRole("heading", { name: "Candidate Resume" });
  await expect(heading).toBeVisible();
  const header = heading.locator("xpath=ancestor::div[1]/..");
  await page.getByTestId("tab-experience").click();   // the long CV's work history: the panel has tabs since 10 Nov 2026
  expect(await header.evaluate((el) => getComputedStyle(el).position)).not.toBe("sticky");
  const scroller = await heading.evaluateHandle((el) => { let n: HTMLElement | null = el; while (n && !(getComputedStyle(n).overflowY === "auto" && n.scrollHeight > n.clientHeight)) n = n.parentElement; return n!; });
  const scrollable = await scroller.evaluate((el: HTMLElement) => el.scrollHeight - el.clientHeight);
  expect(scrollable).toBeGreaterThan(300); // the long CV really does overflow the panel
  await scroller.evaluate((el: HTMLElement) => { el.scrollTop = el.scrollHeight; });
  await sleep(250);
  // after scrolling to the bottom, the heading has scrolled out of the panel's view
  const gone = await heading.evaluate((h, s) => h.getBoundingClientRect().bottom <= (s as HTMLElement).getBoundingClientRect().top + 1, scroller);
  expect(gone).toBe(true);
  await expect(page.getByRole("link", { name: /View Original CV/i }).or(page.getByText("View Original CV"))).toBeVisible();
  if (info.project.name === "desktop") await page.screenshot({ path: `${SHOTS}/3-panel-scrolled-no-sticky-header.png` });
});

async function sampleProgress(page: Page, until: () => Promise<boolean>) {
  const seen: number[] = [];
  const number = page.getByTestId("match-progress-number");
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await number.count()) { const t = (await number.first().textContent({ timeout: 500 }).catch(() => null)) ?? ""; const m = t.match(/(\d+)%/); if (m) seen.push(Number(m[1])); }
    if (await until()) break;
    await sleep(40);
  }
  return seen;
}
/**
 * Records every number the progress ring shows, from INSIDE the page, on the page's own clock. Reading the number from the test runner
 * (poll, round trip, repeat) is not reliable on a busy machine: a read that times out is not a reading of zero, and gaps between reads look
 * like jumps. Here the page itself notes each change as it is drawn, plus the moment the server's answer arrived.
 */
async function watchProgress(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__progress = { shown: [] as { t: number; v: number }[], replied: null as number | null };
    const nativeFetch = w.fetch.bind(w);
    w.fetch = async (input: any, init?: any) => {
      const res = await nativeFetch(input, init);
      const url = typeof input === "string" ? input : input.url, method = init?.method ?? input?.method ?? "GET";
      if (method === "POST" && /\/api\/matches$/.test(url) && w.__progress.replied === null) w.__progress.replied = performance.now();
      return res;
    };
    const note = () => {
      const el = document.querySelector('[data-testid="match-progress-number"]');
      const m = el?.textContent?.match(/^(\d+)%$/);
      if (!m) return;
      const last = w.__progress.shown[w.__progress.shown.length - 1];
      if (!last || last.v !== Number(m[1])) w.__progress.shown.push({ t: performance.now(), v: Number(m[1]) });
    };
    new MutationObserver(note).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
}
const progressLog = (page: Page) => page.evaluate(() => (window as any).__progress as { shown: { t: number; v: number }[]; replied: number | null });
const slowMatches = async (page: Page, ms = 450) => page.route("**/api/matches", async (route) => { await sleep(ms); await route.continue(); });
const resultsModal = (page: Page) => page.locator("[role=dialog][aria-modal=true]");
/** Since 11 Nov 2026 a drag (or M) first asks who to match (MatchChooser): nothing is matched until a button there is pressed. These tests match them all. */
async function matchAll(page: Page) {
  const chooser = page.getByTestId("match-chooser");
  await expect(chooser).toBeVisible();
  await chooser.getByRole("button", { name: /^Match all \(\d+\)$/ }).click();
}

test("dragging a candidate into the Shortlist Matching Zone shows 'Finding role matches', counts up honestly, and ends with a list of roles", async ({ page }, info) => {
  await slowMatches(page);
  const card = cardFor(page, "candidate", "Thandi Mokoena");
  const posts: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && /\/api\/matches$/.test(r.url())) posts.push(r.postData() ?? ""); });
  await dragOnto(page, card, page.getByText("Shortlist Matching Zone"));
  await matchAll(page);
  const dialog = page.getByRole("dialog", { name: "Finding role matches" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Finding suitable roles for Thandi Mokoena");
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", /\d+/);
  const seen = await sampleProgress(page, async () => (await dialog.count()) === 0);
  if (info.project.name === "desktop") {
    // (screenshot taken on a second run below, while the overlay is still up)
  }
  expect(seen.length).toBeGreaterThan(4);
  expect(seen[0]).toBeLessThanOrEqual(10);                                  // starts at the beginning
  for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]); // never goes backwards
  expect(Math.max(...seen.slice(0, -1))).toBeLessThan(100 + 1);
  expect(seen[seen.length - 1]).toBe(100);                                  // and ends at 100
  expect(posts.length).toBe(5);                                             // one real comparison per role, and only those
  expect(posts.every((p) => p.includes('"candidateId"') && p.includes('"jobId"'))).toBe(true);
  await expect(resultsModal(page)).toBeVisible();   // the list of potential roles
  await expect(resultsModal(page)).toContainText(/Matching This (Job|Candidate)/);
});

test("dragging a role into the Shortlist Matching Zone shows 'Finding candidate matches' and ends with a list of candidates", async ({ page }, info) => {
  await slowMatches(page);
  const jobCard = cardFor(page, "job", "Senior Software Developer");
  if (info.project.name === "narrow") { await jobCard.focus(); await page.keyboard.press("m"); } // single column: the zone is far away, so the keyboard alternative is used
  else await dragOnto(page, jobCard, page.getByText("Shortlist Matching Zone"));
  await matchAll(page);
  const dialog = page.getByRole("dialog", { name: "Finding candidate matches" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Finding suitable candidates for Senior Software Developer");
  await expect(dialog.getByTestId("match-progress-stage")).toContainText(/Reading the role requirements|Loading available candidates|Comparing/);
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(resultsModal(page)).toBeVisible();
  await expect(resultsModal(page)).toContainText(/Matching This (Job|Candidate)/);
});

test("a candidate and a job are never matched until the green Match button is pressed", async ({ page }, info) => {
  const posts: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && /\/api\/matches/.test(r.url())) posts.push(r.url()); });
  await expect(page.getByRole("button", { name: "Match", exact: true })).toHaveCount(0); // nothing selected: no Match button
  await cardFor(page, "candidate", "Thandi Mokoena").click({ position: { x: 20, y: 20 } });
  await expect(page.getByRole("button", { name: "Match", exact: true })).toHaveCount(0); // only one slot filled
  await cardFor(page, "job", "Senior Software Developer").click({ position: { x: 20, y: 20 } });
  const match = page.getByRole("button", { name: "Match", exact: true });
  await expect(match).toBeVisible();                                                     // both filled: the button appears
  await sleep(1200);
  expect(posts.length).toBe(0);                                                          // and nothing has been calculated by itself
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // dropping a candidate onto a job card only fills the slots too
  await dragOnto(page, cardFor(page, "candidate", "Michael Chen"), cardFor(page, "job", "Data Analyst"));
  await sleep(800);
  expect(posts.length).toBe(0);

  await slowMatches(page, 700);
  await match.click();
  const dialog = page.getByRole("dialog", { name: "Assessing role alignment" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Matching Michael Chen with Data Analyst");   // the pair the drop put in the slots, not the two clicked before it
  expect(await page.getByRole("progressbar").getAttribute("aria-label")).toBe("Assessing role alignment");
  await expect(dialog.getByTestId("match-progress-number")).toHaveText(/^\d+%$/);
  // a second press cannot start a second request while the first is running
  const seen = await sampleProgress(page, async () => (await dialog.count()) === 0);
  expect(posts.length).toBe(1);
  for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
  expect(seen[seen.length - 1]).toBe(100);
  await expect(page.getByText(/Match Assessment/)).toBeVisible();                          // the assessment opens only now
  if (info.project.name === "desktop") await page.screenshot({ path: `${SHOTS}/7-assessment.png` });
});

test("progress reaches 100% only when the results are ready", async ({ page }) => {
  await page.route("**/api/matches", async (route) => { await sleep(2500); await route.continue(); });   // the server is slow on purpose
  await cardFor(page, "candidate", "Michael Chen").click({ position: { x: 20, y: 20 } });
  await cardFor(page, "job", "Data Analyst").click({ position: { x: 20, y: 20 } });
  await watchProgress(page);
  await page.getByRole("button", { name: "Match", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Assessing role alignment" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeHidden({ timeout: 40_000 });                                  // it closes by itself once the ticker has really reached the end
  const { shown, replied } = await progressLog(page);
  expect(replied).not.toBeNull();
  const waiting = shown.filter((x) => x.t < replied!), after = shown.filter((x) => x.t >= replied!);
  expect(waiting.length).toBeGreaterThan(10);
  expect(Math.max(...waiting.map((x) => x.v))).toBeLessThan(100);                      // never 100 while the server has not answered
  expect(shown[0].v).toBeLessThan(20);                                                   // and it starts at the beginning
  expect(after.at(-1)?.v).toBe(100);                                                     // 100 appears only once the answer is in
  await expect(page.getByText(/Match Assessment/)).toBeVisible();
});

test("the percentage ticks up gradually even when the server is fast, and never runs ahead of the real work", async ({ page }, info) => {
  // no artificial delay: the match itself finishes in a fraction of a second
  await cardFor(page, "candidate", "Michael Chen").click({ position: { x: 20, y: 20 } });
  await cardFor(page, "job", "Data Analyst").click({ position: { x: 20, y: 20 } });
  await watchProgress(page);
  await page.getByRole("button", { name: "Match", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Assessing role alignment" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeHidden({ timeout: 40_000 });
  const { shown, replied } = await progressLog(page);
  const values = shown.map((x) => x.v);
  expect(values.length).toBeGreaterThanOrEqual(25);                                      // it passes through many numbers, not a couple of jumps
  for (let i = 1; i < values.length; i++) {
    expect(values[i], `step ${i}: ${values.slice(Math.max(0, i - 3), i + 1)}`).toBeGreaterThan(values[i - 1]);   // every change is upwards: never backwards
    expect(values[i] - values[i - 1]).toBeLessThanOrEqual(8);                            // and never a sudden leap
  }
  expect(values.at(-1)).toBe(100);
  expect(shown.at(-1)!.t - shown[0].t).toBeGreaterThan(2500);                            // a fast answer still ticks up over several seconds
  expect(replied).not.toBeNull();
  // accuracy: the number never shows more than the work really done, and 100 only appears after the server's answer
  expect(Math.max(0, ...shown.filter((x) => x.t < replied!).map((x) => x.v))).toBeLessThan(100);
  expect(shown.find((x) => x.v === 100)!.t).toBeGreaterThanOrEqual(replied!);
  await expect(page.getByText(/Match Assessment/)).toBeVisible();
});

test("a failure stops the animation, says so plainly, and 'Try again' completes the match", async ({ page }, info) => {
  await cardFor(page, "candidate", "Ruan van der Merwe").click({ position: { x: 20, y: 20 } });
  await cardFor(page, "job", "Data Analyst").click({ position: { x: 20, y: 20 } });
  let failed = false;
  await page.route("**/api/matches", async (route) => { if (!failed) { failed = true; await sleep(300); await route.abort("failed"); } else await route.continue(); });
  await page.getByRole("button", { name: "Match", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Assessing role alignment" });
  await expect(dialog.getByRole("alert")).toContainText("That did not finish", { timeout: 15_000 });
  await expect(dialog.getByRole("alert")).toContainText(/Nothing (was changed|had been sent to the AI)/);
  const stuckAt = await dialog.getByTestId("match-progress-number").textContent();
  expect(stuckAt).not.toBe("100%");                                  // a failed run never claims completion
  await sleep(800);
  expect(await dialog.getByTestId("match-progress-number").textContent()).toBe(stuckAt); // and the number stops moving
  if (info.project.name === "desktop") await page.screenshot({ path: `${SHOTS}/8-error-and-retry.png` });
  await dialog.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText(/Match Assessment/)).toBeVisible({ timeout: 20_000 });
});

test("cards can be used from the keyboard: Enter selects, M finds matches, Tab reaches 'View X more'", async ({ page }) => {
  const card = cardFor(page, "candidate", "Thandi Mokoena");
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(card).toHaveAttribute("aria-label", /selected/);
  await slowMatches(page, 200);
  await page.keyboard.press("m");
  await matchAll(page);
  await expect(page.getByRole("dialog", { name: "Finding role matches" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Finding role matches" })).toBeHidden({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  // focus returns somewhere sensible and the selection is still there
  await expect(card).toHaveAttribute("aria-label", /selected/);
});

test("screenshots of the loading experiences (desktop only)", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "screenshots are taken once, at the desktop size");
  await slowMatches(page, 2500);
  // candidate -> zone
  await dragOnto(page, cardFor(page, "candidate", "Thandi Mokoena"), page.getByText("Shortlist Matching Zone"));
  await matchAll(page);
  await expect(page.getByRole("dialog", { name: "Finding role matches" })).toBeVisible();
  await sleep(2500);
  await page.screenshot({ path: `${SHOTS}/4-candidate-shortlist-loading.png` });
  await expect(page.getByRole("dialog", { name: "Finding role matches" })).toBeHidden({ timeout: 60_000 });
  await page.keyboard.press("Escape");
  await openBoard(page);
  // job -> zone
  await dragOnto(page, cardFor(page, "job", "Senior Software Developer"), page.getByText("Shortlist Matching Zone"));
  await matchAll(page);
  await expect(page.getByRole("dialog", { name: "Finding candidate matches" })).toBeVisible();
  await sleep(2500);
  await page.screenshot({ path: `${SHOTS}/5-job-shortlist-loading.png` });
  await expect(page.getByRole("dialog", { name: "Finding candidate matches" })).toBeHidden({ timeout: 60_000 });
  await page.keyboard.press("Escape");
  await openBoard(page);
  // pairwise
  await cardFor(page, "candidate", "Thandi Mokoena").click({ position: { x: 20, y: 20 } });
  await cardFor(page, "job", "Senior Software Developer").click({ position: { x: 20, y: 20 } });
  await page.getByRole("button", { name: "Match", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Assessing role alignment" })).toBeVisible();
  await sleep(2200);
  await page.screenshot({ path: `${SHOTS}/6-pairwise-loading.png` });
});

// Owner, 17 Nov 2026: "They should be a way to be able to see what they were shortlisted for. Not only on the job."
test("a shortlisted candidate's card names the job, fits the card, and opens that pair's saved match", async ({ page }, info) => {
  const cands: any = await (await page.request.get("/api/candidates?limit=100")).json(), jobs: any = await (await page.request.get("/api/jobs?limit=100")).json();
  const who = cands.items.find((c: any) => c.name === "Michael Chen"), job = (jobs.items ?? jobs).find((j: any) => j.title === "Senior Software Developer");
  const put = (status: string | null) => page.request.put("/api/applications", { headers: { "x-client-contract": "1", "content-type": "application/json" }, data: { candidateId: who.id, jobId: job.id, status } });
  expect((await put("shortlisted")).ok()).toBe(true);
  try {
    await openBoard(page);
    const card = cardFor(page, "candidate", "Michael Chen"), line = card.getByTestId("card-stage-job");
    await expect(line).toContainText(/for Senior Software Developer/i);
    expect(await card.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    const heights = await Promise.all((await candidateCards(page).all()).map(heightOf));
    expect(new Set(heights).size).toBe(1);
    if (info.project.name === "desktop") await card.screenshot({ path: `${SHOTS}/9-card-shortlisted-for.png` });
    const asked = page.waitForRequest((r) => r.url().includes(`/api/matches?candidateId=${who.id}&jobId=${job.id}`));
    await line.click();
    await asked;
  } finally {
    await put(null);
  }
});
