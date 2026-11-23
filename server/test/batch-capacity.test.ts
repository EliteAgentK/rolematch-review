import { Document, Packer, Paragraph } from "docx";
import postgres from "postgres";
import { afterAll, beforeAll, expect, test } from "vitest";
import { adminDeleteUser } from "../src/supabase";
import { sendBatch } from "../../src/utils/batchUpload";
import { setupTestDb, sleep, spawnProc, type Proc, type TestDb } from "./helpers";

// A measured run of the real path: the browser's sender -> batch -> queue -> reading -> records, with invented CVs.
// Off by default (it takes minutes). BATCH_CAPACITY=500 npx vitest run test/batch-capacity.test.ts
const N = Number(process.env.BATCH_CAPACITY ?? 0);
const PORT = 8798, base = `http://localhost:${PORT}`;
const run = crypto.randomUUID().slice(0, 8);
let tdb: TestDb, server: Proc, cookie = "";
const FIRST = ["Thandi", "Pieter", "Aisha", "Lungile", "Maria", "Sipho", "Neha", "Jacques", "Fatima", "Bongani"], LAST = ["Mokoena", "Naidoo", "Jacobs", "Dlamini", "Pretorius", "Khumalo", "Govender", "Botha", "Sithole", "Maseko"];
const RESP = ["Prepared monthly financial statements and managed the budgeting cycle for three business units.", "Led a support team of eight and cut average ticket resolution time through process changes.", "Built and maintained REST services in Node.js and TypeScript with PostgreSQL."];
async function cv(i: number) {
  const name = `${FIRST[i % 10]} ${LAST[Math.floor(i / 10) % 10]}${i >= 100 ? " " + String.fromCharCode(65 + Math.floor(i / 100)) : ""}`;
  const rows = [name, `candidate${i}.${run}@example.test`, "Senior Analyst", "Summary", "Analyst with several years of experience in reporting, delivery and process improvement across mid-size companies.", "Experience", `Senior Analyst, Northwind Traders ${i}, 2016 - 2024`, RESP[i % 3], "Skills", "Excel, Reporting, Budgeting, SQL, Communication", "Education", `BCom, University ${i % 7}, 2015`];
  return new File([new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children: rows.map((l) => new Paragraph(l)) }] })))], `cv-${i}.docx`);
}
beforeAll(async () => {
  if (!N) return;
  tdb = await setupTestDb({ PORT: String(PORT), SIGNUP_REQUIRE_CODE: "false", TRUST_PROXY: "true", RATE_USER_PER_MIN: "100000", RATE_IP_PER_MIN: "100000" });
  server = spawnProc(["tsx", "src/index.ts"], { env: tdb.env, stdout: "ignore", stderr: "ignore" });
  for (let i = 0; i < 300; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch {} await sleep(100); }
  const res = await fetch(base + "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173", "x-forwarded-for": "10.8.1.1" }, body: JSON.stringify({ name: "Capacity", orgName: `Capacity ${run}`, email: `cap-${run}@example.test`, password: "a-long-enough-password-1" }) });
  await res.json(); cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => !c.endsWith("=")).join("; ");
}, 180000);
afterAll(async () => {
  if (!N) return;
  server?.kill(); await tdb?.teardown();
  const a = postgres(process.env.DATABASE_URL!, { max: 1 });
  try { for (const u of await a.unsafe(`select id from auth.users where email like 'cap-${run}@example.test'`)) await adminDeleteUser(u.id); } finally { await a.end(); }
}, 120000);

test.skipIf(!N)(`a batch of N invented CVs is read one after another and every one ends in exactly one visible state`, async () => {
  const hdr = { cookie, origin: "http://localhost:5173" };
  const api = async (path: string, init: RequestInit = {}) => { const r = await fetch(base + path, { ...init, headers: { ...hdr, ...(init.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}) } }); const b: any = await r.json(); if (!r.ok) throw Object.assign(new Error(b.error?.message), { status: r.status, retryAfterSec: Number(r.headers.get("retry-after")) || undefined }); return b; };
  const files: File[] = []; for (let i = 0; i < N; i++) files.push(await cv(i));
  const t0 = Date.now();
  const b = await api("/api/batches", { method: "POST", body: JSON.stringify({ kind: "cv", files: N, bytes: files.reduce((n, f) => n + f.size, 0) }) });
  let peakInFlight = 0;
  const sent = await sendBatch(files, {
    name: (f) => f.name, window: 8,
    send: (f) => { const form = new FormData(); form.append("kind", "cv"); form.append("file", f); return api(`/api/documents?batch=${b.id}&name=${encodeURIComponent(f.name)}`, { method: "POST", body: form }); },
    inFlight: async () => { const v = await api(`/api/batches/${b.id}`); peakInFlight = Math.max(peakInFlight, v.counts.waiting + v.counts.processing); return v.counts.waiting + v.counts.processing; },
  });
  const sentMs = Date.now() - t0;
  let v: any; for (let i = 0; i < 3600; i++) { v = await api(`/api/batches/${b.id}`); if (v.complete) break; await sleep(1000); }
  const totalMs = Date.now() - t0;
  console.log(JSON.stringify({ capacityRun: { files: N, sendMs: sentMs, totalMs, perFileMs: Math.round(totalMs / N), peakInFlight, counts: v.counts, refused: sent.refused.length } }));
  expect(v.complete).toBe(true);
  expect(v.counts.completed + v.counts.needsReview + v.counts.failed + v.counts.refused + v.counts.duplicates).toBe(N);   // every file is in exactly one state
  expect(v.counts.waiting + v.counts.processing).toBe(0);
  expect(peakInFlight).toBeLessThanOrEqual(8 + 1);
  const cands = await api("/api/candidates?limit=1"); expect(cands.total).toBe(v.counts.completed + v.counts.needsReview);   // each published file is exactly one record
}, 3_700_000);
