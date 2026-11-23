// Run by publish-once.test.ts against a throw-away schema: two runs of one document publish at the same moment (a job re-queued while it was
// still running, review 16 Nov 2026, B-H3). The document row is held while both reach the database, so both are in flight at once, every time.
import { forPortal, platformSql } from "../../src/db";
import { publishDraft } from "../../src/pipeline";

const [org, portal, docId] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
await platformSql`insert into orgs (id, name) values (${org}, 'Publish Probe')`;
await platformSql`insert into portals (id, org_id, name) values (${portal}, ${org}, 'P1')`;
await platformSql`insert into documents (id, org_id, portal_id, kind, original_name, mime, size, sha256, storage_path, status, stage)
  values (${docId}, ${org}, ${portal}, 'cv', 'probe.pdf', 'application/pdf', 10, ${"p".repeat(64)}, ${`${org}/probe.pdf`}, 'processing', 'validating')`;
const [doc] = await platformSql`select * from documents where id = ${docId}`;
const draft = { record: { name: "Probe Person", skills: [], workHistory: [], education: [] }, confidence: 0.9, meta: { method: "probe" }, review: { state: "ok", reasons: [] } };

let release!: () => void;
const held = new Promise<void>((r) => { release = r; });
const holding = platformSql.begin(async (q) => { await q`select 1 from documents where id = ${docId} for no key update`; await held; });
await new Promise((r) => setTimeout(r, 300));
const runs = forPortal(org, portal, () => Promise.allSettled([publishDraft(doc, draft, "run-1"), publishDraft(doc, draft, "run-2")]));
await new Promise((r) => setTimeout(r, 1500));
release(); await holding;
const settled = await runs;

const [{ n }] = await platformSql`select count(*)::int as n from candidates where document_id = ${docId}`;
const [{ a }] = await platformSql`select count(*)::int as a from audit_events where entity_type = 'candidate' and action = 'candidate.published' and org_id = ${org}`;
const [d] = await platformSql`select status, record_id from documents where id = ${docId}`;
// A file cancelled meanwhile (Cancel on its batch) is never published by a run that had already started reading it (review 16 Nov 2026, B-M1).
const cancelled = crypto.randomUUID();
await platformSql`insert into documents (id, org_id, portal_id, kind, original_name, mime, size, sha256, storage_path, status, stage, error_code)
  values (${cancelled}, ${org}, ${portal}, 'cv', 'cancelled.pdf', 'application/pdf', 10, ${"c".repeat(64)}, ${`${org}/cancelled.pdf`}, 'exception', 'received', 'CANCELLED')`;
const [late] = await platformSql`select * from documents where id = ${cancelled}`;
await forPortal(org, portal, () => publishDraft({ ...late, status: "processing" }, draft, "late-run"));
const [{ c: cancelledPublished }] = await platformSql`select count(*)::int as c from candidates where document_id = ${cancelled}`;
console.log(JSON.stringify({ cancelledPublished, candidates: n, publishedAudits: a, status: d.status, linked: !!d.record_id, errors: settled.filter((s) => s.status === "rejected").map((s: any) => String(s.reason?.message ?? s.reason)) }));
await platformSql.end({ timeout: 5 });
process.exit(0);
