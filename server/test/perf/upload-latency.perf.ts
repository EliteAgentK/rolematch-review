// A measurement harness, not a pass/fail test (run it with: PERF=1 npx vitest run --config test/perf/vitest.perf.config.ts). It works against ANY version of the
// server, because it only uses the public API and the database from outside: the same file is copied into a checkout of the baseline commit and run there.
// For each repetition it records, separately:
//   rtt_ms          a bare "select 1" round trip to the database, from this machine (network drift between runs shows up here)
//   load_before     the machine's load average (other work on the machine shows up here)
//   post_ms         how long each upload request took to be answered (admission + file transfer + storage + insert + queue add)
//   publish_ms      from the upload request being sent to the record being published (adds queue waiting and reading)
//   unrelated_ms    the slowest and median of ordinary requests made WHILE the uploads are being processed
//   wall_ms         all 12 published
// and prints one JSON line per repetition and a summary with the spread (min, median, max), never only the best run.
import { Document, Packer, Paragraph } from "docx";
import { loadavg } from "node:os";
import postgres from "postgres";
import { expect, test } from "vitest";
import { adminDeleteUser } from "../../src/supabase";
import { setupTestDb, sleep, spawnProc } from "../helpers";

const REPS = Number(process.env.PERF_REPS ?? 5), N = 12, PORT = Number(process.env.PERF_PORT ?? 8820), LABEL = process.env.PERF_LABEL ?? "run";
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const lines = (name: string, n: number) => [name, `${name.toLowerCase().replace(/\W/g, ".")}.${n}@example.test`, "Senior Accountant", "Summary", "Accountant with ten years of experience in financial reporting.", "Experience", `Senior Accountant, Northwind Traders ${n}, 2016 - 2024`, "Prepared monthly financial statements and managed budgets.", "Skills", "Excel, Financial Reporting, Budgeting, Payroll", "Education", "BCom Accounting, University of Cape Town, 2015"];
const names = ["Aanya Zulu", "Brian Kekana", "Chloe Ndlovu", "Dumi Pillay", "Elke Visser", "Farai Moyo", "Gugu Sibiya", "Hendrik Joubert", "Ines Pretorius", "Jabu Radebe", "Karabo Molefe", "Lindiwe Cele"];
const cv = async (i: number, rep: number) => new File([new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children: lines(`${names[i]}`, i + rep * 100).map((l) => new Paragraph(l)) }] })))], `cv${i}-r${rep}.docx`);

test("upload latency, decomposed from outside", async () => {
  const run = crypto.randomUUID().slice(0, 8), base = `http://localhost:${PORT}`;
  const tdb = await setupTestDb({ PORT: String(PORT), SIGNUP_REQUIRE_CODE: "false", TRUST_PROXY: "true", WORKER_CONCURRENCY: "6", PER_ORG_CONCURRENCY: "6", ...(process.env.PERF_POOL ? { DB_POOL_SIZE: process.env.PERF_POOL } : {}), RATE_OVERRIDES: JSON.stringify({ upload: 100000, upload_portal: 100000, reserve_user: 100000 }) });
  const admin = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  const server = spawnProc(["tsx", "src/index.ts"], { env: tdb.env, stdout: "ignore", stderr: "ignore" });
  for (let i = 0; i < 300; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch {} await sleep(100); }
  const res = await fetch(base + "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173", "x-forwarded-for": "10.50.0.1" }, body: JSON.stringify({ name: "Perf One", orgName: `Perf ${run}`, email: `perf-${run}@example.test`, password: "a-long-enough-password-1" }) });
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => !c.endsWith("=")).join("; ");
  const h = { cookie, origin: "http://localhost:5173" };
  const out: any[] = [];
  try {
    for (let rep = 0; rep < REPS; rep++) {
      const rtts: number[] = []; for (let k = 0; k < 9; k++) { const t = performance.now(); await admin`select 1`; rtts.push(performance.now() - t); }
      const files = await Promise.all(Array.from({ length: N }, (_, i) => cv(i, rep)));
      const load = loadavg()[0];
      await fetch(base + "/api/health/details?reset=1", { method: "POST", headers: { authorization: `Bearer ${process.env.OPS_TOKEN ?? ""}` } }).catch(() => null);   // start this repetition's stage timings from zero (only newer versions have them)
      const t0 = performance.now(), sent: number[] = [], posts: number[] = [], ids: string[] = [];
      await Promise.all(files.map(async (f) => { const fd = new FormData(); fd.append("kind", "cv"); fd.append("file", f); const t = performance.now(); const r = await fetch(base + "/api/documents", { method: "POST", headers: h, body: fd }); posts.push(performance.now() - t); const b: any = await r.json(); if (b.id) ids.push(b.id); sent.push(t - t0); }));
      const unrelated: number[] = []; let done = false;
      const watcher = (async () => { while (!done) { const t = performance.now(); await fetch(base + "/api/health"); await fetch(base + "/api/candidates?limit=1", { headers: h }); unrelated.push(performance.now() - t); await sleep(100); } })();
      const published: Record<string, number> = {};
      for (let s = 0; s < 120 && Object.keys(published).length < ids.length; s++) {
        const list: any[] = await (await fetch(base + "/api/documents", { headers: h })).json();
        const pending = new Set(list.filter((d) => d.status === "processing").map((d) => d.id));
        for (const id of ids) if (!pending.has(id) && !(id in published)) published[id] = performance.now() - t0;
        if (Object.keys(published).length < ids.length) await sleep(250);
      }
      done = true; await watcher;
      const pub = Object.values(published);
      out.push({ label: LABEL, rep, rtt_ms: Math.round(med(rtts)), load_before: Number(load.toFixed(2)), post_ms: { med: Math.round(med(posts)), max: Math.round(Math.max(...posts)) }, publish_ms: { med: Math.round(med(pub)), max: Math.round(Math.max(...pub)) }, unrelated_ms: { med: Math.round(med(unrelated)), max: Math.round(Math.max(...unrelated)), n: unrelated.length }, wall_ms: Math.round(Math.max(...pub)), published: pub.length });
      console.log("PERF " + JSON.stringify(out[out.length - 1]));
      const det: any = await (await fetch(base + "/api/health/details", { headers: { authorization: `Bearer ${process.env.OPS_TOKEN ?? ""}` } })).json().catch(() => null);
      if (det?.timing) console.log("STAGES " + JSON.stringify({ label: LABEL, rep, ...det.timing }));
    }
    const k = (f: (o: any) => number) => { const v = out.map(f).sort((a, b) => a - b); return { min: v[0], median: v[Math.floor(v.length / 2)], max: v[v.length - 1] }; };
    console.log("PERFSUMMARY " + JSON.stringify({ label: LABEL, reps: REPS, rtt_ms: k((o) => o.rtt_ms), post_med_ms: k((o) => o.post_ms.med), wall_ms: k((o) => o.wall_ms), unrelated_max_ms: k((o) => o.unrelated_ms.max), unrelated_med_ms: k((o) => o.unrelated_ms.med) }));
    expect(out.every((o) => o.published === N)).toBe(true);
  } finally {
    server.kill(); await admin.end(); await tdb.teardown();
    const a = postgres(process.env.DATABASE_URL!, { max: 1 }); try { for (const u of await a.unsafe(`select id from auth.users where email like 'perf-${run}@example.test'`)) await adminDeleteUser(u.id); } finally { await a.end(); }
  }
}, 1_800_000);
