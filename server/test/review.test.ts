import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, expect, test } from "vitest";
import { adminDeleteUser } from "../src/supabase";
import { reviewCandidate, reviewJob } from "../src/review";
import { setupTestDb, sleep, spawnProc, type Proc, type TestDb } from "./helpers";

const PORT = 8799, base = `http://localhost:${PORT}`;
const run = crypto.randomUUID().slice(0, 8);
let tdb: TestDb, server: Proc, admin: postgres.Sql;
interface Org { cookie: string }
const orgs: Record<string, Org> = {};
const sample = (dir: string, f: string) => new File([readFileSync(fileURLToPath(new URL(`../../sample-documents/${dir}/${f}`, import.meta.url)))], f);

async function signup(tag: string): Promise<Org> {
  const res = await fetch(base + "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173", "x-forwarded-for": `10.4.${tag.length}.${Math.floor(Math.random() * 200)}` }, body: JSON.stringify({ name: `Review ${tag}`, orgName: `Review Org ${tag} ${run}`, email: `rv-${run}-${tag}@example.test`, password: "a-long-enough-password-1" }) });
  await res.json();
  return { cookie: res.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => !c.endsWith("=")).join("; ") };
}
const get = (o: Org, p: string) => fetch(base + p, { headers: { cookie: o.cookie } });
const post = (o: Org, p: string, body: unknown) => fetch(base + p, { method: "POST", headers: { cookie: o.cookie, origin: "http://localhost:5173", "content-type": "application/json" }, body: JSON.stringify(body) });
async function upload(o: Org, kind: "cv" | "jd", file: File) {
  const f = new FormData(); f.append("kind", kind); f.append("file", file);
  const d: any = await (await fetch(base + "/api/documents", { method: "POST", headers: { cookie: o.cookie, origin: "http://localhost:5173" }, body: f })).json();
  for (let i = 0; i < 90; i++) { const x: any = await (await get(o, `/api/documents/${d.id}`)).json(); if (x.status !== "processing") return x; await sleep(1000); }
  throw new Error("document never finished");
}
const list = async (o: Org, qs: string) => (await (await get(o, `/api/candidates${qs}`)).json()) as any;

beforeAll(async () => {
  tdb = await setupTestDb({ PORT: String(PORT), SIGNUP_REQUIRE_CODE: "false", TRUST_PROXY: "true" });
  admin = postgres(process.env.DATABASE_URL!, { max: 2 });
  server = spawnProc(["tsx", "src/index.ts"], { env: tdb.env, stdout: "ignore", stderr: "ignore" });
  for (let i = 0; i < 300; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch {} await sleep(100); }
  orgs.a = await signup("a"); orgs.b = await signup("b");
}, 180000);

afterAll(async () => {
  server?.kill(); await admin?.end(); await tdb?.teardown();
  const a = postgres(process.env.DATABASE_URL!, { max: 1 });
  try { for (const u of await a.unsafe(`select id from auth.users where email like 'rv-${run}-%@example.test'`)) await adminDeleteUser(u.id); } finally { await a.end(); }
}, 120000);

test("the rules explain themselves: a thin CV is flagged with reasons, a full one is not", () => {
  const full = { name: "A", email: "a@x.test", phone: "1", role: "Dev", location: "CT", skills: ["a", "b", "c"], workHistory: [{ position: "Dev", company: "X", startDate: "2020-01" }], education: [{}] };
  expect(reviewCandidate(full, 0.7, {}, 2000).state).toBe("ok");
  const thin = reviewCandidate({ name: "A", email: "", phone: "", role: "", skills: [], workHistory: [], location: "", education: [] }, 0.3, { droppedUnsupported: ["x"] }, 100);
  expect(thin.state).toBe("needs_review");
  expect(thin.reasons.join(" ")).toMatch(/cannot be contacted/); expect(thin.reasons.join(" ")).toMatch(/No work history/); expect(thin.reasons.join(" ")).toMatch(/low \(30%\)/); expect(thin.reasons.join(" ")).toMatch(/Very little text/); expect(thin.reasons.join(" ")).toMatch(/dropped/);
  expect(reviewCandidate(full, 0.7, {}, 2000).notes).toEqual([]); // missing location/education alone are notes, not flags
  expect(reviewCandidate({ ...full, location: "", education: [] }, 0.7, {}, 2000).state).toBe("ok");
  expect(reviewJob({ title: "T", company: "C", requirements: [], preferredRequirements: [] }, 0.7, {}, 2000).reasons.join(" ")).toMatch(/cannot be matched/);
});

