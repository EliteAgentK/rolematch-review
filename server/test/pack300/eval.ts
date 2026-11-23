// npm run eval:pack300 -- [CV0565 ...] [--format word|pdf|scan|all] : reads CVs from the owner's fictional "RoleMatch 300 long form CVs" pack
// (outside the repository; PACK300_DIR, default ~/Downloads/RoleMatch_300_Long_Form_CVs 2) the way an upload is read, and compares every field
// with the pack's answer key (Reference/Expected_CVs: only what each CV actually prints). The documents never enter the repository.
// Without ids it reads all 300. Writes server/data/pack300/report.md (git-ignored).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractCandidate } from "../../src/extract";
import { sniff } from "../../src/formats";
import { readDocument } from "../../src/parse";
import { stopOcr } from "../../src/ocr";
import { readQualifications } from "../../src/graph/qualificationReader";

const PACK = process.env.PACK300_DIR ?? join(homedir(), "Downloads", "RoleMatch_300_Long_Form_CVs 2");
const AS_OF = new Date("2026-10-27");
const FORMATS = { word: ["01_Word", "docx"], pdf: ["02_Searchable_PDF", "pdf"], scan: ["03_Scanned_PDF", "pdf"] } as const;
const norm = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const close = (a: unknown, b: unknown) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const ym = (s: unknown) => { const t = String(s ?? ""); if (/present|current|now|to date/i.test(t)) return "Present"; const iso = t.match(/(\d{4})-(\d{2})/); if (iso) return `${iso[1]}-${iso[2]}`; const num = t.match(/(\d{1,2})[/.](\d{4})/); if (num) return `${num[2]}-${num[1].padStart(2, "0")}`; const mon = t.match(/([A-Za-z]{3})[a-z]*\.?\s*'?(\d{2,4})/); if (mon) { const i = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(mon[1].toLowerCase()); const y = mon[2].length === 2 ? `20${mon[2]}` : mon[2]; if (i >= 0) return `${y}-${String(i + 1).padStart(2, "0")}`; } const y = t.match(/(\d{4})/); return y ? y[1] : ""; };
// the key stores a current job's end as null; the CV prints "Present", "Current" or similar
const sameDate = (got: unknown, want: string | null) => { const g = ym(got); if (want === null || /present/i.test(String(want))) return g === "Present"; return g === want || (g.length === 4 && want.startsWith(g)); };
const STATUS: Record<string, string[]> = { completed: ["stated", "implied", "dates_fit", "year_only", "not_stated"], "in progress": ["in_progress"], "not completed": ["not_completed"] };

export interface Check { field: string; ok: boolean; want: string; got: string }

export async function checkOne(id: string, format: keyof typeof FORMATS): Promise<{ checks: Check[]; ms: number; design: any }> {
  const [dir, ext] = FORMATS[format];
  const key = JSON.parse(readFileSync(join(PACK, "Reference", "Expected_CVs", `${id}.json`), "utf8"));
  const bytes = new Uint8Array(readFileSync(join(PACK, dir, `${id}.${ext}`)));
  const t0 = performance.now();
  const { text } = await readDocument(bytes, sniff(bytes)!);
  const r: any = (await extractCandidate(text, { asOf: AS_OF })).record, ms = performance.now() - t0;
  const checks: Check[] = [];
  const add = (field: string, ok: boolean, want: unknown, got: unknown) => checks.push({ field, ok, want: String(want ?? ""), got: String(got ?? "") });
  add("name", close(r.name, key.name), key.name, r.name);
  add("email", String(r.email ?? "").toLowerCase() === String(key.email).toLowerCase(), key.email, r.email);
  add("phone", digits(r.phone) === digits(key.phone), key.phone, r.phone);
  add("location", close(r.location, key.location), key.location, r.location);
  add("title (headline)", close(r.role, key.title), key.title, r.role);
  add("summary present", !key.summary || !!String(r.summary ?? "").trim(), key.summary ? "yes" : "none printed", r.summary ? "yes" : "no");
  const got = r.workHistory ?? [];
  for (const w of key.work_history ?? []) {
    // exact matches first: "Internal Auditor" must not be matched to "Senior Internal Auditor" when both roles exist
    const eq = (x: unknown, y: unknown) => norm(x) === norm(y);
    const m = got.find((x: any) => eq(x.position, w.title) && close(x.company, w.employer)) ?? got.find((x: any) => close(x.position, w.title) && close(x.company, w.employer)) ?? got.find((x: any) => close(x.company, w.employer)) ?? got.find((x: any) => eq(x.position, w.title)) ?? got.find((x: any) => close(x.position, w.title));
    add(`role: ${w.title} @ ${w.employer}`, !!m, "found", m ? "found" : "missing");
    if (!m) continue;
    add(`  title`, close(m.position, w.title), w.title, m.position);
    add(`  employer`, close(m.company, w.employer), w.employer, m.company);
    add(`  dates`, sameDate(m.startDate, w.start) && sameDate(m.endDate, w.end), `${w.start} to ${w.end ?? "present"}`, `${m.startDate} to ${m.endDate}`);
  }
  const quals = readQualifications(r.education ?? [], { text, asOf: AS_OF });
  for (const q of key.education ?? []) {
    const m = quals.find((x) => close(x.degree, q.qualification));
    add(`qualification: ${q.qualification}`, !!m, "found", m ? "found" : "missing");
    if (m) add(`  completion`, (STATUS[String(q.status).toLowerCase()] ?? []).includes(m.completion.rung), q.status, `${m.completion.rung} (${m.completion.tell})`);
  }
  const allEdu = (r.education ?? []).map((e: any) => e.degree);
  for (const c of key.certifications ?? []) add(`certification: ${c.name}`, allEdu.some((e: string) => close(e, c.name)) || (r.certifications ?? []).some((x: any) => close(x?.name ?? x, c.name)), "found", allEdu.some((e: string) => close(e, c.name)) ? "found" : "missing");
  for (const s of key.skills ?? []) add(`skill: ${s}`, (r.skills ?? []).some((x: string) => close(x, s)), "found", (r.skills ?? []).some((x: string) => close(x, s)) ? "found" : "missing");
  for (const l of key.languages ?? []) add(`language: ${l}`, (r.languages ?? []).some((x: any) => close(x?.name ?? x, l)), "found", (r.languages ?? []).some((x: any) => close(x?.name ?? x, l)) ? "found" : "missing");
  return { checks, ms, design: key.design };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!existsSync(PACK)) { console.error(`The CV pack is not at ${PACK} (set PACK300_DIR).`); process.exit(1); }
  const args = process.argv.slice(2), fi = args.indexOf("--format"), fmt = fi >= 0 ? args[fi + 1] : "pdf";
  const ids = args.filter((a, i) => /^CV\d{4}$/.test(a) && args[i - 1] !== "--format");
  const all = ids.length ? ids : Array.from({ length: 300 }, (_, i) => `CV${String(561 + i).padStart(4, "0")}`);
  const formats = (fmt === "all" ? ["word", "pdf", "scan"] : [fmt]) as (keyof typeof FORMATS)[];
  const lines: string[] = [], totals: Record<string, [number, number]> = {};
  for (const f of formats) for (const id of all) {
    const { checks, ms, design } = await checkOne(id, f);
    const ok = checks.filter((c) => c.ok).length;
    lines.push(`## ${id} (${f}; ${design?.header_family !== undefined ? `header ${design.header_family}, ${design.body_family}, ${design.date_format !== undefined ? `date format ${design.date_format}` : ""}` : ""}): ${ok}/${checks.length} in ${(ms / 1000).toFixed(1)} s`, "");
    for (const c of checks) {
      const group = c.field.startsWith("  ") ? c.field.trim() : c.field.split(":")[0];
      (totals[`${f} ${group}`] ??= [0, 0])[1]++; if (c.ok) totals[`${f} ${group}`][0]++;
      if (!c.ok || ids.length) lines.push(`- ${c.ok ? "ok  " : "MISS"} ${c.field}${c.ok ? "" : `: expected "${c.want}", read "${c.got}"`}`);
    }
    lines.push("");
    if (!ids.length) process.stdout.write(".");
  }
  await stopOcr();
  const summary = Object.entries(totals).sort().map(([k, [a, b]]) => `| ${k} | ${a}/${b} | ${Math.round((100 * a) / b)}% |`);
  const out = [`# RoleMatch 300 pack against its answer keys`, "", `Run ${new Date().toISOString()}; ${all.length} CV(s); formats: ${formats.join(", ")}. Fictional pack, read in place.`, "", "| field | right | share |", "|---|---|---|", ...summary, "", ...lines];
  const dir = fileURLToPath(new URL("../../data/pack300/", import.meta.url)); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "report.md"), out.join("\n") + "\n");
  console.log((ids.length ? out : out.slice(0, 6 + summary.length)).join("\n"));
  process.exit(0);
}
