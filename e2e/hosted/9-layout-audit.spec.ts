// The layout audit (owner, 10 Nov 2026: "never wanna deal with issues I bring up to you again"). Every fault of these kinds the owner found by eye is a
// check here, at the widths people use, in dark and light, with a long organisation name: parts that should match do (the two upload boxes, the four
// board columns), wording neither wraps nor is cut off where it must not be, the initials sit in the middle of their circles, every block shows its
// number, nothing on the Overview is clipped, and nothing scrolls sideways. A failure here stops the release. Invented documents, the stand-in Claude.
import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { address, BASE, createAdmin, dismissNotices, fixture, published, RUN, signIn } from "./kit";

const admin = address("layout"), H = { origin: BASE };
const LONG_ORG = `Organisation With A Very Long Registered Company Name ${RUN} (Pty) Ltd`;
const SIZES = [[1280, 800], [1536, 864], [1920, 1080]] as const, MODES = ["dark", "light"] as const;
test.describe.configure({ mode: "serial" });
let ctx: BrowserContext, page: Page;

test.beforeAll(async ({ browser }) => {
  createAdmin(LONG_ORG, admin, "Layout Admin");
  ctx = await browser.newContext({ baseURL: BASE }); page = await ctx.newPage();
  await signIn(page, admin); await page.waitForURL(/overview/, { timeout: 60_000 });
  const up = async (name: string, kind: "cv" | "jd", buffer: Buffer, type = "application/octet-stream") => (await (await ctx.request.post("/api/documents", { headers: H, multipart: { kind, file: { name, mimeType: type, buffer } } })).json()).id as string;
  await published(ctx.request, await up("CV0501.docx", "cv", readFileSync(fixture("CV0501.docx"))));
  await published(ctx.request, await up("job.txt", "jd", Buffer.from("Senior Strategic Procurement Manager\nCompany: Umber Grove Industrial Group\nLocation: Pretoria\nRequirements\n- A degree and eight years of category management.\nResponsibilities\n- Lead strategic sourcing across raw materials and packaging.\n"), "text/plain"));
});
test.afterAll(async () => { await ctx?.close(); });

const setMode = async (mode: "dark" | "light") => { await page.evaluate((m) => localStorage.setItem("chakra-ui-color-mode", m), mode); await page.reload(); await dismissNotices(page); };

