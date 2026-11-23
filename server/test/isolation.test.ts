// One organisation can never see, change or use another's records, through any endpoint. Organisation A holds a candidate, a job, a match, an edit
// and a settings change; organisation B then tries every route with A's ids, and its own lists and searches must show nothing of A's.
// The last test reads the routes from src/index.ts: a new endpoint fails here until it is added to ROUTES below and checked.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, test } from "vitest";
import { sampleCv, sampleJob } from "./fixtures";
import { setupTestDb, type TestDb, sleep, spawnProc, type Proc } from "./helpers";

const PORT = 8805, base = `http://localhost:${PORT}`;
let tdb: TestDb, server: Proc;

class Client {
  jar = new Map<string, string>();
  async req(path: string, init: RequestInit = {}) {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(base + path, { ...init, headers: { ...(init.headers ?? {}), cookie, origin: "http://localhost:5173" } });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); const v = kv.slice(i + 1); if (v) this.jar.set(kv.slice(0, i), v); else this.jar.delete(kv.slice(0, i)); }
    return res;
  }
  json = (path: string, body: unknown, method = "POST") => this.req(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  upload = (kind: "cv" | "jd", bytes: Uint8Array | Buffer, name: string) => { const f = new FormData(); f.append("kind", kind); f.append("file", new File([bytes], name)); return this.req("/api/documents", { method: "POST", body: f }); };
}

const A = new Client(), B = new Client();
const run = crypto.randomUUID().slice(0, 8);
const NAME = "Isolation Alphaperson";   // appears only in A's data: any of B's answers containing it is a leak
const a = { inv: "", member: "", portal: "", batch: "", cand: "", job: "", match: "", cvDoc: "", jdDoc: "", candVersion: 0, jdBytes: new Uint8Array() };

beforeAll(async () => {
  tdb = await setupTestDb({ PORT: String(PORT), WORKER_CONCURRENCY: "4", PER_ORG_CONCURRENCY: "4" });
  await tdb.createUser("Isolation A", `iso-a-${run}@example.test`, "User A", "isolation-password-a");
  await tdb.createUser("Isolation B", `iso-b-${run}@example.test`, "User B", "isolation-password-b");
  server = spawnProc(["tsx", "src/index.ts"], { env: tdb.env, stdout: "ignore", stderr: "inherit" });
  for (let i = 0; i < 300; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch {} await sleep(100); }
  expect((await A.json("/api/auth/login", { email: `iso-a-${run}@example.test`, password: "isolation-password-a" })).status).toBe(200);
  expect((await B.json("/api/auth/login", { email: `iso-b-${run}@example.test`, password: "isolation-password-b" })).status).toBe(200);

  const cv: any = await (await A.upload("cv", await sampleCv(NAME), "alpha.docx")).json();
  a.jdBytes = new Uint8Array(await sampleJob());
  const jd: any = await (await A.upload("jd", a.jdBytes, "alpha-job.docx")).json();
  a.cvDoc = cv.id; a.jdDoc = jd.id;
  for (const id of [cv.id, jd.id]) {
    let d: any = { status: "processing" };
    for (let i = 0; i < 300 && d.status === "processing"; i++) { await sleep(200); d = await (await A.req(`/api/documents/${id}`)).json(); }
    expect(d.status).toBe("published");
    if (id === cv.id) a.cand = d.recordId; else a.job = d.recordId;
  }
  const matched = await A.json("/api/matches", { candidateId: a.cand, jobId: a.job }); expect(matched.status).toBe(200); a.match = ((await matched.json()) as any).id;
  expect((await A.json("/api/applications", { candidateId: a.cand, jobId: a.job, status: "shortlisted" }, "PUT")).status).toBe(200);   // A's per-job status, which B must neither see nor change
  a.batch = ((await (await A.json("/api/batches", { kind: "cv", files: 3, bytes: 3000 })).json()) as any).id;
  a.inv = (((await (await A.json("/api/portal/invitations", { emails: [`iso-invitee-${run}@example.test`] })).json()) as any)[0] ?? {}).id;
  a.member = (((await (await A.req("/api/portal/members")).json()) as any).members[0] ?? {}).userId;
  a.portal = (((await (await A.req("/api/portals")).json()) as any)[0] ?? {}).id;
  const cand: any = await (await A.req(`/api/candidates/${a.cand}`)).json();
  const edited: any = await (await A.json(`/api/candidates/${a.cand}`, { version: cand.version, recruiterNotes: "A's private note" }, "PUT")).json();
  a.candVersion = edited.version;
  expect((await A.json("/api/settings", { version: 0, labels: { candidate: { one: "Applicant", many: "Applicants" } } }, "PUT")).status).toBe(200);
}, 240000);
afterAll(async () => { server?.kill(); await tdb?.teardown(); }, 60000);

