import { Document, Packer, Paragraph } from "docx";
import postgres from "postgres";
import { afterAll, beforeAll, expect, test } from "vitest";
import { adminDeleteUser } from "../src/supabase";
import { parseCv } from "../src/rules";
import { setupTestDb, sleep, spawnProc, type Proc, type TestDb } from "./helpers";

const PORT = 8796, base = `http://localhost:${PORT}`;
const run = crypto.randomUUID().slice(0, 8);
let tdb: TestDb, server: Proc, admin: postgres.Sql, cookie = "";

async function docx(text: string) { return new File([new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children: text.split("\n").map((l) => new Paragraph(l)) }] })))], "nameless.docx"); }
let namelessFile: File | null = null; // the same bytes every time: a Word file rebuilt from scratch would have a different checksum
async function nameless() { return (namelessFile ??= await docx("Thank you for your time on the phone yesterday. Please find attached the signed form for your records, and let me know if there is anything further that you need from our side at this stage of the process.")); }
const hdr = () => ({ cookie, origin: "http://localhost:5173" });
async function upload(file: File) {
  const f = new FormData(); f.append("kind", "cv"); f.append("file", file);
  const res = await fetch(base + "/api/documents", { method: "POST", headers: hdr(), body: f });
  return { status: res.status, body: (await res.json()) as any };
}
async function settle(id: string) {
  for (let i = 0; i < 60; i++) { const d: any = await (await fetch(base + `/api/documents/${id}`, { headers: { cookie } })).json(); if (d.status !== "processing") return d; await sleep(1000); }
  throw new Error("never settled");
}
const board = async () => (await (await fetch(base + "/api/documents", { headers: { cookie } })).json()) as any[];

beforeAll(async () => {
  tdb = await setupTestDb({ PORT: String(PORT), SIGNUP_REQUIRE_CODE: "false", TRUST_PROXY: "true" });
  admin = postgres(process.env.DATABASE_URL!, { max: 2 });
  server = spawnProc(["tsx", "src/index.ts"], { env: tdb.env, stdout: "ignore", stderr: "ignore" });
  for (let i = 0; i < 300; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch {} await sleep(100); }
  const res = await fetch(base + "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173", "x-forwarded-for": "10.6.1.1" }, body: JSON.stringify({ name: "Doc Tester", orgName: `Docs Org ${run}`, email: `dc-${run}@example.test`, password: "a-long-enough-password-1" }) });
  await res.json();
  cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => !c.endsWith("=")).join("; ");
}, 180000);

afterAll(async () => {
  server?.kill(); await admin?.end(); await tdb?.teardown();
  const a = postgres(process.env.DATABASE_URL!, { max: 1 });
  try { for (const u of await a.unsafe(`select id from auth.users where email like 'dc-${run}%@example.test'`)) await adminDeleteUser(u.id); } finally { await a.end(); }
}, 120000);

test("a rejected document stays dismissed after the page is reloaded (it does not come back at every login)", async () => {
  const bad = await upload(await nameless());
  expect(bad.status).toBe(202);
  expect((await settle(bad.body.id)).status).toBe("exception");
  expect((await board()).some((d) => d.id === bad.body.id)).toBe(true); // shown on the board
  const gone = await fetch(base + `/api/documents/${bad.body.id}/dismiss`, { method: "POST", headers: hdr() });
  expect(gone.status).toBe(200);
  expect((await board()).some((d) => d.id === bad.body.id)).toBe(false); // a fresh load (a new login) no longer lists it
  expect((await admin.unsafe(`select count(*)::int c from "${tdb.schema}".audit_events where action = 'document.dismissed' and entity_id = $1`, [bad.body.id]))[0].c).toBe(1);
  expect((await admin.unsafe(`select count(*)::int c from "${tdb.schema}".documents where id = $1`, [bad.body.id]))[0].c).toBe(1); // the record itself is kept
});

