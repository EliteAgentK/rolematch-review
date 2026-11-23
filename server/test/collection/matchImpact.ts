// How reading mistakes on real CVs change the match. Each CV is assessed three times against the same jobs: as live reads it, as the system and the model read it, and with the work history from the checked answers. The checked answers are provisional, so this measures distance from them, not truth. Counts only.
//   node --import tsx test/collection/matchImpact.ts <live-run> <hybrid-run>
// Pairing, fixed before looking at results: for each CV, the job sharing most title words with its latest checked role (same), the next job that shares a word with any of its roles (adjacent), and the first job sharing none (unrelated). Jobs are the 150 Word job specifications in the collection, since no real ones were given.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assess } from "../../src/match";
import { prepareDocument } from "../../src/prepare";
import { defaultSettings } from "../../src/settings";

const [liveRun, hybridRun] = process.argv.slice(2), P = "data/real-cvs", AS_OF = new Date("2026-11-05T00:00:00Z"), load = (run: string) => new Map<string, any>(JSON.parse(readFileSync(join(P, `candidate/${run}.json`), "utf8")).rows.map((r: any) => [r.id, r.record]));
const keys = new Map<string, any>(readFileSync(join(P, "keys/keys.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => { const k = JSON.parse(l); return [k.id, k]; })), text = JSON.parse(readFileSync(join(P, "keys/text-cache.json"), "utf8")), jobsFile = "data/collection/jobs-parsed.json";
let jobs: any[];
if (existsSync(jobsFile)) jobs = JSON.parse(readFileSync(jobsFile, "utf8"));
else {
  const manifest = readFileSync("data/collection/manifest.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.kind === "jd" && m.collection === "corpus500" && m.format === "docx"); jobs = [];
  for (const m of manifest) { const o: any = await prepareDocument(new Uint8Array(readFileSync(join(process.env.HOME!, m.path))), { kind: "jd", org: defaultSettings(), asOf: AS_OF } as any); if (o.ok) jobs.push({ ...o.record, id: m.id, status: "open", version: 1, extractionConfidence: o.confidence }); }
  writeFileSync(jobsFile, JSON.stringify(jobs));
}
const stop = new Set(["and", "of", "the", "senior", "junior", "lead", "head", "assistant", "manager", "officer", "specialist", "consultant", "administrator", "for"]), W = (s: string) => new Set(String(s ?? "").toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !stop.has(w)));
const shared = (a: Set<string>, b: Set<string>) => [...a].filter((w) => b.has(w)).length;
const asCandidate = (id: string, r: any) => ({ id, name: "x", role: r.role ?? "", skills: r.skills ?? [], summary: r.summary ?? "", location: r.location ?? "", email: "", phone: "", appliedDate: "", status: "new", avatar: "", rating: 0, experience: r.experience ?? "", workHistory: (r.workHistory ?? []).map((w: any) => ({ ...w, responsibilities: w.responsibilities ?? [] })), education: r.education ?? [], certifications: (r.certifications ?? []).map(String), languages: r.languages ?? [], projects: r.projects ?? [], worthNoting: [], reading: r.reading, extractionConfidence: 0.9, version: 1 });
const live = load(liveRun), hybrid = load(hybridRun), kinds = ["same", "adjacent", "unrelated"] as const;
const totals: any = { pairs: 0, liveFar: 0, hybridFar: 0, liveSum: 0, hybridSum: 0, liveYears: 0, hybridYears: 0, liveOrder: 0, hybridOrder: 0, checkedOrder: 0, orders: 0, incomplete: 0, incompleteSame: 0 }, by: any = {};
for (const [id, key] of keys) {
  const h = hybrid.get(id), l = live.get(id); if (!h || !l) continue;
  const roles = key.roles.map((k: any) => { const had = (h.workHistory ?? []).find((w: any) => String(w.startDate ?? "").includes(k[2] ?? "?") && [...W(w.position)].some((x) => W(k[0]).has(x))); return { position: k[0], company: k[1], startDate: k[2] ?? "", endDate: k[3] ?? "", responsibilities: had?.responsibilities ?? [] }; });
  const checked = { ...h, workHistory: roles, reading: undefined }, latest = W(key.roles[0]?.[0] ?? ""), every = W(key.roles.map((k: any) => k[0]).join(" "));
  const ranked = [...jobs].sort((a, b) => shared(W(b.title), latest) - shared(W(a.title), latest) || shared(W(b.title), every) - shared(W(a.title), every) || String(a.id).localeCompare(b.id));
  const same = ranked[0], adjacent = ranked.find((j) => j !== same && shared(W(j.title), every) > 0) ?? ranked[1], unrelated = ranked.find((j) => shared(W(j.title), every) === 0) ?? ranked.at(-1);
  const sourceText = text[id].text, scores: any = {};
  for (const [kind, job] of [["same", same], ["adjacent", adjacent], ["unrelated", unrelated]] as const) {
    const a = assess(asCandidate(id, l) as any, job, sourceText, AS_OF), b = assess(asCandidate(id, h) as any, job, sourceText, AS_OF), c = assess(asCandidate(id, checked) as any, job, sourceText, AS_OF);
    scores[kind] = { a: a.score, b: b.score, c: c.score, incomplete: b.assessment?.state === "incomplete" };
    totals.pairs++; totals.liveSum += Math.abs(a.score - c.score); totals.hybridSum += Math.abs(b.score - c.score);
    if (Math.abs(a.score - c.score) >= 10) totals.liveFar++; if (Math.abs(b.score - c.score) >= 10) totals.hybridFar++;
    const years = (m: any) => m.evidence.filter((e: any) => e.basis === "employment").map((e: any) => e.state).join();
    if (years(a) !== years(c)) totals.liveYears++; if (years(b) !== years(c)) totals.hybridYears++;
    if (b.assessment?.state === "incomplete") { totals.incomplete++; if (kind === "same") totals.incompleteSame++; }
    (by[kind] ??= { n: 0, live: 0, hybrid: 0, checked: 0 }); by[kind].n++; by[kind].live += a.score; by[kind].hybrid += b.score; by[kind].checked += c.score;
  }
  totals.orders++; for (const [k, v] of [["liveOrder", "a"], ["hybridOrder", "b"], ["checkedOrder", "c"]] as const) if (scores.same[v] >= scores.unrelated[v]) totals[k]++;
}
console.log(JSON.stringify({ jobs: jobs.length, ...totals, liveMeanDistance: +(totals.liveSum / totals.pairs).toFixed(1), hybridMeanDistance: +(totals.hybridSum / totals.pairs).toFixed(1), meanScore: Object.fromEntries(Object.entries(by).map(([k, v]: any) => [k, { live: Math.round(v.live / v.n), hybrid: Math.round(v.hybrid / v.n), checked: Math.round(v.checked / v.n) }])) }, null, 1));
process.exit(0);
