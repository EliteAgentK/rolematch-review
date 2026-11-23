import { afterAll, beforeAll, expect, test } from "vitest";
import { cvFile, makeWorld, sleep, type World } from "./portalKit";

// The Overview page's figures (src/orgOverview.ts, GET /api/overview): counted from what this organisation's portal records, one answer shared by everyone
// in the portal for a minute, nothing from another organisation (isolation.test.ts). Invented documents; the stand-in Claude reads the job.
let w: World, candidateId = "", jobId = "";
const jd = new File([["Payroll Administrator", "Company: Silver Acorn Financial Group", "Location: Johannesburg", "Requirements", "- Two years of payroll experience.",
  "Responsibilities", "- Run the monthly payroll."].join("\n")], "payroll.txt", { type: "text/plain" });
const published = async (u: World["users"][0], id: string) => { for (let i = 0; i < 300; i++) { const d = (await u.get(`/api/documents/${id}`)).body; if (d.status === "published") return d.recordId as string; await sleep(100); } throw new Error("not published"); };

beforeAll(async () => {
  w = await makeWorld(8994, 2, { SIGNUP_REQUIRE_CODE: "false" });
  const u = w.users[0];
  candidateId = await published(u, (await u.upload(await cvFile(1), { kind: "cv" })).body.id);
  jobId = await published(u, (await u.upload(jd, { kind: "jd" })).body.id);
  const r = await u.req("/api/applications", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ candidateId, jobId, status: "shortlisted" }) });
  expect(r.status).toBe(200);
}, 300_000);
afterAll(async () => { await w?.stop(); }, 120_000);

test("the overview counts this portal's own records: people, open jobs, the shortlist, the days, and the team's activity in words", async () => {
  const o = (await w.users[0].get("/api/overview?days=30")).body;
  expect(o.days).toBe(30);
  expect(o.candidates).toMatchObject({ total: 1, inPeriod: 1, previous: 0 });
  expect(o.jobs.open).toBe(1);
  expect(o.shortlisted).toMatchObject({ count: 1, jobs: 1 });
  expect(o.series.dates).toHaveLength(30);
  expect(o.series.sl.reduce((a: number, b: number) => a + b, 0)).toBe(1);
  expect(o.series.cv.reduce((a: number, b: number) => a + b, 0)).toBe(1);
  expect(o.pipeline).toMatchObject({ read: 1, shortlisted: 1, interviewing: 0, hired: 0 });
  // Every department with its open jobs and its candidates; read here before being placed, the one job and the one candidate are counted somewhere, once.
  expect(o.families.reduce((n: number, f: any) => n + f.open, 0)).toBe(1);
  expect(o.families.reduce((n: number, f: any) => n + f.candidates, 0)).toBe(1);
  expect(o.attention).toEqual([]);   // nothing waits yet: the job and the shortlist are new, and an empty list is a real answer
  expect(o.credits.allowanceRand).toBeNull();   // no per-organisation credit yet: never made up
  // On the Overview (recruiters and administrators only) a line names the person and the job, and the records, for the board to open; History does not.
  const moved = o.activity.find((a: any) => a.what.startsWith("Moved ") && a.what.endsWith(" to shortlisted for Payroll Administrator"));
  expect(moved).toMatchObject({ candidateId, jobId });
  expect(moved.what).not.toBe("Moved a candidate to shortlisted for Payroll Administrator");
  expect((await w.users[0].get("/api/overview?days=7")).body.series.dates).toHaveLength(7);
}, 60_000);

test("everyone in the portal sees the same answer, served from one cache for a minute", async () => {
  const [a, b] = await Promise.all([w.users[0].get("/api/overview?days=90"), w.users[1].get("/api/overview?days=90")]);
  expect(a.status).toBe(200);
  expect(b.status).toBe(200);
  expect(b.body.generatedAt).toBe(a.body.generatedAt);
  expect(b.body.candidates).toEqual(a.body.candidates);
}, 60_000);

test("a shortlist left for over 5 days shows in Needs attention, and its list on the board is exactly those records", async () => {
  const u = w.users[0];
  // A change in the portal clears its cached figures (index.ts), as any real change does; then the shortlist is made 6 days old.
  expect((await u.req("/api/applications", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ candidateId, jobId, status: "shortlisted" }) })).status).toBe(200);
  await w.admin`update ${w.admin(w.tdb.schema)}.applications set updated_at = now() - interval '6 days' where candidate_id = ${candidateId} and job_id = ${jobId}`;
  const o = (await u.get("/api/overview?days=90")).body;
  expect(o.attention).toEqual([expect.objectContaining({ id: "shortlist-waiting", count: 1 })]);
  // Each item by name too, for the Overview to list in place (owner, 10 Nov 2026): the person, the job and the status that is waiting.
  expect((await u.get("/api/attention/shortlist-waiting")).body).toEqual({ candidateIds: [candidateId], jobIds: [jobId], count: 1, about: ["candidates", "jobs"],
    items: [{ candidateId, jobId, name: expect.any(String), title: "Payroll Administrator", status: "shortlisted" }] });
  expect((await u.get("/api/attention/not-a-rule")).status).toBe(404);
});

