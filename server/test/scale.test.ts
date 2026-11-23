import { afterAll, beforeAll, expect, test } from "vitest";
import postgres from "postgres";
import { adminDeleteUser } from "../src/supabase";
import { sampleCv } from "./fixtures";
import { setupTestDb, type TestDb, sleep, spawnProc, type Proc } from "./helpers";

const PORT = 8798, base = `http://localhost:${PORT}`;
// Rows seeded straight into the database (not through the application) must say which portal they belong to; the column takes it from the session setting, as the application sets it.
const seeders = new Map<string, postgres.Sql>();
// One connection per organisation that already carries the portal setting for its whole life, so each seeded row is one plain round trip (as it was before portals).
const seed = async (orgId: string, text: string, params: unknown[]) => {
  let c = seeders.get(orgId);
  if (!c) { const p = (await admin.unsafe(`select id from ${q("portals")} where org_id = $1 order by created_at limit 1`, [orgId]))[0].id as string; c = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {}, connection: { search_path: tdb.schema }, idle_timeout: 0 }); await c.unsafe("select set_config('app.portal_id', $1, false)", [p]); seeders.set(orgId, c); }   // one pinned connection, the setting held for its life
  return c.unsafe(text, params as any[]);
};
const run = crypto.randomUUID().slice(0, 8);
let tdb: TestDb, server: Proc, admin: postgres.Sql;
interface Org { cookie: string; orgId: string; userId: string }
const orgs: Record<string, Org> = {};
const q = (s: string) => `"${tdb.schema}".${s}`;

async function signup(tag: string): Promise<Org> {
  const res = await fetch(base + "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173", "x-forwarded-for": `10.3.${tag.length}.${Math.floor(Math.random() * 200)}` }, body: JSON.stringify({ name: `Scale ${tag}`, orgName: `Scale Org ${tag} ${run}`, email: `sc-${run}-${tag}@example.test`, password: "a-long-enough-password-1" }) });
  const body: any = await res.json();
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => !c.endsWith("=")).join("; ");
  return { cookie, orgId: body.user.orgId, userId: body.user.userId };
}
const get = (o: Org, path: string) => fetch(base + path, { headers: { cookie: o.cookie } });
const page = async (o: Org, qs = "") => (await (await get(o, `/api/candidates${qs}`)).json()) as any;

/** Inserts a published candidate (with its document) straight into the database. */
async function addCandidate(o: Org, i: number, data: Record<string, unknown>, ageSeconds: number) {
  const docId = crypto.randomUUID(), id = crypto.randomUUID();
  await seed(o.orgId, `insert into ${q("documents")} (id, org_id, kind, original_name, mime, size, sha256, storage_path, status, stage, created_by, created_at) values ($1,$2,'cv',$3,'docx',100,$4,'x','published','ready',$5, now() - ($6 * interval '1 second'))`, [docId, o.orgId, `cv${i}.docx`, `${run}-${o.orgId}-${i}`, o.userId, ageSeconds]);
  await seed(o.orgId, `insert into ${q("candidates")} (id, org_id, document_id, data, extracted, created_at) values ($1,$2,$3,$4,$4,now() - ($5 * interval '1 second'))`, [id, o.orgId, docId, { avatar: "", rating: 0, experience: "", appliedDate: "2026-01-01", workHistory: [], ...data }, ageSeconds]);
  return { id, docId };
}

beforeAll(async () => {
  tdb = await setupTestDb({ PORT: String(PORT), SIGNUP_REQUIRE_CODE: "false", TRUST_PROXY: "true", LIMIT_DOCS_PER_DAY: "40", LIMIT_STORAGE_MB: "1", LIMIT_IN_PROGRESS: "5", LIMIT_MATCHES_PER_HOUR: "10" });
  admin = postgres(process.env.DATABASE_URL!, { max: 2 });
  server = spawnProc(["tsx", "src/index.ts"], { env: tdb.env, stdout: "ignore", stderr: "ignore" });
  for (let i = 0; i < 300; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch {} await sleep(100); }
  for (const tag of ["a", "b", "docs", "store", "busy", "match"]) orgs[tag] = await signup(tag);
}, 180000);

