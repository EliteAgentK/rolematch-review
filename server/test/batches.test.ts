import { afterAll, beforeAll, expect, test } from "vitest";
import { Browser, cvFile, makeWorld, sleep, type World } from "./portalKit";
import { opsDetails } from "./helpers";

// Batches inside a portal, with real recruiters and real processing: per-file outcomes that add up, the persistent report with e-mail attribution, per-person
// acknowledgement, cancelling files that are queued and files that are being read, retry inside and after closure, failures recorded once as one suspected defect,
// and a server restart in the middle of a batch.
let w: World; let U: Browser[];
const NO_RATE_LIMIT = JSON.stringify({ reserve_user: 100000, reserve_portal: 100000, reserve_org: 100000, status_user: 100000, status_portal: 100000, batch_action_user: 100000, upload_file_user: 100000, upload_file_portal: 100000, upload: 100000 });
beforeAll(async () => { w = await makeWorld(8812, 3, { RATE_OVERRIDES: NO_RATE_LIMIT, QUEUE_STALE_SECONDS: "6", QUEUE_HEARTBEAT_MS: "2000", RECONCILE_MS: "3000" }); U = w.users; }, 400000);
afterAll(async () => { await w?.stop(); }, 120000);

const reserve = (b: Browser, files: number, extra: object = {}) => b.post("/api/batches", { kind: "cv", files, bytes: files * 1000, ...extra });
const schema = () => `"${w.tdb.schema}"`;
const held = async () => (await U[0].get("/api/capacity")).body.reserved as number;
// The capacity a portal shows is cached for 5 seconds, and a batch closed by background work reaches it within that time (src/index.ts, portalCached; register R151). So a change is awaited for up to 6 seconds, and the figure is taken fresh when the test needs it exact.
const heldBecomes = async (want: number) => { const until = Date.now() + 6000; let n = await held(); while (n !== want && Date.now() < until) { await new Promise((r) => setTimeout(r, 250)); n = await held(); } return n; };
const heldFresh = async () => { await new Promise((r) => setTimeout(r, 5100)); return held(); };
async function settled(b: Browser, id: string, seconds = 120) {
  for (let i = 0; i < seconds; i++) { const v = (await b.get(`/api/batches/${id}`)).body; if (v.complete) return v; await sleep(1000); }
  throw new Error("batch never completed");
}
/** Documents seeded straight into a batch, in a chosen state, with no queue job: for states the worker would otherwise change at once. */
async function seed(batchId: string, rows: { name: string; status: string; stage: string; code?: string; retries?: number; path?: string }[]) {
  const b = (await w.admin.unsafe(`select org_id, portal_id, created_by from ${schema()}.upload_batches where id = $1`, [batchId]))[0], ids: string[] = [];
  for (const r of rows) {
    const id = crypto.randomUUID(); ids.push(id);
    await w.admin.unsafe(`insert into ${schema()}.documents (id, org_id, portal_id, kind, original_name, mime, size, sha256, storage_path, status, stage, error_code, created_by, batch_id, manual_retries, uploaded_by_email) values ($1::uuid,$2,$3,'cv',$4,'docx',10,$1::text,$5,$6,$7,$8,$9,$10,$11,'seed@example.test')`, [id, b.org_id, b.portal_id, r.name, r.path ?? "missing/object", r.status, r.stage, r.code ?? null, b.created_by, batchId, r.retries ?? 0]);
  }
  return ids;
}
const state = async (id: string) => (await w.admin.unsafe(`select reservation_state s, cancelled_at is not null c from ${schema()}.upload_batches where id = $1`, [id]))[0];
const finishedEvents = async (id: string) => (await w.admin.unsafe(`select count(*)::int c from ${schema()}.audit_events where action = 'batch.finished' and entity_id = $1`, [id]))[0].c;

