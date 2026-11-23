// Records outlive the batch cards that brought them in (R35 follow-up). A finished batch leaves the board and goes to Settings, History; closing,
// cancelling or acknowledging it must never take a candidate or job with it. The records must also survive a refresh, signing out and in, and a restart.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Browser, cvFile, makeWorld, sleep, type World } from "./portalKit";

let w: World; let U: Browser[];
const NO_RATE_LIMIT = JSON.stringify({ reserve_user: 100000, reserve_portal: 100000, reserve_org: 100000, status_user: 100000, status_portal: 100000, batch_action_user: 100000, upload_file_user: 100000, upload_file_portal: 100000, upload: 100000 });
beforeAll(async () => { w = await makeWorld(8815, 2, { RATE_OVERRIDES: NO_RATE_LIMIT }); U = w.users; }, 400000);
afterAll(async () => { await w?.stop(); }, 120000);

const job = (f: string) => new File([readFileSync(fileURLToPath(new URL(`../../sample-documents/jobs/${f}`, import.meta.url)))], f);
const ids = async (b: Browser, kind: "candidates" | "jobs") => { const r = await b.get(`/api/${kind}?limit=100`); expect(r.status).toBe(200); return (r.body.items as { id: string }[]).map((x) => x.id).sort(); };
async function settled(b: Browser, id: string) {
  for (let i = 0; i < 120; i++) { const v = (await b.get(`/api/batches/${id}`)).body; if (v.complete) return v; await sleep(1000); }
  throw new Error("batch never completed");
}
async function published(b: Browser, docId: string) {
  for (let i = 0; i < 120; i++) { const d = (await b.get(`/api/documents/${docId}`)).body; if (d.status !== "processing") return d; await sleep(1000); }
  throw new Error("document never finished");
}

test("closing, cancelling and acknowledging finished batches, signing out and in, and a restart leave every candidate and job in place, for everyone in the portal", async () => {
  const [me, colleague] = U;
  // one single file (a batch of one inside), one batch of two CVs, one batch of two job descriptions
  const single = await me.upload(await cvFile(901));
  expect(single.status).toBe(202);
  const one = await published(me, single.body.id);
  expect(one.status).toBe("published");
  const cvBatch = (await me.post("/api/batches", { kind: "cv", files: 2, bytes: 2000 })).body;
  for (const n of [902, 903]) expect((await me.upload(await cvFile(n), { batch: cvBatch.id })).status).toBe(202);
  const jdBatch = (await me.post("/api/batches", { kind: "jd", files: 2, bytes: 2000 })).body;
  for (const f of ["job01-senior-developer.docx", "job02-data-analyst.docx"]) expect((await me.upload(job(f), { batch: jdBatch.id, kind: "jd" })).status).toBe(202);
  const cvDone = await settled(me, cvBatch.id), jdDone = await settled(me, jdBatch.id);
  expect(cvDone.counts.completed + cvDone.counts.needsReview).toBe(2);
  expect(jdDone.counts.completed + jdDone.counts.needsReview).toBe(2);

  const cands = await ids(me, "candidates"), jobs = await ids(me, "jobs");
  expect(cands).toHaveLength(3); expect(jobs).toHaveLength(2);
  expect(cands).toContain(one.recordId);

  // the cards leave the board: acknowledge, close, and a late cancel of a finished batch
  for (const b of [cvBatch.id, jdBatch.id, single.body.batchId].filter(Boolean)) {
    await me.post(`/api/batches/${b}/ack`);
    expect((await me.post(`/api/batches/${b}/close`)).status).toBe(200);
    await me.post(`/api/batches/${b}/cancel`);   // whatever it answers for a finished batch, it must not touch the records
  }
  expect(await ids(me, "candidates")).toEqual(cands); expect(await ids(me, "jobs")).toEqual(jobs);
  expect(await ids(colleague, "candidates")).toEqual(cands); expect(await ids(colleague, "jobs")).toEqual(jobs);   // the same board for everyone in the portal

  // sign out: the records are not shown to a signed-out browser, and are all there again after signing in
  expect((await me.post("/api/auth/logout")).status).toBe(200);
  expect((await me.get("/api/candidates")).status).toBe(401);
  const login = await me.req("/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.9.77.1" }, body: JSON.stringify({ email: me.email, password: "a-long-enough-password-1" }) });
  expect(login.status).toBe(200);
  expect(await ids(me, "candidates")).toEqual(cands); expect(await ids(me, "jobs")).toEqual(jobs);

  // a restart of the server
  await w.restart();
  expect(await ids(me, "candidates")).toEqual(cands); expect(await ids(me, "jobs")).toEqual(jobs);
  expect(((await me.get("/api/history/uploads")).body as any[]).filter((r) => r.recordId).length).toBe(5);   // and History still links to all five
}, 400000);
