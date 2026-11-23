// The candidate pipeline in the running application: upload, reading, extraction, validation, the saved candidate and what the API gives the panel. Real server, real database and storage on the local stack,
// real queue. Invented documents only. Each check follows a document through the path a recruiter's does, with the flag set the way an administrator would set it.
import { createCanvas } from "@napi-rs/canvas";
import { Document, Packer, Paragraph } from "docx";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Browser, makeWorld, sleep, type World } from "./portalKit";

let w: World, A: Browser, main: string;
const NO_LIMITS = JSON.stringify({ reserve_user: 100000, reserve_portal: 100000, reserve_org: 100000, status_user: 100000, status_portal: 100000, batch_action_user: 100000, upload_file_user: 100000, upload_file_portal: 100000, upload_file_org: 100000 });
beforeAll(async () => { w = await makeWorld(8824, 1, { RATE_OVERRIDES: NO_LIMITS, QUEUE_STALE_SECONDS: "3", QUEUE_HEARTBEAT_MS: "1000" }); A = w.users[0]; main = (await A.get("/api/portals")).body[0].id; A.portal = main; }, 400000);
afterAll(async () => { await w?.stop(); }, 120000);

const setPageLimit = async (maxPages?: number) => { const cur = (await A.get("/api/settings")).body; const r = await A.req("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: cur.version, limits: { ...cur.settings.limits, ...(maxPages ? { maxPages } : {}) } }) }); expect(r.status).toBe(200); };
const docx = async (name: string, lines: string[]) => new File([new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children: lines.map((l) => new Paragraph(l)) }] })))], name);
const BODY = ["Skills", "Excel / Reporting / Budgeting", "Experience", "Financial Manager", "Northwind Traders | 2018-01 to Present | Permanent", "- Prepared monthly statements for the board and led the audit team across three regions in the group.", "- Reviewed budgets with each regional director every quarter and reported the variances to the executive.", "Education", "BCom Accounting | University of Pretoria | Completed | 2012"];
const agencyCv = (who: string) => docx(`${who}.docx`, [`Candidate Name: ${who}`, "To arrange a meeting with this candidate or to request further information please contact:", "Consultants Name | Peter Smith", "Consultants Number | 082 555 0100", "Consultants Email | peter.smith@brightpath.example", "Brightpath Recruitment", ...BODY]);
async function finished(b: Browser, id: string, seconds = 240) { for (let i = 0; i < seconds * 4; i++) { const d = (await b.get(`/api/documents/${id}`)).body; if (d.status !== "processing") return d; await sleep(250); } throw new Error("document never finished"); }
const candidate = async (b: Browser, id: string) => (await b.get(`/api/candidates/${id}`)).body;
/** A scan: pictures of pages, nothing in the text layer, so OCR has real work and takes real time. */
async function scan(pages: number) { const d = await PDFDocument.create(); for (let p = 0; p < pages; p++) { const c = createCanvas(1240, 1754), g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 1240, 1754); g.fillStyle = "#000"; g.font = "28px sans-serif"; ["Lerato Dube", "lerato.dube@mail.example", "082 555 0177", ...BODY, ...Array.from({ length: 30 }, (_, i) => `Further record of delivery work number ${i} on page ${p + 1} of this document.`)].forEach((l, i) => g.fillText(l.slice(0, 80), 80, 100 + i * 40)); const img = await d.embedPng(c.toBuffer("image/png")); d.addPage([595, 842]).drawImage(img, { x: 0, y: 0, width: 595, height: 842 }); } return new File([new Uint8Array(await d.save())], "scan.pdf"); }
async function pagesOf(n: number, name: string) { const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica); for (let p = 0; p < n; p++) { const pg = d.addPage([595, 842]); ["Thandi Mokoena", "thandi@mail.example", "Requirements", "Five years of experience in financial reporting and audit across a group of companies.", ...BODY].forEach((l, i) => pg.drawText(l.slice(0, 90), { x: 40, y: 800 - i * 18, size: 10, font: f })); } return new File([new Uint8Array(await d.save())], name); }