/** What is wrong with the page as it is drawn, in words: an empty list means nothing is. */
const problems = (where: "board" | "overview") => page.evaluate((where) => {
  const bad: string[] = [], r = (e: Element) => e.getBoundingClientRect();
  if (document.documentElement.scrollWidth > window.innerWidth + 1) bad.push("the page scrolls sideways");
  const header = document.querySelector("header"); if (header && r(header).height > 96) bad.push(`the header is ${Math.round(r(header).height)} px tall (wrapped)`);
  const views = document.querySelector('[aria-label="Views"]'); if (views && window.innerWidth >= 768) { const c = r(views).left + r(views).width / 2; if (Math.abs(c - window.innerWidth / 2) > 2) bad.push("the view switch is not centred"); }
  for (const av of document.querySelectorAll("span.av, .ov .av")) {   // initials in the middle of their circle
    const box = r(av), range = document.createRange(); range.selectNodeContents(av); const t = range.getBoundingClientRect();
    if (t.width && (Math.abs(box.left + box.width / 2 - (t.left + t.width / 2)) > 2 || Math.abs(box.top + box.height / 2 - (t.top + t.height / 2)) > 3)) { bad.push(`initials off centre: ${av.textContent}`); break; }
  }
  if (where === "board") {
    const zones = [...document.querySelectorAll("[aria-disabled]")].filter((e) => /^Upload /.test(e.querySelector("p")?.textContent ?? ""));
    if (zones.length !== 2) bad.push(`expected the two upload boxes, found ${zones.length}`);   // never a pass by finding nothing
    if (zones.length === 2 && Math.abs(r(zones[0]).height - r(zones[1]).height) > 1) bad.push(`upload boxes differ: ${zones.map((z) => Math.round(r(z).height)).join(" vs ")} px`);
    for (const z of zones) { const p = z.querySelector("p")!; if (p.scrollWidth > p.clientWidth + 1) bad.push(`upload wording cut off: ${p.textContent}`); }
    const grid = [...document.querySelectorAll("div")].find((d) => getComputedStyle(d).gridTemplateColumns.split(" ").length === 4 && d.children.length >= 4);
    if (!grid && window.innerWidth >= 1280) bad.push("the four board columns were not found");
    if (grid) { const tops = [...grid.children].map((c) => Math.round(r(c).bottom)); if (Math.max(...tops) - Math.min(...tops) > 2) bad.push(`board columns end at different heights: ${tops.join(", ")}`); }
    // Each filter says what it filters while it is on All (owner, 10 Nov 2026: "it just says all and all"), and its words fit.
    const filters = [...document.querySelectorAll('[data-testid^="filter-"]')];
    if (filters.length < 5) bad.push(`expected the five list filters, found ${filters.length}`);
    for (const f of filters) { const sel = f.querySelector("select") as HTMLSelectElement | null, shown = f.querySelector("p, span:not(.chakra-select__icon-wrapper)")?.textContent?.trim() ?? "";
      if (sel?.value === "All" && shown !== sel.getAttribute("aria-label")) bad.push(`a filter on All does not say what it is: ${sel?.getAttribute("aria-label")}`); }
  } else {
    if (document.querySelectorAll(".ov .card").length < 9) bad.push("the Overview's blocks were not all drawn");
    for (const c of document.querySelectorAll(".ov .card")) if (c.scrollHeight > c.clientHeight + 2) bad.push(`clipped: ${c.querySelector("h3")?.textContent ?? "a block"}`);
    // A number counts only if it is on screen: a count hidden by a style still has its text (R196, the Needs attention counts).
    const shows = (e: Element | null) => !!e && !!e.textContent?.trim() && r(e).width > 0 && r(e).height > 0 && getComputedStyle(e).visibility !== "hidden" && Number(getComputedStyle(e).opacity) > 0.05;
    for (const k of document.querySelectorAll(".ov .kpi")) if (!shows(k.querySelector(".num"))) bad.push(`a top block shows no number: ${k.textContent?.slice(0, 20)}`);
    for (const a of document.querySelectorAll(".ov .att")) if (!shows(a.querySelector(".count"))) bad.push("a Needs attention item shows no count");
  }
  return bad;
}, where);

for (const mode of MODES) for (const [w, h] of SIZES) {
  test(`board and Overview at ${w} x ${h}, ${mode}: nothing mismatched, cut off, clipped or off centre`, async () => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/dashboard"); await setMode(mode);
    await expect(page.getByText(/^Upload CVs$/)).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);
    expect(await problems("board")).toEqual([]);
    await page.goto("/overview"); await dismissNotices(page);
    for (const view of ["Demo", "Live"]) {
      await page.getByRole("button", { name: view, exact: true }).click();
      await expect(page.locator(".ov .kpi").first()).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(900);   // the blocks rise into place
      expect(await problems("overview"), `${view}`).toEqual([]);
    }
  });
}

