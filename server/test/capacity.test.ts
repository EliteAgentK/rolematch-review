import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { Browser, cvFile, makeWorld, sleep, type World } from "./portalKit";

// Shared portal capacity: 500 document slots per portal, combined across every recruiter, document type and batch, reserved for a whole batch and released
// exactly once when the batch closes. These tests use REAL recruiters (ten accounts in one portal) and the real HTTP API, signed in as the application would be.
// What they prove is coordination correctness; they say nothing about OCR or model throughput.
let w: World; let U: Browser[];
const reserve = (b: Browser, files: number, kind: "cv" | "jd" = "cv", requestKey?: string) => b.post("/api/batches", { kind, files, bytes: files * 1000, requestKey });
const cap = async (b = U[0]) => (await b.get("/api/capacity")).body;
// the state between tests: every reservation closed (directly in the database: fast, and the closing routes have their own tests below)
async function clear() { await w.admin.unsafe(`update "${w.tdb.schema}".upload_batches set cancelled_at = coalesce(cancelled_at, now()), reservation_state = 'released', released_at = coalesce(released_at, now()), finished_at = coalesce(finished_at, now()) where reservation_state = 'held'`); await w.admin.unsafe(`update ${'"' + w.tdb.schema + '"'}.portal_capacity c set reserved = coalesce((select sum(b.reserved_slots) from ${'"' + w.tdb.schema + '"'}.upload_batches b where b.portal_id = c.portal_id and b.reservation_state = 'held'), 0)`); }   // the counter follows the batches, as a real release would leave it
// The rate limits are tested on their own (ratelimit-portal.test.ts, default thresholds); here they are raised out of the way so these tests show the allowance's own behaviour.
const NO_RATE_LIMIT = JSON.stringify({ reserve_user: 100000, reserve_portal: 100000, reserve_org: 100000, status_user: 100000, status_portal: 100000, batch_action_user: 100000, upload_file_user: 100000, upload_file_portal: 100000, upload: 100000 });
beforeAll(async () => { w = await makeWorld(8810, 10, { RATE_OVERRIDES: NO_RATE_LIMIT }); U = w.users; }, 600000);
afterAll(async () => { await w?.stop(); }, 120000);
beforeEach(async () => { await clear(); });