let agencyId = "", agencyDoc = "";
test("upload to saved candidate, a document invisible until finished, candidate and agency apart", async () => {
  const before = (await A.get("/api/candidates?limit=100")).body.items.length;
  const up = await A.upload(await agencyCv("Thandi Mokoena")); expect(up.status).toBe(202); agencyDoc = up.body.id;
  const mid = (await A.get(`/api/documents/${agencyDoc}`)).body;
  if (mid.status === "processing") expect((await A.get("/api/candidates?limit=100")).body.items.length).toBe(before);
  const d = await finished(A, agencyDoc); expect(d.status).toBe("published"); agencyId = d.recordId;
  const c = await candidate(A, agencyId);
  expect(c).toMatchObject({ name: "Thandi Mokoena", email: "", phone: "", submission: { contactRoute: "through-agency", agency: { name: "Brightpath Recruitment" }, recruiter: { name: "Peter Smith", email: "peter.smith@brightpath.example", phone: "082 555 0100" } } });
  expect(c.skills).toEqual(expect.arrayContaining(["Excel", "Reporting", "Budgeting"]));
  expect(c.extraction.parserVersion).toContain("candidate-7");
  expect(c.extraction.fields.email).toMatchObject({ state: "missing", reason: expect.stringMatching(/agency/) });
  expect(c.originalDocumentUrl).toBeTruthy();
}, 300000);

test("the record survives a refresh, signing out and in, and a server restart", async () => {
  const same = async () => { const c = await candidate(A, agencyId); expect(c.submission.recruiter.name).toBe("Peter Smith"); expect(c.name).toBe("Thandi Mokoena"); };
  await same(); await same();
  expect((await A.post("/api/auth/logout")).status).toBe(200);
  expect((await A.get(`/api/candidates/${agencyId}`)).status).toBe(401);
  const login = await A.req("/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.9.71.1" }, body: JSON.stringify({ email: A.email, password: "a-long-enough-password-1" }) }); expect(login.status).toBe(200);
  await same();
  await w.restart(); await same();
}, 300000);

test("portal and organisation isolation: another portal and another organisation cannot see it", async () => {
  const other = await A.post("/api/portals", { name: "Second portal" }); expect(other.status).toBeLessThan(300);
  A.portal = other.body.id;
  expect((await A.get("/api/candidates?limit=100")).body.items.map((x: any) => x.id)).not.toContain(agencyId);
  expect((await A.get(`/api/candidates/${agencyId}`)).status).toBe(404);
  A.portal = main;
  expect((await candidate(A, agencyId)).name).toBe("Thandi Mokoena");   // switching back finds it where it was
  const stranger = new Browser(w.base, `other-${w.run}@example.test`);
  await w.tdb.createUser(`Stranger org ${w.run}`, stranger.email, "Stranger", "a-long-enough-password-1");
  expect((await stranger.req("/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.9.72.1" }, body: JSON.stringify({ email: stranger.email, password: "a-long-enough-password-1" }) })).status).toBe(200);
  expect((await stranger.get(`/api/candidates/${agencyId}`)).status).toBe(404);
  expect((await stranger.get("/api/candidates?limit=100")).body.items).toHaveLength(0);
}, 200000);

test("two candidates from one agency are not duplicates of each other, and the same file twice is noticed", async () => {
  const a = await finished(A, (await A.upload(await agencyCv("Lerato Sithole"))).body.id), b = await finished(A, (await A.upload(await agencyCv("Bongani Khumalo"))).body.id);
  expect(a.status).toBe("published"); expect(b.status).toBe("published");
  expect((await candidate(A, b.recordId)).extraction.possibleDuplicates ?? []).toHaveLength(0);
  const again = await finished(A, (await A.upload(await agencyCv("Bongani Khumalo"))).body.id);
  if (again.status === "published") expect((await candidate(A, again.recordId)).extraction.possibleDuplicates?.length ?? 0).toBeGreaterThan(0);
  else expect(again.errorCode).toBeTruthy();
  const count = (await A.get("/api/candidates?limit=100")).body.items.filter((c: any) => c.name === "Bongani Khumalo").length;
  expect(count).toBeLessThanOrEqual(2);
}, 300000);

test("a candidate whose name could not be confirmed is kept, sent for review, and a person can give the name", async () => {
  const d = await finished(A, (await A.upload(await docx("noname.docx", ["lm1990@mail.example", "082 555 0111", ...BODY]))).body.id); expect(d.status).toBe("published");
  const c = await candidate(A, d.recordId);
  expect(c.name).toBe(""); expect(c.reviewState).toBe("needs_review"); expect(c.workHistory.length).toBeGreaterThan(0);
  const saved = await A.req(`/api/candidates/${c.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...c, name: "Lindiwe Mabaso", changeKind: "extraction_correction" }) });
  expect(saved.status).toBe(200); expect((await candidate(A, c.id)).name).toBe("Lindiwe Mabaso");
  expect((await candidate(A, c.id)).submission).toBeUndefined();
}, 200000);

test("what a CV states about an agency is not editable, and a change to it is refused", async () => {
  const c = await candidate(A, agencyId);
  const r = await A.req(`/api/candidates/${agencyId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...c, submission: { ...c.submission, recruiter: { ...c.submission.recruiter, name: "Someone Else" } }, changeKind: "extraction_correction" }) });
  expect((await candidate(A, agencyId)).submission.recruiter.name).toBe("Peter Smith");
  expect(r.status).toBe(403);
}, 60000);