afterAll(async () => {
  for (const c of seeders.values()) await c.end().catch(() => {});
  server?.kill(); await admin?.close(); await tdb?.teardown();
  const a = postgres(process.env.DATABASE_URL!, { max: 1 });
  try { for (const u of await a.unsafe(`select id from auth.users where email like 'sc-${run}-%@example.test'`)) await adminDeleteUser(u.id); } finally { await a.end(); }
}, 120000);

test("60 records page through 25 at a time with no gaps or duplicates, newest first", async () => {
  const A = orgs.a;
  for (let i = 1; i <= 60; i++) await addCandidate(A, i, { name: `Person ${String(i).padStart(3, "0")}`, role: i % 2 ? "Developer" : "Nurse", status: i <= 7 ? "shortlisted" : "new", skills: i % 5 === 0 ? ["Welding", "Pipe fitting"] : ["Excel"], location: "Cape Town, South Africa", email: `p${i}@example.test` }, 600 - i);
  const seen: string[] = [];
  let cursor: string | null = null, pages = 0;
  do {
    const p: any = await page(A, `?limit=25${cursor ? `&cursor=${cursor}` : ""}`);
    expect(p.total).toBe(60);
    seen.push(...p.items.map((c: any) => c.name));
    cursor = p.nextCursor; pages++;
  } while (cursor && pages < 10);
  expect(pages).toBe(3);
  expect(seen.length).toBe(60);
  expect(new Set(seen).size).toBe(60);
  expect(seen[0]).toBe("Person 060"); // newest first: higher numbers were created more recently
  expect(seen[59]).toBe("Person 001");
});

test("page size is bounded: a huge or zero limit cannot pull everything or break", async () => {
  expect((await page(orgs.a, "?limit=100000")).items.length).toBe(60); // clamped to 100, only 60 exist
  expect((await page(orgs.a, "?limit=0")).items.length).toBe(1);
  expect((await page(orgs.a, "?limit=abc")).items.length).toBeGreaterThan(0);
});

test("search: every word must match, any order, any case; filters and status work", async () => {
  const A = orgs.a;
  expect((await page(A, "?q=person%20057")).total).toBe(1);
  expect((await page(A, "?q=PERSON%20057")).total).toBe(1);
  expect((await page(A, "?q=057%20person")).total).toBe(1);
  expect((await page(A, "?q=welding")).total).toBe(12); // every fifth of 60
  expect((await page(A, "?q=welding%20person%20010")).total).toBe(1);
  expect((await page(A, "?q=no-such-thing")).total).toBe(0);
  expect((await page(A, "?q=cape%20town")).total).toBe(60);
  expect((await page(A, "?status=shortlisted")).total).toBe(7);
  expect((await page(A, "?status=shortlisted&q=welding")).total).toBe(1); // only Person 005 is both
});

test("hostile search text is treated as plain text and does nothing", async () => {
  const A = orgs.a;
  for (const evil of ["%25", "_", "'%3B%20drop%20table%20candidates%3B%20--", "%5C"]) expect((await page(A, `?q=${evil}`)).total).toBe(0);
  expect((await page(A, "")).total).toBe(60); // still all there
  const bad = await page(A, "?cursor=not-a-real-cursor");
  expect(bad.items.length).toBe(25); // a bad cursor is ignored, not an error
});

test("another organisation sees none of it", async () => {
  expect((await page(orgs.b, "")).total).toBe(0);
  expect((await page(orgs.b, "?q=person")).total).toBe(0);
});

test("fair use: the daily upload limit, with a clear message", async () => {
  const o = orgs.docs;
  for (let i = 0; i < 40; i++) await addCandidate(o, i, { name: `Filler ${i}`, role: "x", status: "new", skills: [] }, 5);
  const f = new FormData(); f.append("kind", "cv"); f.append("file", new File([await sampleCv("Over Limit")], "x.docx"));
  const res = await fetch(base + "/api/documents", { method: "POST", headers: { cookie: o.cookie, origin: "http://localhost:5173" }, body: f });
  expect(res.status).toBe(429);
  const body: any = await res.json();
  expect(body.error.code).toBe("QUOTA-001");
  expect(body.error.message).toContain("limit of 40");
  const usage: any = await (await get(o, "/api/usage")).json();
  expect(usage.usage.documentsToday).toBeGreaterThanOrEqual(40);
  expect(usage.limits.documentsPerDay).toBe(40);
});

