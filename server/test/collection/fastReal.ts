// While working on role reading: the real CVs' read text once, then only the reader again, so each step can be scored in seconds. Writes a run the scorer reads. A full run on the service's path is what counts at the end.
//   node --import tsx test/collection/fastReal.ts <run> [--refresh]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prepareDocument } from "../../src/prepare";
import { parseCv } from "../../src/rules";
import { defaultSettings } from "../../src/settings";

const P = "data/real-cvs", run = process.argv[2], cacheFile = join(P, "keys/text-cache.json"), inv = JSON.parse(readFileSync(join(P, "inventory.json"), "utf8"));
let cache: Record<string, { text: string; record: any }> = existsSync(cacheFile) && !process.argv.includes("--refresh") ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};
for (const d of inv.docs) if (!cache[d.id]) { const o: any = await prepareDocument(new Uint8Array(readFileSync(join(inv.source, d.file))), { kind: "cv", org: defaultSettings(), asOf: new Date("2026-11-05T00:00:00Z") } as any); cache[d.id] = { text: o.text ?? "", record: o.record ?? {} }; }
writeFileSync(cacheFile, JSON.stringify(cache));
const rows = inv.docs.map((d: any) => { const c: any = parseCv(cache[d.id].text), r = cache[d.id].record; return { id: d.id, ok: true, record: { ...r, workHistory: c.workHistory, education: c.education?.map((e: any) => ({ degree: e.qualification, institution: e.institution, year: e.period })), skills: c.skills?.map((s: any) => s.name), certifications: c.certifications?.map((x: any) => x.name ?? x.qualification ?? x), languages: c.languages } }; });
writeFileSync(join(P, `candidate/${run}.json`), JSON.stringify({ commit: "working-tree", rows }));
process.exit(0);
