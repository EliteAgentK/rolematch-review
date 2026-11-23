// Every candidate panel and job panel has the same sections in the same order, whatever the document was: clean, agency, incomplete, long, or read from a scan. Nothing clips, and a section with nothing to show says so. Invented documents, disposable stack only.
import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { address, BASE, CARD, createAdmin, dismissNotices, fixture, openTab, panelSections, panelTabs, published, RUN, signedIn } from "./kit";

const admin = address("panels"), H = { origin: BASE }, CANDIDATE = ["summary", "notes", "work", "projects", "education", "skills"], CANDIDATE_TABS = ["overview", "experience", "education", "skills", "notes"], JOB_TABS = ["overview", "requirements", "responsibilities", "skills", "more"];
test.describe.configure({ mode: "serial" });
let ctx: BrowserContext, page: Page;
const up = async (name: string, buffer: Buffer, kind = "cv", type = "text/plain") => (await (await ctx.request.post("/api/documents", { headers: H, multipart: { kind, file: { name, mimeType: type, buffer } } })).json()).id as string;
const BODY = (n: number) => Array.from({ length: n }, (_, i) => `Senior Engineer ${i} | Elmstead Advisory ${i} | January ${2000 + i} - December ${2000 + i}\n- Prepared a very long monthly statement ${"with a great many words about the work ".repeat(6)}for the board.`).join("\n");
// The panel has tabs (10 Nov 2026): its shape is the same tabs in the same order, and the same sections under them, each tab opened in turn.
const sections = async (p: Page) => { expect(await panelTabs(p, "candidate")).toEqual(CANDIDATE_TABS); return panelSections(p, "candidate"); };
async function openCandidate(name: string) { await page.goto("/dashboard"); await dismissNotices(page); await page.locator(CARD("candidate")).filter({ hasText: name }).first().click(); await expect(page.getByTestId("candidate-tabs")).toBeVisible({ timeout: 30_000 }); }
const clippedHere = () => page.evaluate(() => { const bad: string[] = []; for (const el of document.querySelectorAll('[data-testid^="section-"], [data-testid^="tab-panel-"]')) { const e = el as HTMLElement; if (e.scrollWidth > e.clientWidth + 1) bad.push(e.dataset.testid!); } return { bad, page: document.documentElement.scrollWidth > window.innerWidth + 1 }; });
/** Nothing clips on any tab: each tab is opened in turn and checked. */
const noClipping = async () => { const out = { bad: [] as string[], page: false }; for (const tab of await panelTabs(page, "candidate")) { await openTab(page, "candidate", tab); const c = await clippedHere(); out.bad.push(...c.bad); out.page ||= c.page; } return out; };

test.beforeAll(async ({ browser }) => {
  createAdmin(`Panels ${RUN}`, admin, "Panels Admin");
  ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1400, height: 900 } }); page = await ctx.newPage(); await signedIn(page, admin);
  const docs = [
    await up("CV0501.docx", readFileSync(fixture("CV0501.docx")), "cv", "application/octet-stream"),
    await up("thin.txt", Buffer.from("Zanele Thin\nzanele.thin@example.test\nExperience\nClerk | Elmstead | 2020 - 2021\nI have worked in several offices across the city and handled post and filing for each of them, and I am keen to do more of the same kind of work in a new place soon, ideally close to home and with a friendly team.")),
    await up("long.txt", Buffer.from(`Peter Longman\npeter.longman@example.test\nSkills\n${Array.from({ length: 60 }, (_, i) => `Skill${i}`).join(", ")}\nExperience\n${BODY(14)}\nEducation\nBCom Accounting, University of Pretoria, 1999`)),
    await up("agency.txt", Buffer.from(`Candidate Name: Aisha Agency\nTo arrange a meeting with this candidate or to request further information please contact:\nConsultants Name | Peter Smith\nConsultants Number | 082 555 0100\nConsultants Email | peter.smith@brightstaff.example\nBrightStaff Recruitment\nEducation\nBSc Statistics, University of Cape Town, 2015\nEmployment History\nData Analyst\nNorthwind Traders\nMarch 2018 - Present\n- Built reports for the finance team every month for several years and maintained them.`)),
  ];
  for (const id of docs) await published(ctx.request, id);
});
test.afterAll(async () => { await ctx?.close(); });

