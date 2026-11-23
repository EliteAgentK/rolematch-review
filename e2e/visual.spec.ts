// Pixel capture of every screen and state, for the Chakra UI 3 migration (pass rule: pixel-identical to the Chakra 2 baseline).
//
//   VISUAL_RECORD=1 npx playwright test -c playwright.visual.config.ts   records each test's server answers (signed in, real server) and the baseline
//   npx playwright test -c playwright.visual.config.ts                   replays the recorded answers and compares every screen with the baseline
//
// Inputs are fixed so only the website's own rendering can change a pixel: the server's answers come from the recording, the clock is frozen,
// Math.random is seeded, motion is reduced (animations show their final state), the text caret is hidden. Desktop size only (phones get their
// own composition later). Light and dark mode. Recordings and images live in e2e/visual-data (git-ignored).
//   VISUAL_DIST=<folder>   serves the website from a built folder instead of the server (to compare two builds of the same states)
//   VISUAL_DUMP=<label>    also writes every element's position and computed style to e2e/visual-data/dump/<label>/<state>.json,
//                          so two builds can be compared element by element: python3 e2e/visual-diff.py [--summary|--boxes] <a> <b> [state]
//   node e2e/visual-where.cjs <diff.png> and node e2e/visual-crop.cjs <png> <out> x y w h point to and cut out a differing area.
import { expect, test, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

const RECORD = !!process.env.VISUAL_RECORD;
const DIST = process.env.VISUAL_DIST, DUMP = process.env.VISUAL_DUMP;
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json", ".lottie": "application/zip", ".gif": "image/gif", ".webp": "image/webp" };
const DATA = join(__dirname, "visual-data");
const CARD = { candidate: '[aria-roledescription="selectable candidate card"]', job: '[aria-roledescription="selectable job card"]' };
const cardFor = (page: Page, kind: "candidate" | "job", text: string) => page.locator(CARD[kind]).filter({ hasText: text }).first();
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// every visible element: where it is, its text and the computed style properties that decide how it looks
async function dump(page: Page, name: string) {
  const els = await page.evaluate(() => {
    // as the screenshot does: finished transitions and animations at their end, endless ones stopped
    for (const a of document.getAnimations()) { try { if (a.effect?.getComputedTiming().iterations === Infinity) a.cancel(); else a.finish(); } catch { /* already done */ } }
    const PROPS = ["display", "position", "box-sizing", "width", "height", "margin-top", "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-right", "padding-bottom", "padding-left",
      "border-top-width", "border-right-width", "border-bottom-width", "border-left-width", "border-top-style", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
      "border-top-left-radius", "border-top-right-radius", "border-bottom-left-radius", "border-bottom-right-radius", "color", "background-color", "background-image", "box-shadow", "opacity",
      "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-align", "text-transform", "text-decoration-line", "white-space", "vertical-align",
      "outline-style", "outline-width", "outline-color", "outline-offset", "gap", "row-gap", "column-gap", "flex-direction", "align-items", "justify-content", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis",
      "overflow-x", "overflow-y", "z-index", "transform", "cursor", "fill", "stroke", "visibility", "inset", "max-width", "min-width", "max-height", "min-height", "grid-template-columns", "object-fit", "text-overflow", "-webkit-line-clamp", "word-break", "overflow-wrap", "list-style-type", "appearance", "accent-color", "filter", "backdrop-filter", "mask-image"];
    const out: any[] = [];
    const walk = (el: Element, path: string) => {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent!.trim()).join(" ").slice(0, 60);
      const style: Record<string, string> = {}; for (const p of PROPS) style[p] = cs.getPropertyValue(p);
      for (const pseudo of ["::before", "::after", "::placeholder"]) { const ps = getComputedStyle(el, pseudo); if (ps.content && ps.content !== "none" && ps.content !== "normal") style[pseudo] = `${ps.content} ${ps.width} ${ps.height} ${ps.backgroundColor} ${ps.borderTopWidth} ${ps.borderTopColor}`; if (pseudo === "::placeholder" && (el as HTMLInputElement).placeholder) style[pseudo] = `${ps.color} ${ps.opacity}`; }
      const vis = (el as any).checkVisibility ? (el as any).checkVisibility({ visibilityProperty: true }) : true;
      out.push({ path, tag: el.tagName.toLowerCase(), text: own, vis, box: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 100) / 100), style });
      [...el.children].forEach((c, i) => { if (!["SCRIPT", "STYLE", "LINK", "META", "TITLE", "NOSCRIPT"].includes(c.tagName)) walk(c, `${path}>${c.tagName.toLowerCase()}[${i}]`); });
    };
    walk(document.documentElement, "html");
    return out;
  });
  const dir = join(DATA, "dump", DUMP!); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(els));
}