// Any change in the portal clears its cached figures (index.ts): setting the same status again does, without adding to the counts.
const fresh = async (days: number) => {
  const u = w.users[0];
  expect((await u.req("/api/applications", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ candidateId, jobId, status: "shortlisted" }) })).status).toBe(200);
  return (await u.get(`/api/overview?days=${days}`)).body;
};
const where = async () => (await w.admin`select org_id, portal_id from ${w.admin(w.tdb.schema)}.candidates where id = ${candidateId}`)[0] as { org_id: string; portal_id: string };
const SAST_MONTH = `date_trunc('month', now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg'`;
const SAST_TODAY = `(now() at time zone 'Africa/Johannesburg')::date::timestamp at time zone 'Africa/Johannesburg'`;
const shortlistAt = async (at: string) => { const { org_id, portal_id } = await where(); await w.admin.unsafe(`insert into ${w.tdb.schema}.audit_events (org_id, portal_id, action, entity_type, entity_id, detail, created_at)
  values ($1, $2, 'application.status_changed', 'candidate', gen_random_uuid(), jsonb_build_object('jobId', gen_random_uuid(), 'to', 'shortlisted'), ${at})`, [org_id, portal_id]); };

test("this month's AI credits begin at midnight in Johannesburg, not in UTC, and each day of the chart is a Johannesburg day (code review, 16 Nov 2026, C-M5)", async () => {
  const { org_id, portal_id } = await where();
  // An hour after the month began in Johannesburg (still last month in UTC), and half an hour before it (last month in Johannesburg).
  await w.admin.unsafe(`insert into ${w.tdb.schema}.ai_usage (org_id, portal_id, purpose, provider, model, cost_micro_usd, outcome, at) values
    ($1, $2, 'matching', 'anthropic', 'test', 1000000, 'answered', ${SAST_MONTH} + interval '1 hour'), ($1, $2, 'matching', 'anthropic', 'test', 7000000, 'answered', ${SAST_MONTH} - interval '30 minutes')`, [org_id, portal_id]);
  // A shortlisting one minute into today in Johannesburg: 22:01 UTC the day before.
  await shortlistAt(`${SAST_TODAY} + interval '1 minute'`);
  const o = await fresh(7), today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());
  expect(o.credits.usedUsd).toBe(1);
  expect(o.credits.month).toBe(today.slice(0, 7));
  expect(o.series.dates.at(-1)).toBe(today);
  expect(o.series.sl.at(-1)).toBe(2);   // the shortlisting set up front, and this one: both today in Johannesburg
}, 60_000);

test("the Shortlisted figure counts exactly the days the chart shows, and its change compares it with a period as long (code review, 16 Nov 2026, G-M1)", async () => {
  // The first moment of the first day the 7-day chart shows (six days before today, in Johannesburg).
  const FIRST = `((now() at time zone 'Africa/Johannesburg')::date - 6)::timestamp at time zone 'Africa/Johannesburg'`;
  await shortlistAt(`now() - interval '7 days' + interval '1 minute'`);    // within seven days by the clock, but before the first day drawn
  await shortlistAt(`${FIRST} + interval '1 minute'`);                     // on the first day drawn
  await shortlistAt(`${FIRST} - interval '7 days' + interval '1 minute'`); // the same moment, a period earlier
  await shortlistAt(`now() - interval '14 days' + interval '1 minute'`);   // before the period earlier began
  const o = await fresh(7), drawn = o.series.sl.reduce((a: number, b: number) => a + b, 0);
  const [n] = await w.admin.unsafe(`select count(*) filter (where created_at >= ${FIRST})::int as now, count(*) filter (where created_at >= ${FIRST} - interval '7 days' and created_at < now() - interval '7 days')::int as before
    from ${w.tdb.schema}.audit_events where action = 'application.status_changed' and detail->>'to' = 'shortlisted'`);
  expect(drawn).toBe(n.now);                  // the headline is the sum of the days drawn ...
  expect(o.pipeline.shortlisted).toBe(n.now); // ... and the period's own count: the same events
  expect(o.shortlisted.previous).toBe(n.before);   // the period before, as long as this one so far
}, 60_000);

test("the pipeline counts each person for a job once at a stage, however many steps of it they went through (code review, 16 Nov 2026, G-M2)", async () => {
  const before = await fresh(7), { org_id, portal_id } = await where();
  // One person taken through all three interview stages for one job, and moved to hired twice (back and forth).
  for (const to of ["awaiting interview", "interviewing", "interviewed", "hired", "interviewed", "hired"]) await w.admin.unsafe(`insert into ${w.tdb.schema}.audit_events (org_id, portal_id, action, entity_type, entity_id, detail)
    values ($1, $2, 'application.status_changed', 'candidate', $3, jsonb_build_object('jobId', $4::text, 'to', $5::text))`, [org_id, portal_id, candidateId, jobId, to]);
  const o = await fresh(7);
  expect(o.pipeline.interviewing - before.pipeline.interviewing).toBe(1);
  expect(o.pipeline.hired - before.pipeline.hired).toBe(1);
}, 60_000);

test("a job's shortlist on the board and the Overview's 'on shortlists' are one definition: shortlisted or further, never 'Reviewed' (code review, 16 Nov 2026, G-M3)", async () => {
  const u = w.users[0], put = (path: string, body: object) => u.req(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const cur = (await u.get("/api/settings")).body;
  expect((await put("/api/settings", { version: cur.version, statuses: cur.settings.statuses.map((x: any) => (x.key === "reviewed" ? { ...x, active: true } : x)) })).status).toBe(200);
  const other = await published(u, (await u.upload(await cvFile(2), { kind: "cv" })).body.id);
  expect((await put("/api/applications", { candidateId: other, jobId, status: "reviewed" })).status).toBe(200);
  const shortlist = (await u.get(`/api/jobs/${jobId}/shortlist`)).body as any[], o = await fresh(30);
  expect(shortlist.map((r) => r.candidate.id)).toEqual([candidateId]);   // the person marked Reviewed is not on the job's shortlist ...
  expect(o.shortlisted).toMatchObject({ count: 1, jobs: 1 });            // ... nor on the Overview's
}, 120_000);
