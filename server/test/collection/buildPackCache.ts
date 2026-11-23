// A small scored test set from a fictional pack in Downloads (owner, 8 Nov 2026: "test some other CVs in my downloads, but be wary of credits"):
// the first N CVs of the Visual Variety pack as searchable PDFs and as phone photos, read exactly as a live upload is (prepareDocument: OCR, contact
// re-reads, identity; free), with the pack's
// answer keys in scoreReal.py's format. Writes data/packs/<name>/text-cache.json and keys.jsonl (gitignored). Fictional people: regression and robustness only.
//   node --import tsx test/collection/buildPackCache.ts <N>
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { prepareDocument } from "../../src/prepare";
import { defaultSettings } from "../../src/settings";

const N = Number(process.argv[2] ?? 20), PACK = join(homedir(), "Downloads", "RoleMatch_60_Visual_Variety_CVs 3"), OUT = join("data", "packs", "vv");
mkdirSync(OUT, { recursive: true });
const ids = readdirSync(join(PACK, "02_Searchable_PDF")).filter((f) => f.endsWith(".pdf")).map((f) => f.replace(/\.pdf$/, "")).sort().slice(0, N);
const cache: Record<string, any> = {}, keys: string[] = [];
for (const id of ids) {
  const k = JSON.parse(readFileSync(join(PACK, "Reference", "Expected_CVs", `${id}.json`), "utf8"));
  for (const [form, dir] of [["pdf", "02_Searchable_PDF"], ["photo", "04_Phone_Photo_PDF"]]) {
    const t0 = performance.now(), o: any = await prepareDocument(new Uint8Array(readFileSync(join(PACK, dir, `${id}.pdf`))), { kind: "cv", org: defaultSettings(), asOf: new Date("2026-11-08T00:00:00Z") } as any);
    const key = `VV-${id}-${form}`, text = o.text ?? "";
    cache[key] = { text, record: o.record ?? {} };
    keys.push(JSON.stringify({ id: key, name: k.name, email: k.email, phone: k.phone, location: k.location, roles: (k.work_history ?? []).map((r: any) => [r.title, r.employer, String(r.start ?? "").slice(0, 4), /present|current/i.test(String(r.end ?? "")) ? "present" : String(r.end ?? "").slice(0, 4)]), education: (k.education ?? []).map((e: any) => [e.qualification, e.institution ?? "", String(e.year ?? "")]), skills: (k.skills ?? []).map((s: any) => (typeof s === "string" ? s : s.name)), certs: (k.certifications ?? []).map((c: any) => (typeof c === "string" ? c : c.name)), languages: (k.languages ?? []).map((l: any) => (typeof l === "string" ? l : l.name)), family: form, split: form }));
    console.log(key, `${((performance.now() - t0) / 1000).toFixed(1)} s`, text.length, "chars");
  }
}
writeFileSync(join(OUT, "text-cache.json"), JSON.stringify(cache));
writeFileSync(join(OUT, "keys.jsonl"), keys.join("\n") + "\n");
console.log(`${Object.keys(cache).length} documents`);
process.exit(0);