test("uploading the same rejected file again tries it again instead of being stuck behind the old failure", async () => {
  const again = await upload(await nameless());
  expect(again.status).toBe(202); expect(again.body.retried).toBe(true);
  expect((await settle(again.body.id)).status).toBe("exception"); // still has no name, so it fails again, visibly
  expect((await board()).some((d) => d.id === again.body.id)).toBe(true); // and is shown again because it is a new attempt
  expect((await admin.unsafe(`select count(*)::int c from "${tdb.schema}".audit_events where action = 'document.retried'`))[0].c).toBe(1);
});

test("dismissing is limited to finished failures of your own organisation", async () => {
  expect((await fetch(base + "/api/documents/not-a-uuid/dismiss", { method: "POST", headers: hdr() })).status).toBe(404);
  const ok = await upload(await docx("Jordan Example\nSenior Developer\njordan.example@example.test | 011 000 0000 | Johannesburg, South Africa\nSkills\nTypeScript, React, Node.js\nExperience\nSenior Developer, Acme Software (2019-03 - Present)\nBuilt React and TypeScript front ends and Node.js REST APIs.\nEducation\nBSc Computer Science, University of Cape Town, 2015"));
  expect((await settle(ok.body.id)).status).toBe("published");
  await fetch(base + `/api/documents/${ok.body.id}/dismiss`, { method: "POST", headers: hdr() }); // a published one is left alone
  expect((await admin.unsafe(`select dismissed_at from "${tdb.schema}".documents where id = $1`, [ok.body.id]))[0].dismissed_at).toBeNull();
});

