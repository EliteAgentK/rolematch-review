// Turns src/points.ts into docs/architecture/POINTS_CATALOGUE.md, so the document can never drift from the data.
// Run from server/: npm run docs:points
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FAMILIES, POINTS, type FamilyId, type PointDef } from "../src/points";

const KIND: Record<string, string> = { scored: "scored", gate: "flag", info: "shown", integrity: "trust", human: "person", forbidden: "never used" };
const cell = (s: string) => (s || "—").replace(/\|/g, "/");

export function renderCatalogue(): string {
  const count = (f: (p: PointDef) => boolean) => POINTS.filter(f).length;
  const out: string[] = [];
  out.push("# The points catalogue", "");
  out.push("Generated from `server/src/points.ts` by `npm run docs:points`; do not edit by hand. A test fails if this file and the data disagree.", "");
  out.push(`${POINTS.length} points in ${Object.keys(FAMILIES).length} families: ${count((p) => p.status === "implemented")} are in the engine today, ${count((p) => p.status === "planned")} are designed and planned, and ${count((p) => p.family === "X" || p.status === "never")} are never used.`, "");
  out.push("**What a point is.** One thing a recruiter might look for. For each: where its evidence comes from, how it is judged, and what stops it being counted twice or unfairly disadvantaging a person.", "");
  out.push("**Kinds.** *scored* earns credit in the match arithmetic. *flag* is shown to a person (never zero, never a rejection). *shown* is a fact displayed, not scored (some facts are risky to score and are still worth seeing). *trust* changes how far the result can be trusted (confidence), not how good the person looks. *person* is recorded by a human, never inferred. *never used* is forbidden for every organisation.", "");
  out.push("**Never counting the same thing twice.** Credit depends on distinct evidence, never on counts of mentions. A word repeated a hundred times earns what it earns once; overlapping or duplicated roles count once; a requirement repeated in a job description is counted once; the same person in a second file is flagged, not merged. See [`MATCHING_MODEL.md`](MATCHING_MODEL.md), section 4.", "");
  for (const id of Object.keys(FAMILIES) as FamilyId[]) {
    const ps = POINTS.filter((p) => p.family === id);
    out.push(`## ${id}. ${FAMILIES[id].name}`, "", FAMILIES[id].about, "");
    out.push("| Id | Point | Kind | Status | Evidence | How it is judged | Guard against double counting and unfairness |", "|---|---|---|---|---|---|---|");
    for (const p of ps) out.push(`| ${p.id} | ${cell(p.name)} | ${KIND[p.kind]} | ${p.status} | ${cell(p.evidence)} | ${cell(p.rule)} | ${cell(p.guard)} |`);
    out.push("");
  }
  return out.join("\n");
}

export const CATALOGUE_PATH = fileURLToPath(new URL("../../docs/architecture/POINTS_CATALOGUE.md", import.meta.url));
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { writeFileSync(CATALOGUE_PATH, renderCatalogue()); console.log("wrote", CATALOGUE_PATH, POINTS.length, "points"); }