test("partial success: every file reaches exactly one outcome, the report adds up, names the submitter by e-mail, and holds no candidate contact details", async () => {
  const b = (await reserve(U[0], 4, { skipped: [{ fileName: "notes.txt", reason: "unsupported type" }] })).body;
  expect(b.submittedByEmail).toBe(U[0].email); expect(b.reservedSlots).toBe(4); expect(b.eta.state).toBe("calculating");
  const good1 = await cvFile(1, "thandi.docx"), good2 = await cvFile(2, "pieter.docx");
  expect((await U[0].upload(good1, { batch: b.id })).status).toBe(202);
  expect((await U[0].upload(good2, { batch: b.id })).status).toBe(202);
  expect((await U[0].upload(new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], "notes.docx"), { batch: b.id })).status).toBe(415);
  expect((await U[0].upload(good1, { batch: b.id })).body.duplicate).toBe(true);
  const v = await settled(U[0], b.id);
  expect(v.counts).toMatchObject({ received: 2, refused: 1, duplicates: 1, waiting: 0, processing: 0 });
  expect(v.counts.completed + v.counts.needsReview + v.counts.failed + v.counts.blocked).toBe(2);
  expect(v.refusals[0]).toMatchObject({ fileName: "notes.docx", code: "FILE-001" }); expect(v.refusals[0].reference).toBeTruthy();
  const rep = (await U[0].get(`/api/batches/${b.id}/report`)).body;
  expect(rep.files.length).toBe(v.counts.received + v.counts.duplicates + v.counts.refused + 1);   // +1: the file the browser left out
  expect(Object.values(rep.tally).reduce((a: number, n: any) => a + n, 0)).toBe(rep.files.length);
  expect(rep.tally).toMatchObject({ left_out_before_sending: 1, unsupported_or_refused: 1, duplicate: 1 });
  expect(rep.files.filter((f: any) => f.recordSaved).map((f: any) => f.uploadedBy)).toEqual([U[0].email, U[0].email]);   // e-mail, not a display name
  expect(rep.batch.submittedByEmail).toBe(U[0].email);
  expect(JSON.stringify(rep)).not.toMatch(/\.\d+@example\.test(?!.*kit)/);   // no candidate contact details (only the submitter's own address appears)
  expect(v.elapsedSec).toBeGreaterThanOrEqual(0); expect(v.eta.state).toBe("none");
  expect(await heldBecomes(0)).toBe(0);   // the batch closed on its own and returned its slots
  expect(await finishedEvents(b.id)).toBe(1);
  // a file that was in the batch stays reported after it is closed on screen
  expect((await U[0].post(`/api/batches/${b.id}/close`)).status).toBe(200);
  expect((await U[0].get(`/api/batches/${b.id}/report`)).body.files.length).toBe(rep.files.length);
}, 180000);

test("acknowledging a summary is per person: one person's acknowledgement changes nothing for another", async () => {
  const b = (await reserve(U[0], 1)).body;
  expect(b.acknowledgedByMe).toBe(false);
  expect((await U[1].post(`/api/batches/${b.id}/ack`)).status).toBe(200);   // a colleague acknowledges (their own view of the shared summary)
  expect((await U[1].get(`/api/batches/${b.id}`)).body.acknowledgedByMe).toBe(true);
  expect((await U[0].get(`/api/batches/${b.id}`)).body.acknowledgedByMe).toBe(false);   // the submitter's has not changed
  expect((await U[0].post(`/api/batches/${b.id}/ack`)).status).toBe(200);
  expect((await U[0].post(`/api/batches/${b.id}/ack`)).status).toBe(200);   // twice is harmless
  expect((await w.admin.unsafe(`select count(*)::int c from ${schema()}.batch_acknowledgements where batch_id = $1`, [b.id]))[0].c).toBe(2);
  await U[0].post(`/api/batches/${b.id}/cancel`);
});

test("cancelling files still queued stops them at once and closes the batch; files already published are kept", async () => {
  const b = (await reserve(U[0], 3)).body;
  const ids = await seed(b.id, [{ name: "w1.docx", status: "processing", stage: "received" }, { name: "w2.docx", status: "processing", stage: "received" }, { name: "p1.docx", status: "published", stage: "ready" }]);
  const c = await U[0].post(`/api/batches/${b.id}/cancel`);
  expect(c.status).toBe(200); expect(c.body.stopped).toBe(2);
  expect(c.body.view.counts).toMatchObject({ cancelled: 2, waiting: 0, processing: 0 });
  const rows = await w.admin.unsafe(`select original_name n, status, error_code from ${schema()}.documents where id = any($1) order by original_name`, [ids]);
  expect(rows.map((r: any) => [r.n, r.status, r.error_code])).toEqual([["p1.docx", "published", null], ["w1.docx", "exception", "CANCELLED"], ["w2.docx", "exception", "CANCELLED"]]);
  expect((await state(b.id)).s).toBe("released"); expect(await heldBecomes(0)).toBe(0);
  expect((await U[0].upload(await cvFile(70), { batch: b.id })).body.error.code).toBe("BATCH-003");   // closed to more files
});