test("a name that sits far from the top of the text is found through the e-mail address, but headings are not mistaken for names", () => {
  const text = "WORK EXPERIENCE\nPROFESSIONAL SUMMARY\nMar 2017 - Jan 2020\nRand Bank - Team Lead\nManaged a project.\nSIPHO DLAMINI\nsipho.dlamini@example.test | 011 000 0000\nKEY SKILLS\nProject management, Leadership, SQL";
  expect(parseCv(text).fullName).toBe("Sipho Dlamini");
  expect(parseCv("WORK EXPERIENCE\nKEY SKILLS\nmail@example.test\nProject management, Leadership, SQL").fullName).toBe("");
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NO_PAGE_LIMIT, readDocument } from "../src/parse";
import { reviewCandidate } from "../src/review";

const heavyScan = () => new Uint8Array(readFileSync(fileURLToPath(new URL("../../sample-documents/cvs/cv13-thandi-heavy-scan.pdf", import.meta.url))));
const longCv = () => new Uint8Array(readFileSync(fileURLToPath(new URL("../../sample-documents/cvs/cv12-pieter-long-career.pdf", import.meta.url))));

test("a 24-page CV is read in full and published: there is no CV page limit", async () => {
  const f = new FormData(); f.append("kind", "cv"); f.append("file", new File([longCv()], "cv12-pieter-long-career.pdf"));
  const res = await fetch(base + "/api/documents", { method: "POST", headers: hdr(), body: f });
  expect(res.status).toBe(202);
  const doc = await settle(((await res.json()) as any).id);
  expect(doc.status).toBe("published");
  expect((await admin.unsafe(`select scan_result from "${tdb.schema}".documents where id = $1`, [doc.id]))[0].scan_result).toMatch(/24 pages \(counted from the pdf\)/);
  // every role on every page is read (24 pages, 60 roles)
  const c = parseCv((await readDocument(longCv(), "pdf", { pageCeiling: NO_PAGE_LIMIT })).text);
  expect(c.fullName).toBe("Pieter Lekota"); expect(c.workHistory.length).toBe(60);
}, 120000);

test("a heavy scan is made much smaller for speed, the words are checked, and the record says so", async () => {
  const f = new FormData(); f.append("kind", "cv"); f.append("file", new File([heavyScan()], "cv13-thandi-heavy-scan.pdf"));
  const res = await fetch(base + "/api/documents", { method: "POST", headers: hdr(), body: f });
  expect(res.status).toBe(202);
  const doc = await settle(((await res.json()) as any).id);
  expect(doc.status).toBe("published");
  const row = (await admin.unsafe(`select size, original_size, optimised, scan_result from "${tdb.schema}".documents where id = $1`, [doc.id]))[0];
  expect(row.optimised).toBe(true);
  expect(Number(row.original_size)).toBeGreaterThan(4_000_000);
  expect(Number(row.size)).toBeLessThan(Number(row.original_size) * 0.3); // at least 70% smaller
  expect(row.scan_result).toMatch(/file made smaller/);
  const cand: any = (await (await fetch(base + "/api/candidates?q=thandi", { headers: { cookie } })).json()).items.find((c: any) => /Thandi/.test(c.name));
  expect(cand).toBeTruthy(); // it was still read correctly after being shrunk
}, 180000);

const sampleBytes = (f: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../../sample-documents/cvs/${f}`, import.meta.url))));

for (const [file, label, want] of [["cv14-nomsa-text-with-photos.pdf", "a text PDF with large photos", 0.15], ["cv15-nomsa-text-with-photos.docx", "a Word file with large photos", 0.15]] as const) {
  test(`${label} keeps its words exactly and loses most of its weight`, async () => {
    const f = new FormData(); f.append("kind", "cv"); f.append("file", new File([sampleBytes(file)], file));
    const res = await fetch(base + "/api/documents", { method: "POST", headers: hdr(), body: f });
    expect(res.status).toBe(202);
    const doc = await settle(((await res.json()) as any).id);
    expect(doc.status).toBe("published");
    const row = (await admin.unsafe(`select size, original_size, optimised, scan_result from "${tdb.schema}".documents where id = $1`, [doc.id]))[0];
    expect(row.optimised).toBe(true);
    expect(Number(row.size)).toBeLessThan(Number(row.original_size) * want); // at least 85% smaller
    const cand: any = (await (await fetch(base + "/api/candidates?q=nomsa", { headers: { cookie } })).json()).items.find((c: any) => c.name === "Nomsa Dube");
    expect(cand).toBeTruthy(); expect(cand.workHistory.length).toBe(2); expect(cand.skills.length).toBeGreaterThanOrEqual(4); // read as well as the original would be
  }, 120000);
}

test("the optimisers never change a word, and leave small or already-light files alone", async () => {
  const { optimiseDocx, optimiseTextPdf } = await import("../src/optimise");
  const { readText } = await import("../src/parse");
  const pdf = sampleBytes("cv14-nomsa-text-with-photos.pdf"), docx = sampleBytes("cv15-nomsa-text-with-photos.docx");
  const [p, d] = [await optimiseTextPdf(pdf), await optimiseDocx(docx)];
  expect(await readText(p!.bytes, "pdf")).toBe(await readText(pdf, "pdf"));
  expect(await readText(d!.bytes, "docx")).toBe(await readText(docx, "docx"));
  // already light: nothing to do, so nothing is replaced
  expect(await optimiseTextPdf(sampleBytes("cv06-aisha-patel.pdf"))).toBeNull();
  expect(await optimiseDocx(sampleBytes("cv01-thandi-mokoena.docx"))).toBeNull();
});

test("reading problems (damaged text, OCR) make a record needs-review", async () => {
  const issues = ["This PDF has characters that could not be read."];
  const rec = { name: "P", email: "p@x.test", role: "R", skills: ["a", "b", "c"], workHistory: [{ position: "R", startDate: "2000-01" }] };
  expect(reviewCandidate(rec, 0.7, { readingIssues: issues }, 5000).state).toBe("needs_review");
});

test("the app page is never cached stale, while hashed assets are cached for a year", async () => {
  const page = await fetch(base + "/dashboard");
  expect(page.headers.get("cache-control")).toBe("no-cache");
  const html = await page.text();
  const asset = html.match(/\/assets\/[^"']+\.js/)?.[0];
  if (asset) expect((await fetch(base + asset)).headers.get("cache-control")).toMatch(/immutable/);
  // The logos and other images outside /assets are kept a week, not fetched again on every visit (PageSpeed, 11 Nov 2026).
  expect((await fetch(base + "/logo-light.png")).headers.get("cache-control")).toBe("public, max-age=604800, stale-while-revalidate=86400");
});