test("uploads are flagged when weakly extracted, and the list can show only those", async () => {
  const A = orgs.a;
  // A thin skills list goes to a person only where an organisation asks for that (Settings); this one does.
  const put = async (body: unknown) => fetch(base + "/api/settings", { method: "PUT", headers: { "content-type": "application/json", origin: "http://localhost:5173", cookie: A.cookie }, body: JSON.stringify(body) });
  const cur: any = await (await fetch(base + "/api/settings", { headers: { cookie: A.cookie, origin: "http://localhost:5173" } })).json();
  expect((await put({ version: cur.version, review: { ...cur.settings.review, minSkills: 9 } })).status).toBe(200);
  for (const f of ["cv01-thandi-mokoena.docx", "cv05-sipho-ndlovu.docx", "cv03-lindiwe-dlamini.pdf"]) expect((await upload(A, "cv", sample("cvs", f))).status).toBe("published");
  const all = await list(A, "");
  expect(all.total).toBe(3);
  const flagged = await list(A, "?review=needs_review");
  expect(flagged.total).toBeGreaterThanOrEqual(1);
  expect(flagged.total + (await list(A, "?review=ok")).total).toBe(3);
  for (const c of flagged.items) { expect(c.review.state).toBe("needs_review"); expect(c.review.reasons.length).toBeGreaterThan(0); }
});

test("a person clears the flag explicitly; it is audited, idempotent and respects versions", async () => {
  const A = orgs.a;
  const [target] = (await list(A, "?review=needs_review")).items;
  const stale = await post(A, `/api/candidates/${target.id}/review`, { version: target.version + 5 });
  expect(stale.status).toBe(409);
  const done: any = await (await post(A, `/api/candidates/${target.id}/review`, { version: target.version })).json();
  expect(done.reviewState).toBe("reviewed"); expect(done.review.reviewedAt).toBeTruthy(); expect(done.review.reasons.length).toBeGreaterThan(0); // the reasons stay on record
  expect(done.version).toBe(target.version + 1);
  const again: any = await (await post(A, `/api/candidates/${target.id}/review`, {})).json();
  expect(again.version).toBe(done.version); // confirming twice changes nothing
  expect((await list(A, "?review=needs_review")).total).toBe(1);
  expect((await list(A, "?review=reviewed")).total).toBe(1);
  // read the audit trail the way the product does (through the API, inside the organisation), not with a direct database login
  const trail: any[] = (await (await get(A, `/api/audit?entityId=${target.id}`)).json()) as any[];
  expect(trail.filter((e) => e.action === "candidate.review_confirmed").length).toBe(1);
});

test("editing a flagged record does not silently clear the flag", async () => {
  const A = orgs.a;
  const [flagged] = (await list(A, "?review=needs_review")).items;
  const res: any = await (await fetch(base + `/api/candidates/${flagged.id}`, { method: "PUT", headers: { cookie: A.cookie, origin: "http://localhost:5173", "content-type": "application/json" }, body: JSON.stringify({ location: "Durban, South Africa", version: flagged.version, changeKind: "candidate_update" }) })).json();
  expect(res.location).toBe("Durban"); expect(res.city).toBe("Durban");   // a person's place is shown as their town (places.ts)
  expect(res.reviewState).toBe("needs_review");
});

test("another organisation cannot review or see these records", async () => {
  const [flagged] = (await list(orgs.a, "?review=needs_review")).items;
  expect((await post(orgs.b, `/api/candidates/${flagged.id}/review`, {})).status).toBe(404);
  expect((await list(orgs.b, "?review=needs_review")).total).toBe(0);
});

test("jobs are reviewed too", async () => {
  const A = orgs.a;
  const j = await upload(A, "jd", sample("jobs", "job01-senior-developer.docx"));
  expect(j.status).toBe("published");
  const jobs: any = await (await get(A, "/api/jobs")).json();
  expect(jobs.items[0].review.state).toBe("ok");
});