for (const [label, name] of [["a clean CV", "Madonsela"], ["a thin CV", "Zanele Thin"], ["a very long CV", "Peter Longman"], ["an agency CV", "Aisha Agency"]] as const) {
  test(`${label}: the same sections, in the same order, nothing clipped`, async () => {
    await openCandidate(name);
    expect(await sections(page)).toEqual(CANDIDATE);
    const c = await noClipping(); expect(c.bad, "sections overflowing").toEqual([]); expect(c.page, "page overflowing").toBe(false);
  });
}
test("a section with nothing in it says so, in words, rather than vanishing", async () => {
  await openCandidate("Zanele Thin");
  await openTab(page, "candidate", "experience"); await expect(page.getByTestId("section-projects-empty")).toBeVisible();
  await openTab(page, "candidate", "education"); await expect(page.getByTestId("section-education-empty")).toBeVisible();
});
test("a long list stays folded until asked, and opening it keeps the shape", async () => {
  await openCandidate("Peter Longman");
  await openTab(page, "candidate", "skills");
  const before = await page.getByTestId("panel-skill").count();
  await page.getByTestId("section-skills").getByRole("button", { name: /^View \d+ more/ }).click();
  expect(await page.getByTestId("panel-skill").count()).toBeGreaterThan(before);
  expect(await sections(page)).toEqual(CANDIDATE);
  expect((await noClipping()).bad).toEqual([]);
});
test("agency details sit in their own place and do not move the sections", async () => {
  await openCandidate("Aisha Agency");
  await openTab(page, "candidate", "overview");
  await expect(page.getByTestId("agency-details")).toContainText(/BrightStaff/i);
  expect(await sections(page)).toEqual(CANDIDATE);
});
test("at phone width the panel still holds its sections and does not overflow", async () => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openCandidate("Peter Longman");
  expect(await sections(page)).toEqual(CANDIDATE);
  expect((await noClipping()).page).toBe(false);
  await page.setViewportSize({ width: 1400, height: 900 });
});
test("the tabs stay in reach while a long panel scrolls, changing tab is instant, and the upload date shows", async () => {
  // Owner, 10 Nov 2026: deep in a CV's Experience there were no tabs in sight ("where's the tab option"), and "the change in everything should be instant".
  await openCandidate("Peter Longman");
  await openTab(page, "candidate", "experience");
  await page.getByTestId("tab-panel-experience").evaluate((el) => { let p: HTMLElement | null = el as HTMLElement; while (p && !/auto|scroll/.test(getComputedStyle(p).overflowY)) p = p.parentElement; p?.scrollBy(0, 1500); });
  await expect(page.getByTestId("candidate-tabs").getByTestId("tab-bar")).toBeInViewport();
  await expect(page.getByTestId("tab-bar-title")).toHaveText(/Peter Longman/);
  // Every tab is already drawn, so a click only shows it: measured in the page, from the click to the tab being on screen.
  const ms = await page.evaluate(async () => { const t = performance.now(); (document.querySelector('[data-testid="tab-skills"]') as HTMLElement).click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return (document.querySelector('[data-testid="tab-panel-skills"]') as HTMLElement)?.offsetParent ? performance.now() - t : 9999; });
  expect(ms, "changing tab").toBeLessThan(100);
  await expect(page.getByTestId("uploaded-on")).toHaveText(/^Uploaded \d{1,2} \p{L}{3}/u);
  expect(await page.getByTestId("uploaded-on").getAttribute("title")).toMatch(/^Uploaded \d{1,2} \p{L}+ \d{4} at \d{2}:\d{2}/u);
});
test("another candidate opens as a clean panel: at its very top, on its Overview, wherever the last one was scrolled to", async () => {
  // Owner, 11 Nov 2026: "when I click a candidate, no matter where I was with the last one, it should open at the very top to the overview ... it's a
  // clean new panel"; "when it opens, it needs to be at the very beginning".
  await openCandidate("Peter Longman");
  await openTab(page, "candidate", "experience");
  // The panel's own scrolling area: the nearest box above the tabs that scrolls.
  await page.getByTestId("tab-panel-experience").evaluate((el) => { let p: HTMLElement | null = el as HTMLElement; while (p && !/auto|scroll/.test(getComputedStyle(p).overflowY)) p = p.parentElement; p?.scrollBy(0, 1500); });
  await page.locator(CARD("candidate")).filter({ hasText: "Zanele Thin" }).first().click();
  await expect(page.getByTestId("candidate-tabs")).toContainText("Overview");
  await expect(page.getByTestId("tab-overview")).toHaveAttribute("aria-selected", "true");
  expect(await page.getByTestId("candidate-tabs").evaluate((el) => { let p: HTMLElement | null = el as HTMLElement; while (p && !/auto|scroll/.test(getComputedStyle(p).overflowY)) p = p.parentElement; return p?.scrollTop ?? 0; }), "the new panel's scroll").toBe(0);
});
test("every job panel has the same tabs in the same order", async () => {
  const thin = await up("JDthin.txt", Buffer.from("Filing Clerk\nElmstead Advisory\nRequirements\n- Experience with filing and post for a busy office in the city centre.\nWe need someone reliable who can start soon and who has done this kind of work for several years already, and who enjoys it."), "jd");
  const full = await up("JD0151.docx", readFileSync(fixture("JD0151.docx")), "jd", "application/octet-stream");
  for (const id of [thin, full]) await published(ctx.request, id);
  for (const title of ["Filing Clerk", "IT Support Analyst"]) {
    await page.goto("/dashboard"); await dismissNotices(page);
    await page.locator(CARD("job")).filter({ hasText: title }).first().click();
    await expect(page.getByTestId("job-tabs")).toBeVisible({ timeout: 30_000 });
    expect(await panelTabs(page, "job")).toEqual(JOB_TABS);
    await openTab(page, "job", "requirements"); await expect(page.getByTestId("job-requirements")).toBeVisible();
  }
});

