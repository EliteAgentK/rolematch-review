// Assigns dataset roles to a batch BEFORE results are examined. Records that share content stay together: every format of one candidate; candidates
// who share a duty sentence or a base role (connected components); jobs with identical requirement sets. Groups go to development or protected
// evaluation by a hash of the group, so the assignment is reproducible and not chosen by looking at outcomes. Records already inspected (the smoke run)
// are forced into development. Protected records are reported only in aggregate and are never used to choose a change.
// Usage: node --import tsx test/batch/splits.ts <pack directory> <batch id> <protected share 0..1> [--inspected ID,ID]
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2), [packDir, batchId, shareArg] = args;
const inspected = new Set((args[args.indexOf("--inspected") + 1] ?? "").split(",").filter(Boolean));
const share = Number(shareArg ?? 0.4);
const load = (d: string) => Object.fromEntries(readdirSync(join(packDir, "Reference", d)).map((f) => [f.replace(".json", ""), JSON.parse(readFileSync(join(packDir, "Reference", d, f), "utf8"))]));
const cvs = load("Expected_CVs"), jds = load("Expected_Jobs");
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

// union-find over candidates: shared duty sentence or shared base role joins two candidates
const parent = new Map<string, string>(Object.keys(cvs).map((k) => [k, k]));
const find = (x: string): string => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x)!)), parent.get(x)!));
const unite = (a: string, b: string) => parent.set(find(a), find(b));
const firstBy = new Map<string, string>();
for (const [id, e] of Object.entries<any>(cvs)) for (const key of [`role:${e.base_role}`, ...e.work_history.flatMap((w: any) => w.bullets.map((b: string) => `duty:${norm(b)}`))]) {
  const seen = firstBy.get(key); if (seen) unite(id, seen); else firstBy.set(key, id);
}
const jobKey = (j: any) => [...j.required_skills].sort().join("|") + "#" + j.minimum_experience_years + "#" + j.qualification;
const groupOf = (id: string) => (id.startsWith("CV") ? `cv-group:${find(id)}` : `jd-group:${jobKey(jds[id])}`);
const hashShare = (g: string) => parseInt(createHash("sha256").update(`${batchId}:${g}`).digest("hex").slice(0, 8), 16) / 0xffffffff;

const groups = new Map<string, string[]>();
for (const id of [...Object.keys(cvs), ...Object.keys(jds)]) groups.set(groupOf(id), [...(groups.get(groupOf(id)) ?? []), id]);
const roles: Record<string, "development" | "protected"> = {};
for (const [g, ids] of groups) { const role = ids.some((i) => inspected.has(i)) ? "development" : hashShare(g) < share ? "protected" : "development"; for (const i of ids) roles[i] = role; }
const out = {
  batchId, assignedAt: new Date().toISOString(), method: "groups (candidate formats; shared duty or base role; identical job requirement sets), hash-assigned before results were examined", protectedShare: share, forcedDevelopment: [...inspected],
  counts: { candidates: { development: Object.keys(cvs).filter((i) => roles[i] === "development").length, protected: Object.keys(cvs).filter((i) => roles[i] === "protected").length }, jobs: { development: Object.keys(jds).filter((i) => roles[i] === "development").length, protected: Object.keys(jds).filter((i) => roles[i] === "protected").length }, candidateGroups: [...groups.keys()].filter((g) => g.startsWith("cv")).length, jobGroups: [...groups.keys()].filter((g) => g.startsWith("jd")).length },
  limitation: "The pack's careers and requirements are adapted from an earlier synthetic corpus that was not supplied, so cross-batch lineage cannot be checked; 'protected' means protected within this batch only.",
  roles, groups: Object.fromEntries(groups),
};
const dir = join(import.meta.dirname, "..", "..", "..", "docs", "assessment", "batches", batchId);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "splits.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out.counts));
