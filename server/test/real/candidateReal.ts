// The candidate pipeline on the real CVs, from the application's own document path, on this machine only. What leaves this script is counts, opaque ids and which checks passed; values stay in
// server/data/real-cvs/. Agency values have no human answers, so each is checked by machine against the document, and is recorded as exactly that: never as human verification.
// Usage: node --import tsx test/real/candidateReal.ts <run id> [--acceptance]
// --acceptance runs the untouched set, once. A lock records the commit; a second run is refused, because a set read twice is no longer untouched.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sniff } from "../../src/formats";
import { levenshtein, ocrPdfWords, stopOcr } from "../../src/ocr";
import { prepareDocument } from "../../src/prepare";
import { defaultSettings } from "../../src/settings";

const [runId, flag] = process.argv.slice(2), acceptance = flag === "--acceptance", PRIVATE = join(import.meta.dirname, "..", "..", "data", "real-cvs"), OUT = join(PRIVATE, "candidate"), LOCK = join(PRIVATE, "acceptance-run.lock");
process.env.CANDIDATE_PIPELINE = "all";
if (process.env.ANTHROPIC_API_KEY) throw new Error("an outside AI key is set: real CVs are not processed");
const git = (...a: string[]) => execFileSync("git", a, { cwd: import.meta.dirname, encoding: "utf8" }).trim(), commit = git("rev-parse", "HEAD"), dirty = git("status", "--porcelain", "--", "src").length > 0;
if (acceptance) {
  if (existsSync(LOCK)) throw new Error(`the acceptance set was already run: ${readFileSync(LOCK, "utf8")}. Move it to development and obtain a fresh set.`);
  if (dirty) throw new Error("the candidate must be frozen: commit it first");
  writeFileSync(LOCK, JSON.stringify({ commit, runId, at: new Date().toISOString() }), { mode: 0o600 });
}
mkdirSync(OUT, { recursive: true, mode: 0o700 });
const inv = JSON.parse(readFileSync(join(PRIVATE, "inventory.json"), "utf8")), docs = inv.docs.filter((d: any) => d.role === (acceptance ? "acceptance" : "development") || (acceptance && d.role === "untouched"));
const labels: Record<string, any> = acceptance || !existsSync(join(PRIVATE, "labels.json")) ? {} : JSON.parse(readFileSync(join(PRIVATE, "labels.json"), "utf8"));
const low = (s: string) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim(), flat = (s: string) => low(s).replace(/[^\p{L}\p{N}]/gu, ""), digits = (s: string) => String(s ?? "").replace(/\D/g, "").replace(/^27/, "0");
const same = (f: string, a: string, b: string) => (f === "phone" ? digits(a) === digits(b) : low(a) === low(b));
const nearIn = (value: string, text: string) => { const v = flat(value), t = flat(text); if (!v) return false; if (t.includes(v)) return true; for (let i = 0; i + v.length <= t.length; i += Math.max(1, Math.floor(v.length / 4))) if (1 - levenshtein(v, t.slice(i, i + v.length)) / v.length >= 0.8) return true; return false; };