test("fair use: the storage allowance", async () => {
  const o = orgs.store;
  await seed(o.orgId, `insert into ${q("documents")} (id, org_id, kind, original_name, mime, size, sha256, storage_path, status, stage, created_by) values ($1,$2,'cv','big.pdf','pdf',1048000,$3,'x','published','ready',$4)`, [crypto.randomUUID(), o.orgId, `${run}-big`, o.userId]);
  const f = new FormData(); f.append("kind", "cv"); f.append("file", new File([await sampleCv("Storage")], "x.docx"));
  const res = await fetch(base + "/api/documents", { method: "POST", headers: { cookie: o.cookie, origin: "http://localhost:5173" }, body: f });
  expect(res.status).toBe(429);
  expect(((await res.json()) as any).error.code).toBe("QUOTA-002");
});

test("fair use: too many documents already waiting", async () => {
  const o = orgs.busy;
  for (let i = 0; i < 5; i++) await seed(o.orgId, `insert into ${q("queue")} (id, org_id, type, payload, status, run_after) values ($1,$2,'noop',$3,'queued', now() + interval '1 hour')`, [crypto.randomUUID(), o.orgId, {}]);
  const f = new FormData(); f.append("kind", "cv"); f.append("file", new File([await sampleCv("Busy")], "x.docx"));
  const res = await fetch(base + "/api/documents", { method: "POST", headers: { cookie: o.cookie, origin: "http://localhost:5173" }, body: f });
  expect(res.status).toBe(429);
  expect(((await res.json()) as any).error.code).toBe("QUOTA-003");
});

test("fair use: the hourly match limit", async () => {
  const o = orgs.match;
  const c = await addCandidate(o, 1, { name: "Match Person", role: "Dev", status: "new", skills: ["React"] }, 5);
  const jobId = crypto.randomUUID(), jdoc = crypto.randomUUID();
  await seed(o.orgId, `insert into ${q("documents")} (id, org_id, kind, original_name, mime, size, sha256, storage_path, status, stage, created_by) values ($1,$2,'jd','j.docx','docx',100,$3,'x','published','ready',$4)`, [jdoc, o.orgId, `${run}-jd`, o.userId]);
  await seed(o.orgId, `insert into ${q("jobs")} (id, org_id, document_id, data, extracted) values ($1,$2,$3,$4,$4)`, [jobId, o.orgId, jdoc, { title: "Dev", company: "X", location: "", department: "", skills: [], type: "", description: "", requirements: ["Experience with React."], responsibilities: [], postedDate: "2026-01-01", status: "open" }]);
  for (let i = 0; i < 10; i++) await seed(o.orgId, `insert into ${q("matches")} (id, org_id, candidate_id, job_id, candidate_version, job_version, engine_version, result, created_by) values ($1,$2,$3,$4,1,1,'x',$5,$6)`, [crypto.randomUUID(), o.orgId, c.id, jobId, {}, o.userId]);
  const res = await fetch(base + "/api/matches", { method: "POST", headers: { cookie: o.cookie, origin: "http://localhost:5173", "content-type": "application/json" }, body: JSON.stringify({ candidateId: c.id, jobId }) });
  expect(res.status).toBe(429);
  expect(((await res.json()) as any).error.code).toBe("QUOTA-004");
});

test("the queue is fair between organisations: a small organisation is not stuck behind a big one's backlog", async () => {
  server.kill(); await server.exited; // the running server would otherwise claim the fixture jobs itself
  const p = spawnProc(["tsx", "test/fixtures/fairness.ts"], { env: tdb.env, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text();
  await p.exited;
  const order: string[] = JSON.parse(out.trim().split("\n").pop()!);
  // Workers never finish in this fixture, so counts of running jobs stay level; the small organisation must still get in at once.
  expect(order.indexOf("small")).toBeGreaterThanOrEqual(0);
  expect(order.indexOf("small")).toBeLessThan(2); // plain first-come-first-served would put it at position 20
});
