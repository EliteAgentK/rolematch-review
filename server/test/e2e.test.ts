import { afterAll, beforeAll, expect, test } from "vitest";
import { sampleCv, sampleJob } from "./fixtures";
import { setupTestDb, type TestDb, sleep, spawnProc, type Proc } from "./helpers";

const API_PORT = 8791;
const base = `http://localhost:${API_PORT}`;
let tdb: TestDb;
let server: Proc;

const extra = { PORT: String(API_PORT), WORKER_CONCURRENCY: "6", PER_ORG_CONCURRENCY: "6" };

class Client {
  jar = new Map<string, string>();
  async req(path: string, init: RequestInit = {}) {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(base + path, { ...init, headers: { ...(init.headers ?? {}), cookie, origin: "http://localhost:5173" } });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); const v = kv.slice(i + 1); if (v) this.jar.set(kv.slice(0, i), v); else this.jar.delete(kv.slice(0, i)); }
    return res;
  }
  json = (path: string, body: unknown, method = "POST") => this.req(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  async upload(kind: "cv" | "jd", bytes: Uint8Array | Buffer, name: string) {
    const f = new FormData();
    f.append("kind", kind);
    f.append("file", new File([bytes], name));
    return this.req("/api/documents", { method: "POST", body: f });
  }
}

const A = new Client(), B = new Client();
const run = crypto.randomUUID().slice(0, 8); // unique emails per run so a crashed run can never block the next
const EMAIL_A = `a-${run}@example.test`, EMAIL_B = `b-${run}@example.test`;
const PW_A = "correct-horse-battery", PW_B = "another-long-password";
// The sign-in tests use a person of their own: a person is signed in on one device at a time (owner, 16 Nov 2026), so signing A in again elsewhere
// would end the sign-in the other tests work with.
const EMAIL_S = `s-${run}@example.test`, PW_S = "signs-in-and-out-alone";

beforeAll(async () => {
  tdb = await setupTestDb(extra);
  await tdb.createUser("Org A", EMAIL_A, "User A", PW_A);
  await tdb.createUser("Org B", EMAIL_B, "User B", PW_B);
  await tdb.createUser("Org S", EMAIL_S, "User S", PW_S);
  server = spawnProc(["tsx", "src/index.ts"], { env: tdb.env, stdout: "ignore", stderr: "inherit" });
  for (let i = 0; i < 300; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch {} await sleep(100); }
  expect((await A.json("/api/auth/login", { email: EMAIL_A, password: PW_A })).status).toBe(200);
  expect((await B.json("/api/auth/login", { email: EMAIL_B, password: PW_B })).status).toBe(200);
}, 120000);
afterAll(async () => { server?.kill(); await tdb?.teardown(); }, 60000);

async function waitForDoc(c: Client, id: string, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const d: any = await (await c.req(`/api/documents/${id}`)).json();
    if (d.status !== "processing") return d;
    await sleep(150);
  }
  throw new Error("timed out waiting for document");
}

test("auth: wrong password and anonymous access are refused", async () => {
  const c = new Client();
  expect((await c.req("/api/candidates")).status).toBe(401);
  expect((await c.json("/api/auth/login", { email: EMAIL_S, password: "nope" })).status).toBe(401);
  expect((await c.json("/api/auth/login", { email: EMAIL_S, password: PW_S })).status).toBe(200);
  expect((await c.req("/api/candidates")).status).toBe(200);
  const evil = await fetch(base + "/api/auth/logout", { method: "POST", headers: { origin: "https://evil.example" } });
  expect(evil.status).toBe(403);
});

test("auth: after signing out, a copy of the old sign-in cookies no longer works (tokens are checked on this server)", async () => {
  const c = new Client();
  expect((await c.json("/api/auth/login", { email: EMAIL_S, password: PW_S })).status).toBe(200);
  const copy = new Client(); copy.jar = new Map(c.jar);
  expect((await copy.req("/api/candidates")).status).toBe(200);
  expect((await c.req("/api/auth/logout", { method: "POST" })).status).toBeLessThan(300);
  expect((await copy.req("/api/candidates")).status).toBe(401);
});

test("uploads: fake PDFs are rejected by content, not by name", async () => {
  const c = A;
  const res = await c.upload("cv", new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff, 0, 0, 0xb8, 0, 0, 0]), "cv.pdf"); // a Windows program: binary, so not text either
  expect(res.status).toBe(415);
});

