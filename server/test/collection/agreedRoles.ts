// Measures one rule on stored readings, free: a role the AI could not tie to its lines, which the parser read the same way (title, employer and the same start
// year on both), counted as confirmed. Prints, per run, how many such roles the answer keys hold. Counts and opaque ids only.
//   node --import tsx test/collection/agreedRoles.ts <run> [<run> ...]
import { readFileSync } from "node:fs";
import { parseCv } from "../../src/rules";
import { bothRead } from "../../src/reconcile";
const P = "data/real-cvs", cache = JSON.parse(readFileSync(`${P}/keys/text-cache.json`, "utf8"));
const keys = new Map(readFileSync(`${P}/keys/keys.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((k) => [k.id, k]));
const words = (s?: string) => new Set(String(s ?? "").toLowerCase().replace(/[^a-z0-9#+. ]/g, " ").split(/\s+/).filter((w) => w && !["the", "of", "in", "and", "a", "ltd", "pty", "sa", "group", "company", "limited"].includes(w)));
const near = (a?: string, b?: string) => { const A = words(a), B = words(b); return !!A.size && !!B.size && [...A].filter((w) => B.has(w)).length / Math.min(A.size, B.size) >= 0.6; };
const yr = (s?: string) => String(s ?? "").match(/(?:19|20)\d{2}/)?.[0] ?? "";
for (const run of process.argv.slice(2)) {
  const rows = JSON.parse(readFileSync(`${P}/candidate/${run}.json`, "utf8")).rows, tally: Record<string, number> = {};
  for (const r of rows) {
    const k: any = keys.get(r.id), rules = parseCv(cache[r.id]?.text ?? "").workHistory ?? [];
    for (const w of r.record?.workHistory ?? []) {
      if (w.status !== "uncertain" || w.agreement !== "both") continue;
      const right = k.roles.some(([t, e, s]: string[]) => near(w.position, t) && (!e || near(w.company, e)) && (!s || yr(w.startDate) === s));
      const g = `${rules.some((x: any) => bothRead(w, x)) ? "confirmed" : "still uncertain"} / ${right ? "right" : "not in key"}`;
      tally[g] = (tally[g] ?? 0) + 1;
    }
  }
  console.log(run, tally);
}
