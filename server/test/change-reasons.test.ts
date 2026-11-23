// Every change to a field read from a document says why (store.ts, CHANGE_KINDS), so a correction of the reader can be told apart from new
// information, a preference or a disagreement; only a correction goes into the error register (migration 015). The recruiter's own work (notes,
// workflow status) needs no reason. docs/learning/TRAINING_AND_IMPROVEMENT_PLAN.md, milestone 1. Invented CV only.
import postgres from "postgres";
import { afterAll, beforeAll, expect, test } from "vitest";
import { sampleCv } from "./fixtures";
import { setupTestDb, type TestDb, sleep, spawnProc, type Proc } from "./helpers";

const PORT = 8808, base = `http://localhost:${PORT}`;
let tdb: TestDb, server: Proc, admin: postgres.Sql;
const run = crypto.randomUUID().slice(0, 8);
const S = () => `"${tdb.schema}"`;

class Client {
  jar = new Map<string, string>();
  async req(path: string, init: RequestInit = {}) {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(base + path, { ...init, headers: { ...(init.headers ?? {}), cookie, origin: "http://localhost:5173" } });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); const v = kv.slice(i + 1); if (v) this.jar.set(kv.slice(0, i), v); else this.jar.delete(kv.slice(0, i)); }
    return res;
  }
  json = (path: string, body: unknown, method = "POST") => this.req(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
const A = new Client(), B = new Client();
let cand: any;
const edit = async (c: Client, body: Record<string, unknown>) => {
  const fresh: any = await (await c.req(`/api/candidates/${cand.id}`)).json();
  return c.json(`/api/candidates/${cand.id}`, { version: fresh.version, ...body }, "PUT");
};
const register = () => admin.unsafe(`select * from ${S()}.error_register where record_id = $1 order by created_at`, [cand.id]);
const edits = () => admin.unsafe(`select detail from ${S()}.audit_events where entity_id = $1 and action = 'candidate.edited' order by created_at`, [cand.id]);

beforeAll(async () => {
  tdb = await setupTestDb({ PORT: String(PORT) });
  admin = postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {} });
  await tdb.createUser("Reasons A", `reasons-a-${run}@example.test`, "Recruiter A", "change-reasons-password-a");
  await tdb.createUser("Reasons B", `reasons-b-${run}@example.test`, "Recruiter B", "change-reasons-password-b");
  server = spawnProc(["tsx", "src/index.ts"], { env: tdb.env, stdout: "ignore", stderr: "inherit" });
  for (let i = 0; i < 300; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch {} await sleep(100); }
  expect((await A.json("/api/auth/login", { email: `reasons-a-${run}@example.test`, password: "change-reasons-password-a" })).status).toBe(200);
  expect((await B.json("/api/auth/login", { email: `reasons-b-${run}@example.test`, password: "change-reasons-password-b" })).status).toBe(200);
  const f = new FormData(); f.append("kind", "cv"); f.append("file", new File([await sampleCv("Reason Testperson")], "reasons.docx"));
  const doc: any = await (await A.req("/api/documents", { method: "POST", body: f })).json();
  let d: any = { status: "processing" };
  for (let i = 0; i < 300 && d.status === "processing"; i++) { await sleep(200); d = await (await A.req(`/api/documents/${doc.id}`)).json(); }
  expect(d.status).toBe("published");
  cand = await (await A.req(`/api/candidates/${d.recordId}`)).json();
}, 180000);
afterAll(async () => { server?.kill(); await admin?.end(); await tdb?.teardown(); }, 60000);

test("a field read from the CV cannot be changed without a reason, and nothing changes when it is refused", async () => {
  const before: any = await (await A.req(`/api/candidates/${cand.id}`)).json();
  const res = await edit(A, { location: "Gqeberha, South Africa" });
  expect(res.status).toBe(400);
  const body: any = await res.json();
  expect(body.error.code).toBe("VAL-005"); expect(body.error.fields).toEqual(["location"]);
  expect(body.error.changeKinds).toEqual(["extraction_correction", "candidate_update", "recruiter_preference", "disputed_interpretation"]);
  expect((await edit(A, { location: "Gqeberha, South Africa", changeKind: "because I said so" })).status).toBe(400);   // only the four reasons exist
  const after: any = await (await A.req(`/api/candidates/${cand.id}`)).json();
  expect(after.version).toBe(before.version); expect(after.location).toBe(before.location);
  expect(await register()).toHaveLength(0);
});

test("the recruiter's own notes need no reason; a person's stage is never edited on the person, only for a job", async () => {
  expect((await edit(A, { recruiterNotes: "Spoke to them on Tuesday." })).status).toBe(200);
  // The stage on the person is worked out from their status for each job (production review, 12 Nov 2026, P4): set it through a job, never here.
  const refused = await edit(A, { status: "interviewed" });
  expect(refused.status).toBe(403);
  const audited: any[] = await edits();
  expect(audited.every((a) => !("changeKind" in a.detail))).toBe(true);
});