test("a candidate stays invisible until processing completes, then matching works", async () => {
  const c = A;
  const cvBytes = await sampleCv();
  const cvRes = await c.upload("cv", cvBytes, "jordan.docx");
  expect(cvRes.status).toBe(202);
  const cvDoc: any = await cvRes.json();
  expect((((await (await c.req("/api/candidates")).json()) as any).items).length).toBe(0); // still processing

  const dup: any = await (await c.upload("cv", cvBytes, "jordan-copy.docx")).json();
  expect(dup.duplicate).toBe(true);
  expect(dup.id).toBe(cvDoc.id);

  const jdDoc: any = await (await c.upload("jd", await sampleJob(), "job.docx")).json();
  const doneCv = await waitForDoc(c, cvDoc.id);
  const doneJd = await waitForDoc(c, jdDoc.id);
  expect(doneCv.status).toBe("published");
  expect(doneJd.status).toBe("published");

  const candidates: any[] = ((await (await c.req("/api/candidates")).json()) as any).items;
  expect(candidates.length).toBe(1);
  const cand = candidates[0];
  expect(cand.name).toBe("Jordan Example");
  expect(cand.skills).toContain("TypeScript");
  expect(cand.originalDocumentUrl).toContain("/original");

  const orig = await c.req(cand.originalDocumentUrl);
  expect(orig.status).toBe(200);
  expect((await orig.arrayBuffer()).byteLength).toBeGreaterThan(1000);

  const jobs: any[] = ((await (await c.req("/api/jobs")).json()) as any).items;
  expect(jobs[0].status).toBe("draft");
  const match: any = await (await c.json("/api/matches", { candidateId: cand.id, jobId: jobs[0].id })).json();
  // Matching is the AI's alone (owner, 9 Nov 2026; aiMatch.ts). With no AI here a match is saved without a score and says why: no rules score stands in for it.
  expect(match.ai).toMatchObject({ state: "not_checked" });
  expect(match.ai.reason).toMatch(/switched off/);
  expect(match.evidence).toEqual([]);

  // edit with optimistic concurrency + audit (location is one of the fields a recruiter may correct by default; see editPolicy.ts)
  const edit = await c.json(`/api/candidates/${cand.id}`, { location: "Cape Town, South Africa", version: cand.version, changeKind: "extraction_correction" }, "PUT");
  expect(edit.status).toBe(200);
  const stale = await c.json(`/api/candidates/${cand.id}`, { location: "Other", version: cand.version, changeKind: "extraction_correction" }, "PUT");
  expect(stale.status).toBe(409);
  const trail: any[] = await (await c.req(`/api/audit?entityId=${cand.id}`)).json() as any[];
  expect(trail.some((a) => a.action === "candidate.edited" && a.detail.changes.location.to === "Cape Town, South Africa")).toBe(true);   // the trail keeps the values as saved; the screen shows the town
  expect(trail.some((a) => a.action === "match.run")).toBe(true);
});

test("the same person in a different file is flagged as a possible duplicate, never merged", async () => {
  const c = A;
  const before = ((await (await c.req("/api/candidates")).json()) as any).items.length;
  const second: any = await (await c.upload("cv", await sampleCv("Jordan Example", "Also volunteers at a coding club on weekends."), "jordan-new-version.docx")).json();
  expect(second.duplicate).toBeUndefined();              // different bytes: a new file
  const done = await waitForDoc(c, second.id);
  expect(done.status).toBe("published");
  const items: any[] = ((await (await c.req("/api/candidates")).json()) as any).items;
  expect(items.length).toBe(before + 1);                 // nothing merged: a person decides
  const fresh = items.find((x) => x.id === done.recordId);
  expect(fresh.review.state).toBe("needs_review");
  expect(fresh.review.reasons.join(" ")).toContain("already in your list");
});

test("tenant isolation: another organisation sees nothing and cannot fetch by id", async () => {
  const a = A, b = B;
  const aCands: any[] = ((await (await a.req("/api/candidates")).json()) as any).items;
  expect(aCands.length).toBeGreaterThan(0);
  expect((((await (await b.req("/api/candidates")).json()) as any).items).length).toBe(0);
  expect((await b.req(`/api/candidates/${aCands[0].id}`)).status).toBe(404);
  expect((await b.req(aCands[0].originalDocumentUrl)).status).toBe(404);
});

test("CONCURRENCY: 12 uploads at once all publish and the server stays responsive", async () => {
  const c = B;
  const started = Date.now();
  const docs: any[] = [];
  const files = await Promise.all(Array.from({ length: 12 }, (_, i) => sampleCv(`Person ${String.fromCharCode(65 + i)}${"abcdefghijkl"[i]}`)));   // names without digits: the reader needs a real-looking name
  docs.push(...(await Promise.all(files.map(async (f, i) => (await c.upload("cv", f, `cv${i}.docx`)).json()))));
  expect(docs.every((d) => d.status === "processing")).toBe(true);

  // While 12 documents are being read, other requests must not wait.
  const latencies: number[] = [];
  let finished = false;
  const watcher = (async () => {
    while (!finished) { const t = performance.now(); await c.req("/api/health"); await c.req("/api/candidates"); latencies.push(performance.now() - t); await sleep(100); }
  })();
  // Poll the way the browser does: one list request, not one per document.
  const end = Date.now() + 40000;
  while (Date.now() < end) {
    const pending = ((await (await c.req("/api/documents")).json()) as any[]).filter((d) => d.status === "processing");
    if (!pending.length) break;
    await sleep(500);
  }
  const elapsed = Date.now() - started; // time until every document is published
  finished = true;
  const results = await Promise.all(docs.map((d) => waitForDoc(c, d.id, 5000)));
  await watcher;

  expect(results.every((r) => r.status === "published")).toBe(true);
  expect(latencies.length).toBeGreaterThan(0);   // the built-in reader publishes 12 documents in about a second against a local database, so few samples fit
  // Every ordinary request involves a network round trip to Supabase, so allow for that; serial blocking would show as many seconds.
  expect(Math.max(...latencies)).toBeLessThan(4000); // measured 1.5 to 2.8 s on Node with a 3-connection test pool; real blocking would show 24 s or more
  console.log(`12 uploads published in ${elapsed}ms; slowest unrelated request: ${Math.round(Math.max(...latencies))}ms`);
}, 60000);