/** Every route, and how B tries it with A's ids. `expect` is B's answer; every answer must also be free of A's data. */
const ROUTES: Record<string, () => Promise<{ status: number; expected: number[] }>> = {
  "GET /api/candidates": async () => ({ status: (await B.req(`/api/candidates?q=${encodeURIComponent("Alphaperson")}`)).status, expected: [200] }),
  "GET /api/jobs": async () => ({ status: (await B.req("/api/jobs")).status, expected: [200] }),
  "GET /api/usage": async () => ({ status: (await B.req("/api/usage")).status, expected: [200] }),
  "GET /api/settings": async () => ({ status: (await B.req("/api/settings")).status, expected: [200] }),
  "PUT /api/settings": async () => ({ status: (await B.json("/api/settings", { version: 0, labels: { job: { one: "Vacancy", many: "Vacancies" } } }, "PUT")).status, expected: [200] }),   // B changes its own only
  "GET /api/settings/history": async () => ({ status: (await B.req("/api/settings/history")).status, expected: [200] }),
  "POST /api/candidates/:id/review": async () => ({ status: (await B.json(`/api/candidates/${a.cand}/review`, {})).status, expected: [404] }),
  "POST /api/jobs/:id/review": async () => ({ status: (await B.json(`/api/jobs/${a.job}/review`, {})).status, expected: [404] }),
  "GET /api/candidates/:id/employment": async () => ({ status: (await B.req(`/api/candidates/${a.cand}/employment`)).status, expected: [404] }),
  "POST /api/candidates/:id/employment-review": async () => ({ status: (await B.json(`/api/candidates/${a.cand}/employment-review`, { action: "resolve" })).status, expected: [404] }),
  "POST /api/candidates/:id/read-again": async () => ({ status: (await B.json(`/api/candidates/${a.cand}/read-again`, {})).status, expected: [404] }),
  "GET /api/candidates/:id": async () => ({ status: (await B.req(`/api/candidates/${a.cand}`)).status, expected: [404] }),
  "GET /api/jobs/:id": async () => ({ status: (await B.req(`/api/jobs/${a.job}`)).status, expected: [404] }),
  "PUT /api/candidates/:id": async () => ({ status: (await B.json(`/api/candidates/${a.cand}`, { version: a.candVersion, recruiterNotes: "B was here", status: "new" }, "PUT")).status, expected: [404] }),
  "PUT /api/jobs/:id": async () => ({ status: (await B.json(`/api/jobs/${a.job}`, { recruiterNotes: "B was here" }, "PUT")).status, expected: [404] }),
  "DELETE /api/candidates/:id": async () => ({ status: (await B.req(`/api/candidates/${a.cand}`, { method: "DELETE" })).status, expected: [404] }),
  "DELETE /api/jobs/:id": async () => ({ status: (await B.req(`/api/jobs/${a.job}`, { method: "DELETE" })).status, expected: [404] }),
  "POST /api/documents": async () => ({ status: (await B.upload("jd", a.jdBytes, "same-file-as-a.docx")).status, expected: [202] }),   // byte for byte A's file: a new document of B's (202), never A's "duplicate" (200)
  "POST /api/batches": async () => ({ status: (await B.json("/api/batches", { kind: "cv", files: 1, bytes: 100 })).status, expected: [201] }),   // B opens its own
  "GET /api/capacity": async () => ({ status: (await B.req("/api/capacity")).status, expected: [200] }),   // B's own portal's figures (checked below: nothing of A's)
  "GET /api/portal/members": async () => ({ status: (await B.req("/api/portal/members")).status, expected: [200] }),   // B's own members only (checked below)
  "POST /api/portal/invitations": async () => ({ status: (await B.json("/api/portal/invitations", { emails: [`iso-b-invitee-${run}@example.test`] })).status, expected: [201] }),   // B invites into its own portal
  "POST /api/portal/invitations/:id/revoke": async () => ({ status: (await B.json(`/api/portal/invitations/${a.inv}/revoke`, {})).status, expected: [404] }),
  "POST /api/portal/invitations/:id/resend": async () => ({ status: (await B.json(`/api/portal/invitations/${a.inv}/resend`, {})).status, expected: [404] }),
  "DELETE /api/portal/members/:id": async () => ({ status: (await B.req(`/api/portal/members/${a.member}`, { method: "DELETE" })).status, expected: [404] }),
  "GET /api/batches": async () => ({ status: (await B.req("/api/batches")).status, expected: [200] }),   // lists B's own only (leak check below)
  "POST /api/batches/:id/close": async () => ({ status: (await B.json(`/api/batches/${a.batch}/close`, {})).status, expected: [404] }),
  "GET /api/batches/:id/report": async () => ({ status: (await B.req(`/api/batches/${a.batch}/report`)).status, expected: [404] }),
  "POST /api/batches/:id/ack": async () => ({ status: (await B.json(`/api/batches/${a.batch}/ack`, {})).status, expected: [404] }),
  "GET /api/errors": async () => ({ status: (await B.req("/api/errors")).status, expected: [200] }),   // B's own (admin): nothing of A's
  "POST /api/errors/:id/status": async () => ({ status: (await B.json("/api/errors/abcdef0123456789/status", { status: "resolved" })).status, expected: [404] }),
  "GET /api/batches/:id": async () => ({ status: (await B.req(`/api/batches/${a.batch}`)).status, expected: [404] }),
  "POST /api/batches/:id/cancel": async () => ({ status: (await B.json(`/api/batches/${a.batch}/cancel`, {})).status, expected: [404] }),
  "POST /api/batches/:id/retry": async () => ({ status: (await B.json(`/api/batches/${a.batch}/retry`, {})).status, expected: [404] }),
  "GET /api/documents": async () => ({ status: (await B.req("/api/documents")).status, expected: [200] }),
  "POST /api/documents/:id/dismiss": async () => ({ status: (await B.json(`/api/documents/${a.cvDoc}/dismiss`, {})).status, expected: [200] }),   // always "ok"; must change nothing of A's (checked below)
  "GET /api/documents/:id": async () => ({ status: (await B.req(`/api/documents/${a.cvDoc}`)).status, expected: [404] }),
  "GET /api/documents/:id/original": async () => ({ status: (await B.req(`/api/documents/${a.cvDoc}/original`)).status, expected: [404] }),
  "POST /api/matches": async () => ({ status: (await B.json("/api/matches", { candidateId: a.cand, jobId: a.job })).status, expected: [404] }),
  "POST /api/matches/bulk (candidate)": async () => ({ status: (await B.json("/api/matches/bulk", { candidateId: a.cand })).status, expected: [404] }),
  "POST /api/matches/bulk (job)": async () => ({ status: (await B.json("/api/matches/bulk", { jobId: a.job })).status, expected: [404] }),
  "POST /api/matches/ai-status": async () => ({ status: (await B.json(`/api/matches/ai-status`, { ids: [a.match] })).status, expected: [200] }),   // answers with nothing of A's
  "POST /api/jobs/:id/read-again": async () => ({ status: (await B.json(`/api/jobs/${a.job}/read-again`, {})).status, expected: [404] }),
  "POST /api/matches/cancel": async () => ({ status: (await B.json(`/api/matches/cancel`, { ids: [a.match] })).status, expected: [200] }),   // cancels nothing of A's (ai-tenancy.test.ts)
  "GET /api/history/activity": async () => ({ status: (await B.req("/api/history/activity?scope=org")).status, expected: [200] }),   // B's own organisation only (leak check below)
  "GET /api/ai-usage": async () => ({ status: (await B.req(`/api/ai-usage`)).status, expected: [200] }),   // B's own bill only (ai-tenancy.test.ts proves it holds nothing of A's)
  "GET /api/audit": async () => ({ status: (await B.req(`/api/audit?entityId=${a.cand}`)).status, expected: [200] }),
  "GET /api/history/uploads": async () => ({ status: (await B.req("/api/history/uploads?scope=org")).status, expected: [200] }),   // B's own organisation only (leak check below)
  "GET /api/history/invitations": async () => ({ status: (await B.req("/api/history/invitations?scope=org")).status, expected: [200] }),
  "PATCH /api/portal/members/:id": async () => ({ status: (await B.req(`/api/portal/members/${a.member}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "hiring_manager" }) })).status, expected: [404] }),
  "POST /api/portal/leave": async () => ({ status: (await B.json("/api/portal/leave", {})).status, expected: [409] }),   // B is its portal's only administrator: refused, nothing of A's involved
  "GET /api/org/people": async () => ({ status: (await B.req("/api/org/people")).status, expected: [200] }),   // B's own people only (leak check below)
  "DELETE /api/org/members/:id": async () => ({ status: (await B.req(`/api/org/members/${a.member}`, { method: "DELETE" })).status, expected: [404] }),
  "POST /api/org/portals/:id/admins": async () => ({ status: (await B.json(`/api/org/portals/${a.portal}/admins`, { userId: a.member })).status, expected: [404] }),
  "POST /api/org/leave": async () => ({ status: (await B.json("/api/org/leave", {})).status, expected: [409] }),   // B is its organisation's only administrator
  "GET /api/applications": async () => ({ status: (await B.req("/api/applications")).status, expected: [200] }),
  "GET /api/overview": async () => {   // B's own figures only: none of A's candidates, jobs, matches or activity is counted or named
    const r = await B.req("/api/overview?days=30"), body = await r.text();
    expect(body).not.toContain(NAME);
    // B uploads its own copy of A's job file above (POST /api/documents), so B may have a job of its own: the count must be exactly B's own list.
    const own = ((await (await B.req("/api/jobs")).json()) as any).items.length, o = JSON.parse(body);
    expect([o.candidates.total, o.jobs.open, o.shortlisted.count, o.strongest.length]).toEqual([0, own, 0, 0]);
    return { status: r.status, expected: [200] };
  },
  "GET /api/attention/:id": async () => {   // each list names only B's own records: none of A's candidates or jobs, whatever the rule
    let status = 200;
    for (const rule of ["interview-no-update", "shortlist-waiting", "strong-not-acted", "job-no-shortlist", "new-not-matched"]) {
      const r = await B.req(`/api/attention/${rule}`), o = (await r.json()) as any; status = r.status === 200 ? status : r.status;
      expect([...o.candidateIds, ...o.jobIds]).not.toContain(a.cand); expect([...o.candidateIds, ...o.jobIds]).not.toContain(a.job);
    }
    return { status, expected: [200] };
  },   // B's own per-job statuses only (leak check below)
  "PUT /api/applications": async () => ({ status: (await B.json("/api/applications", { candidateId: a.cand, jobId: a.job, status: "declined" }, "PUT")).status, expected: [404] }),
  "GET /api/jobs/:id/shortlist": async () => ({ status: (await B.req(`/api/jobs/${a.job}/shortlist`)).status, expected: [404] }),
};

test("organisation B gets nothing of A's from any endpoint, and changes nothing of A's", async () => {
  const failures: string[] = [];
  for (const [route, attempt] of Object.entries(ROUTES)) {
    const { status, expected } = await attempt();
    if (!expected.includes(status)) failures.push(`${route}: ${status}, expected ${expected.join(" or ")}`);
  }
  expect(failures).toEqual([]);

  // B's own answers hold none of A's ids, names or notes
  const answers = await Promise.all(["/api/candidates", "/api/jobs", "/api/history/activity", "/api/documents", "/api/usage", "/api/ai-usage", "/api/settings", "/api/settings/history", "/api/capacity", "/api/portal/members", "/api/portals", "/api/errors", "/api/history/uploads?scope=org", "/api/history/invitations?scope=org", "/api/org/people", "/api/batches", "/api/applications", `/api/audit?entityId=${a.cand}`, `/api/audit?entityId=${a.cvDoc}`]
    .map(async (p) => [p, await (await B.req(p)).text()] as const));
  for (const [p, body] of answers) for (const secret of [a.cand, a.job, a.cvDoc, a.jdDoc, a.batch, a.inv, a.member, NAME, "A's private note", "Applicant"]) expect(body.includes(secret), `${p} contains "${secret}"`).toBe(false);
  expect(JSON.parse(answers.find(([p]) => p === `/api/audit?entityId=${a.cand}`)![1])).toEqual([]);

  // A's records are exactly as A left them
  const cand: any = await (await A.req(`/api/candidates/${a.cand}`)).json();
  expect(cand.version).toBe(a.candVersion);
  expect(cand.recruiterNotes).toBe("A's private note");
  expect((await A.req(`/api/jobs/${a.job}`)).status).toBe(200);
  const aApps: any[] = await (await A.req("/api/applications")).json();
  expect(aApps.map((x) => [x.candidateId, x.jobId, x.status])).toEqual([[a.cand, a.job, "shortlisted"]]);   // B's "not suitable" never landed
  expect(((await (await A.req(`/api/jobs/${a.job}/shortlist`)).json()) as any[]).length).toBe(1);
  expect(((await (await A.req(`/api/documents/${a.cvDoc}`)).json()) as any).status).toBe("published");
  const aSettings: any = await (await A.req("/api/settings")).json();
  expect(aSettings.settings.labels.candidate.one).toBe("Applicant");
  expect(aSettings.settings.labels.job.one).not.toBe("Vacancy");
  const aAudit: any[] = await (await A.req(`/api/audit?entityId=${a.cand}`)).json();
  expect(aAudit.every((e) => e.actor !== "User B")).toBe(true);
  const aDocAudit: any[] = await (await A.req(`/api/audit?entityId=${a.cvDoc}`)).json();
  expect(aDocAudit.map((e) => e.action)).not.toContain("document.dismissed");
  const aBatch: any = await (await A.req(`/api/batches/${a.batch}`)).json();
  expect(aBatch.cancelledAt).toBeNull();   // B's cancel attempt changed nothing
}, 240000);

test("every route in src/index.ts is in this isolation test", () => {
  const src = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  const authed = src.slice(src.indexOf("async function handleAuthed"), src.indexOf("async function runMatch"));
  const found = new Set<string>();
  for (const m of authed.matchAll(/path === "(\/api\/[^"]+)"/g)) found.add(m[1]);
  for (const m of authed.matchAll(/path\.match\(\/\^(.+?)\$\//g)) found.add(m[1].replace(/\\\//g, "/"));
  const covered = Object.keys(ROUTES).join("\n");
  const missing = [...found].filter((p) => {
    if (p.includes("(candidates|jobs)")) return !["candidates", "jobs"].every((k) => covered.includes(p.replace("(candidates|jobs)", k).replace("([\\w-]+)", ":id")));
    return !covered.includes(p.replace("([\\w-]+)", ":id"));
  });
  expect(missing, "add these routes to ROUTES, with what another organisation must get").toEqual([]);
  expect(found.size).toBeGreaterThanOrEqual(14);   // the reading itself works
});
