import { afterAll, beforeAll, expect, test } from "vitest";
import { Browser, cvFile, makeWorld, sleep, type World } from "./portalKit";
import { opsDetails } from "./helpers";

// Rate limits for portal work, run with the DEFAULT thresholds: legitimate multi-recruiter workflows must pass, abuse must be limited, and a temporary
// rate limit must never look like (or change) the portal's upload allowance. All recruiters here share one address (127.0.0.1), as colleagues in one
// office would: nothing may depend on the address alone.
let w: World; let U: Browser[];
const reserve = (b: Browser, files = 1) => b.post("/api/batches", { kind: "cv", files, bytes: files * 1000 });
// Everyone the sign-in script adds is an administrator; two of the four become ordinary recruiters so the permission checks mean something.
beforeAll(async () => {
  // Over the internet to the database one match request takes about 2 s, so the default 120 a minute cannot be reached from a test; the per-account match limit is
  // lowered to 15 a minute here (the mechanism, the message and the separation from upload capacity are what is tested; every other limit is at its default).
  w = await makeWorld(8811, 4, { RATE_OVERRIDES: JSON.stringify({ match: 15 }) }); U = w.users;
  for (const b of [U[2], U[3]]) await w.admin.unsafe(`update "${w.tdb.schema}".members set role = 'recruiter' where email = $1`, [b.email]);
  for (const b of [U[2], U[3]]) await w.admin.unsafe(`update "${w.tdb.schema}".portal_members set role = 'recruiter' where user_id = (select user_id from "${w.tdb.schema}".members where email = $1)`, [b.email]);
  await sleep(11_000);   // membership is cached for ten seconds
}, 300000);
const inParallel = async <T>(n: number, width: number, run: (i: number) => Promise<T>) => { const out: T[] = []; for (let i = 0; i < n; i += width) out.push(...(await Promise.all(Array.from({ length: Math.min(width, n - i) }, (_, k) => run(i + k))))); return out; };
afterAll(async () => { await w?.stop(); }, 120000);

test("a legitimate multi-recruiter workflow from one shared address is never limited", async () => {
  const results = await Promise.all(U.map(async (b) => {
    const out: number[] = [];
    for (let i = 0; i < 3; i++) { const r = await reserve(b, 100); out.push(r.status); if (r.status === 201) { for (let p = 0; p < 15; p++) out.push((await b.get(`/api/batches/${r.body.id}`)).status); out.push((await b.get("/api/capacity")).status); out.push((await b.post(`/api/batches/${r.body.id}/cancel`)).status); } }
    return out;
  }));
  for (const out of results) expect(out.filter((s) => s === 429)).toEqual([]);   // four people, one address, a dozen batches and dozens of polls
  expect((await U[0].get("/api/capacity")).body.reserved).toBe(0);
}, 240000);

test("asking for reservations too often is limited with a reason and a retry time, reserves nothing, and is not mistaken for a full portal", async () => {
  const rs: any[] = [];
  for (let i = 0; i < 24; i++) rs.push(await reserve(U[1], 1));
  const ok = rs.filter((r) => r.status === 201), limited = rs.filter((r) => r.status === 429);
  expect(ok.length).toBeGreaterThanOrEqual(1); expect(limited.length).toBeGreaterThanOrEqual(4);
  for (const r of limited) {
    expect(r.body.error.code).toBe("RATE-001"); expect(r.body.error.code).not.toBe("CAPACITY-001");
    expect(r.body.error.message).toMatch(/temporary limit, not a lack of upload capacity/); expect(r.body.error.message).toMatch(/nothing you have already submitted is affected/);
  }
  const cap = (await U[1].get("/api/capacity")).body;
  expect(cap.reserved).toBe(ok.length); expect(cap.available).toBe(500 - ok.length);   // the refused requests took no slots
  const again = await U[1].req("/api/batches", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "cv", files: 1, bytes: 1 }) });
  expect(Number(again.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  expect((await reserve(U[2], 1)).status).toBe(201);   // a colleague on the same address is unaffected: the limit is per account
}, 120000);

