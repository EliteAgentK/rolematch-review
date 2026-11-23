// The real CVs through the actual platform on the isolated stack: upload, reader, model, auditor, publication, panel. Only runs when asked (E2E_REAL_CVS=1), only against a rehearsal, and writes what came back to the private results folder for scoring. Prints counts and opaque ids only.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { address, BASE, CARD, createAdmin, dismissNotices, panelSections, RUN, signedIn } from "./kit";

const P = join(__dirname, "../../server/data/real-cvs"), H = { origin: BASE }, admin = address("real");
test.skip(process.env.E2E_REAL_CVS !== "1" || !/localhost/.test(BASE), "asked for, on a rehearsal only");
test.setTimeout(3 * 60 * 60 * 1000);

test("every real CV reaches a panel or a stated outcome, and is read as the service reads it", async ({ browser }) => {
  createAdmin(`Real ${RUN}`, admin, "Real Admin");
  const inv = JSON.parse(readFileSync(join(P, "inventory.json"), "utf8")), ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1400, height: 900 } }), page = await ctx.newPage(); await signedIn(page, admin);
  const started = Date.now(), docs: { id: string; doc: string; at: number; done?: number; status?: string; code?: string | null; recordId?: string }[] = [];
  for (const d of inv.docs) {
    const r = await ctx.request.post("/api/documents", { headers: H, multipart: { kind: "cv", file: { name: `${d.id}.${d.file.split(".").pop()}`, mimeType: "application/octet-stream", buffer: readFileSync(join(inv.source, d.file)) } } });
    expect(r.ok(), `upload ${d.id}: ${r.status()}`).toBe(true);
    docs.push({ id: d.id, doc: (await r.json()).id, at: Date.now() });
  }
  const save = async () => {
    const rows: any[] = [];
    for (const d of docs) if (d.recordId) { const rec = await (await ctx.request.get(`/api/candidates/${d.recordId}`, { headers: H })).json(); rows.push({ id: d.id, ok: true, record: rec, seconds: Math.round((d.done! - d.at) / 1000) }); }
    mkdirSync(join(P, "candidate"), { recursive: true });
    writeFileSync(join(P, `candidate/platform-${process.env.E2E_EXPECT_COMMIT?.slice(0, 7) ?? RUN}.json`), JSON.stringify({ commit: process.env.E2E_EXPECT_COMMIT, rows, outcomes: docs.map(({ id, status, code, done, at }) => ({ id, status, code, seconds: done ? Math.round((done - at) / 1000) : null })) }));
  };
  while (docs.some((d) => !d.done) && Date.now() - started < 170 * 60 * 1000) {
    for (const d of docs.filter((x) => !x.done)) {
      const s = await (await ctx.request.get(`/api/documents/${d.doc}`, { headers: H })).json();
      if (s.status === "published" || s.status === "exception") { d.done = Date.now(); d.status = s.status; d.code = s.errorCode; d.recordId = s.recordId; console.log(`${d.id} ${s.status} ${s.errorCode ?? ""} ${Math.round((d.done - started) / 1000)}s`); await save(); }
    }
    await page.waitForTimeout(15_000);
    await page.goto("/dashboard").catch(() => undefined);   // keeps the sign-in fresh, as a person's open tab would
  }
  await save();
  // Panels: a sample that covers agency, thin, long and scanned records, all in the same shape.
  await page.goto("/dashboard"); await dismissNotices(page);
  const SECTIONS = ["notes", "work", "projects", "education", "skills"], cards = page.locator(CARD("candidate")), n = await cards.count();
  for (const k of [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1]) {
    if (k < 0) continue;
    await page.goto("/dashboard"); await dismissNotices(page);
    await cards.nth(k).dblclick({ position: { x: 20, y: 20 } });
    await expect(page.getByTestId("candidate-tabs")).toBeVisible();
    expect(await panelSections(page, "candidate")).toEqual(SECTIONS);
  }
  await ctx.close();
  expect(docs.filter((d) => !d.done).length, "documents still waiting").toBe(0);
});
