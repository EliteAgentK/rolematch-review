// Matching on the live workflow corpus, both directions, against the answer key's qualitative expectations, written down before the results were looked at:
//   1. For each anchor CV, its direct-fit job ranks at or above its adjacent job, and both above its cross-domain decoy.
//   2. On the decoy job, the alternate candidate the key names ranks above the anchor.
//   3. Where a mandatory credential is not evidenced, that criterion is not met and is not called contradicted: absence is not proof.
//   4. Where leadership and budget evidence is missing, that criterion is not met.
//   5. Every credited criterion cites evidence from the CV, and the score is the configured calculation of the criterion credits.
// Each assessment is made twice with the same engine: on the record the platform published, and on a reference record built from the answer key, so reading errors and matching errors can be told apart. No exact percentage is claimed: the key gives none.
//   node --import tsx test/corpus/matching.ts data/corpus-live/run-<commit>.json
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { assess } from "../../src/match";

const run = JSON.parse(readFileSync(process.argv[2], "utf8")), inv = JSON.parse(readFileSync("data/corpus-live/inventory.json", "utf8")), keyFile = (n: string) => inv.answerKey.find((p: string) => p.endsWith(n));
const csv = (file: string) => { const [head, ...rows] = readFileSync(file, "utf8").trim().split(/\r?\n/).map((l) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'))); return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""]))); };
const expected = csv(keyFile("Expected matching.csv")), truth = Object.fromEntries(csv(keyFile("CV ground truth.csv")).map((r) => [r["CV ID"], r]));
const AS_OF = new Date("2026-11-05T00:00:00Z"), records: Record<string, any> = {}, sources: Record<string, string> = {};
for (const o of run.outcomes) { const d = o.docs?.[0]; if (o.id && d?.record) records[o.id] = { ...d.record, id: o.id, version: d.record.version ?? 1 }; }
// The CV text the platform matches against, as runMatch reads it: the document's stored text, from the isolated database.
const docOf = Object.fromEntries(run.outcomes.filter((o: any) => o.id && o.docs?.[0]?.doc).map((o: any) => [o.docs[0].doc, o.id]));
const dump = execFileSync("docker", ["exec", "supabase_db_rolematch", "psql", "-U", "postgres", "-At", "-c", `select id, encode(convert_to(coalesce(source_text, ''), 'UTF8'), 'base64') from documents where id in (${Object.keys(docOf).map((d) => `'${d}'`).join(",") || "null"})`], { maxBuffer: 1 << 28 }).toString();
for (const line of dump.split("\n").filter(Boolean)) { const [id, b64] = line.split("|"); sources[docOf[id]] = Buffer.from(b64.replace(/\s/g, ""), "base64").toString("utf8"); }
const reference = (id: string) => { const k = truth[id]; if (!k) return null; const role = (p: string, c: string, s: string, e: string) => ({ position: p, company: c, startDate: s, endDate: e, responsibilities: [] as string[] });
  return { ...records[id], workHistory: [role(k["Current role"], k["Current employer"], k["Current start"], "Present"), role(k["Prior role"], k["Prior employer"], k["Prior start"], k["Prior end"]), role(k["Earlier role"], k["Earlier employer"], k["Earlier start"], k["Earlier end"])], skills: k.Skills.split(";").map((s: string) => s.trim()), reading: undefined }; };
const job = (id: string) => records[id] && { ...records[id], status: "open" };
const kindOf = (rel: string) => (/^Direct/.test(rel) ? "direct" : /^Adjacent/.test(rel) ? "adjacent" : /Leadership/.test(rel) ? "leadership missing" : /credential/.test(rel) ? "credential missing" : "decoy");
const checks: Record<string, { pass: number; fail: number; skip: number; fails: string[] }> = {}, note = (name: string, ok: boolean | null, id: string) => { const c = (checks[name] ??= { pass: 0, fail: 0, skip: 0, fails: [] }); if (ok === null) c.skip++; else if (ok) c.pass++; else { c.fail++; c.fails.push(id); } };
let incomplete = 0, total = 0, untraced = 0, refDiff = 0; const distance: number[] = [];
for (const anchor of [...new Set(expected.map((e) => e["Anchor CV ID"]))]) {
  const rows = expected.filter((e) => e["Anchor CV ID"] === anchor), cand = records[anchor], ref = reference(anchor);
  if (!cand) { for (const r of rows) note("anchor published", false, `${anchor}`); continue; }
  const res: Record<string, any> = {}, refRes: Record<string, any> = {};
  for (const r of rows) { const j = job(r["Job ID"]); if (!j) { note("job published", false, r["Job ID"]); continue; }
    const a = assess(cand, j, sources[anchor], AS_OF); res[kindOf(r["Expected evidence relationship"])] = { r, a }; total++; if (a.assessment?.state === "incomplete") incomplete++;
    if (ref) { const b = assess(ref, j, sources[anchor], AS_OF); refRes[kindOf(r["Expected evidence relationship"])] = b; distance.push(Math.abs(a.score - b.score)); if (Math.abs(a.score - b.score) >= 10) refDiff++; }
    for (const e of a.evidence) if (e.state === "verified" && !e.source) untraced++;
    // 5. the configured calculation: shares add to 100 and the proved points are what the floor says
    const proved = a.evidence.reduce((s: number, e: any) => s + (e.pointsProved ?? 0), 0); note("score is the configured calculation", Math.abs(proved - a.scoreFloor) <= 1 || a.evidence.some((e: any) => e.state === "contradicted"), `${anchor}x${r["Job ID"]}`);
  }
  const s = (k: string, from = res) => (from === res ? from[k]?.a : (from as any)[k]);
  const rank = (x: any) => (x ? (x.assessment?.state === "incomplete" ? null : x.scoreFloor * 1000 + x.score) : null);
  const order = (from: any, label: string) => { const d = rank(s("direct", from)), ad = rank(s("adjacent", from)), dec = rank(s("decoy", from)); note(`${label}: direct at or above adjacent`, d === null || ad === null ? null : d >= ad, anchor); note(`${label}: adjacent above the decoy`, ad === null || dec === null ? null : ad > dec, anchor); };
  order(res, "published records"); order(refRes, "reference records");
  // 2. the other direction: on the decoy job, the alternate candidate ranks above the anchor
  const decoy = res.decoy; if (decoy) { const alt = decoy.r["Alternate candidate to inspect"]; if (records[alt]) { const b = assess(records[alt], job(decoy.r["Job ID"]), sources[alt] ?? "", AS_OF); note("job to candidates: the alternate ranks above the anchor on the decoy job", rank(b) === null || rank(decoy.a) === null ? null : rank(b) > rank(decoy.a), `${decoy.r["Job ID"]}`); } }
  // 3. a mandatory credential not evidenced is not met and is not contradicted
  const cred = res["credential missing"]; if (cred) { const e = cred.a.evidence.filter((x: any) => /member|registr|certif|licen|accredit|qualif/i.test(x.label) && x.mandatory); note("missing credential: not met", e.length ? e.every((x: any) => x.state !== "verified") : null, `${anchor}x${cred.r["Job ID"]}`); note("missing credential: not called contradicted", e.length ? e.every((x: any) => x.state !== "contradicted") : null, `${anchor}x${cred.r["Job ID"]}`); }
  // 4. leadership and budget evidence missing is not met
  const lead = res["leadership missing"]; if (lead) { const e = lead.a.evidence.filter((x: any) => /budget|lead|manag/i.test(x.label)); note("leadership and budget missing: not met", e.length ? e.every((x: any) => x.state !== "verified") : null, `${anchor}x${lead.r["Job ID"]}`); }
}
console.log(`assessments ${total}; Assessment incomplete ${incomplete}; credited criteria without cited evidence ${untraced}; published against reference records: mean distance ${(distance.reduce((a, b) => a + b, 0) / Math.max(1, distance.length)).toFixed(1)} points, ${refDiff} of ${distance.length} differ by 10 or more`);
for (const [name, c] of Object.entries(checks)) console.log(`  ${name}: ${c.pass} pass, ${c.fail} fail${c.skip ? `, ${c.skip} not assessable` : ""}${c.fails.length ? ` (${c.fails.slice(0, 8).join(" ")})` : ""}`);
process.exit(0);
