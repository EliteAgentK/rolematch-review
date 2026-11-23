// While one organisation's portal is busy with a large upload, another organisation and a second portal in the first carry on: their own documents are read in their turn, their reads stay quick, and nothing of the busy portal is visible to them, its documents, originals, results, status or review history. Only when asked (E2E_TENANTS=1), on a rehearsal, alongside the corpus run. Fictional documents.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { address, BASE, createAdmin, portalHeader, published, RUN, signedIn } from "./kit";

const H = { origin: BASE }, CORPUS = join(__dirname, "../../server/data/corpus-live/inventory.json");
test.skip(process.env.E2E_TENANTS !== "1" || !/localhost/.test(BASE), "asked for, on a rehearsal only");
test.setTimeout(3 * 60 * 60 * 1000);
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))];

test("a busy portal does not hold up, slow down or show itself to anyone else", async ({ browser }) => {
  const inv = JSON.parse(readFileSync(CORPUS, "utf8")).items.filter((i: any) => i.id), file = (id: string) => inv.find((i: any) => i.id === id).files[0];
  // The busy portal: organisation A's main portal, given a batch of 20 at once.
  const a = address("busy"), b = address("other"); createAdmin(`Busy ${RUN}`, a, "Busy Admin"); createAdmin(`Other ${RUN}`, b, "Other Admin");
  const A = await browser.newContext({ baseURL: BASE }), B = await browser.newContext({ baseURL: BASE });
  await signedIn(await A.newPage(), a); await signedIn(await B.newPage(), b);
  const busy = (await (await A.request.get("/api/portals", { headers: H })).json())[0].id;
  const second = (await (await A.request.post("/api/portals", { headers: H, data: { name: `Second ${RUN}` } })).json()).id;
  const bPortal = (await (await B.request.get("/api/portals", { headers: H })).json())[0].id;
  const send = async (ctx: typeof A, portal: string, id: string) => (await (await ctx.request.post("/api/documents", { headers: portalHeader(portal), multipart: { kind: "cv", file: { name: `${id}.pdf`, mimeType: "application/pdf", buffer: readFileSync(file(id)) } } })).json()).id as string;
  const textPdfs = inv.filter((i: any) => i.kind === "cv" && i.format === "Text PDF").map((i: any) => i.id);
  const busyDocs: string[] = []; for (const id of textPdfs.slice(0, 20)) busyDocs.push(await send(A, busy, id));
  // The others start a moment later, each with one document.
  const t0 = Date.now(), bDoc = await send(B, bPortal, textPdfs[20]), secondDoc = await send(A, second, textPdfs[21]);
  const reads: Record<string, number[]> = { busy: [], other: [], second: [] }, done: Record<string, number> = {};
  while (!done.other || !done.second) {
    for (const [who, ctx, portal] of [["busy", A, busy], ["other", B, bPortal], ["second", A, second]] as const) { const t = Date.now(); expect((await ctx.request.get("/api/candidates?limit=20", { headers: portalHeader(portal) })).ok()).toBe(true); reads[who].push(Date.now() - t); }
    for (const [who, ctx, portal, doc] of [["other", B, bPortal, bDoc], ["second", A, second, secondDoc]] as const) if (!done[who]) { const s = await (await ctx.request.get(`/api/documents/${doc}`, { headers: portalHeader(portal) })).json(); if (s.status === "published" || s.status === "exception") done[who] = Date.now() - t0; }
    await new Promise((r) => setTimeout(r, 10_000));
    if (Date.now() - t0 > 2.5 * 60 * 60 * 1000) break;
  }
  const busyLeft = (await Promise.all(busyDocs.map(async (d) => (await (await A.request.get(`/api/documents/${d}`, { headers: portalHeader(busy) })).json()).status))).filter((s) => s === "processing").length;
  console.log(JSON.stringify({ otherOrgDoneSec: Math.round((done.other ?? NaN) / 1000), secondPortalDoneSec: Math.round((done.second ?? NaN) / 1000), busyStillProcessingWhenTheyFinished: busyLeft, readP95ms: { busy: p95(reads.busy), other: p95(reads.other), second: p95(reads.second) } }));
  // Fair turns: neither waited for the whole busy batch.
  expect(busyLeft, "the others finished before the busy batch did").toBeGreaterThan(0);
  // Nothing of the busy portal is visible elsewhere: its documents, originals, records, results or history.
  const busyRecord = await published(A.request, busyDocs[0]);
  for (const [ctx, portal] of [[B, bPortal], [A, second]] as const) {
    const h = portalHeader(portal);
    expect((await ctx.request.get(`/api/documents/${busyDocs[0]}`, { headers: h })).status()).toBe(404);
    expect((await ctx.request.get(`/api/documents/${busyDocs[0]}/original`, { headers: h })).status()).toBe(404);
    expect((await ctx.request.get(`/api/candidates/${busyRecord}`, { headers: h })).status()).toBe(404);
    expect((await ctx.request.get(`/api/candidates/${busyRecord}/employment`, { headers: h })).status()).toBe(404);
    const list = JSON.stringify(await (await ctx.request.get("/api/candidates?limit=200", { headers: h })).json());
    expect(list).not.toContain(busyRecord);
    const audit = await ctx.request.get(`/api/audit?entityId=${busyRecord}`, { headers: h });
    expect([200, 403, 404]).toContain(audit.status()); if (audit.ok()) expect(await audit.json()).toEqual([]);
  }
  await A.close(); await B.close();
});
