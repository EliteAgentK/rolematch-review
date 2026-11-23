// Inventory of a supplied batch of fictional documents, before any of it is used. Reads the pack read-only, never executes anything from it, and
// treats its text as data. Writes machine-readable results to server/data/evaluations/<batch>/inventory.json (git-ignored: the documents and anything
// derived from them stay out of Git) and prints a summary.
// Usage (from server/): node --import tsx test/batch/inventory.ts <pack directory> <batch id>
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";

const [packDir, batchId] = process.argv.slice(2);
if (!packDir || !batchId) throw new Error("usage: inventory.ts <pack directory> <batch id>");
const OUT = join(import.meta.dirname, "..", "..", "data", "evaluations", batchId);

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const tokens = (s: string) => new Set(norm(s).split(/[^a-z0-9@.+]+/).filter((t) => t.length > 1));
const recall = (want: Set<string>, got: Set<string>) => (want.size ? [...want].filter((t) => got.has(t)).length / want.size : 1);

const files = walk(packDir).filter((p) => !p.includes("/Reference/") && /\.(docx|pdf|txt)$/i.test(p) && !p.endsWith("Visual_Index.pdf"));
const manifest = new Map(readFileSync(join(packDir, "Reference", "file_manifest.csv"), "utf8").trim().split(/\r?\n/).slice(1).map((l) => { const [path, id, bytes, h] = l.split(","); return [path, { id, bytes: +bytes, sha256: h }]; }));
const expCv = Object.fromEntries(readdirSync(join(packDir, "Reference", "Expected_CVs")).map((f) => [f.replace(".json", ""), JSON.parse(readFileSync(join(packDir, "Reference", "Expected_CVs", f), "utf8"))]));
const expJd = Object.fromEntries(readdirSync(join(packDir, "Reference", "Expected_Jobs")).map((f) => [f.replace(".json", ""), JSON.parse(readFileSync(join(packDir, "Reference", "Expected_Jobs", f), "utf8"))]));

interface FileRow { path: string; id: string; kind: "cv" | "jd"; format: string; condition: string; bytes: number; sha256: string; manifestMatch: boolean | null; pages: number | null; textLayerChars: number | null; tokenRecallVsExpected: number | null }
const rows: FileRow[] = [];
for (const p of files.sort()) {
  const rel = relative(packDir, p), b = readFileSync(p), id = (rel.match(/(CV|JD)\d{4}/) ?? [""])[0], kind = id.startsWith("CV") ? "cv" : "jd";
  const condition = rel.startsWith("03_") ? "simulated scan (image only)" : rel.startsWith("04_") ? "simulated phone photo (image only)" : rel.includes("Searchable_PDF") ? "native PDF" : rel.includes("Word") ? "native Word" : "plain text";
  const m = manifest.get(rel);
  let pages: number | null = null, textLayerChars: number | null = null, rec: number | null = null;
  const expected = kind === "cv" ? expCv[id]?.canonical_text : expJd[id]?.canonical_text;
  if (extname(p).toLowerCase() === ".pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(b));
    pages = pdf.numPages;
    const t = await extractText(pdf, { mergePages: true }), text = Array.isArray(t.text) ? t.text.join("\n") : t.text;
    textLayerChars = text.replace(/\s/g, "").length;
    if (textLayerChars > 0 && expected) rec = recall(tokens(expected), tokens(text));
  } else if (extname(p).toLowerCase() === ".txt" && expected) rec = recall(tokens(expected), tokens(b.toString("utf8")));
  rows.push({ path: rel, id, kind, format: extname(p).slice(1).toLowerCase(), condition, bytes: b.length, sha256: sha(b), manifestMatch: m ? m.sha256 === sha(b) : null, pages, textLayerChars, tokenRecallVsExpected: rec });
}

// Is each expected value actually printed? (the generated answer key is checked, not trusted)
const printed = (text: string, v: unknown) => v === null || v === undefined || v === "" || norm(text).includes(norm(String(v)));
const fieldChecks: { id: string; field: string; value: string }[] = [];
for (const [id, e] of Object.entries<any>(expCv)) {
  const t = e.canonical_text as string;
  const want: [string, unknown][] = [["name", e.name], ["email", e.email], ["phone", e.phone], ["location", e.location], ...e.skills.map((s: string) => ["skill", s] as [string, unknown]),
    ...e.work_history.flatMap((w: any) => [["employer", w.employer], ["title", w.title], ["start", w.start], ["end", w.end ?? "Present"], ...w.bullets.map((x: string) => ["duty", x])] as [string, unknown][]),
    ...e.education.flatMap((x: any) => [["qualification", x.qualification], ["institution", x.institution], ["education status", x.status]] as [string, unknown][]),
    ...e.certifications.flatMap((x: any) => [["certification", x.name], ["certification status", x.status]] as [string, unknown][])];
  for (const [field, v] of want) if (!printed(t, v)) fieldChecks.push({ id, field, value: String(v) });
}
for (const [id, j] of Object.entries<any>(expJd)) for (const s of [...j.required_skills, ...j.preferred_skills]) if (!printed(j.canonical_text, s)) fieldChecks.push({ id, field: "job skill", value: s });

