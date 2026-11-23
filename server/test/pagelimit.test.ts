import { PDFDocument, StandardFonts } from "pdf-lib";
import { zipSync, strToU8 } from "fflate";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Browser, cvFile, makeWorld, sleep, type World } from "./portalKit";
import { countPages } from "../src/pageCount";

// A CV has no page limit (owner rule, 2026-11-02): every CV is read in full, however long, and its page count is recorded for the audit trail only.
// The organisation's page setting still applies to job descriptions. Pages are counted from the file itself; nothing is guessed.
let w: World; let U: Browser;
const NO_RATE = JSON.stringify({ reserve_user: 100000, reserve_portal: 100000, upload: 100000, status_user: 100000, status_portal: 100000 });
beforeAll(async () => { w = await makeWorld(8814, 1, { RATE_OVERRIDES: NO_RATE }); U = w.users[0]; }, 200000);
afterAll(async () => { await w?.stop(); }, 120000);
const S = () => `"${w.tdb.schema}"`;

async function pdfCv(pages: number, name: string) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([595, 842]);
    const lines = p === 0 ? [name, `${name.toLowerCase().replace(/\W/g, ".")}@example.test`, "Senior Accountant", "Experience", "Senior Accountant, Northwind Traders, 2016 - 2024", "Prepared monthly financial statements and budgets.", "Skills", "Excel, Budgeting, Reporting, Payroll", "Education", "BCom Accounting, University of Cape Town, 2015"] : p === pages - 1 ? ["Final page: referees Thandi Mokoena and Lerato Dlamini, available on request."] : [`Page ${p + 1}: additional detail about projects and responsibilities.`];   // the repeated line is page furniture (removed); the last page's is unique
    lines.forEach((l, i) => page.drawText(l, { x: 50, y: 780 - i * 22, size: 12, font }));
  }
  return new File([new Uint8Array(await doc.save())], `${name.replace(/\s/g, "-")}-${pages}p.pdf`);
}
const docx = (pages: number | null, text: string, name: string) => {
  const app = pages === null ? "<Properties></Properties>" : `<Properties><Pages>${pages}</Pages></Properties>`;
  const body = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${text.split("\n").map((l) => `<w:p><w:r><w:t>${l}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`;
  const files = { "[Content_Types].xml": strToU8(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`), "_rels/.rels": strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`), "word/document.xml": strToU8(body), "docProps/app.xml": strToU8(app) };
  return new File([zipSync(files)], name);
};
const CV_TEXT = "Pieter Naidoo\npieter.naidoo@example.test\nSenior Accountant\nExperience\nSenior Accountant, Northwind Traders, 2016 - 2024\nPrepared monthly financial statements and managed the budgeting cycle.\nSkills\nExcel, Budgeting, Reporting, Payroll\nEducation\nBCom Accounting, University of Cape Town, 2015";
async function send(f: File) {
  const up = await U.upload(f); expect(up.status).toBe(202);
  for (let i = 0; i < 60; i++) { const d = (await U.get(`/api/documents/${up.body.id}`)).body; if (d.status !== "processing") return d; await sleep(1000); }
  throw new Error("never settled");
}

test("page counting comes from the file: PDF page tree, TIFF/image, and the page count a Word file records; everything else is unverified, never guessed", async () => {
  expect(await countPages(new Uint8Array(await (await pdfCv(3, "Count Three")).arrayBuffer()), "pdf")).toMatchObject({ state: "counted", pages: 3, source: "pdf" });
  expect(await countPages(new Uint8Array(await docx(5, CV_TEXT, "a.docx").arrayBuffer()), "docx")).toMatchObject({ state: "counted", pages: 5, source: "document-metadata" });
  expect((await countPages(new Uint8Array(await docx(null, CV_TEXT, "b.docx").arrayBuffer()), "docx")).state).toBe("unverified");
  expect((await countPages(new TextEncoder().encode("plain text cv"), "txt")).state).toBe("unverified");   // a word or line count is not a page count
  expect((await countPages(new Uint8Array([1, 2, 3]), "pdf")).state).toBe("unverified");                    // unreadable: reported as such, not as zero pages
  expect(await countPages(new Uint8Array([0xff, 0xd8, 0xff]), "jpeg")).toMatchObject({ state: "counted", pages: 1 });
});

test("a CV has no page limit: 8- and 30-page CVs are read in full, published, and their page count recorded", async () => {
  for (const pages of [8, 30]) {
    const d = await send(await pdfCv(pages, `Long Pagesperson${pages === 8 ? "" : " Thirty"}`));
    expect(d.status).toBe("published");
    const row = (await w.admin.unsafe(`select scan_result, source_text from ${S()}.documents where id = $1`, [d.id]))[0];
    expect(row.scan_result).toMatch(new RegExp(`${pages} pages \\(counted from the pdf\\)`));
    expect(row.source_text).toMatch(/Final page: referees Thandi Mokoena and Lerato Dlamini/);   // the last page was read: nothing cut off
    expect((await w.admin.unsafe(`select count(*)::int c from ${S()}.candidates where document_id = $1`, [d.id]))[0].c).toBe(1);
  }
}, 180000);

test("a Word CV is read whatever page count it records, and one that records none is read and noted as not verified", async () => {
  expect((await send(docx(9, CV_TEXT.replace("Pieter Naidoo", "Word Ninepages"), "nine.docx"))).status).toBe("published");
  const none = await send(docx(null, CV_TEXT.replace("Pieter Naidoo", "Word Nocount"), "nocount.docx"));
  expect(none.status).toBe("published");
  expect((await w.admin.unsafe(`select scan_result from ${S()}.documents where id = $1`, [none.id]))[0].scan_result).toMatch(/page count not verified/);
});

test("the organisation's page limit applies to job descriptions only: a 13-page job description is refused, a 13-page CV is read", async () => {
  const up = await U.upload(await pdfCv(13, "Long Jobadvert"), { kind: "jd" }); expect(up.status).toBe(202);
  let d: any; for (let i = 0; i < 40; i++) { d = (await U.get(`/api/documents/${up.body.id}`)).body; if (d.status !== "processing") break; await sleep(1000); }
  expect(d.errorCode).toBe("PAGES_LIMIT");
  expect(d.errorMessage).toMatch(/This job description PDF has 13 pages; your organisation's limit is 12\./);
  expect((await send(await pdfCv(13, "Thirteen Pagesperson"))).status).toBe("published");
}, 120000);

test("a long CV in a batch completes like any other: nothing is blocked and the slots are released with the batch", async () => {
  const b = (await U.post("/api/batches", { kind: "cv", files: 2, bytes: 100 })).body;
  await U.upload(await pdfCv(12, "Batch Longcv"), { batch: b.id }); await U.upload(await pdfCv(1, "Batch Fine"), { batch: b.id });
  let v: any; for (let i = 0; i < 60; i++) { v = (await U.get(`/api/batches/${b.id}`)).body; if (v.complete) break; await sleep(1000); }
  expect(v.counts).toMatchObject({ received: 2, blocked: 0, failed: 0 }); expect(v.counts.completed + v.counts.needsReview).toBe(2);
  expect((await U.get("/api/capacity")).body.reserved).toBe(0);
}, 180000);
