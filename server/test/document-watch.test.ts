import { afterAll, beforeAll, expect, test } from "vitest";
import { makeWorld, sleep, type World } from "./portalKit";

// A document is never left "being read" with nothing behind it (owner, 10 Nov 2026: two job descriptions stayed at "Being read by the AI" after their
// batch had finished; "I need this to never be an issue again"). The live state is made here exactly: a document waiting for the AI's reading
// (status processing, stage auditing, a draft waiting) with no queued work for it, as a restart between marking it and queueing its reading left it.
// The watch (src/documentWatch.ts) sends it on and it is published; one already restarted three times is stopped with Retry instead. Invented documents.
let w: World, jobDoc = "";
const jd = new File([["Payroll Administrator", "Company: Silver Acorn Financial Group", "Location: Johannesburg", "Requirements", "- Two years of payroll experience.", "Responsibilities", "- Run the monthly payroll for 400 staff and reconcile the payroll accounts every month."].join("\n")], "payroll.txt", { type: "text/plain" });
const docOf = async (id: string) => (await w.users[0].get(`/api/documents/${id}`)).body;
const until = async (id: string, done: (d: any) => boolean) => { let d: any; for (let i = 0; i < 300; i++) { d = await docOf(id); if (done(d)) return d; await sleep(200); } return d; };
const T = () => w.admin(w.tdb.schema);
/** A copy of the published document, put back into the state the live ones were left in: waiting for the AI's reading, nothing queued for it. */
const stuckCopy = async (rescuedBefore = 0) => {
  const id = crypto.randomUUID();
  await w.admin.begin(async (q) => {
    await q`create temp table stuck on commit drop as select * from ${T()}.documents where id = ${jobDoc}`;
    await q`update stuck set id = ${id}, sha256 = ${crypto.randomUUID()}, status = 'processing', stage = 'auditing', record_id = null, batch_id = null,
      awaiting_audit = ${q.json({ record: {}, meta: {} })}, updated_at = now() - interval '1 hour'`;
    await q`insert into ${T()}.documents select * from stuck`;
    for (let i = 0; i < rescuedBefore; i++) await q`insert into ${T()}.audit_events (org_id, action, entity_type, entity_id, detail) select org_id, 'document.rescued', 'document', id, '{}' from ${T()}.documents where id = ${id}`;
  });
  return id;
};
const rescues = async (id: string) => Number((await w.admin`select count(*)::int as n from ${T()}.audit_events where entity_id = ${id} and action = 'document.rescued'`)[0].n);

beforeAll(async () => {
  w = await makeWorld(8999, 1, { DOCUMENT_STALL_MINUTES: "0", DOCUMENT_WATCH_MS: "1000" });
  jobDoc = (await w.users[0].upload(jd, { kind: "jd" })).body.id;
  expect((await until(jobDoc, (d) => d.status !== "processing")).status).toBe("published");
}, 300_000);
afterAll(async () => { await w?.stop(); }, 120_000);

test("a document waiting for an AI reading that was never queued is sent on again and published", async () => {
  const id = await stuckCopy();
  const d = await until(id, (x) => x.status !== "processing");
  expect(d.status).toBe("published");
  expect(await rescues(id)).toBe(1);
}, 120_000);

test("a document already restarted three times stops waiting and says so, with Retry", async () => {
  const id = await stuckCopy(3);
  const d = await until(id, (x) => x.status !== "processing");
  expect(d.status).toBe("exception");
  expect(d.errorCode).toBe("STALLED");
  expect(await rescues(id)).toBe(3);   // not sent again
}, 120_000);

test("a document still being worked on is left alone", async () => {
  await sleep(2500);   // two more watches: the published and stopped documents are untouched, nothing is queued again
  const queued = await w.admin`select count(*)::int as n from ${T()}.queue where status in ('queued', 'running')`;
  expect(Number(queued[0].n)).toBe(0);
}, 60_000);
