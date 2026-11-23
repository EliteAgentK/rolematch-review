// What compressing every document would cost: size, time, and whether the same fields are still read, on invented documents. Measures only; changes nothing.
// Usage: CANDIDATE_PIPELINE=all node --import tsx test/candidate/compressCompare.ts <pack> <files per format>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stopOcr } from "../../src/ocr";
import { isScanned, optimiseDocx, optimiseScannedPdf, optimiseTextPdf } from "../../src/optimise";
import { prepareDocument } from "../../src/prepare";
import { defaultSettings } from "../../src/settings";

const [pack, n] = [process.argv[2], Number(process.argv[3] ?? 8)];
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}+#.@]+/gu, " ").trim();
const read = async (b: Uint8Array, e: any) => { const r: any = await prepareDocument(b, { kind: "cv", org: defaultSettings(), asOf: new Date("2026-06-01") } as any); const rec = r.record ?? {}, sk = new Set((rec.skills ?? []).map(norm)); return { ok: !!r.ok, name: norm(rec.name) === norm(e.name), email: norm(rec.email) === norm(e.email), phone: norm(rec.phone).replace(/\D/g, "") === norm(e.phone).replace(/\D/g, ""), skills: (e.skills ?? []).map(norm).filter((s: string) => sk.has(s)).length, roles: (rec.workHistory ?? []).length }; };
for (const [dir, ext] of [["01_Word", ".docx"], ["02_Searchable_PDF", ".pdf"], ["03_Scanned_PDF", ".pdf"], ["04_Phone_Photo_PDF", ".pdf"]] as const) {
  const files = readdirSync(join(pack, dir)).filter((f) => f.endsWith(ext)).sort().slice(0, n);
  const t = { before: 0, after: 0, unchanged: 0, compressMs: 0, readA: 0, readB: 0, nameA: 0, nameB: 0, emailA: 0, emailB: 0, phoneA: 0, phoneB: 0, skillsA: 0, skillsB: 0, wanted: 0, agree: 1 };
  for (const f of files) {
    const id = f.replace(ext, ""), e = JSON.parse(readFileSync(join(pack, "Reference", "Expected_CVs", `${id}.json`), "utf8")), bytes = new Uint8Array(readFileSync(join(pack, dir, f)));
    const t0 = performance.now(); const out = ext === ".docx" ? await optimiseDocx(bytes) : (await isScanned(bytes)) ? await optimiseScannedPdf(bytes) : await optimiseTextPdf(bytes); t.compressMs += performance.now() - t0;
    const small = out ? out.bytes : bytes; t.before += bytes.length; t.after += small.length; if (!out) t.unchanged++; else t.agree = Math.min(t.agree, out.agreement);
    const a0 = performance.now(), A = await read(bytes, e); t.readA += performance.now() - a0;
    const b0 = performance.now(), B = await read(small, e); t.readB += performance.now() - b0;
    t.nameA += +A.name; t.nameB += +B.name; t.emailA += +A.email; t.emailB += +B.email; t.phoneA += +A.phone; t.phoneB += +B.phone; t.skillsA += A.skills; t.skillsB += B.skills; t.wanted += (e.skills ?? []).length;
  }
  const c = files.length;
  console.log(`${dir}: ${c} files, ${Math.round(t.before / c / 1024)} KB > ${Math.round(t.after / c / 1024)} KB avg (${Math.round((1 - t.after / t.before) * 100)}% smaller), ${t.unchanged} unchanged; compress ${(t.compressMs / c / 1000).toFixed(1)} s each; read ${(t.readA / c / 1000).toFixed(1)} > ${(t.readB / c / 1000).toFixed(1)} s; name ${t.nameA} > ${t.nameB}, email ${t.emailA} > ${t.emailB}, phone ${t.phoneA} > ${t.phoneB}, skills ${t.skillsA} > ${t.skillsB} of ${t.wanted}; lowest word agreement ${t.agree.toFixed(2)}`);
}
await stopOcr();
