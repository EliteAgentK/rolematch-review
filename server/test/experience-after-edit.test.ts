import { afterAll, beforeAll, expect, test } from "vitest";
import { cvFile, makeWorld, sleep, type World } from "./portalKit";

// Years of experience are worked out by the platform from the roles a record holds, and nobody may type them (editPolicy.ts). Code review, 16 Nov 2026,
// C-M3: a recruiter's answer about an uncertain role (removed, or its dates corrected), or an edit of the work history where the organisation allows one,
// changed the roles but left the years as first read, so the panel and every later use of the record kept the old figure. Invented records only.
let w: World, id = "";
const published = async (u: World["users"][0], doc: string) => { for (let i = 0; i < 300; i++) { const d = (await u.get(`/api/documents/${doc}`)).body; if (d.status === "published") return d.recordId as string; await sleep(100); } throw new Error("not published"); };
const roles = [
  { position: "Senior Accountant", company: "Northwind Traders", startDate: "Jan 2015", endDate: "Dec 2024", responsibilities: [], status: "uncertain" },
  { position: "Accounts Clerk", company: "Northwind Traders", startDate: "Jan 2005", endDate: "Dec 2014", responsibilities: [], status: "uncertain" },   // as if read twice
];

beforeAll(async () => {
  w = await makeWorld(9071, 1, { SIGNUP_REQUIRE_CODE: "false" });
  const u = w.users[0];
  id = await published(u, (await u.upload(await cvFile(3), { kind: "cv" })).body.id);
  // Two roles the reading was unsure of, and the twenty years they add up to.
  await w.admin`update ${w.admin(w.tdb.schema)}.candidates set data = data || ${w.admin.json({ workHistory: roles, experience: "20" } as any)}::jsonb
    || jsonb_build_object('reading', coalesce(data->'reading', '{}'::jsonb) || '{"employment": {"state": "uncertain", "reasons": []}}'::jsonb) where id = ${id}`;
}, 300_000);
afterAll(async () => { await w?.stop(); }, 120_000);

const review = async (body: object) => { const u = w.users[0], c = (await u.get(`/api/candidates/${id}`)).body; return u.post(`/api/candidates/${id}/employment-review`, { ...body, version: c.version }); };

test("removing a role read twice, or correcting its dates, works the years out again from the roles the record now holds", async () => {
  expect((await w.users[0].get(`/api/candidates/${id}`)).body.experience).toBe("20");
  const removed = await review({ action: "remove", index: 1 });
  expect(removed.status).toBe(200);
  expect(removed.body.candidate.experience).toBe("10");                      // Jan 2015 to Dec 2024
  const corrected = await review({ action: "correct", index: 0, values: { position: "Senior Accountant", company: "Northwind Traders", startDate: "Jan 2020", endDate: "Dec 2024" } });
  expect(corrected.status).toBe(200);
  expect(corrected.body.candidate.experience).toBe("5");
  expect((await w.users[0].get(`/api/candidates/${id}`)).body.experience).toBe("5");
}, 60_000);

test("where the organisation lets recruiters edit the work history, an edit to it works the years out again; the years themselves still cannot be typed", async () => {
  const u = w.users[0], cur = (await u.get("/api/settings")).body;
  const req = (path: string, body: object) => u.req(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await req("/api/settings", { version: cur.version, editing: { candidate: { ...cur.settings.editing.candidate, workHistory: true }, job: cur.settings.editing.job } })).status).toBe(200);
  const c = (await u.get(`/api/candidates/${id}`)).body;
  const workHistory = [{ ...c.workHistory[0], startDate: "Jan 2012" }];
  const edited = await req(`/api/candidates/${id}`, { version: c.version, workHistory, changeKind: "extraction_correction" });
  expect(edited.status).toBe(200);
  expect(((await edited.json()) as any).experience).toBe("13");             // Jan 2012 to Dec 2024
  const again = (await u.get(`/api/candidates/${id}`)).body;
  expect(again.correctedFields).toEqual(["workHistory"]);                   // marked corrected, so matching gives the AI the roles as edited (aiMatch.ts)
  expect((await req(`/api/candidates/${id}`, { version: again.version, experience: "30" })).status).toBe(403);
}, 60_000);