const rows: any[] = [], org = defaultSettings(), asOf = new Date("2026-11-03T00:00:00Z");
for (const d of docs) {
  const bytes = new Uint8Array(readFileSync(join(inv.source, d.file))), t0 = performance.now(), cpu0 = process.cpuUsage();
  let out: any; try { out = await prepareDocument(bytes, { kind: "cv", org, asOf }); } catch (e) { out = { ok: false, code: "CRASH", message: String((e as Error).message).slice(0, 80) }; }
  const ms = Math.round(performance.now() - t0), cpu = process.cpuUsage(cpu0), row: any = { id: d.id, format: d.format, ok: !!out.ok, code: out.code ?? null, ms, cpuMs: Math.round((cpu.user + cpu.system) / 1000), rssMb: Math.round(process.memoryUsage().rss / 1048576) };
  if (out.ok) {
    const r = out.record, id = out.meta.identity, sub = r.submission;
    Object.assign(row, { record: r, reader: out.meta.reader, order: out.meta.readingOrder, fields: out.meta.fields, review: out.review.state, reasons: out.review.reasons, counts: { roles: r.workHistory.length, skills: r.skills.length, edu: r.education.filter((e: any) => e.type !== "certificate").length, certs: r.education.filter((e: any) => e.type === "certificate").length, langs: r.languages.length } });
    // diagnostics, not answers: the file name's words, and date ranges in the text against roles found
    const wordsInName = low(r.name).split(" "); row.fileName = !d.names?.length ? "no name in file name" : !r.name ? "none published" : d.names.some((w: string) => wordsInName.some((x) => x.includes(w) || w.includes(x))) ? "agrees" : "disagrees";
    const RANGE = /\b(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*)?(?:0?\d\/)?(?:19|20)\d{2}\s*(?:-|–|—|to|until)\s*(?:(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*)?(?:0?\d\/)?(?:19|20)\d{2}|present|current|date|now)/gi;
    row.dateRanges = (out.text.match(RANGE) ?? []).length; row.rolesOk = r.workHistory.length >= row.dateRanges / 2;
    // separation: nothing that is the agency's may sit in the candidate's fields
    row.separation = !sub || ![[r.email, sub.recruiter.email], [r.email, sub.agency.email]].some(([a, b]) => a && a === b) && ![[r.phone, sub.recruiter.phone], [r.phone, sub.agency.phone]].some(([a, b]) => a && digits(a) === digits(b));
    if (sub && id?.agency) {
      // every value against the line it cites, and against a second reader that does not use the file's text layer
      const a = id.agency, lines = new Map<string, string>();
      const model = await (await import("../../src/docmodel/model")).buildDocModel(bytes, sniff(bytes)!, { text: out.text });
      for (const l of model.pages.flatMap((p) => p.lines)) lines.set(l.id, l.text);
      const values: Record<string, { value: string; source?: string }> = { agencyName: a.name.status === "selected" ? { value: a.name.value, source: a.name.source } : { value: "" }, recruiterName: a.recruiter.name.status === "selected" ? { value: a.recruiter.name.value, source: a.recruiter.name.source } : { value: "" }, recruiterEmail: { value: a.recruiter.email.value, source: a.recruiter.email.source }, recruiterPhone: { value: a.recruiter.phone.value, source: a.recruiter.phone.source }, officeEmail: { value: a.office.email.value, source: a.office.email.source }, officePhone: { value: a.office.phone.value, source: a.office.phone.source } };
      const pages = [...new Set(Object.values(values).flatMap((v) => (v.source ? [Number(v.source.match(/^p(\d+)/)?.[1])] : [])))].filter(Boolean).slice(0, 4);
      const second = model.reader === "pdf-native" && pages.length ? (await ocrPdfWords(bytes, pages).catch(() => [])).map((p) => p.words.map((w) => w.text).join(" ")).join(" ") : "";
      row.agencyCheck = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, !v.value ? { state: "blank" } : { state: "value", citedLine: !!v.source && nearIn(v.value, lines.get(v.source) ?? ""), secondReader: second ? nearIn(v.value, second) : null }]));
      const local = low(a.recruiter.email.value).split("@")[0], words = low(a.recruiter.name.value).split(" ").map(flat).filter((w) => w.length >= 3);
      row.crossCheck = { recruiterNameInEmail: a.recruiter.email.value && words.length ? words.some((w) => local.includes(w)) : null, agencyNameInDomain: a.name.value && a.domain ? low(a.name.value).split(" ").map(flat).some((w) => w.length >= 4 && flat(a.domain).includes(w)) : null, emailDomainIsAgency: a.recruiter.email.value && a.domain ? a.recruiter.email.value.endsWith("@" + a.domain) : null };
      row.verification = "machine only: cited line, second reader and cross-checks. Not checked by a person, and not read by an AI model.";
    }
  }
  rows.push(row);
  console.log(`${d.id} ${d.format} ${row.ok ? "ok" : row.code} ${ms}ms ${row.reader ?? ""} ${row.order ?? ""} review=${row.review ?? "-"} ${row.counts ? JSON.stringify(row.counts) : ""}`);
}
await stopOcr();
writeFileSync(join(OUT, `${runId}.json`), JSON.stringify({ commit, dirty, acceptance, rows }, null, 1), { mode: 0o600 }); chmodSync(join(OUT, `${runId}.json`), 0o600);
const accepted = rows.filter((r) => r.ok);
console.log(`\ncommit ${commit.slice(0, 7)}${dirty ? " (uncommitted changes)" : ""} | ${acceptance ? "UNTOUCHED SET, first and only run" : "development set"} | ${rows.length} documents, read ${accepted.length}, refused ${rows.length - accepted.length} | sent for review ${accepted.filter((r) => r.review === "needs_review").length}`);
const states: Record<string, Record<string, number>> = {}; for (const r of accepted) for (const [k, f] of Object.entries<any>(r.fields ?? {})) { (states[k] ??= {})[f.state] = (states[k][f.state] ?? 0) + 1; }
console.log("field states:"); for (const [k, v] of Object.entries(states)) console.log(`  ${k.padEnd(16)} ${JSON.stringify(v)}`);
const fnChecked = accepted.filter((r) => labels[r.id]);
if (fnChecked.length) { console.log(`against a person's answers, ${fnChecked.length} documents (right/wrong/missing/unsure):`); for (const [f, key] of [["name", "name"], ["email", "email"], ["phone", "phone"]] as const) { const a = { right: 0, wrong: 0, missing: 0, unsure: 0 }; for (const r of fnChecked) { const l = labels[r.id], e = l[f] ?? "", g = r.record[key] ?? ""; if (l[`${f}Unsure`]) a.unsure++; else if (!e) a[g ? "wrong" : "right"]++; else if (!g) a.missing++; else a[same(f, g, e) ? "right" : "wrong"]++; } console.log(`  ${f}: ${JSON.stringify(a)}`); } }
const agencyRows = accepted.filter((r) => r.agencyCheck); console.log(`agency documents read: ${agencyRows.length}, separation of candidate and agency held on ${accepted.filter((r) => r.separation).length} of ${accepted.length}`);
for (const f of ["agencyName", "recruiterName", "recruiterEmail", "recruiterPhone", "officeEmail", "officePhone"]) { const v = agencyRows.map((r) => r.agencyCheck[f]), val = v.filter((x) => x.state === "value"); console.log(`  ${f.padEnd(15)} value ${val.length}/${v.length} | in the line it cites ${val.filter((x) => x.citedLine).length}/${val.length} | second reader agrees ${val.filter((x) => x.secondReader === true).length}, disagrees ${val.filter((x) => x.secondReader === false).length}, not available ${val.filter((x) => x.secondReader === null).length}`); }
const cc = (k: string) => { const v = agencyRows.map((r) => r.crossCheck?.[k]).filter((x) => x !== null && x !== undefined && x !== ""); return `${v.filter(Boolean).length}/${v.length}`; };
console.log(`  cross-checks: recruiter's name in their e-mail ${cc("recruiterNameInEmail")}, agency's name in its domain ${cc("agencyNameInDomain")}, recruiter's e-mail on the agency's domain ${cc("emailDomainIsAgency")}`);
const fn: Record<string, number> = {}; for (const r of accepted) fn[r.fileName] = (fn[r.fileName] ?? 0) + 1; console.log(`name against the file name (a diagnostic): ${JSON.stringify(fn)} | roles at least half the date ranges: ${accepted.filter((r) => r.rolesOk).length}/${accepted.length}`);
const allCited = agencyRows.every((r) => Object.values<any>(r.agencyCheck).every((v) => v.state === "blank" || v.citedLine)), noDisagree = agencyRows.every((r) => Object.values<any>(r.agencyCheck).every((v) => v.secondReader !== false));
const crashes = rows.filter((r) => r.code === "CRASH").length, plain = rows.filter((r) => r.reader !== "pdf-ocr" && r.reader !== "image-ocr").map((r) => r.ms).sort((a, b) => a - b), medPlain = plain[Math.floor(plain.length / 2)] ?? 0;
if (acceptance) { const c: [string, boolean, string][] = [["A1 nothing crashes; read or refused with a reason", crashes === 0, `${crashes} crashes`], ["A2 name agrees with the file name, at least 7 of 9", (fn["agrees"] ?? 0) >= 7, String(fn["agrees"] ?? 0)], ["A3 no name disagrees", !fn["disagrees"], String(fn["disagrees"] ?? 0)], ["A4 candidate and agency apart", accepted.every((r) => r.separation) , `${accepted.filter((r) => r.separation).length}/${accepted.length}`], ["A5 agency values in their cited line; no second reader disagrees", allCited && noDisagree, `cited ${allCited}, no disagreement ${noDisagree}`], ["A6 roles at least half the date ranges, at least 7 of 9", accepted.filter((r) => r.rolesOk).length >= 7, String(accepted.filter((r) => r.rolesOk).length)], ["A7 sent for review, at most 5 of 9", accepted.filter((r) => r.review === "needs_review").length <= 5, String(accepted.filter((r) => r.review === "needs_review").length)], ["A8 median time without OCR under 5 seconds", medPlain < 5000, `${medPlain} ms`]]; console.log("acceptance criteria:"); for (const [n, ok, v] of c) console.log(`  ${ok ? "PASS" : "FAIL"} ${n}: ${v}`); console.log(c.every((x) => x[1]) ? "all criteria hold. This is not an accuracy figure." : "NOT ALL CRITERIA HOLD."); }
const ms = rows.map((r) => r.ms).sort((a, b) => a - b); console.log(`time ms: median ${ms[Math.floor(ms.length / 2)]}, slowest ${ms.at(-1)} | peak memory ${Math.max(...rows.map((r) => r.rssMb))} MB`);
process.exit(0);
