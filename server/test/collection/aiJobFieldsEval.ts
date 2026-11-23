// The whole job panel, field by field, as live reads it: today's reader (src/jobReader.ts, job-ai-3, through src/aiJobFields.ts's record) on the 309-job
// set, scored on the fields the job panel shows (owner, 10 Nov 2026: "do a whole job description test, not just the titles"). Answer keys: the 150-job
// reference set (Testing/Jobs, Downloads/Reference/Expected_Jobs) in Word and as searchable PDF, and the five corporate jobs (RoleMatch Corporate Expected
// Records 2026-11-09.json). The four hand-check jobs have no key; Absa and Hollard are must-pass cases.
// Local database only (it refuses a hosted address), so nothing reaches live's meter. All documents are fictional test jobs; the output is ids, fields and counts.
//   DATABASE_URL=<the local database, 127.0.0.1> ANTHROPIC_API_KEY=… node --import tsx test/collection/aiJobFieldsEval.ts <out.json> [limit]
//
// PASS CRITERIA, written before the 10 Nov 2026 re-run (baseline: the same 309 jobs read by the first Claude prompt, commit 0562725):
//   1. every one of the 309 read;
//   2. each panel field no more than 2 points below the baseline (title, company, location, reports to, summary, employment 100%; arrangement 99.0%; pay 100%);
//   3. each list's items found no more than 2 points below (requirements 99.9%, preferred 99.8%, skills 92.2%, responsibilities 99.2%);
//   4. Absa (Head of Technology - Job Description.docx): read, title "Head of Technology", 28 responsibilities under 7 headings, no line unlabelled;
//      Hollard CIO: read, a title naming the chief information officer, no line unlabelled;
//   5. median time per job at most 15 s; whole run at most US$3.
//   job-ai-3 (same day): as above, and no value of a fact repeats its sentence (no "reports to" inside a reports-to value).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { READ_MODEL } from "../../src/ai/claude";
import { jobRecordOf } from "../../src/aiJobFields";
import { readJobDocument } from "../../src/jobReader";
import { evalAsk } from "./liveJob";
import { platformSql as sql } from "../../src/db";
import { prepareDocument } from "../../src/prepare";
import { defaultSettings } from "../../src/settings";

if (!/@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? "")) throw new Error("Run against a local database only (DATABASE_URL on 127.0.0.1): this must never meter on live.");
const [out, limitArg] = process.argv.slice(2), LIMIT = Number(limitArg ?? 1e9), AT_ONCE = Number(process.env.AT_ONCE ?? 6);
const HOME = process.env.HOME!, T = `${HOME}/Documents/Testing`, KEYS = `${HOME}/Downloads/Reference/Expected_Jobs`;

// ---- the panel's fields, as the job record names them (server/src/types.ts Job; src/components/JobDetails.tsx)
const SINGLE = ["title", "company", "department", "location", "workArrangement", "type", "remuneration", "reportsTo", "description"] as const;
const LISTS = ["requirements", "preferredRequirements", "skills", "responsibilities"] as const;
type Panel = Partial<Record<(typeof SINGLE)[number], string> & Record<(typeof LISTS)[number], string[]>>;

// ---- answer keys
const line = (xs: string[] | undefined, re: RegExp) => (xs ?? []).map((l) => l.match(re)?.[1]?.trim()).find(Boolean);
const section = (s: Record<string, string[]>, re: RegExp) => Object.entries(s).find(([k]) => re.test(k))?.[1];
// The role named after "reports to", up to the end of the clause ("... and has responsibility for ..." is not part of it: the key over-reached before 10 Nov 2026).
const reportsIn = (t: string) => t.match(/\breports? (?:directly )?to (?:the )?(.+?)(?=\s+(?:and|who|which|while|with)\b|[.,;]|$)/i)?.[1]?.trim();
function referenceKey(k: any): Panel {
  const s = k.source_sections ?? {}, work = section(s, /working arrangement|work arrangement|conditions/i), purpose = (section(s, /purpose|overview|about the role|summary/i) ?? []).join(" ");
  return { title: k.title, company: k.employer, location: k.location, workArrangement: line(work, /^working model:\s*(.+)/i), type: line(work, /^employment:\s*(.+)/i),
    remuneration: line(section(s, /remuneration|salary|pay/i), /^[^:]*:\s*(.+)/), reportsTo: reportsIn(purpose), description: purpose,
    requirements: section(s, /essential|required|minimum/i), preferredRequirements: section(s, /desirable|preferred|advantageous/i),
    responsibilities: section(s, /responsibilit|duties/i), skills: [...(k.required_skills ?? []), ...(k.preferred_skills ?? [])] };
}
const corporateKey = (k: any): Panel => ({ title: k.title, company: k.company, location: k.city, remuneration: k.salary, description: k.purpose, reportsTo: reportsIn(k.purpose ?? ""),
  requirements: k.essential, preferredRequirements: k.preferred, responsibilities: (k.responsibilities ?? []).map((r: any) => (Array.isArray(r) ? r[1] : String(r))) });

type Doc = { set: string; id: string; file: string; key?: Panel };
const docs: Doc[] = [];
for (let n = 1; n <= 150; n++) {
  const id = `JD${String(n).padStart(4, "0")}`, k = join(KEYS, `${id}.json`); if (!existsSync(k)) continue;
  const key = referenceKey(JSON.parse(readFileSync(k, "utf8")));
  docs.push({ set: "reference-word", id, file: `${T}/Jobs/01_Word/${id}.docx`, key }, { set: "reference-pdf", id, file: `${T}/Jobs/02_Searchable_PDF/${id}.pdf`, key });
}
const corporate = JSON.parse(readFileSync(`${T}/RoleMatch Corporate Expected Records 2026-11-09.json`, "utf8")).jobs as any[];
for (const f of ["JD01_Chief_Financial_Officer", "JD02_Graduate_Business_Data_Analyst", "JD03_Regional_Distribution_Operations_Manager", "JD04_Head_of_Enterprise_Programme_Delivery", "JD05_Senior_Underground_Rock_Engineering_Specialist"])
  docs.push({ set: "corporate", id: f.slice(0, 4), file: `${T}/RoleMatch Corporate Jobs 2026-11-09/${f}.docx`, key: corporateKey(corporate.find((j) => j.id === f.slice(0, 4))) });