test("negative control: ordinary polling (a request every second or two, as the page does) is never limited, while the burst below is", async () => {
  // The first version of the burst test sent 340 requests over about 50 seconds and expected a limit of 300 a minute to trip. It did not, and that was a wrong
  // assumption in the test, not a missed limit: the counter is a weighted sliding window over minute-aligned windows, and a stream spread across a minute boundary
  // peaks at about 270 on that estimate (checked by hand: 170 in the first window weighted 0.6, plus 160 in the second). A stream that slow is not "excessive" to this limit.
  const codes: number[] = [];
  for (let i = 0; i < 40; i++) { codes.push((await U[3].get("/api/capacity")).status); }
  expect(codes.filter((c) => c === 429)).toEqual([]);
});

test("polling progress without end is limited per account and does not limit colleagues", async () => {
  const rs = await inParallel(700, 100, () => U[3].get("/api/capacity"));
  const limited = rs.filter((r) => r.status === 429).length, ok = rs.filter((r) => r.status === 200).length;
  expect(ok).toBeGreaterThan(100); expect(limited).toBeGreaterThanOrEqual(1);
  expect((await U[0].get("/api/capacity")).status).toBe(200);
}, 240000);

test("invitations are limited per person; only an administrator can send them", async () => {
  const sent: number[] = [];
  for (let i = 0; i < 34; i++) sent.push((await U[0].post("/api/portal/invitations", { emails: [`inv${i}-${w.run}@example.test`], role: "recruiter" })).status);
  expect(sent.filter((s) => s === 201).length).toBe(30);   // the shared limit is 30 an hour
  expect(sent.filter((s) => s === 429).length).toBe(4);
  expect((await U[2].post("/api/portal/invitations", { emails: ["x@example.test"] })).status).toBe(403);   // an ordinary recruiter
}, 240000);

test("a flood of match requests is limited per account and says it does not touch upload capacity", async () => {
  const rs = await inParallel(40, 6, () => U[2].post("/api/matches", { candidateId: crypto.randomUUID(), jobId: crypto.randomUUID() }));   // six at a time is exactly the portal's concurrent-match cap
  const codes = rs.map((r) => r.status); const message = rs.find((r) => r.status === 429)?.body.error.message ?? "";
  expect(codes.filter((c) => c === 404).length).toBeGreaterThanOrEqual(10);   // reached the matcher
  expect(codes.filter((c) => c === 429).length).toBeGreaterThanOrEqual(1);
  expect(message).toMatch(/does not affect upload capacity/);
}, 240000);

test("files sent into an admitted batch are not limited like reservation requests", async () => {
  const b = (await reserve(U[0], 12)).body;
  const files = await Promise.all(Array.from({ length: 12 }, (_, i) => cvFile(300 + i)));
  const rs = await Promise.all(files.map((f) => U[0].upload(f, { batch: b.id })));
  expect(rs.map((r) => r.status).filter((s) => s === 429)).toEqual([]);
  expect(rs.map((r) => r.status)).toEqual(Array(12).fill(202));   // twelve distinct files, each new to this portal: all admitted, none answered as a duplicate
}, 120000);

test("rate-limit metrics are counts only: no accounts, addresses or content, and only the platform operator can read them", async () => {
  const m = await opsDetails(w.base);
  expect(m.rateLimits.reserve_user.limited).toBeGreaterThanOrEqual(1);
  expect(m.rateLimits.reserve_user.distinctKeysLimited).toBeGreaterThanOrEqual(1);
  const text = JSON.stringify(m.rateLimits);
  expect(text).not.toMatch(/@example|127\.0\.0|kit\d/i);
  expect((await U[2].get("/api/health/details")).status).toBe(404);   // not even confirmed to exist to anyone else
  // nor to a company's own administrator: the figures are the whole platform's (code review, 16 Nov 2026, A-M3)
  expect((await U[0].get("/api/health/details")).status).toBe(404);
  expect((await U[0].req("/api/health/details?reset=1", { method: "POST" })).status).toBe(404);
}, 60000);