test("five recruiters each submit 100 CVs at the same moment: all five batches are admitted and the portal is exactly full", async () => {
  const rs = await Promise.all(U.slice(0, 5).map((b) => reserve(b, 100)));
  expect(rs.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
  const c = await cap();
  expect(c).toMatchObject({ total: 500, reserved: 500, available: 0, cvReserved: 500, jdReserved: 0 });
  expect(c.batches.map((x: any) => x.submittedBy).sort()).toEqual(U.slice(0, 5).map((b) => b.email).sort());   // each batch shows its submitter's e-mail
  const sixth = await reserve(U[5], 1);
  expect(sixth.status).toBe(409); expect(sixth.body.error.code).toBe("CAPACITY-001"); expect(sixth.body.error.available).toBe(0);
  expect((await U[5].get("/api/candidates")).status).toBe(200);   // a full upload allowance blocks only uploads
});

test("ten recruiters each submit 30 documents: all 300 are admitted, shared between CVs and job descriptions", async () => {
  const rs = await Promise.all(U.map((b, i) => reserve(b, 30, i % 2 ? "jd" : "cv")));
  expect(rs.every((r) => r.status === 201)).toBe(true);
  expect(await cap()).toMatchObject({ reserved: 300, available: 200, cvReserved: 150, jdReserved: 150 });   // one allowance, not one per document type
  const again = await Promise.all(U.slice(0, 7).map((b) => reserve(b, 30)));   // 7 x 30 = 210 > 200 free: at most six more fit
  expect(again.filter((r) => r.status === 201).length).toBe(6);
  expect(again.filter((r) => r.status === 409).length).toBe(1);
  expect((await cap()).reserved).toBe(480);
});

test("one recruiter takes all 500 and nobody can be admitted until it closes", async () => {
  expect((await reserve(U[0], 500)).status).toBe(201);
  const r = await reserve(U[1], 1, "jd");
  expect(r.status).toBe(409); expect(r.body.error.available).toBe(0);
  expect((await reserve(U[0], 1)).status).toBe(409);   // not even the same person, not even one more document
  const mine = ((await U[0].get("/api/batches")).body as any[]).find((x) => x.reservedSlots === 500);
  expect((await U[0].post(`/api/batches/${mine.id}/cancel`)).status).toBe(200);   // closes the batch (nothing was being read)
  expect((await cap()).reserved).toBe(0);
  expect((await reserve(U[1], 1, "jd")).status).toBe(201);
});

test("simultaneous requests that together exceed the ceiling: exactly the ones that fit are admitted, never more than 500", async () => {
  for (let round = 0; round < 4; round++) {
    await clear();
    const rs = await Promise.all(U.slice(0, 6).map((b) => reserve(b, 150)));   // 6 x 150 = 900: three fit (450)
    expect(rs.filter((r) => r.status === 201).length).toBe(3);
    expect(rs.filter((r) => r.status === 409 && r.body.error.code === "CAPACITY-001").length).toBe(3);
    expect((await cap()).reserved).toBe(450);
  }
}, 240000);

test("a repeated submission (double click, retry after an uncertain answer) reserves once; a different person's identical key is separate", async () => {
  const key = crypto.randomUUID();
  const rs = await Promise.all([reserve(U[0], 40, "cv", key), reserve(U[0], 40, "cv", key), reserve(U[0], 40, "cv", key)]);
  expect(rs.every((r) => r.status === 201)).toBe(true);
  expect(new Set(rs.map((r) => r.body.id)).size).toBe(1);
  expect((await cap()).reserved).toBe(40);
  expect((await reserve(U[1], 40, "cv", key)).body.id).not.toBe(rs[0].body.id);
  expect((await cap()).reserved).toBe(80);
});

test("an all-or-nothing batch that does not fit says how many slots are free", async () => {
  await reserve(U[0], 450);
  const r = await reserve(U[1], 60);
  expect(r.status).toBe(409);
  expect(r.body.error).toMatchObject({ code: "CAPACITY-001", available: 50, requested: 60, total: 500 });
  expect(r.body.error.message).toMatch(/50 of 500 upload slots free and this selection needs 60/);
  expect((await cap()).reserved).toBe(450);   // nothing was taken
});

test("every portal member sees the same live figures, with the submitting account of each batch, and they converge after a release", async () => {
  const a = await reserve(U[2], 120, "jd"); expect(a.status).toBe(201);
  for (const b of [U[0], U[3], U[9]]) { const c = await cap(b); expect(c).toMatchObject({ reserved: 120, available: 380, jdReserved: 120 }); expect(c.batches[0]).toMatchObject({ kind: "jd", reserved: 120, submittedBy: U[2].email }); }
  await U[2].post(`/api/batches/${a.body.id}/cancel`);
  for (const b of [U[0], U[3], U[9]]) expect((await cap(b)).reserved).toBe(0);   // a poll later, everyone converges on the server's truth
});

test("matching consumes no upload slots and is not blocked by a full allowance", async () => {
  await reserve(U[0], 500);
  expect((await cap()).available).toBe(0);
  const res = await U[1].post("/api/matches", { candidateId: crypto.randomUUID(), jobId: crypto.randomUUID() });
  expect(res.status).toBe(404);   // reached the matcher (unknown ids), not refused for capacity
  expect(JSON.stringify(res.body)).not.toMatch(/CAPACITY|slot/i);
  expect((await cap()).reserved).toBe(500);   // and used none
  expect((await U[1].get("/api/candidates")).status).toBe(200); expect((await U[1].get("/api/jobs")).status).toBe(200);
});

test("a batch closes exactly once however many events or recoveries try to close it, and no capacity leaks", async () => {
  const b = (await reserve(U[0], 50)).body;
  const rs = await Promise.all(Array.from({ length: 8 }, () => U[0].post(`/api/batches/${b.id}/cancel`)));
  expect(rs.every((r) => r.status === 200)).toBe(true);
  expect((await cap()).reserved).toBe(0);
  const closed = await w.admin.unsafe(`select count(*)::int c from "${w.tdb.schema}".audit_events where action = 'batch.finished' and entity_id = $1`, [b.id]);
  expect(closed[0].c).toBe(1);   // released once
  await sleep(7000);              // two or more passes of the background reconciler (every 3 s here)
  expect((await w.admin.unsafe(`select count(*)::int c from "${w.tdb.schema}".audit_events where action = 'batch.finished' and entity_id = $1`, [b.id]))[0].c).toBe(1);
  expect((await cap()).reserved).toBe(0);
}, 60000);

test("an abandoned transfer is released by the reconciler after the lease; a batch with a file still being read is not", async () => {
  const abandoned = (await reserve(U[0], 30)).body, busy = (await reserve(U[1], 20)).body;
  const org = (await w.admin.unsafe(`select org_id, portal_id, created_by from "${w.tdb.schema}".upload_batches where id = $1`, [busy.id]))[0];
  const doc = crypto.randomUUID();
  await w.admin.unsafe(`insert into "${w.tdb.schema}".documents (id, org_id, portal_id, kind, original_name, mime, size, sha256, storage_path, status, stage, created_by, batch_id) values ($1::uuid,$2,$3,'cv','busy.docx','docx',10,$1::text,'x','processing','reading',$4,$5)`, [doc, org.org_id, org.portal_id, org.created_by, busy.id]);
  await w.admin.unsafe(`update "${w.tdb.schema}".upload_batches set last_activity_at = now() - interval '1 hour' where id = any($1)`, [[abandoned.id, busy.id]]);
  await sleep(7000);
  const held = async (id: string) => (await w.admin.unsafe(`select reservation_state s from "${w.tdb.schema}".upload_batches where id = $1`, [id]))[0].s;
  expect(await held(abandoned.id)).toBe("released");   // nothing in flight, nobody sending: slots return
  expect(await held(busy.id)).toBe("held");            // a late result could still arrive: slots stay
  expect((await cap()).reserved).toBe(20);
  await w.admin.unsafe(`update "${w.tdb.schema}".documents set status = 'exception', error_code = 'UNREADABLE' where id = $1`, [doc]);   // the document reaches an end state
  await sleep(7000);
  expect(await held(busy.id)).toBe("released");
  expect((await cap()).reserved).toBe(0);
}, 60000);