for (const f of [`${HOME}/Downloads/Head of Technology - Job Description.docx`, `${T}/Hollard CIO - test job description.docx`, `${T}/Head of Technology Centre of Excellence - test job.docx`, `${T}/Software Engineer - test job description.docx`])
  docs.push({ set: "hand-check", id: basename(f).replace(/\.docx$/, ""), file: f });

// ---- scoring: a single field is right when it says what the key says (one contains the other, or most words shared); a list counts the key's items found
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const words = (s: string) => new Set(norm(s).split(" ").filter((w) => w.length > 1));
const share = (a: string, b: string) => { const A = words(a), B = words(b); if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n++; return n / A.size; };
function single(expected: string | undefined, got: string | undefined): "right" | "wrong" | "missing" | "extra" | "no key" {
  if (expected === undefined) return "no key";
  const e = norm(expected), g = norm(got ?? "");
  if (!e) return g ? "extra" : "right";
  if (!g) return "missing";
  return e.includes(g) || g.includes(e) || share(expected, got!) >= 0.6 ? "right" : "wrong";
}
function list(expected: string[] | undefined, got: string[] | undefined) {
  if (!expected) return null;
  const g = got ?? [], found = expected.filter((e) => g.some((x) => share(e, x) >= 0.6 || norm(x).includes(norm(e)))).length;
  const relevant = g.filter((x) => expected.some((e) => share(x, e) >= 0.6 || norm(x).includes(norm(e)) || norm(e).includes(norm(x)))).length;
  return { expected: expected.length, found, got: g.length, notInKey: g.length - relevant };
}
const descriptionRight = (expected: string | undefined, got: string | undefined) => expected === undefined ? "no key" : !norm(got ?? "") ? "missing" : share(expected, got!) >= 0.5 || share(got!, expected) >= 0.6 ? "right" : "wrong";
function score(key: Panel, p: Panel) {
  const s: any = {};
  for (const f of SINGLE) s[f] = f === "description" ? descriptionRight(key.description, p.description) : single(key[f], p[f]);
  for (const f of LISTS) s[f] = list(key[f], p[f]);
  return s;
}

// ---- run
const usdSince = async (since: Date) => Number((await sql`select coalesce(sum(cost_micro_usd), 0)::bigint as m from ai_usage where purpose = 'evaluation' and at >= ${since}`)[0].m) / 1e6;
// ONLY=JD0066,JD01 runs those ids alone; PANELS=1 keeps both panels beside the key on every row, for a person to look at.
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null, PANELS = process.env.PANELS === "1";
const started = new Date(Date.now() - 60_000), rows: any[] = [], chosen = docs.filter((d) => !ONLY || ONLY.has(d.id)).slice(0, LIMIT);
for (let i = 0; i < chosen.length; i += AT_ONCE) {
  await Promise.all(chosen.slice(i, i + AT_ONCE).map(async (d) => {
    // The document reader takes the text exactly as the pipeline does; the AI reads it exactly as live does (liveJob.ts: the reader's own call).
    const r: any = await prepareDocument(new Uint8Array(readFileSync(d.file)), { kind: "jd", org: defaultSettings() as any, asOf: new Date() });
    const t0 = performance.now(), read = r.ok ? await readJobDocument(String(r.text ?? ""), evalAsk) : null, sec = (performance.now() - t0) / 1000;
    const ok = !!read?.ok, rec: any = read?.ok ? jobRecordOf(read.reading) : {}, a = read?.ok ? read.reading.aiReading : null;
    const panel: Panel = { ...rec };
    rows.push({ set: d.set, id: d.id, ok, why: !r.ok ? r.code : read && !read.ok ? read.why : null, sec: +sec.toFixed(1),
      lines: a?.lines ?? 0, unlabelled: a?.unlabelled ?? 0, askedAgain: a?.askedAgain ?? false, dropped: a?.dropped ?? 0, summarySource: rec.summarySource ?? "",
      counts: { req: rec.requirements?.length ?? 0, pref: rec.preferredRequirements?.length ?? 0, resp: rec.responsibilities?.length ?? 0, respGroups: rec.responsibilityGroups?.length ?? 0, skills: rec.skills?.length ?? 0, comp: rec.competencies?.length ?? 0, extras: (rec.extras ?? []).reduce((n: number, e: any) => n + e.items.length, 0) },
      title: rec.title ?? "", score: d.key ? score(d.key, panel) : null, ...(d.key && !PANELS ? {} : { key: d.key ?? null, panel }) });
    process.stdout.write(`${d.set} ${d.id} ${ok ? "read" : "NOT READ " + (rows.at(-1).why ?? "")} ${sec.toFixed(1)}s\n`);
  }));
}
const exact = await sql`select model, count(*)::int as calls, round(sum(cost_micro_usd) / 1e6::numeric, 4)::float as usd from ai_usage where purpose = 'evaluation' and at >= ${started} group by model`;
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), model: READ_MODEL, cost: exact, totalUsd: await usdSince(started), rows }, null, 1));
console.log(JSON.stringify({ documents: rows.length, cost: exact }));
await sql.end({ timeout: 5 });
