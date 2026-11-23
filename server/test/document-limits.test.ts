import { readFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterAll, beforeAll, expect, test } from "vitest";
import { makeWorld, sleep, type World } from "./portalKit";

// What one hostile or broken document may cost. Each one ends with a clear outcome, and the next document is still read.
let w: World;
const until = async <T,>(get: () => Promise<T | null | undefined>, ms = 60_000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) { const v = await get(); if (v) return v; } throw new Error("timed out"); };
const settled = (id: string) => until(async () => { const d = (await w.users[0].get(`/api/documents/${id}`)).body; return ["published", "exception"].includes(d.status) ? d : null; });
const good = () => new File([readFileSync(join(import.meta.dirname, "fixtures/journey/CV0501.docx"))], "CV0501.docx");
beforeAll(async () => { w = await makeWorld(8985, 1, { SIGNUP_REQUIRE_CODE: "false", MAX_EXPANDED_MB: "1", QUEUE_STALE_SECONDS: "2", QUEUE_HEARTBEAT_MS: "500" }); }, 300000);
afterAll(async () => { await w?.stop(); }, 120000);

test("a zip that unpacks too far is refused unopened, and the next document is still read", async () => {
  const bomb = zipSync({ "word/document.xml": new Uint8Array(30 * 1024 * 1024), "[Content_Types].xml": new TextEncoder().encode("<Types/>") }, { level: 9 });
  const up = await w.users[0].upload(new File([bomb as BlobPart], "big.docx"), { kind: "cv" });
  expect(bomb.length).toBeLessThan(200_000);
  const d = await settled(up.body.id);
  expect(d).toMatchObject({ status: "exception", errorCode: "FILE_EXPANDS_TOO_FAR" });
  expect((await settled((await w.users[0].upload(good(), { kind: "cv" })).body.id)).status).toBe("published");
}, 120000);

test("a job whose worker keeps dying stops at its limit and is reported as failed, instead of taking the worker down for ever", async () => {
  const up = await w.users[0].upload(new File([new TextEncoder().encode("Line one of a plain text file that is a CV for testing purposes.")], "plain.txt"), { kind: "cv" });
  const s = w.tdb.schema;
  await sleep(50);
  // the state a crash leaves: running, last seen long ago, every attempt used
  const id = "00000000-0000-4000-8000-" + Math.random().toString(16).slice(2, 14).padEnd(12, "0"), docId = up.body.id;
  await w.admin.unsafe(`update "${s}".documents set status = 'processing', error_code = null where id = $1`, [docId]);
  const [o] = await w.admin.unsafe(`select org_id, portal_id from "${s}".documents where id = $1`, [docId]);
  await w.admin.unsafe(`insert into "${s}".queue (id, org_id, portal_id, type, payload, status, attempts, max_attempts, locked_at) values ($1, $2, $3, 'process-document', '{"documentId":"${docId}"}'::jsonb, 'running', 3, 3, now() - interval '1 hour')`, [id, o.org_id, o.portal_id]);
  const row = await until(async () => { const [q] = await w.admin.unsafe(`select status, last_error from "${s}".queue where id = $1`, [id]); return q?.status === "failed" ? q : null; }, 30_000);
  expect(row.last_error).toContain("stopped on every attempt");
  expect((await until(async () => { const [d] = await w.admin.unsafe(`select status, error_code from "${s}".documents where id = $1`, [docId]); return d?.error_code ? d : null; }, 15_000)).error_code).toBe("PROCESSING_FAILED");
}, 120000);