test("cancelling while a file is being read: queued files stop, the batch keeps its slots until the file in flight ends, then releases once", async () => {
  const b = (await reserve(U[0], 3)).body;
  const [, , reading] = await seed(b.id, [{ name: "q1.docx", status: "processing", stage: "received" }, { name: "q2.docx", status: "processing", stage: "received" }, { name: "r1.docx", status: "processing", stage: "reading" }]);
  const c = await U[0].post(`/api/batches/${b.id}/cancel`);
  expect(c.body.stopped).toBe(2);
  expect((await state(b.id)).s).toBe("held"); expect(await heldBecomes(3)).toBe(3);   // a late result could still arrive: the slots stay
  expect(c.body.view.complete).toBe(false);
  await w.admin.unsafe(`update ${schema()}.documents set status = 'published', stage = 'ready' where id = $1`, [reading]);   // the file in flight finishes
  for (let i = 0; i < 12 && (await state(b.id)).s !== "released"; i++) await sleep(1000);
  expect((await state(b.id)).s).toBe("released");
  await expect.poll(held, { timeout: 8000, interval: 500 }).toBe(0);   // released by the database at once; the shared figure catches up within its 5 s (X4). Admission never reads it.
  expect(await finishedEvents(b.id)).toBe(1);
}, 60000);

test("retry inside an open batch keeps its reservation; retry after closure needs a new reservation linked to the old one, and is refused when the portal is full", async () => {
  const open = (await reserve(U[0], 3)).body;
  const [f1, f2] = await seed(open.id, [{ name: "f1.docx", status: "exception", stage: "security", code: "PROCESSING_FAILED" }, { name: "f2.docx", status: "exception", stage: "security", code: "PROCESSING_FAILED", retries: 3 }, { name: "keep.docx", status: "processing", stage: "reading" }]);
  const r = await U[0].post(`/api/batches/${open.id}/retry`);
  expect(r.body.retried).toBe(1); expect(r.body.newBatchId).toBeNull();      // inside the same reservation; the spent one is not retried again
  expect((await w.admin.unsafe(`select manual_retries from ${schema()}.documents where id = $1`, [f2]))[0].manual_retries).toBe(3);
  expect(await heldBecomes(3)).toBe(3);
  await U[0].post(`/api/batches/${open.id}/cancel`);
  await w.admin.unsafe(`update ${schema()}.documents set status = 'exception', error_code = 'PROCESSING_FAILED' where batch_id = $1 and original_name = 'keep.docx'`, [open.id]);
  // closed batch with a failed file that can still be retried
  const closed = (await reserve(U[1], 2)).body;
  const [g1] = await seed(closed.id, [{ name: "g1.docx", status: "exception", stage: "security", code: "PROCESSING_FAILED" }, { name: "g2.docx", status: "published", stage: "ready" }]);
  await w.admin.unsafe(`update ${schema()}.upload_batches set declared_files = 2, last_activity_at = now() - interval '1 hour' where id = $1`, [closed.id]);
  for (let i = 0; i < 12 && (await state(closed.id)).s !== "released"; i++) await sleep(1000);
  expect((await state(closed.id)).s).toBe("released");
  const fill = (await reserve(U[2], 500 - (await heldFresh()))).body;   // the portal is now exactly full
  expect(fill.reservedSlots).toBeGreaterThan(0);
  const refused = await U[1].post(`/api/batches/${closed.id}/retry`);
  expect(refused.status).toBe(409); expect(refused.body.error.code).toBe("CAPACITY-001");
  await U[2].post(`/api/batches/${fill.id}/cancel`);
  const ok = await U[1].post(`/api/batches/${closed.id}/retry`);
  expect(ok.status).toBe(200); expect(ok.body.retried).toBe(1); expect(ok.body.newBatchId).toBeTruthy();
  const nb = (await w.admin.unsafe(`select parent_batch_id p, reserved_slots r, submitted_by_email e from ${schema()}.upload_batches where id = $1`, [ok.body.newBatchId]))[0];
  expect(nb).toEqual({ p: closed.id, r: 1, e: U[1].email });   // linked to the original, one slot, attributed to the person who retried
  expect((await w.admin.unsafe(`select batch_id from ${schema()}.documents where id = $1`, [g1]))[0].batch_id).toBe(ok.body.newBatchId);
  void f1;
}, 180000);

