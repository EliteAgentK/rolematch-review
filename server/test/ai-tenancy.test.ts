import { afterAll, beforeAll, expect, test } from "vitest";
import { fakeServe, sleep } from "./helpers";
import { makeWorld, type World } from "./portalKit";

// Many organisations share one AI (owner, 8 Nov 2026: 400 users in 1,000 portals, all reading and matching at once; "we need to isolate each even with the
// Anthropic LLM"; "being able to bill per portal is the key"). Two organisations, one of them with two portals, read CVs and run matches at the same time
// against a fake Anthropic server on this machine (nothing leaves it, nothing is paid). The fake answers after a delay so the calls overlap, and records
// every request. It proves: no request holds two portals' documents; each answer lands with its own document; every call is billed to the right portal of
// the right organisation's own billing account; and no organisation can read another's bill or another's match, even knowing its id.
const PORT = 8776 + 205, MARK = /TENANTMARK[A-Z0-9]+/g;
let fake: ReturnType<typeof fakeServe>, a: World, b: World;
const seenTogether: string[][] = []; let concurrent = 0, peak = 0;
let hold: Promise<void> | null = null, release = () => {}, briefAsked = false;   // holds one job's reading, to press Cancel while the AI works
const message = (text: string) => Response.json({ id: "msg_test", type: "message", role: "assistant", model: "claude-haiku-5-5", content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 900, output_tokens: 120, cache_read_input_tokens: 1500, cache_creation_input_tokens: 0 } });
function answer(system: string, user: string, marks: string[]) {
  const mark = marks[0] ?? "";
  // The job read into its requirements, each quoting the job; then one candidate scored against them. The test is about who sees what, not about judging.
  if (/briefing yourself on ONE job/.test(system)) return { role: "Prepares the monthly statements.", seniority: "intermediate", industry: "finance", requirements: [{ requirement: "Excel", kind: "skill", mandatory: true, importance: "must_have", quote: "Excel", fair: true, fairness: "" }, { requirement: "BCom Accounting", kind: "qualification", mandatory: true, importance: "must_have", quote: "BCom Accounting", fair: true, fairness: "" }] };
  if (/assessing ONE candidate against ONE job/.test(system)) {
    const ids = [...user.matchAll(/^(r\d+) \[/gm)].map((m) => m[1]);
    return { requirements: ids.map((id) => ({ id, state: "not_demonstrated", supportIds: [], counterIds: [], inferred: false, reason: "Not shown.", explanation: "" })), career: { seniority: "matches", industry: "same", recency: "current", note: "" }, score: 40, confidence: "Low", confidenceReasons: ["A stand-in answer."], strengths: [], gaps: ids.slice(0, 1), actions: [], summary: "A stand-in answer." };
  }
  if (/opening lines of a CV/.test(system)) return { name: "", email: "", phone: "" };
  const line = [...user.matchAll(/^\[(\d+)\] (.*)$/gm)].find((m) => m[2].startsWith("Analyst | Northwind"));
  return { headline: "Analyst", roles: line ? [{ title: "Analyst", employer: `Northwind Traders ${mark}`, start: "2019-01", end: "Present", lines: [Number(line[1])] }] : [], education: [], certifications: [], skills: ["Excel", mark, "Reporting"].filter(Boolean), languages: [], location: "", agency: { name: "", recruiter: "", recruiterEmail: "", recruiterPhone: "" } };
}
beforeAll(async () => {
  fake = fakeServe({ port: PORT, fetch: async (req) => {
    const body: any = await req.json(), system = String(body.system?.[0]?.text ?? body.system ?? ""), user = String(body.messages?.[0]?.content ?? "");
    if (hold && /briefing yourself on ONE job/.test(system) && JSON.stringify(body).includes("TENANTMARKHOLDJOBX")) { briefAsked = true; await hold; }
    concurrent++; peak = Math.max(peak, concurrent); await sleep(150); concurrent--;
    const marks = [...new Set(JSON.stringify(body).match(MARK) ?? [])]; seenTogether.push(marks);
    return message(JSON.stringify(answer(system, user, marks)));
  } });
  await fake.ready;
  const env = { AI_READING: "on", AI_MATCHING: "on", ANTHROPIC_BASE_URL: `http://127.0.0.1:${PORT}`, ANTHROPIC_API_KEY: "sk-ant-test-not-a-real-key", AI_MAX_RETRIES: "0", SIGNUP_REQUIRE_CODE: "false", WORKER_CONCURRENCY: "16", AI_PER_ORG_CONCURRENCY: "16" };
  a = await makeWorld(8982, 1, env); b = await makeWorld(8984, 1, env);
}, 300_000);
afterAll(async () => { await a?.stop(); await b?.stop(); await fake?.stop(); }, 120_000);

const cv = (who: string, mark: string) => new File([`${who}\n${who.toLowerCase().replace(" ", ".")}@example.test\nSkills\nExcel, ${mark}, Reporting\nExperience\nAnalyst | Northwind Traders ${mark} | 2019-01 - Present\n- Prepared monthly statements for the board and reconciled the accounts every month.\nEducation\nBCom Accounting, University of Pretoria, 2015\nThis person has worked in finance for many years across several companies in the city and is known for careful work.`], `${mark}.txt`);
const jd = (mark: string) => new File([`Financial Analyst ${mark}\nLocation: Johannesburg\nRequirements\n- BCom Accounting\n- 3 years of experience in financial reporting\n- Excel\nResponsibilities\n- Prepare monthly statements and reconcile the accounts`], `job-${mark}.txt`);
const done = async (w: World, id: string, user = w.users[0]) => { for (let i = 0; i < 400; i++) { const d = (await user.get(`/api/documents/${id}`)).body; if (d.status === "published") return d.recordId as string; await sleep(250); } throw new Error("not published"); };

test("two organisations and three portals reading and matching at once: no request holds two portals' documents, each answer lands with its own, and every call is billed to its own portal", async () => {
  // A second portal in organisation A, with its own work: a portal is the unit of billing, whoever works in it.
  const created = await a.users[0].post("/api/portals", { name: "Second portal" });
  expect(created.status).toBe(201);
  const firstPortalA = (await a.users[0].get("/api/portals")).body.find((p: any) => p.id !== created.body.id).id;
  const inPortal = (portal: string) => { const u = Object.create(Object.getPrototypeOf(a.users[0])); Object.assign(u, a.users[0], { jar: a.users[0].jar, portal }); return u as typeof a.users[0]; };
  const a1 = inPortal(firstPortalA), a2 = inPortal(created.body.id), b1 = b.users[0];
  const places = [{ w: a, u: a1, tag: "AONE" }, { w: a, u: a2, tag: "ATWO" }, { w: b, u: b1, tag: "BONE" }];
  const work = await Promise.all(places.flatMap((p) => Array.from({ length: 4 }, async (_, i) => {
    const mark = `TENANTMARK${p.tag}${i}X`, up = await p.u.upload(cv(`Person Number${String.fromCharCode(65 + i)} ${p.tag[0]}${p.tag.slice(1).toLowerCase()}`, mark));
    expect(up.status).toBe(202);
    return { ...p, mark, id: await done(p.w, up.body.id, p.u) };
  })));
  // Each CV was read by the AI, and holds only its own marker.
  for (const d of work) {
    const rec = (await d.u.get(`/api/candidates/${d.id}`)).body;
    expect(rec.aiReading?.state, JSON.stringify(rec.aiReading)).toBe("read");
    for (const m of JSON.stringify(rec).match(MARK) ?? []) expect(m, "a record holds someone else's marker").toBe(d.mark);
  }
  // One job per portal, and every CV of the portal matched against it.
  const jobs = new Map<string, string>();
  for (const p of places) { const up = await p.u.upload(jd(`TENANTMARK${p.tag}JOBX`), { kind: "jd" }); jobs.set(p.tag, await done(p.w, up.body.id, p.u)); }
  const matches = await Promise.all(work.map(async (d) => { const r = await d.u.post("/api/matches", { candidateId: d.id, jobId: jobs.get(d.tag) }); expect(r.status).toBe(200); expect(r.body.ai?.state).toBe("pending"); return { ...d, matchId: r.body.id as string }; }));
  for (const m of matches) {
    let st: any; for (let i = 0; i < 200; i++) { st = (await m.u.post("/api/matches/ai-status", { ids: [m.matchId] })).body[0]; if (st?.ai?.state !== "pending") break; await sleep(250); }
    expect(st.ai.state, JSON.stringify(st.ai)).toBe("checked");
    expect(st.result.score).toBe(40);                    // the AI's final score, the only one
    expect(st.result.evidence.map((e: any) => e.label)).toEqual(["Excel", "BCom Accounting"]);
  }
  // No request to the AI ever held two portals' documents, and the calls really did overlap.
  expect(seenTogether.length).toBeGreaterThanOrEqual(27);   // 12 readings, 3 jobs read once each, 12 scores, at least
  for (const marks of seenTogether) expect(new Set(marks.map((m) => m.replace(/\d+X$|JOBX$/, ""))).size, `one request held ${marks.join(", ")}`).toBeLessThanOrEqual(1);
  expect(peak).toBeGreaterThan(1);

  // The bill: organisation A's administrator sees both of A's portals and nothing of B; B sees only B; each organisation has its own billing account.
  const billA = (await a1.get("/api/ai-usage")).body, billB = (await b1.get("/api/ai-usage")).body;
  expect(billA.scope).toBe("organisation");
  expect(billA.account?.id).toBeTruthy(); expect(billB.account?.id).toBeTruthy(); expect(billA.account.id).not.toBe(billB.account.id);
  const portalsA = new Set(billA.lines.map((l: any) => l.portalId));
  expect(portalsA).toEqual(new Set([firstPortalA, created.body.id]));
  expect(billB.lines.every((l: any) => !portalsA.has(l.portalId))).toBe(true);
  for (const bill of [billA, billB]) for (const purpose of ["extraction", "matching"]) expect(bill.lines.some((l: any) => l.purpose === purpose && l.answered > 0), `${purpose} on the bill`).toBe(true);
  expect(billA.totalUsd).toBeGreaterThan(0);
  // In the database, every metered call carries its organisation, its portal and that organisation's own account.
  const rows = await a.admin.unsafe(`select u.org_id, u.portal_id, u.account_id, b.org_id as account_org, p.org_id as portal_org from ${a.tdb.schema}.ai_usage u left join ${a.tdb.schema}.billing_accounts b on b.id = u.account_id left join ${a.tdb.schema}.portals p on p.id = u.portal_id`);
  expect(rows.length).toBeGreaterThanOrEqual(26);   // organisation A's own database: 8 readings of two questions, 2 job briefs, 8 scores
  for (const r of rows as any[]) { expect(r.portal_id, "a call without a portal").toBeTruthy(); expect(r.account_org).toBe(r.org_id); expect(r.portal_org).toBe(r.org_id); }

  // Knowing another organisation's ids gets nothing: no match, no status, no bill lines.
  const theirs = matches.find((m) => m.tag === "AONE")!;
  expect((await b1.post("/api/matches/ai-status", { ids: [theirs.matchId] })).body).toEqual([]);
  expect((await b1.get(`/api/matches?candidateId=${theirs.id}&jobId=${jobs.get("AONE")}`)).status).toBe(404);
}, 300_000);

test("the same candidate and job are scored once: selecting Match again gets the final score at once, at no cost", async () => {
  const mark = "TENANTMARKSAVEDX", up = await b.users[0].upload(cv("Person Saved Again", mark)), id = await done(b, up.body.id);
  const job = await done(b, (await b.users[0].upload(jd("TENANTMARKSAVEDJOBX"), { kind: "jd" })).body.id);
  const first = (await b.users[0].post("/api/matches", { candidateId: id, jobId: job })).body;
  for (let i = 0; i < 200; i++) { if ((await b.users[0].post("/api/matches/ai-status", { ids: [first.id] })).body[0]?.ai?.state !== "pending") break; await sleep(250); }
  const asked = seenTogether.filter((m) => m.includes(mark)).length;
  const again = (await b.users[0].post("/api/matches", { candidateId: id, jobId: job })).body;
  expect(again.ai.state).toBe("checked");
  // The recorded match itself, not a copy: nothing new is saved or counted as a run (owner, 10 Nov 2026: "nothing should ever change").
  expect(again.id).toBe(first.id);
  expect(again.recorded).toBe(true);
  const runs = await b.admin`select count(*)::int as n from ${b.admin(b.tdb.schema)}.matches where candidate_id = ${id} and job_id = ${job}`;
  expect(Number(runs[0].n)).toBe(1);
  await sleep(1500);
  expect(seenTogether.filter((m) => m.includes(mark)).length).toBe(asked);
}, 120_000);

test("two Match clicks for the same pair at the same moment make one match and one AI score, never two (code review, 16 Nov 2026, C-M2)", async () => {
  const u = b.users[0], mark = "TENANTMARKDOUBLEX", id = await done(b, (await u.upload(cv("Person Double Click", mark))).body.id);
  const job = await done(b, (await u.upload(jd("TENANTMARKDOUBLEJOBX"), { kind: "jd" })).body.id);
  const asked = seenTogether.filter((m) => m.includes(mark)).length;   // the CV's own reading
  const [x, y] = await Promise.all([1, 2].map(() => u.post("/api/matches", { candidateId: id, jobId: job })));
  expect([x.status, y.status]).toEqual([200, 200]);
  expect(y.body.id).toBe(x.body.id);   // the second click gets the first one's match
  for (let i = 0; i < 200; i++) { if ((await u.post("/api/matches/ai-status", { ids: [x.body.id] })).body[0]?.ai?.state !== "pending") break; await sleep(250); }
  await sleep(1000);
  expect(Number((await b.admin`select count(*)::int as n from ${b.admin(b.tdb.schema)}.matches where candidate_id = ${id} and job_id = ${job}`)[0].n)).toBe(1);
  expect(seenTogether.filter((m) => m.includes(mark)).length - asked).toBe(1);   // the AI was asked to score it once, so it is paid for once
}, 120_000);

test("Read again pressed twice at once queues one reading, never two, for a CV and for a job (code review, 16 Nov 2026, A-M6)", async () => {
  const u = b.users[0], id = await done(b, (await u.upload(cv("Person Read Twice", "TENANTMARKREREADX"))).body.id);
  const job = await done(b, (await u.upload(jd("TENANTMARKREREADJOBX"), { kind: "jd" })).body.id);
  const twice = await Promise.all([...[1, 2].map(() => u.post(`/api/candidates/${id}/read-again`, {})), ...[1, 2].map(() => u.post(`/api/jobs/${job}/read-again`, {}))]);
  expect(twice.map((r) => r.status)).toEqual([202, 202, 202, 202]);
  const queued = async (type: string, key: string, value: string) => Number((await b.admin`select count(*)::int as n from ${b.admin(b.tdb.schema)}.queue where type = ${type} and payload->>${key} = ${value}`)[0].n);
  expect(await queued("model-read-again", "candidateId", id)).toBe(1);
  expect(await queued("model-job-read-again", "jobId", job)).toBe(1);
  // Once the reading is done, Read again works again.
  for (let i = 0; i < 200; i++) { if (!(await u.get(`/api/candidates/${id}`)).body.rereading) break; await sleep(250); }
  expect((await u.post(`/api/candidates/${id}/read-again`, {})).status).toBe(202);
  expect(await queued("model-read-again", "candidateId", id)).toBe(2);
  for (let i = 0; i < 200; i++) { const [c, j] = await Promise.all([u.get(`/api/candidates/${id}`), u.get(`/api/jobs/${job}`)]); if (!c.body.rereading && !j.body.rereading) break; await sleep(250); }
}, 120_000);

test("a job's reading still being worked on is never taken over and paid for again, however long it takes; one that was abandoned is (code review, 16 Nov 2026, B-M8)", async () => {
  const u = b.users[0], jobMark = "TENANTMARKLONGJOBX";
  const job = await done(b, (await u.upload(jd(jobMark), { kind: "jd" })).body.id);
  const id = await done(b, (await u.upload(cv("Person Long Read", "TENANTMARKLONGREADX"))).body.id);
  for (let i = 0; i < 200; i++) { if ((await b.admin`select 1 from ${b.admin(b.tdb.schema)}.model_reviews where kind = 'job-reading' and subject_id = ${job} and status = 'done'`).length) break; await sleep(250); }
  // As if another worker had been reading the job for ten minutes, and is still at it (its lease renewed a moment ago).
  await b.admin`update ${b.admin(b.tdb.schema)}.model_reviews set status = 'running', result = null, created_at = now() - interval '10 minutes', lease_at = now() where kind = 'job-reading' and subject_id = ${job}`;
  const briefs = () => seenTogether.filter((m) => m.includes(jobMark)).length, before = briefs();
  const m = (await u.post("/api/matches", { candidateId: id, jobId: job })).body;
  await sleep(4000);
  expect(briefs()).toBe(before);   // not read a second time while the first reader is alive
  expect((await u.post("/api/matches/ai-status", { ids: [m.id] })).body[0].ai.state).toBe("pending");   // the match waits for it
  // The reader stops renewing its lease (it died): after two minutes without word, the match takes the reading over, once.
  await b.admin`update ${b.admin(b.tdb.schema)}.model_reviews set lease_at = now() - interval '3 minutes' where kind = 'job-reading' and subject_id = ${job}`;
  let st: any; for (let i = 0; i < 200; i++) { st = (await u.post("/api/matches/ai-status", { ids: [m.id] })).body[0]; if (st?.ai?.state !== "pending") break; await sleep(250); }
  expect(st.ai.state).toBe("checked");
  expect(briefs()).toBe(before + 1);
}, 120_000);

test("Cancel in the matching window: the match stops waiting and the AI is never asked to score it, whether it was still queued or already being worked on", async () => {
  const u = b.users[0], scored = (mark: string) => seenTogether.filter((m) => m.includes(mark)).length;
  hold = new Promise<void>((r) => { release = r; });
  const job = await done(b, (await u.upload(jd("TENANTMARKHOLDJOBX"), { kind: "jd" })).body.id);
  const first = await done(b, (await u.upload(cv("Person Cancel One", "TENANTMARKCANCELONEX"))).body.id);
  const second = await done(b, (await u.upload(cv("Person Cancel Two", "TENANTMARKCANCELTWOX"))).body.id);
  const askedBefore = [scored("TENANTMARKCANCELONEX"), scored("TENANTMARKCANCELTWOX")];   // their own readings
  // Being worked on: the AI is reading the job when Cancel is pressed. The reading finishes (it was already asked), the score is never asked.
  const m1 = (await u.post("/api/matches", { candidateId: first, jobId: job })).body;
  expect(m1.ai.state).toBe("pending");
  for (let i = 0; i < 80 && !briefAsked; i++) await sleep(250);
  expect(briefAsked).toBe(true);
  // the job is being read (held); wait until this match's scoring has been picked up too, and is waiting on that reading
  const state = async () => (await b.admin.unsafe(`select status from ${b.tdb.schema}.model_reviews where kind = 'match-score' and subject_id = $1`, [m1.id]))[0]?.status;
  for (let i = 0; i < 80 && (await state()) !== "running"; i++) await sleep(250);
  expect(await state()).toBe("running");
  const c1 = await u.post("/api/matches/cancel", { ids: [m1.id] });
  expect(c1.status).toBe(200);
  expect(c1.body).toEqual({ cancelled: 1, notSent: 0, started: 1 });
  const st1 = (await u.post("/api/matches/ai-status", { ids: [m1.id] })).body[0];
  expect(st1.ai.state).toBe("not_checked");
  expect(st1.ai.reason).toMatch(/^Cancelled\. The AI had already started/);
  release(); hold = null;
  await sleep(4000);
  expect(scored("TENANTMARKCANCELONEX")).toBe(askedBefore[0]);   // never scored
  // Cancelled at once, the job already read: withdrawn (still queued) or stopped before the score (already claimed); either way the AI never scores it.
  const m2 = (await u.post("/api/matches", { candidateId: second, jobId: job })).body;
  const c2 = await u.post("/api/matches/cancel", { ids: [m2.id] });
  expect(c2.body.cancelled).toBe(1);
  await sleep(4000);
  expect(scored("TENANTMARKCANCELTWOX")).toBe(askedBefore[1]);
  expect((await u.post("/api/matches/ai-status", { ids: [m2.id] })).body[0].ai.state).toBe("not_checked");
  // A second Cancel, or one for a match already final, changes nothing.
  expect((await u.post("/api/matches/cancel", { ids: [m1.id, m2.id] })).body).toEqual({ cancelled: 0, notSent: 0, started: 0 });
  // Selecting Match again after a Cancel scores it as usual.
  const again = (await u.post("/api/matches", { candidateId: second, jobId: job })).body;
  let st: any; for (let i = 0; i < 200; i++) { st = (await u.post("/api/matches/ai-status", { ids: [again.id] })).body[0]; if (st?.ai?.state !== "pending") break; await sleep(250); }
  expect(st.ai.state).toBe("checked");
  // Another organisation cannot cancel this portal's matches, even knowing the id.
  const m3 = (await u.post("/api/matches", { candidateId: first, jobId: job })).body;
  expect((await a.users[0].post("/api/matches/cancel", { ids: [m3.id] })).body).toEqual({ cancelled: 0, notSent: 0, started: 0 });
}, 180_000);

test("a job edited while its match waits for the AI is never scored as edited under the match made before: the match says so, and Match again scores it as it is now (code review, 16 Nov 2026, C-M1)", async () => {
  const u = b.users[0], s = b.tdb.schema, KEY = 7_650_016, edited = "TENANTMARKSNAPEDITEDX";
  const id = await done(b, (await u.upload(cv("Person Snapshot", "TENANTMARKSNAPX"))).body.id);
  const job = await done(b, (await u.upload(jd("TENANTMARKSNAPJOBX"), { kind: "jd" })).body.id);
  // The AI worker is held at its very first step (taking the scoring on), as a busy queue holds it, so the job can be edited while the match waits.
  await b.admin.unsafe(`create or replace function ${s}.test_hold_scoring() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(${KEY}); return new; end $$`);
  await b.admin.unsafe(`create trigger test_hold_scoring before update on ${s}.model_reviews for each row when (new.kind = 'match-score' and new.status = 'running' and old.status = 'queued') execute function ${s}.test_hold_scoring()`);
  const held = await b.admin.reserve();
  try {
    await held`select pg_advisory_lock(${KEY})`;
    const m = (await u.post("/api/matches", { candidateId: id, jobId: job })).body;
    expect(m.ai.state).toBe("pending");
    let waiting = 0; for (let i = 0; i < 200 && !waiting; i++) { waiting = Number((await b.admin`select count(*)::int as n from pg_locks where locktype = 'advisory' and objid = ${KEY} and not granted`)[0].n); if (!waiting) await sleep(100); }
    expect(waiting).toBe(1);
    const current = (await u.get(`/api/jobs/${job}`)).body;
    const put = await u.req(`/api/jobs/${job}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: current.version, title: `Senior Financial Analyst ${edited}`, changeKind: "recruiter_preference" }) });
    expect(put.status).toBe(200);
    await held`select pg_advisory_unlock(${KEY})`;
    let st: any; for (let i = 0; i < 200; i++) { st = (await u.post("/api/matches/ai-status", { ids: [m.id] })).body[0]; if (st?.ai?.state !== "pending") break; await sleep(250); }
    expect(st.ai.state).toBe("not_checked");
    expect(st.ai.reason).toMatch(/edited after Match was selected/);
    expect(seenTogether.filter((x) => x.includes(edited)).length).toBe(0);   // the edited job never reached the AI under the earlier match
  } finally {
    held.release();
    await b.admin.unsafe(`drop trigger if exists test_hold_scoring on ${s}.model_reviews`);
  }
  // Match again: a new match of the job as it is now, scored, and saying so.
  const again = (await u.post("/api/matches", { candidateId: id, jobId: job })).body;
  let st: any; for (let i = 0; i < 200; i++) { st = (await u.post("/api/matches/ai-status", { ids: [again.id] })).body[0]; if (st?.ai?.state !== "pending") break; await sleep(250); }
  expect(st.ai.state).toBe("checked");
  expect(seenTogether.filter((x) => x.includes(edited)).length).toBeGreaterThan(0);
}, 120_000);