// One footer under every page, as on a website (owner and his father, 10 Nov 2026; owner, 11 Nov: "make sure the footer stays consistent and tailor a
// few things that should only be showing up on the landing page"). Exactly one, at the very end of the page, nothing pinned over it, nothing sideways;
// the newsletter and Get Started only on the public pages.
const FOOTER = (on: Page, want: "site" | "app") => on.evaluate((want) => {
  const bad: string[] = [], all = [...document.querySelectorAll('[data-testid="site-footer"]')];
  if (all.length !== 1) return [`expected one footer, found ${all.length}`];
  const f = all[0] as HTMLElement, end = f.getBoundingClientRect().bottom + window.scrollY, text = f.textContent ?? "";
  if (f.dataset.footer !== want) bad.push(`the ${f.dataset.footer} footer where the ${want} one belongs`);
  if (Math.abs(document.documentElement.scrollHeight - end) > 2) bad.push(`the footer ends at ${Math.round(end)} px, the page at ${document.documentElement.scrollHeight}`);
  if (/Get Started/.test(text) !== (want === "site") || /Stay Updated/.test(text) !== (want === "site")) bad.push("the public-page invitations are on the wrong page");
  if (!/All rights reserved/.test(text) || !/Product/.test(text)) bad.push("the footer's common parts are missing");
  if (document.documentElement.scrollWidth > window.innerWidth + 1) bad.push("the page scrolls sideways");
  return bad;
}, want);
for (const [w, h] of [[1280, 800], [390, 844]] as const) {
  test(`one footer under every page at ${w} x ${h}: the full one on the public pages, the tailored one everywhere else`, async ({ browser }) => {
    await page.setViewportSize({ width: w, height: h });
    for (const path of ["/overview", "/dashboard", "/settings", "/profile"]) {
      await page.goto(path); await dismissNotices(page); await page.waitForTimeout(1200);
      expect(await FOOTER(page, "app"), path).toEqual([]);
    }
    const visitor = await browser.newContext({ baseURL: BASE, viewport: { width: w, height: h } }), p = await visitor.newPage();
    try {
      for (const [path, want] of [["/", "site"], ["/features", "site"], ["/pricing", "site"], ["/contact", "site"], ["/login", "app"], ["/signup", "app"]] as const) {
        await p.goto(path); await p.waitForTimeout(900);
        expect(await FOOTER(p, want), path).toEqual([]);
      }
    } finally { await visitor.close(); }
  });
}

// The results of Find matches and a match's details on a phone (owner, 11 Nov 2026, a phone screenshot: "not catered for ... can't even see the
// details"). The five-column table ran off the side of its window, which hides what spills over, so nothing scrolled sideways and the page checks
// above passed. Here every part of every match, and of the assessment it opens, must sit inside its window, at a phone's width and a desktop's.
const INSIDE = (on: Page, sel: string) => on.evaluate((sel) => {
  const box = sel === "the last window" ? [...document.querySelectorAll('[role="dialog"]')].pop() : document.querySelector(sel); if (!box) return [`${sel} was not drawn`];
  const edge = box.getBoundingClientRect(), bad: string[] = [];
  for (const e of box.querySelectorAll("p, span, button, select, h2, h3, td, th")) {
    const r = e.getBoundingClientRect(); if (!r.width || getComputedStyle(e).visibility === "hidden") continue;
    if (r.right > Math.min(edge.right, window.innerWidth) + 1 || r.left < Math.max(edge.left, 0) - 1) { bad.push(`outside its window: ${(e.textContent ?? e.tagName).trim().slice(0, 40)}`); if (bad.length > 4) break; }
  }
  return bad;
}, sel);
for (const [w, h] of [[390, 844], [1280, 800]] as const) {
  test(`Find matches and a match's details at ${w} x ${h}: every part inside its window`, async () => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/dashboard"); await dismissNotices(page);
    await page.getByRole("button", { name: /^Shortlist Matching Zone/ }).click();
    const picker = page.getByRole("dialog", { name: "Choose what to find matches for" });
    await picker.getByRole("option").first().click();
    await picker.getByRole("button", { name: /^Find matches for this/ }).click();
    const list = page.getByTestId("match-list");
    await expect(list.getByTestId("match-row").first()).toBeVisible({ timeout: 120_000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: test.info().outputPath(`results-${w}.png`) });
    expect(await INSIDE(page, '[data-testid="match-list"]')).toEqual([]);
    await expect(list.getByRole("button", { name: "Details" }).first()).toBeInViewport();
    await list.getByRole("button", { name: "Details" }).first().click();
    const assessment = page.getByRole("dialog").filter({ hasText: "Match Assessment" }).last();
    await expect(assessment).toBeVisible({ timeout: 30_000 }); await page.waitForTimeout(600);
    await page.screenshot({ path: test.info().outputPath(`assessment-${w}.png`) });
    expect(await INSIDE(page, "the last window")).toEqual([]);
    expect(await page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => d.scrollWidth > d.clientWidth + 1))).toBe(false);
    await assessment.getByRole("button", { name: "Close", exact: true }).last().click();
    await page.getByRole("button", { name: "Close Shortlist" }).click();
  });
}