for (const mode of ["light", "dark"] as const) test.describe(`${mode} mode`, () => {
  test.beforeEach(async ({ page }, info) => {
    // a script error on the page is a failure of its own, reported with the state it happened in
    page.on("pageerror", (e) => console.log(`PAGE ERROR in "${info.title}" (${mode}): ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) console.log(`CONSOLE ERROR in "${info.title}" (${mode}): ${m.text().slice(0, 300)}`); });
    await page.routeFromHAR(join(DATA, "har", `${slug(info.title)}-${mode}.har`), { url: "**/api/**", update: RECORD, updateContent: "embed", notFound: "abort" });
    if (DIST) await page.route((u) => u.port === "8787" && !u.pathname.startsWith("/api/"), (r) => {
      const p = decodeURIComponent(new URL(r.request().url()).pathname), f = join(DIST, p);
      const file = existsSync(f) && statSync(f).isFile() ? f : join(DIST, "index.html");   // the website's own pages, as the server does
      return r.fulfill({ body: readFileSync(file), contentType: TYPES[extname(file)] ?? "application/octet-stream" });
    });
    await page.clock.setFixedTime(new Date("2026-10-27T10:00:00+02:00"));
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: mode });
    await page.addInitScript((m) => {
      let s = 20261027; Math.random = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
      localStorage.setItem("chakra-ui-color-mode", m);
      localStorage.setItem("rolematchDontShowTutorial", "true");
    }, mode);
  });
  const shot = async (page: Page, name: string, opts: { fullPage?: boolean } = {}) => {
    await page.evaluate(() => document.fonts.ready);
    if (DUMP) await dump(page, `${name}-${mode}`);
    // soft: a state that differs is reported and the test goes on to the next state, so every difference shows in one run
    await expect.soft(page).toHaveScreenshot(`${name}-${mode}.png`, { fullPage: opts.fullPage ?? true, animations: "disabled", caret: "hide", maxDiffPixels: 0, timeout: 20_000 });
  };
  // the cookie banner can sit behind an open window: then it stays, as a visitor would see it
  const closeCookies = async (page: Page) => { const b = page.getByRole("button", { name: "Essential Only" }); if (await b.isVisible().catch(() => false)) await b.click({ timeout: 3000 }).catch(() => {}); };
  const board = async (page: Page) => {
    await page.goto("/dashboard");
    await expect(page.locator(CARD.candidate)).toHaveCount(5, { timeout: 30_000 });
    await expect(page.locator(CARD.job)).toHaveCount(5);
    await closeCookies(page);
  };

  // ------------------------------------------------------------------ public pages
  for (const path of ["/", "/features", "/pricing", "/contact", "/login", "/signup"]) {
    // the public pages bring elements in on timers (up to 2.6s after load, between pauses a screenshot could land in): wait for all of them
    test(`page ${path}`, async ({ page }) => { await page.goto(path); await closeCookies(page); await page.waitForTimeout(3500); await shot(page, `public${path === "/" ? "-home" : path.replace("/", "-")}`); });
  }
  test("cookie banner and its preferences", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Essential Only" })).toBeVisible();
    await shot(page, "cookie-banner", { fullPage: false });
    await page.getByText("Customize preferences").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await shot(page, "cookie-preferences", { fullPage: false });
  });
  test("pricing with an answer open and annual billing", async ({ page }) => {
    await page.goto("/pricing"); await closeCookies(page);
    const toggle = page.getByRole("checkbox").first(); if (await toggle.isVisible().catch(() => false)) await toggle.click({ force: true });
    const q = page.getByRole("button", { expanded: false }).filter({ hasText: /\?$/ }).first(); if (await q.isVisible().catch(() => false)) await q.click();
    await shot(page, "pricing-states");
  });
  test("login with a wrong password", async ({ page }) => {
    await page.goto("/login"); await closeCookies(page);
    await page.getByLabel(/email/i).fill("nobody@example.test");
    const next = page.getByRole("button", { name: /continue/i }); if (await next.isVisible().catch(() => false)) await next.click();
    const pw = page.getByLabel(/password/i).first(); if (await pw.isVisible().catch(() => false)) { await pw.fill("not-the-password"); await page.getByRole("button", { name: /sign in|log in|continue/i }).last().click(); }
    await expect(page.getByText("Could not sign in", { exact: true })).toBeVisible({ timeout: 30_000 });
    await pw.focus();   // whether the box still has focus depends on timing; a person retyping has it focused
    await shot(page, "login-error", { fullPage: false });
  });

  // ------------------------------------------------------------------ the board
  test("board", async ({ page }) => { await board(page); await shot(page, "board"); });
  test("candidate panel", async ({ page }) => { await board(page); await cardFor(page, "candidate", "Thandi Mokoena").click({ position: { x: 20, y: 20 } }); await page.waitForTimeout(400); await shot(page, "candidate-panel"); });
  test("job panel", async ({ page }) => { await board(page); await cardFor(page, "job", "Senior Software Developer").click({ position: { x: 20, y: 20 } }); await page.waitForTimeout(400); await shot(page, "job-panel"); });
  test("more skills popover", async ({ page }) => {
    await board(page);
    await cardFor(page, "candidate", "Thandi Mokoena").getByRole("button", { name: /View \d+ more/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await shot(page, "more-skills", { fullPage: false });
  });
  test("card tooltip", async ({ page }) => {
    await board(page);
    // the location line at the foot of a card shows the full place in a tooltip
    await cardFor(page, "candidate", "Zanele Khumalo").locator("p[title]").last().hover();
    await expect(page.getByRole("tooltip")).toBeVisible();
    await shot(page, "card-tooltip", { fullPage: false });
  });
  test("candidate editing", async ({ page }) => {
    await board(page);
    await cardFor(page, "candidate", "Thandi Mokoena").click({ position: { x: 20, y: 20 } });
    await page.getByRole("button", { name: /^edit/i }).first().click();
    await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
    await shot(page, "candidate-editing");
  });
  test("job editing", async ({ page }) => {
    await board(page);
    await cardFor(page, "job", "Senior Software Developer").click({ position: { x: 20, y: 20 } });
    await page.getByRole("button", { name: /^edit/i }).first().click();
    await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
    await shot(page, "job-editing");
  });
  test("delete confirmation", async ({ page }) => {
    await board(page);
    await cardFor(page, "candidate", "Thandi Mokoena").click({ position: { x: 20, y: 20 } });
    await page.getByRole("button", { name: /^delete$/i }).first().click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await shot(page, "delete-confirm", { fullPage: false });
  });
  test("both slots filled: the Match button", async ({ page }) => {
    await board(page);
    await cardFor(page, "candidate", "Thandi Mokoena").click({ position: { x: 20, y: 20 } });
    await cardFor(page, "job", "Senior Software Developer").click({ position: { x: 20, y: 20 } });
    await expect(page.getByRole("button", { name: "Match", exact: true })).toBeVisible();
    await shot(page, "match-ready");
  });
  test("match assessment", async ({ page }) => {
    await board(page);
    await cardFor(page, "candidate", "Thandi Mokoena").click({ position: { x: 20, y: 20 } });
    await cardFor(page, "job", "Senior Software Developer").click({ position: { x: 20, y: 20 } });
    await page.getByRole("button", { name: "Match", exact: true }).click();
    await expect(page.getByText(/Match Assessment/)).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(500);
    await shot(page, "match-assessment");
  });
  test("shortlist results", async ({ page }) => {
    await board(page);
    await cardFor(page, "job", "Senior Software Developer").focus(); await page.keyboard.press("m");
    await expect(page.getByText(/Matching This (Job|Candidate)/)).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(500);
    await shot(page, "shortlist-results", { fullPage: false });
  });
  test("upload in progress and an upload held during an outage", async ({ page }) => {
    await page.route("**/api/documents", (r) => r.request().method() === "GET" ? r.fulfill({ json: [
      { id: "11111111-1111-4111-8111-111111111111", kind: "cv", fileName: "Naledi_Khumalo_CV.pdf", status: "processing", stage: "reading", scanResult: null, errorCode: null, errorMessage: null, recordId: null, createdAt: "2026-10-27T07:58:00.000Z", updatedAt: "2026-10-27T07:59:00.000Z" },
      { id: "22222222-2222-4222-8222-222222222222", kind: "jd", fileName: "Finance_Manager.docx", status: "processing", stage: "held", scanResult: null, errorCode: null, errorMessage: null, recordId: null, createdAt: "2026-10-27T07:58:00.000Z", updatedAt: "2026-10-27T07:58:00.000Z", held: true },
    ] }) : r.fallback());
    await board(page); await page.waitForTimeout(1500);
    await shot(page, "uploads-processing");
  });
  test("read-only notice", async ({ page }) => {
    // every server answer carries the read-only headers, as during an outage (an event alone is undone by the next normal answer)
    await page.addInitScript(() => {
      const real = window.fetch;
      window.fetch = async (...a) => {
        const r = await real(...a);
        if (!String(a[0] instanceof Request ? a[0].url : a[0]).includes("/api/")) return r;
        const h = new Headers(r.headers); h.set("x-rolematch-mode", "read-only"); h.set("x-rolematch-copy-at", "2026-10-27T07:55:00.000Z");
        return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
      };
    });
    await board(page);
    await expect(page.getByText("Saving is paused.")).toBeVisible();
    await shot(page, "read-only-notice", { fullPage: false });
  });
  test("user menu", async ({ page }) => {
    await board(page);
    await page.locator('[aria-haspopup="menu"]').first().click();   // the avatar picture opens the menu; it has no text of its own
    await expect(page.getByRole("menuitem", { name: "Settings" })).toBeVisible();
    await shot(page, "user-menu", { fullPage: false });
  });
  test("getting started window", async ({ page }) => {
    await page.addInitScript(() => { localStorage.removeItem("rolematchDontShowTutorial"); sessionStorage.setItem("th_just_signed_up", "1"); });
    await page.goto("/dashboard");
    await expect(page.getByRole("dialog", { name: /Getting Started with/ })).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(500);
    await shot(page, "getting-started", { fullPage: false });
  });

  // ------------------------------------------------------------------ settings and profile
  test("settings, every tab", async ({ page }) => {
    await page.goto("/settings"); await closeCookies(page);
    await expect(page.getByRole("tab").first()).toBeVisible({ timeout: 30_000 });
    const tabs = page.getByRole("tab"), n = await tabs.count();
    for (let i = 0; i < n; i++) { await tabs.nth(i).click(); await page.waitForTimeout(300); await shot(page, `settings-tab-${i + 1}`); }
  });
  test("profile, every tab", async ({ page }) => {
    await page.goto("/profile"); await closeCookies(page); await page.waitForTimeout(800);
    const tabs = page.getByRole("tab"), n = await tabs.count();
    if (!n) await shot(page, "profile");
    for (let i = 0; i < n; i++) { await tabs.nth(i).click(); await page.waitForTimeout(300); await shot(page, `profile-tab-${i + 1}`); }
  });
});