test("a file that fails for an unknown reason is recorded once per attempt, grouped as ONE suspected defect (never confirmed), with the final failure counted separately", async () => {
  const b = (await reserve(U[0], 2)).body;
  const org = (await w.admin.unsafe(`select org_id, portal_id from ${schema()}.upload_batches where id = $1`, [b.id]))[0];
  const ids = await seed(b.id, [{ name: "boom1.docx", status: "processing", stage: "received" }, { name: "boom2.docx", status: "processing", stage: "received" }]);
  for (const id of ids) await w.admin.unsafe(`insert into ${schema()}.queue (org_id, portal_id, type, payload, max_attempts) values ($1, $2, 'process-document', $3::text::jsonb, 1)`, [org.org_id, org.portal_id, JSON.stringify({ documentId: id })]);
  const v = await settled(U[0], b.id, 60);
  expect(v.counts.failed).toBe(2);
  expect(v.failures.every((f: any) => f.errorCode === "PROCESSING_FAILED" && f.reference)).toBe(true);
  const e = (await U[0].get("/api/errors")).body;
  const final = e.groups.find((x: any) => x.code === "PROCESSING_FAILED"), attempt = e.groups.find((x: any) => x.code === "UNEXPECTED_ERROR");
  expect(final).toMatchObject({ kind: "suspected_defect", status: "suspected" }); expect(final.occurrences).toBeGreaterThanOrEqual(2);
  expect(attempt.kind).toBe("operational_transient");                      // the attempts and the final failure are different events, not added up as separate defects
  expect(attempt.defect_key).not.toBe(final.defect_key);
  const occ = e.recent.filter((x: any) => x.code === "PROCESSING_FAILED" && ids.includes(x.document_id));
  expect(occ.length).toBe(2); expect(occ[0].versions.parser).toBeTruthy(); expect(occ[0].stage).toBeTruthy();
  expect(JSON.stringify(e)).not.toMatch(/at .*\.ts:\d+|@example\.test/);
  expect((await opsDetails(w.base)).errorRecording.count).toBe(0);   // the recorder itself did not fail
  expect((await U[0].post(`/api/errors/${final.defect_key}/status`, { status: "confirmed" })).status).toBe(400);
  expect((await U[0].post(`/api/errors/${final.defect_key}/status`, { status: "confirmed", registerRef: "R24" })).status).toBe(200);
}, 120000);

test("a server restart in the middle of a batch loses nothing, duplicates nothing, and the reservation is released once", async () => {
  const N = 8;
  const b = (await reserve(U[0], N)).body;
  const files = await Promise.all(Array.from({ length: N }, (_, i) => cvFile(200 + i)));
  for (const f of files) expect((await U[0].upload(f, { batch: b.id })).status).toBe(202);
  await w.restart();                                                       // stopped while files are queued or being read
  for (const x of U) x.jar = new Map(x.jar);                               // the same sign-ins carry on (their tokens are not the server's memory)
  const v = await settled(U[0], b.id, 180);
  expect(v.counts.received).toBe(N); expect(v.counts.completed + v.counts.needsReview).toBe(N); expect(v.counts.failed + v.counts.cancelled).toBe(0);
  expect((await w.admin.unsafe(`select count(*)::int c, count(distinct document_id)::int d from ${schema()}.candidates where document_id in (select id from ${schema()}.documents where batch_id = $1)`, [b.id]))[0]).toEqual({ c: N, d: N });   // one record per document
  for (let i = 0; i < 10 && (await state(b.id)).s !== "released"; i++) await sleep(1000);
  expect((await state(b.id)).s).toBe("released"); expect(await finishedEvents(b.id)).toBe(1);
}, 400000);

test("a job the AI could not read can be retried, a document that is itself the problem cannot, and the view, the report and Retry agree (one rule: RETRYABLE)", async () => {
  // R188: the upload panel offered Retry only for PROCESSING_FAILED, its own copy of the rule, so a job the AI could not read showed no Retry.
  const b = (await reserve(U[0], 3)).body;
  await seed(b.id, [{ name: "job.docx", status: "exception", stage: "auditing", code: "AI_NOT_READ" }, { name: "photo.docx", status: "exception", stage: "reading", code: "FILE_TYPE" }, { name: "still.docx", status: "processing", stage: "reading" }]);
  const v = (await U[0].get(`/api/batches/${b.id}`)).body;
  expect(Object.fromEntries(v.failures.map((f: any) => [f.fileName, f.retryable]))).toEqual({ "job.docx": true, "photo.docx": false });
  const rep = (await U[0].get(`/api/batches/${b.id}/report`)).body;
  expect(Object.fromEntries(rep.files.filter((f: any) => f.fileName !== "still.docx").map((f: any) => [f.fileName, f.retryEligible]))).toEqual({ "job.docx": true, "photo.docx": false });
  expect((await U[0].post(`/api/batches/${b.id}/retry`)).body.retried).toBe(1);
  await U[0].post(`/api/batches/${b.id}/cancel`);
}, 60000);