test("every reason is recorded with the change; only a correction of what was read enters the error register", async () => {
  const original: any = await (await A.req(`/api/candidates/${cand.id}`)).json();
  expect((await edit(A, { location: "Polokwane, South Africa", changeKind: "candidate_update" })).status).toBe(200);
  expect((await edit(A, { location: "Mbombela, South Africa", changeKind: "recruiter_preference" })).status).toBe(200);
  expect((await edit(A, { location: "East London, South Africa", changeKind: "disputed_interpretation" })).status).toBe(200);
  expect(await register()).toHaveLength(0);
  expect((await edit(A, { email: "reason.testperson@example.test", phone: "082 000 1111", changeKind: "extraction_correction" })).status).toBe(200);

  const kinds = (await edits()).map((a: any) => a.detail.changeKind).filter(Boolean);
  expect(kinds).toEqual(["candidate_update", "recruiter_preference", "disputed_interpretation", "extraction_correction"]);
  const rows: any[] = await register();
  expect(rows.map((r) => r.field_path).sort()).toEqual(["email", "phone"]);
  const email = rows.find((r) => r.field_path === "email");
  expect(email).toMatchObject({ record_kind: "candidate", change_kind: "extraction_correction", status: "unverified", category: null, document_id: cand.documentId });
  expect(email.from_value).toBe(original.email); expect(email.to_value).toBe("reason.testperson@example.test");
  expect(email.parser_version).toMatch(/^\d+\.\d+\.\d+\+candidate-\d+$/);
  const [{ user_id }] = await admin.unsafe(`select user_id from ${S()}.members where email = $1`, [`reasons-a-${run}@example.test`]);
  expect(email.created_by).toBe(user_id);
});

test("register rows belong to their organisation: another organisation cannot write one, and its tenant role sees none of them", async () => {
  // B cannot correct A's record (it does not exist for B)
  expect((await B.json(`/api/candidates/${cand.id}`, { name: "Someone Else", changeKind: "extraction_correction" }, "PUT")).status).toBe(404);
  const rows: any[] = await register();
  expect(rows.length).toBeGreaterThan(0);
  expect(new Set(rows.map((r) => r.org_id)).size).toBe(1);
  const orgOf = async (email: string) => (await admin.unsafe(`select org_id from ${S()}.members where email = $1`, [email]))[0].org_id;
  const [orgA, orgB] = [await orgOf(`reasons-a-${run}@example.test`), await orgOf(`reasons-b-${run}@example.test`)];
  expect(rows[0].org_id).toBe(orgA);
  // what the database itself shows each organisation's tenant role (migration 015, the same rule as 014)
  const portalOf = async (org: string) => (await admin.unsafe(`select id from ${S()}.portals where org_id = $1 order by created_at limit 1`, [org]))[0].id;
  const seenBy = async (org: string) => { const portal = await portalOf(org); return admin.begin(async (q) => {   // the database shows a tenant role its own portal's rows only
    await q.unsafe(`select set_config('role', 'rolematch_tenant', true), set_config('app.org_id', $1, true), set_config('app.portal_id', $2, true)`, [org, portal]);
    return (await q.unsafe(`select count(*)::int c from ${S()}.error_register`))[0].c as number;
  }); };
  expect(await seenBy(orgA)).toBe(rows.length);
  expect(await seenBy(orgB)).toBe(0);
});

// Found 18 Nov 2026 (browser tests): a person's location leaves the server as their town only (store.ts hydrate, owner 11 Nov 2026), and the board
// saves a note by sending the whole record back. The town was then taken for a changed location: the note was refused with "Say why this field was
// changed", and with a reason given the stored place would have been cut down to the town.
test("saving a note with the whole record as the board shows it needs no reason, and keeps the stored place", async () => {
  await admin.unsafe(`update ${S()}.candidates set data = jsonb_set(data, '{location}', '"Rosebank, Johannesburg, Gauteng, South Africa"') where id = $1`, [cand.id]);
  const shown: any = await (await A.req(`/api/candidates/${cand.id}`)).json();
  expect(shown.location).not.toBe("Rosebank, Johannesburg, Gauteng, South Africa");   // the board is shown less than is stored
  const res = await A.json(`/api/candidates/${cand.id}`, { ...shown, recruiterNotes: "Phoned on Monday." }, "PUT");
  expect(res.status).toBe(200);
  const stored = await admin.unsafe(`select data->>'location' as location, data->>'recruiterNotes' as notes from ${S()}.candidates where id = $1`, [cand.id]);
  expect(stored[0].location).toBe("Rosebank, Johannesburg, Gauteng, South Africa");
  expect(stored[0].notes).toBe("Phoned on Monday.");
  // a real change of place still asks why
  const again: any = await (await A.req(`/api/candidates/${cand.id}`)).json();
  expect((await A.json(`/api/candidates/${cand.id}`, { ...again, location: "Durban" }, "PUT")).status).toBe(400);
});
