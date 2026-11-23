// R8 (docs/learning/ERROR_REGISTER.md): the same candidate-and-job pair gets the same assessment whether a recruiter starts from the candidate
// (best jobs for this person) or from the job (best people for this job). Ranking positions may differ, because the comparison pools differ; the
// pair's own result may not. Invented documents only.
import { afterAll, beforeAll, expect, test } from "vitest";
import { sampleCv, sampleJob } from "./fixtures";
import { setupTestDb, type TestDb, sleep, spawnProc, type Proc } from "./helpers";

const PORT = 8809, base = `http://localhost:${PORT}`;
let tdb: TestDb, server: Proc;
const run = crypto.randomUUID().slice(0, 8), EMAIL = `both-ways-${run}@example.test`, PASSWORD = "both-ways-password-1";
let cookie = "";
const req = (path: string, init: RequestInit = {}) => fetch(base + path, { ...init, headers: { ...(init.headers ?? {}), cookie, origin: "http://localhost:5173" } });
const post = (path: string, body: unknown) => req(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
async function publish(kind: "cv" | "jd", bytes: Uint8Array | Buffer, name: string): Promise<string> {
  const f = new FormData(); f.append("kind", kind); f.append("file", new File([bytes], name));
  const doc: any = await (await req("/api/documents", { method: "POST", body: f })).json();
  let d: any = { status: "processing" };
  for (let i = 0; i < 300 && d.status === "processing"; i++) { await sleep(200); d = await (await req(`/api/documents/${doc.id}`)).json(); }
  expect(d.status).toBe("published");
  return d.recordId;
}

beforeAll(async () => {
  tdb = await setupTestDb({ PORT: String(PORT) });
  await tdb.createUser("Both ways", EMAIL, "Both Ways", PASSWORD);
  server = spawnProc(["tsx", "src/index.ts"], { env: tdb.env, stdout: "ignore", stderr: "inherit" });
  for (let i = 0; i < 300; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch {} await sleep(100); }
  const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}, 120000);
afterAll(async () => { server?.kill(); await tdb?.teardown(); }, 60000);

test("a pair's assessment is identical from the candidate's side and from the job's side; only the pools differ", async () => {
  const [c1, c2] = [await publish("cv", await sampleCv("Both Ways One"), "one.docx"), await publish("cv", await sampleCv("Both Ways Two", "Built Kubernetes platforms on AWS."), "two.docx")];
  const [j1] = [await publish("jd", await sampleJob(), "job.docx")];
  const fromCandidate: any[] = await (await post("/api/matches/bulk", { candidateId: c1 })).json();
  const fromJob: any[] = await (await post("/api/matches/bulk", { jobId: j1 })).json();
  const a = fromCandidate.find((r) => r.job.id === j1).matchResult, b = fromJob.find((r) => r.candidate.id === c1).matchResult;
  const { id: _a, ...left } = a, { id: _b, ...right } = b;   // each run is stored as its own immutable snapshot, so only the snapshot id differs
  expect(right).toEqual(left);
  expect(fromJob.map((r) => r.candidate.id).sort()).toEqual([c1, c2].sort());   // the job's pool holds both candidates; the candidate's pool, the one job
}, 180000);
