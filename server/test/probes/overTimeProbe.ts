// Run by reading-time-limit.test.ts against a throw-away schema, as a reading worker would run (code review, 16 Nov 2026, B-M3). Two documents are read at
// once: an invented eight-page scan that cannot be read within the time limit (PROCESS_MAX_SECONDS, set small by the test) and a short invented CV. The scan
// must fail on its own, the CV must be published, neither may lose an attempt, the process must keep running, and the scan's reading must really stop.
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { forPortal, platformSql } from "../../src/db";
import { ocrPdfWords, stopOcr } from "../../src/ocr";
import { registerPipeline } from "../../src/pipeline";
import { enqueue, startWorkers, stopWorkers } from "../../src/queue";
import { putObject } from "../../src/supabase";

const [org, portal, slowId, quickId] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
const scan = await PDFDocument.load(readFileSync(new URL("../../../sample-documents/cvs/cv11-zanele-scanned.pdf", import.meta.url)));
const pagesOf = async (n: number) => { const out = await PDFDocument.create(); for (let i = 0; i < n; i++) { const [p] = await out.copyPages(scan, [0]); out.addPage(p); } return new Uint8Array(await out.save()); };
const one = await pagesOf(1), eight = await pagesOf(8);
const cv = new TextEncoder().encode(["Thandeka Example", "thandeka.example@example.test", "082 555 0100", "Experience", "Accountant, Acme Holdings, 2018 - 2023",
  "- Prepared the monthly management accounts and the year-end statements for the group.", "Skills", "Excel, IFRS, Payroll", "Education", "BCom Accounting, University of Pretoria, 2017"].join("\n"));

await ocrPdfWords(one);   // the OCR engine started
let t = performance.now(); await ocrPdfWords(one); const pageMs = performance.now() - t;   // what one page takes here

await platformSql`insert into orgs (id, name) values (${org}, 'Time Limit Probe')`;
await platformSql`insert into portals (id, org_id, name) values (${portal}, ${org}, 'P1')`;
for (const [id, name, mime, bytes] of [[slowId, "scan.pdf", "application/pdf", eight], [quickId, "cv.txt", "text/plain", cv]] as const) {
  const path = `${org}/${id}/${name}`;
  await putObject(path, bytes, mime);
  await platformSql`insert into documents (id, org_id, portal_id, kind, original_name, mime, size, sha256, storage_path, status, stage)
    values (${id}, ${org}, ${portal}, 'cv', ${name}, ${mime}, ${bytes.length}, ${id.replace(/-/g, "").padEnd(64, "0")}, ${path}, 'processing', 'received')`;
}
let exited: number | null = null;
const realExit = process.exit.bind(process);
process.exit = ((code?: number) => { exited = code ?? 0; console.log(JSON.stringify({ exited })); return realExit(code); }) as typeof process.exit;

registerPipeline();
await startWorkers();
const t0 = performance.now();
await forPortal(org, portal, async () => { await enqueue(org, "process-document", { documentId: slowId }); await enqueue(org, "process-document", { documentId: quickId }); });
const status = async (id: string) => (await platformSql`select status, error_code from documents where id = ${id}`)[0];
let slowEndedAfter = 0;
for (let i = 0; i < 1200; i++) {
  const [s, q] = [await status(slowId), await status(quickId)];
  if (s.status !== "processing" && !slowEndedAfter) slowEndedAfter = (performance.now() - t0) / 1000;
  if (s.status !== "processing" && q.status !== "processing") break;
  await new Promise((r) => setTimeout(r, 100));
}
// The scan's reading was told to stop: the next document's OCR waits at most for the page it was on.
t = performance.now(); await ocrPdfWords(one); const waitedMs = performance.now() - t;
await new Promise((r) => setTimeout(r, 2000));   // the process is still here two seconds later
const [s, q] = [await status(slowId), await status(quickId)];
const jobs = await platformSql`select payload->>'documentId' as id, status, attempts from queue where org_id = ${org} order by created_at`;
console.log(JSON.stringify({
  slow: { status: s.status, code: s.error_code, endedWithinLimit: slowEndedAfter > 0 && slowEndedAfter <= Number(process.env.PROCESS_MAX_SECONDS) + 3 },
  quick: { status: q.status, code: q.error_code },
  jobs: jobs.map((j: any) => ({ doc: j.id === slowId ? "slow" : "quick", status: j.status, attempts: j.attempts })),
  stoppedSoon: waitedMs < pageMs * 3.5 + 1500, waitedMs: Math.round(waitedMs), pageMs: Math.round(pageMs), slowEndedAfter, exited,
}));
stopWorkers(); await stopOcr(); await platformSql.end({ timeout: 5 });
realExit(0);