// Content reuse between candidates: shared duty sentences and shared base roles (new names do not make reused careers independent)
const dutyOwners = new Map<string, Set<string>>();
for (const [id, e] of Object.entries<any>(expCv)) for (const w of e.work_history) for (const b of w.bullets) { const k = norm(b); dutyOwners.set(k, (dutyOwners.get(k) ?? new Set()).add(id)); }
const sharedDuties = [...dutyOwners.entries()].filter(([, s]) => s.size > 1);
const byRole = new Map<string, string[]>();
for (const [id, e] of Object.entries<any>(expCv)) byRole.set(e.base_role, [...(byRole.get(e.base_role) ?? []), id]);
const careerKey = (e: any) => e.work_history.map((w: any) => norm(w.title) + "|" + w.bullets.map(norm).sort().join("/")).sort().join("||");
const sameCareer = new Map<string, string[]>();
for (const [id, e] of Object.entries<any>(expCv)) sameCareer.set(careerKey(e), [...(sameCareer.get(careerKey(e)) ?? []), id]);
const jobReqKey = (j: any) => [...j.required_skills].sort().join("|") + "#" + j.minimum_experience_years + "#" + j.qualification;
const sameJobReqs = new Map<string, string[]>();
for (const [id, j] of Object.entries<any>(expJd)) sameJobReqs.set(jobReqKey(j), [...(sameJobReqs.get(jobReqKey(j)) ?? []), id]);

const count = <T,>(xs: T[], k: (x: T) => string) => xs.reduce((m, x) => ((m[k(x)] = (m[k(x)] ?? 0) + 1), m), {} as Record<string, number>);
const summary = {
  batchId, packDir, readAt: new Date().toISOString(),
  candidates: Object.keys(expCv).length, jobs: Object.keys(expJd).length,
  files: rows.length, filesByKindAndCondition: count(rows, (r) => `${r.kind}: ${r.condition} (.${r.format})`),
  manifest: { listed: manifest.size, matched: rows.filter((r) => r.manifestMatch === true).length, mismatched: rows.filter((r) => r.manifestMatch === false).map((r) => r.path), unlisted: rows.filter((r) => r.manifestMatch === null).map((r) => r.path) },
  exactDuplicateFiles: Object.values(count(rows, (r) => r.sha256)).filter((n) => n > 1).length,
  pdfPages: count(rows.filter((r) => r.pages !== null), (r) => `${r.condition}: ${r.pages} page(s)`),
  imageOnlyWithTextLayer: rows.filter((r) => r.condition.includes("image only") && (r.textLayerChars ?? 0) > 0).map((r) => r.path),
  nativeTokenRecallMin: Math.min(...rows.filter((r) => r.tokenRecallVsExpected !== null).map((r) => r.tokenRecallVsExpected!)),
  nativeBelow98: rows.filter((r) => r.tokenRecallVsExpected !== null && r.tokenRecallVsExpected < 0.98).map((r) => `${r.path} ${r.tokenRecallVsExpected!.toFixed(3)}`),
  expectedValuesNotPrinted: fieldChecks,
  designs: { headerFamilies: new Set(Object.values<any>(expCv).map((e) => e.design.header)).size, signatures: new Set(Object.values<any>(expCv).map((e) => `${e.design.header_index}/${e.design.body_layout}/${e.design.body_font}/${e.design.section_order.join(">")}`)).size, bodyLayouts: count(Object.values<any>(expCv), (e) => String(e.design.body_layout)), difficulty: count(Object.values<any>(expCv).flatMap((e) => e.difficulty), (x: string) => x) },
  reuse: {
    dutySentences: dutyOwners.size, dutySentencesSharedByCandidates: sharedDuties.length, maxCandidatesSharingOneDuty: Math.max(...sharedDuties.map(([, s]) => s.size), 1),
    baseRoles: byRole.size, candidatesPerBaseRole: count([...byRole.values()], (v) => String(v.length)),
    identicalCareerGroups: [...sameCareer.values()].filter((v) => v.length > 1),
    jobsWithIdenticalRequirementSets: [...sameJobReqs.values()].filter((v) => v.length > 1),
  },
  pairingGuide: count(JSON.parse(readFileSync(join(packDir, "Reference", "pairing_guide.json"), "utf8")), (p: any) => p.intended_relationship),
};
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "inventory.json"), JSON.stringify({ summary, files: rows }, null, 2));
console.log(JSON.stringify(summary, null, 2));
