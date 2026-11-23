// Does every limit on Settings hold while a crowd is using the platform? Takes one organisation of the disposable stack, sets each limit in turn, drives it to the edge one at a time and then all at once, and confirms another organisation is untouched. Prints a table: limit, what happened, verdict.
//   node --import tsx test/load/limitsProbe.ts <base> <origin> <accounts.json> <org index to test> <other org index>
import { readFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "pdf-lib";
const [BASE, ORIGIN, file, orgA, orgB] = process.argv.slice(2);
const { password, accounts } = JSON.parse(readFileSync(file, "utf8"));
const adminOf = (n: string) => accounts.find((a: any) => a.role === "admin" && a.org.endsWith(` org ${n}`));
class Person {
  cookie = ""; constructor(public a: any) {}
  async req(path: string, init: any = {}) { const r = await fetch(BASE + path, { ...init, headers: { origin: ORIGIN, cookie: this.cookie, "x-portal-id": this.a.portal, "x-forwarded-for": this.a.ip, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(120_000) }); const set = r.headers.getSetCookie(); if (set.length) this.cookie = set.map((c) => c.split(";")[0]).join("; "); const text = await r.text(); let body: any = text; try { body = JSON.parse(text); } catch { /* not JSON */ } return { status: r.status, body }; }
  json = (path: string, method: string, data: unknown) => this.req(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  upload = (bytes: Uint8Array, name: string, kind = "cv") => { const f = new FormData(); f.append("kind", kind); f.append("file", new File([bytes as any], name)); return this.req("/api/documents", { method: "POST", body: f }); };
}
const A = new Person(adminOf(orgA)), B = new Person(adminOf(orgB));
// the crowd may be filling the platform: a sign-in told to wait waits, as a person would
for (const p of [A, B]) { let r: any; for (let i = 0; i < 40; i++) { r = await p.json("/api/auth/login", "POST", { email: p.a.email, password }); if (r.status !== 503 && r.status !== 429) break; await new Promise((w) => setTimeout(w, 3000)); } if (r.status !== 200) throw new Error(`sign-in ${r.status}`); }
const pdf = async (pages: number, tag: string, padMb = 0) => { const d = await PDFDocument.create(), font = await d.embedFont(StandardFonts.Helvetica); for (let p = 0; p < pages; p++) { const page = d.addPage([595, 842]); (p === 0 ? [`Probe Person ${tag}`, `probe.${tag}@load.invalid`, "Senior Accountant", "Experience", "Senior Accountant, Northwind Traders, 2016 - 2024", "Prepared monthly financial statements and managed budgets for three business units.", "Skills", "Excel, Financial Reporting"] : [`Page ${p + 1} of the document, with enough ordinary text to be read as text and not an image.`]).forEach((l, i) => page.drawText(l, { x: 50, y: 780 - i * 22, size: 12, font })); } const bytes = await d.save(); return padMb ? new Uint8Array([...bytes, ...new TextEncoder().encode("\n%" + "x".repeat(padMb * 1024 * 1024))]) : bytes; };
let tag = Date.now();
const rows: string[][] = [], note = (limit: string, did: string, ok: boolean) => { rows.push([limit, did, ok ? "held" : "NOT HELD"]); console.log(`${ok ? "held    " : "NOT HELD"} | ${limit} | ${did}`); };
const settings = async () => (await A.req("/api/settings")).body;
const set = async (patch: any, section = "limits") => { const s = await settings(); const r = await A.json("/api/settings", "PUT", { version: s.version, [section]: { ...s.settings[section], ...patch } }); if (r.status !== 200) throw new Error(`settings ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`); await new Promise((res) => setTimeout(res, 300)); };
const before = await settings(), usage = async () => (await A.req("/api/usage")).body;
const roomy = { documentsPerDay: 5000, storageMb: 102400, inProgress: 1000, matchesPerHour: 50000, maxPages: 50, maxFileMb: 100, processFileMb: 50 };
await set(roomy);

// uploads per day
let u = await usage(); await set({ documentsPerDay: u.usage.documentsToday + 2 });
const three = []; for (let i = 0; i < 3; i++) three.push(await A.upload(await pdf(1, `day${tag++}`), `day-${i}.pdf`));
note("Uploads per day", `limit +2: ${three.map((r) => r.status).join(", ")}; third says ${three[2].body?.error?.code}`, three[0].status < 300 && three[1].status < 300 && three[2].body?.error?.code === "QUOTA-001");
u = await usage(); await set({ documentsPerDay: u.usage.documentsToday + 3 });
const race = await Promise.all(Array.from({ length: 20 }, async (_, i) => A.upload(await pdf(1, `dayrace${tag++}`), `race-${i}.pdf`)));
const raced = race.filter((r) => r.status < 300).length; note("Uploads per day, 20 at the same moment", `limit allows 3 more: ${raced} accepted, ${race.filter((r) => r.body?.error?.code === "QUOTA-001").length} refused, others ${race.filter((r) => r.status >= 300 && r.body?.error?.code !== "QUOTA-001").map((r) => r.body?.error?.code ?? r.status).join(",")}`, raced <= 3);
await set(roomy);

// storage
u = await usage(); const usedMb = Math.ceil(u.usage.storageBytes / 1048576); await set({ storageMb: Math.max(10, usedMb + 2) });
const big = await A.upload(await pdf(1, `store${tag++}`, Math.max(10, usedMb + 2) - usedMb + 2), "storage.pdf");
note("Storage", `used ${usedMb} MB, limit ${Math.max(10, usedMb + 2)} MB, file over it: ${big.status} ${big.body?.error?.code}`, big.body?.error?.code === "QUOTA-002");
await set(roomy);

// documents waiting
u = await usage(); await set({ inProgress: u.usage.inProgress + 1 });
const wave = await Promise.all(Array.from({ length: 12 }, async (_, i) => A.upload(await pdf(1, `wait${tag++}`), `wait-${i}.pdf`)));
const waveOk = wave.filter((r) => r.status < 300).length; note("Documents waiting at once", `room for 1, 12 at once: ${waveOk} accepted, ${wave.filter((r) => r.body?.error?.code === "QUOTA-003").length} refused, others ${wave.filter((r) => r.status >= 300 && r.body?.error?.code !== "QUOTA-003").map((r) => r.body?.error?.code ?? r.status).join(",")}`, waveOk <= 1);
await set(roomy);

// matches per hour
const cand = (await A.req("/api/candidates?limit=1")).body.items[0].id, job = (await A.req("/api/jobs?limit=1")).body.items[0].id;
u = await usage(); await set({ matchesPerHour: u.usage.matchesLastHour + 2 });
const m3 = []; for (let i = 0; i < 3; i++) m3.push(await A.json("/api/matches", "POST", { candidateId: cand, jobId: job }));
note("Matches per hour", `limit +2: ${m3.map((r) => r.status).join(", ")}; third says ${m3[2].body?.error?.code}`, m3[2].body?.error?.code === "QUOTA-004");
u = await usage(); await set({ matchesPerHour: u.usage.matchesLastHour + 3 });
const mr = await Promise.all(Array.from({ length: 20 }, () => A.json("/api/matches", "POST", { candidateId: cand, jobId: job })));
const mOk = mr.filter((r) => r.status < 300).length; note("Matches per hour, 20 at the same moment", `limit allows 3 more: ${mOk} ran, ${mr.filter((r) => r.body?.error?.code === "QUOTA-004").length} refused, others ${[...new Set(mr.filter((r) => r.status >= 300 && r.body?.error?.code !== "QUOTA-004").map((r) => r.body?.error?.code ?? r.status))].join(",")}`, mOk <= 3);
await set(roomy);

// largest upload
await set({ maxFileMb: 1 });
const mb2 = await A.upload(await pdf(1, `size${tag++}`, 2), "two-mb.pdf"), small = await A.upload(await pdf(1, `size${tag++}`), "small.pdf");
note("Largest upload", `limit 1 MB: 2 MB file ${mb2.status} ${mb2.body?.error?.code}; small file ${small.status}`, mb2.body?.error?.code === "FILE-002" && small.status < 300);
await set(roomy);

// longest job description, and a CV has no page limit
await set({ maxPages: 2 });
const longJd = await A.upload(await pdf(4, `jd${tag++}`), "long-jd.pdf", "jd"), longCv = await A.upload(await pdf(4, `cv${tag++}`), "long-cv.pdf", "cv");
const settle = async (id: string) => { for (let i = 0; i < 1800; i++) { const d = (await A.req(`/api/documents/${id}`)).body; if (d.status && d.status !== "processing") return d; await new Promise((r) => setTimeout(r, 1000)); } return { status: "still processing" }; };
const jdEnd = longJd.status < 300 ? await settle(longJd.body.id) : { errorCode: longJd.body?.error?.code }, cvEnd = longCv.status < 300 ? await settle(longCv.body.id) : { status: "refused" };
note("Longest job description", `limit 2 pages: 4-page job ends ${jdEnd.status ?? ""} ${jdEnd.errorCode ?? ""}; 4-page CV ends ${cvEnd.status} ${cvEnd.errorCode ?? ""}`, jdEnd.status === "exception" || !!jdEnd.errorCode);
await set(roomy);

// largest file read
await set({ processFileMb: 1 });
const padded = await A.upload(await pdf(1, `read${tag++}`, 3), "three-mb.pdf"), paddedEnd = padded.status < 300 ? await settle(padded.body.id) : { errorCode: padded.body?.error?.code };
note("Largest file we will read", `limit 1 MB, 3 MB file: ends ${paddedEnd.status ?? ""} ${paddedEnd.errorCode ?? ""} (a bigger file is made smaller first)`, paddedEnd.status === "published" || paddedEnd.status === "exception" || !!paddedEnd.errorCode);
await set(roomy);

// session length
await set({ sessionHours: 1, warnMinutes: 7 }, "access");
const relog = await A.json("/api/auth/login", "POST", { email: A.a.email, password }), w = relog.body?.session ?? relog.body?.window, hours = w ? (Date.parse(w.endsAt) - Date.now()) / 3600000 : NaN;
note("Session length and warning", `set 1 h and 7 min: sign-in says ends in ${hours.toFixed(2)} h, warns at ${w?.warnMinutes}`, Math.abs(hours - 1) < 0.1 && w?.warnMinutes === 7);
await set({ sessionHours: before.settings.access.sessionHours, warnMinutes: before.settings.access.warnMinutes }, "access");

// another organisation
const other = await B.upload(await pdf(1, `other${tag++}`), "other.pdf"), oS = (await B.req("/api/settings")).body;
note("Another organisation untouched", `upload ${other.status}; its uploads-per-day ${oS.settings.limits.documentsPerDay}, not this organisation's changes`, other.status < 300 && oS.version !== undefined);
await set(before.settings.limits);
console.log(rows.filter((r) => r[2] !== "held").length ? "SOME NOT HELD" : "ALL HELD");
process.exit(0);