// One look for every panel (owner, 11 Nov 2026: "same font, same sizes, same bullet points, same kind of header, same everything"): a CV panel and a job
// panel are measured in the browser, at a desktop and at a phone's width, and their section headings, bullets and skill chips must be drawn alike.
test("a CV panel and a job panel draw names, the line under them, headings, section boxes, bullets, chips and footers exactly alike, wide and narrow", async () => {
  const look = (sel: string) => page.locator(sel).first().evaluate((el) => { const c = getComputedStyle(el as HTMLElement); return { size: c.fontSize, weight: c.fontWeight, line: c.lineHeight, colour: c.color, family: c.fontFamily }; });
  const box = (sel: string) => page.locator(sel).first().evaluate((el) => { const c = getComputedStyle(el as HTMLElement); return { bg: c.backgroundColor, padding: c.padding, radius: c.borderRadius }; });
  const marker = (sel: string) => page.locator(sel).first().evaluate((el) => { const c = getComputedStyle(el as HTMLElement, "::before"); return { w: c.width, h: c.height, bg: c.backgroundColor, radius: c.borderRadius }; });
  for (const width of [1400, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await openCandidate("Peter Longman");   // a CV with roles, duties under them, and skills
    const cvTitle = await look('[data-testid="panel-title"]'), cvFooter = await look('[data-testid="uploaded-on"]');
    const cvSub = (await page.locator('[data-testid="panel-subtitle"]').count()) ? await look('[data-testid="panel-subtitle"]') : null;
    await openTab(page, "candidate", "experience");
    const cvHeading = await look('[data-testid="section-work"] h3'), cvBullet = await look('[data-testid="work-entry"] li'), cvMarker = await marker('[data-testid="work-entry"] li');
    const cvBox = await box('[data-testid="section-work"] > div');
    await openTab(page, "candidate", "skills");
    const cvChip = await look('[data-testid="panel-skill"]');
    await openCandidate("Zanele Thin"); await openTab(page, "candidate", "experience");
    const cvEmpty = await look('[data-testid="section-projects-empty"]');
    await page.goto("/dashboard"); await dismissNotices(page);
    await page.locator(CARD("job")).filter({ hasText: "IT Support Analyst" }).first().click();
    await expect(page.getByTestId("job-tabs")).toBeVisible({ timeout: 30_000 });
    const jobTitle = await look('[data-testid="panel-title"]'), jobFooter = await look('[data-testid="uploaded-on"]');
    const jobSub = (await page.locator('[data-testid="panel-subtitle"]').count()) ? await look('[data-testid="panel-subtitle"]') : null;
    await openTab(page, "job", "requirements");
    const jobHeading = await look('[data-testid="section-requirements"] h3'), jobBullet = await look('[data-testid="job-requirements"] li'), jobMarker = await marker('[data-testid="job-requirements"] li');
    const jobBox = await box('[data-testid="section-requirements"] > div');
    await openTab(page, "job", "skills");
    // A job the stand-in read with no skills has no chip to measure: then the words that say a section is empty are compared instead.
    const hasChip = (await page.locator('[data-testid="job-skill"]').count()) > 0;
    const jobChip = await look(hasChip ? '[data-testid="job-skill"]' : '[data-testid="section-skills-empty"]');
    expect(jobTitle, `record name at ${width}px`).toEqual(cvTitle);
    if (jobSub && cvSub) expect(jobSub, `line under the name at ${width}px`).toEqual(cvSub);   // a record with nothing to say under its name has no such line
    expect(jobFooter, `footer at ${width}px`).toEqual(cvFooter);
    expect(jobBox, `section box at ${width}px`).toEqual(cvBox);
    expect(jobHeading, `section heading at ${width}px`).toEqual(cvHeading);
    expect(jobBullet, `bullet text at ${width}px`).toEqual(cvBullet);
    expect(jobMarker, `bullet marker at ${width}px`).toEqual(cvMarker);
    expect(jobChip, `${hasChip ? "skill chip" : "empty section wording"} at ${width}px`).toEqual(hasChip ? cvChip : cvEmpty);
  }
  await page.setViewportSize({ width: 1400, height: 900 });
});

