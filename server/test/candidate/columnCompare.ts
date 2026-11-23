// A reader change, measured on the same invented searchable PDFs before and after: each file's fields against its reference, and whether its reading changed. Reports what got better and what got worse.
// Usage: CANDIDATE_PIPELINE=all node --import tsx test/candidate/columnCompare.ts run <out.json> <pack>... | diff <before.json> <after.json>
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stopOcr } from "../../src/ocr";
import { prepareDocument } from "../../src/prepare";
import { defaultSettings } from "../../src/settings";

const [mode, ...rest] = process.argv.slice(2);
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}+#.]+/gu, " ").trim();
if (mode === "run") {
  const [out, ...packs] = rest, rows: any[] = [], LIMIT = 60;
  for (const pack of packs) for (const f of readdirSync(join(pack, "02_Searchable_PDF")).filter((n) => n.endsWith(".pdf")).sort().slice(0, LIMIT)) {
    const id = f.replace(/\.pdf$/, ""), ref = join(pack, "Reference", "Expected_CVs", `${id}.json`);
    if (!existsSync(ref)) continue;
    const e = JSON.parse(readFileSync(ref, "utf8")), r: any = await prepareDocument(new Uint8Array(readFileSync(join(pack, "02_Searchable_PDF", f))), { kind: "cv", org: defaultSettings(), asOf: new Date("2026-06-01") } as any);
    const rec = r.record ?? {}, skills = new Set((rec.skills ?? []).map(norm)), want = (e.skills ?? []).map(norm);
    rows.push({ id, ok: !!r.ok, text: r.text ?? "", name: norm(rec.name) === norm(e.full_name ?? e.name), email: norm(rec.email) === norm(e.email), phone: norm(rec.phone).replace(/\D/g, "") === norm(e.phone).replace(/\D/g, ""), location: norm(rec.location) === norm(e.location),
      skillsFound: want.filter((s: string) => skills.has(s)).length, skillsWanted: want.length, extraSkills: [...skills].filter((s) => !want.includes(s as string)).length, roles: (rec.workHistory ?? []).length, rolesWanted: (e.work_history ?? []).length, review: r.review?.state });
  }
  writeFileSync(out, JSON.stringify(rows)); await stopOcr();
  console.log(`read ${rows.length} files into ${out}`);
} else {
  const [a, b] = [rest[0], rest[1]].map((p) => JSON.parse(readFileSync(p, "utf8")) as any[]), byId = new Map(b.map((r) => [r.id, r]));
  const sum = (rows: any[], f: (r: any) => number) => rows.reduce((n, r) => n + f(r), 0);
  const show = (label: string, f: (r: any) => number) => console.log(label.padEnd(28), sum(a, f), ">", sum(b, f));
  console.log(`same ${a.length} files; reading changed on ${a.filter((r) => byId.get(r.id)?.text !== r.text).length}`);
  for (const k of ["ok", "name", "email", "phone", "location"]) show(k, (r) => (r[k] ? 1 : 0));
  show("skills found", (r) => r.skillsFound); show("skills wanted", (r) => r.skillsWanted); show("skills not in reference", (r) => r.extraSkills); show("roles found", (r) => Math.min(r.roles, r.rolesWanted)); show("roles wanted", (r) => r.rolesWanted); show("sent for review", (r) => (r.review === "needs_review" ? 1 : 0));
  const worse = a.filter((r) => { const n = byId.get(r.id)!; return ["ok", "name", "email", "phone", "location"].some((k) => r[k] && !n[k]) || n.skillsFound < r.skillsFound || Math.min(n.roles, n.rolesWanted) < Math.min(r.roles, r.rolesWanted) || n.extraSkills > r.extraSkills; });
  console.log("files worse on any measure:", worse.length, worse.map((r) => r.id).slice(0, 20).join(" "));
  const better = a.filter((r) => { const n = byId.get(r.id)!; return n.skillsFound > r.skillsFound || Math.min(n.roles, n.rolesWanted) > Math.min(r.roles, r.rolesWanted) || ["name", "email", "phone", "location"].some((k) => !r[k] && n[k]); });
  console.log("files better on any measure:", better.length, better.map((r) => r.id).slice(0, 20).join(" "));
}
