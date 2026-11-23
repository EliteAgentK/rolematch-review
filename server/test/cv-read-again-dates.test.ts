import { afterAll, beforeAll, expect, test } from "vitest";
import { makeWorld, sleep, type World } from "./portalKit";

// A CV read again is dated as the first reading was: "Present" and the years of experience are worked out as of the day the CV was uploaded, never as of
// the day someone pressed Read again (code review, 16 Nov 2026, B-M10). Without that, a CV re-read months later gained a year of experience and certificates
// turned expired with nothing in the document changed. The AI here is the test stand-in (test/fakeJobClaude.ts). Invented text.
let w: World;
const cv = new File([[
  "Lerato Example", "lerato.example@example.test", "Experience", "Data Analyst, Bluegum Analytics, January 2020 - Present",
  "- Built the monthly sales dashboards and reconciled the regional figures every month.", "Skills", "SQL, Excel, Power BI",
  "Education", "BCom Statistics, University of Pretoria, 2019",
].join("\n")], "lerato-example.txt", { type: "text/plain" });

beforeAll(async () => { w = await makeWorld(8971, 1, { AI_READING: "on" }); }, 300_000);
afterAll(async () => { await w?.stop(); }, 120_000);

test("reading a CV again works out its dates as of the day it was uploaded, as the first reading did (code review, 16 Nov 2026, B-M10)", async () => {
  const u = w.users[0], up = await u.upload(cv);
  expect(up.status).toBe(202);
  let id = "";
  for (let i = 0; i < 300 && !id; i++) { const d = (await u.get(`/api/documents/${up.body.id}`)).body; if (d.status === "published") id = d.recordId; else await sleep(100); }
  expect(id, "the CV was not published").toBeTruthy();
  // The CV was uploaded on 1 July 2022: as of then, January 2020 to the present is two and a half years.
  await w.admin.unsafe(`update ${w.tdb.schema}.documents set created_at = '2022-07-01T09:00:00Z' where id = $1`, [up.body.id]);
  expect((await u.post(`/api/candidates/${id}/read-again`, {})).status).toBe(202);
  let read: any;
  for (let i = 0; i < 300; i++) { read = (await u.get(`/api/candidates/${id}`)).body; if (!read.rereading) break; await sleep(100); }
  expect(read.rereading).toBeFalsy();
  expect(read.workHistory?.[0]?.position).toBe("Data Analyst");
  expect(read.experience).toBe("2");   // as of today it would be 6
}, 120_000);
