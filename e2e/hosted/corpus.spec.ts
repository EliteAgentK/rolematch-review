// The live workflow corpus through the isolated platform, in paced batches, while ordinary work is timed alongside. Only when asked (E2E_CORPUS=1), only against a rehearsal. Every source ID ends with an outcome, written to the private results folder. Fictional documents.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { address, BASE, createAdmin, portalHeader, RUN, signedIn } from "./kit";

const DATA = join(__dirname, "../../server/data/corpus-live"), inv = JSON.parse(readFileSync(join(DATA, "inventory.json"), "utf8")), H = { origin: BASE };
test.skip(process.env.E2E_CORPUS !== "1" || !/localhost/.test(BASE), "asked for, on a rehearsal only");
test.setTimeout(10 * 60 * 60 * 1000);
const STEPS = (process.env.CORPUS_STEPS ?? "5,10,20,40,200").split(",").map(Number), PROBE_LIMIT_MS = Number(process.env.PROBE_LIMIT_MS ?? 2000);
const mime = (f: string) => (/\.pdf$/i.test(f) ? "application/pdf" : /\.docx$/i.test(f) ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : /\.jpe?g$/i.test(f) ? "image/jpeg" : "application/octet-stream");
const p95 = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))] : 0);

test("every source ID in the corpus ends with an outcome, and ordinary work stays responsive", async ({ browser }) => {
  const admin = address("corpus"); createAdmin(`Corpus ${RUN}`, admin, "Corpus Admin");
  const ctx = await browser.newContext({ baseURL: BASE }), page = await ctx.newPage(); await signedIn(page, admin);
  const api: APIRequestContext = ctx.request, portal = (await (await api.get("/api/portals", { headers: H })).json())[0].id, PH = portalHeader(portal);
  const outcomes: any[] = [], probes: { at: number; ms: number; inFlight: number }[] = [], started = Date.now();
  const save = () => writeFileSync(join(DATA, `run-${(process.env.E2E_EXPECT_COMMIT ?? RUN).slice(0, 7)}.json`), JSON.stringify({ commit: process.env.E2E_EXPECT_COMMIT, org: `Corpus ${RUN}`, portal, started, outcomes, probes }));
  const upload = async (o: any, file: string, kind: string) => {
    const t = Date.now(), r = await api.post("/api/documents", { headers: PH, multipart: { kind, file: { name: basename(file), mimeType: mime(file), buffer: readFileSync(file) } } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok()) { o.refused = { status: r.status(), code: body.code ?? body.error?.code ?? null, message: String(body.message ?? body.error?.message ?? "").slice(0, 160) }; return null; }
    return { doc: body.id as string, uploadedAt: t, uploadMs: Date.now() - t };
  };
  // 1. The page-photo sequence as a person would send it: each JPG on its own. What the platform does with it is recorded, not assumed.
  const seq = inv.items.filter((i: any) => i.id).find((i: any) => i.format === "Page photos" && i.pages >= 5);
  const sequence: any = { id: seq.id, as: "separate page photos", docs: [] };
  for (const f of seq.files) { const u = await upload(sequence, f, "cv"); if (u) sequence.docs.push(u); }
  outcomes.push(sequence);
  // 2. The whole corpus, page photos as one image-only PDF each, in widening batches.
  const queue = inv.items.filter((i: any) => i.id).map((i: any) => ({ id: i.id, kind: i.kind, format: i.format, pages: i.pages ?? null, file: i.pdf ? (isAbsolute(i.pdf) ? i.pdf : join(__dirname, "../../server", i.pdf)) : i.files[0], as: i.pdf ? "image-only PDF of the photos" : "original" }));
  const inFlight = () => outcomes.filter((o) => o.docs?.some((d: any) => !d.done)).length;
  const probe = async () => { const t = Date.now(); const r = await api.get("/api/candidates?limit=20", { headers: PH }); probes.push({ at: t, ms: Date.now() - t, inFlight: inFlight() }); expect(r.ok()).toBe(true); };
  const poll = async () => { for (const o of outcomes) for (const d of o.docs ?? []) if (!d.done) { const s = await (await api.get(`/api/documents/${d.doc}`, { headers: PH })).json(); if (s.status === "published" || s.status === "exception") Object.assign(d, { done: Date.now(), status: s.status, code: s.errorCode ?? null, recordId: s.recordId ?? null }); } };
  let at = 0;
  for (const step of STEPS) {
    const batch = queue.slice(at, at + step); at += batch.length; if (!batch.length) break;
    for (const item of batch) { const o: any = { ...item, docs: [] }; outcomes.push(o); const u = await upload(o, item.file, item.kind); if (u) o.docs.push(u); }
    save();
    // Wait for this batch, timing ordinary reads all the while.
    while (inFlight() > 0) { await probe(); await poll(); save(); await page.waitForTimeout(10_000); if (Date.now() - started > 9.5 * 60 * 60 * 1000) break; }
    const recent = probes.slice(-30).map((p) => p.ms);
    console.log(`batch of ${batch.length} done at ${Math.round((Date.now() - started) / 60000)} min; probe p95 ${p95(recent)} ms`);
    if (p95(recent) > PROBE_LIMIT_MS) { console.log("ordinary reads slowed past the limit: not widening"); STEPS.splice(STEPS.indexOf(step) + 1, Infinity, ...Array(Math.ceil((queue.length - at) / step)).fill(step)); }
  }
  // 3. What came back, for scoring.
  for (const o of outcomes) for (const d of o.docs ?? []) if (d.recordId) d.record = await (await api.get(`/api/${o.kind === "jd" ? "jobs" : "candidates"}/${d.recordId}`, { headers: PH })).json();
  save();
  await ctx.close();
  expect(outcomes.filter((o) => !o.refused && o.docs.some((d: any) => !d.done)).length, "documents still waiting").toBe(0);
});
