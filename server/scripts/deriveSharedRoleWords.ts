// Which words in job titles and requirements say nothing about the profession, because many unrelated professions use them ("manager", "senior"). Measured from invented packs' role families, so the list comes from evidence rather than taste, and is written into the rules as configuration.
//   node --import tsx scripts/deriveSharedRoleWords.ts <reference folder> [families needed]
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const [ref, need] = process.argv.slice(2), byWord = new Map<string, Set<string>>(), families = new Set<string>();
const add = (text: string, family: string) => { families.add(family); for (const w of new Set(text.toLowerCase().match(/[a-z]{4,}/g) ?? [])) { const s = w.slice(0, 5); if (!byWord.has(s)) byWord.set(s, new Set()); byWord.get(s)!.add(family); } };
for (const f of readdirSync(join(ref, "Expected_CVs"))) { const e = JSON.parse(readFileSync(join(ref, "Expected_CVs", f), "utf8")); add(e.title ?? "", e.role_family); for (const w of e.work_history ?? []) add(w.title ?? "", e.role_family); }
for (const f of readdirSync(join(ref, "Expected_Jobs"))) { const e = JSON.parse(readFileSync(join(ref, "Expected_Jobs", f), "utf8")); add(e.title ?? "", e.role_family); }
const min = Number(need ?? Math.ceil(families.size * 0.25));
const out = [...byWord].filter(([, v]) => v.size >= min).sort((a, b) => b[1].size - a[1].size).map(([k, v]) => `${k}:${v.size}`);
console.log(`${families.size} families; words in at least ${min}:`); console.log(out.join(" "));