test("a crash in the middle of OCR: the document is taken up again and published exactly once", async () => {
  const up = await A.upload(await scan(5)); expect(up.status).toBe(202);
  const id = up.body.id;
  for (let i = 0; i < 400; i++) { const d = (await A.get(`/api/documents/${id}`)).body; if (["reading", "extracting"].includes(d.stage)) break; await sleep(100); }
  const before = (await w.admin.unsafe(`select status, attempts from "${w.tdb.schema}".queue where payload->>'documentId' = '${id}'`))[0];
  expect(before.status).toBe("running");
  w.server.crash(); await w.server.exited; await sleep(500);
  await w.restart();
  const d = await finished(A, id, 400); expect(d.status).toBe("published");
  const rows = await w.admin.unsafe(`select count(*)::int as n from "${w.tdb.schema}".candidates where document_id = '${id}'`); expect(rows[0].n).toBe(1);
  const after = (await w.admin.unsafe(`select status, attempts from "${w.tdb.schema}".queue where payload->>'documentId' = '${id}'`))[0];
  expect(after.attempts).toBeGreaterThan(before.attempts);
}, 600000);

test("malformed files are refused with a reason and do not stop the next document", async () => {
  const cases: [string, Uint8Array][] = [["empty.pdf", new Uint8Array()], ["fake.pdf", new TextEncoder().encode("this is not a pdf at all")], ["truncated.pdf", new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<< /Type /Catalog")], ["zip.docx", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])]];
  for (const [name, bytes] of cases) {
    const up = await A.upload(new File([bytes], name));
    if (up.status === 202) { const d = await finished(A, up.body.id); expect(d.status, name).toBe("exception"); expect(d.errorCode, name).toBeTruthy(); }
    else expect(up.status, name).toBeGreaterThanOrEqual(400);
  }
  const ok = await finished(A, (await A.upload(await agencyCv("Fatima Jacobs"))).body.id); expect(ok.status).toBe("published");
}, 300000);

test("page limits: a job description over the organisation's limit is refused; a long CV is read in full", async () => {
  await setPageLimit(7);
  const jd = await A.upload(await pagesOf(8, "long-job.pdf"), { kind: "jd" });
  if (jd.status === 202) { const d = await finished(A, jd.body.id); expect(d.status).toBe("exception"); expect(d.errorCode).toBe("PAGES_LIMIT"); } else expect(jd.status).toBeGreaterThanOrEqual(400);
  const shortJob = await A.upload(await pagesOf(7, "ok-job.pdf"), { kind: "jd" }); expect(shortJob.status).toBe(202);
  expect((await finished(A, shortJob.body.id)).errorCode).not.toBe("PAGES_LIMIT");
  const cv = await A.upload(await pagesOf(9, "long-cv.pdf")); expect(cv.status).toBe(202);
  const d = await finished(A, cv.body.id); expect(d.status).toBe("published");
}, 300000);

test("many at once: all finish, none are lost, the server stays responsive and per-organisation limits hold", async () => {
  const ups = await Promise.all(Array.from({ length: 24 }, async (_, i) => A.upload(await agencyCv(`Person Number${String.fromCharCode(65 + i)} Test`))));
  for (const u of ups) expect(u.status).toBe(202);
  let peak = 0, slowest = 0;
  const watch = (async () => { for (let i = 0; i < 400; i++) { const t = performance.now(); await A.get("/api/health"); slowest = Math.max(slowest, performance.now() - t); const running = (await w.admin.unsafe(`select count(*)::int as n from "${w.tdb.schema}".queue where status = 'running'`))[0].n; peak = Math.max(peak, running); if (!running && i > 5) break; await sleep(150); } })();
  const done = await Promise.all(ups.map((u) => finished(A, u.body.id))); await watch;
  expect(done.filter((d) => d.status === "published")).toHaveLength(24);
  expect(peak).toBeLessThanOrEqual(4);
  expect(slowest).toBeLessThan(5000);
  console.log(`concurrency: 24 documents, peak running ${peak}, slowest health answer ${Math.round(slowest)} ms`);
}, 400000);
