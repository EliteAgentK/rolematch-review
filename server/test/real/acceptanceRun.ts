// The frozen acceptance run. prepare: lists a folder of fresh authorised documents under opaque ids and writes a blank answer sheet for a person. run: reads each once on a clean, tagged commit. Nothing identifying is printed or leaves server/data/real-cvs/.
// Usage: node --import tsx test/real/acceptanceRun.ts prepare <folder> | run [--behaviour-only]
// A run is refused on uncommitted code, on an untagged commit, a second time, or, unless --behaviour-only says it cannot state accuracy, without a person's answers for every document. If its failures inform any change, the set moves to development and is never called held out again.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { stopOcr } from "../../src/ocr";
import { prepareDocument } from "../../src/prepare";
import { defaultSettings } from "../../src/settings";
import { CRITERIA, scoreDocument, verdict, type Answers, type Tally } from "./acceptanceLib";

const [mode, arg] = process.argv.slice(2), HOME = join(import.meta.dirname, "..", "..", "data", "real-cvs", CRITERIA.version), MANIFEST = join(HOME, "manifest.json"), SHEET = join(HOME, "answers.json"), LOCK = join(HOME, "run.lock"), RESULT = join(HOME, "result.json");
const git = (...a: string[]) => execFileSync("git", a, { cwd: import.meta.dirname, encoding: "utf8" }).trim();
const secret = (path: string, body: string) => { writeFileSync(path, body, { mode: 0o600 }); chmodSync(path, 0o600); };
if (mode === "prepare") {
  if (!arg) throw new Error("prepare needs the folder holding the fresh documents"); if (existsSync(MANIFEST)) throw new Error("this acceptance set is already prepared");
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  const files = readdirSync(arg).filter((f) => /\.(pdf|docx|jpe?g|png|tiff?)$/i.test(f)).sort(), docs = files.map((f) => { const sha = createHash("sha256").update(readFileSync(join(arg, f))).digest("hex"); return { id: `AC-${sha.slice(0, 8)}`, path: join(arg, f), sha, format: extname(f).slice(1).toLowerCase() }; });
  secret(MANIFEST, JSON.stringify({ preparedAt: new Date().toISOString(), docs }, null, 1));
  secret(SHEET, JSON.stringify(Object.fromEntries(docs.map((d) => [d.id, { checkedBy: "", checkedOn: "", name: "", email: "", phone: "", location: "", title: "", roles: [], skills: [], qualifications: [], certifications: [], agency: null }])), null, 1));
  console.log(`${docs.length} documents listed. A person fills ${SHEET} from each original, without looking at what RoleMatch read. Then: run.`);
} else if (mode === "run") {
  const behaviourOnly = process.argv.includes("--behaviour-only"), manifest = JSON.parse(readFileSync(MANIFEST, "utf8")), answers = JSON.parse(readFileSync(SHEET, "utf8")) as Record<string, Answers>;
  if (existsSync(LOCK)) throw new Error(`already run: ${readFileSync(LOCK, "utf8")}. Move this set to development and obtain a fresh one.`);
  if (git("status", "--porcelain", "--", "src", "../src", "test/real").length) throw new Error("the code is not committed: a frozen run needs a frozen commit");
  const commit = git("rev-parse", "HEAD"), tags = git("tag", "--points-at", commit); if (!tags) throw new Error("tag this commit first: the tag is what the run is about");
  const unchecked = manifest.docs.filter((d: any) => !answers[d.id]?.checkedBy?.trim()).length;
  if (unchecked && !behaviourOnly) throw new Error(`${unchecked} documents have no person's answers. Without them this run cannot state accuracy; --behaviour-only runs it knowing that.`);
  secret(LOCK, `${new Date().toISOString()} ${commit} ${tags}`);
  const org = defaultSettings(); org.reading = { ...org.reading, candidatePipeline: true } as any;
  const tally: Tally = {}, rows: any[] = []; let crashes = 0;
  for (const d of manifest.docs) {
    const bytes = new Uint8Array(readFileSync(d.path)); if (createHash("sha256").update(bytes).digest("hex") !== d.sha) throw new Error(`${d.id} has changed since it was listed`);
    let out: any; const t0 = performance.now(); try { out = await prepareDocument(bytes, { kind: "cv", org }); } catch { crashes++; out = { ok: false, code: "CRASH" }; }
    const a = answers[d.id], scored = out.ok && a?.checkedBy?.trim() ? scoreDocument(out.record, a) : [], format = /pdf/.test(d.format) ? (out.ok && /OCR/i.test((out.issues ?? []).join(" ")) ? "scanned pdf" : "pdf") : d.format;
    for (const s of scored) { const f = ((tally[format] ??= {})[s.field] ??= { right: 0, wrong: 0, missing: 0 }); f[s.outcome]++; }
    rows.push({ id: d.id, format, ok: out.ok, code: out.code ?? null, review: out.review?.state ?? null, ms: Math.round(performance.now() - t0), wrong: scored.filter((s) => s.outcome === "wrong").map((s) => s.field), missing: scored.filter((s) => s.outcome === "missing").map((s) => s.field) });
  }
  await stopOcr();
  const v = verdict(tally, crashes), result = { criteria: CRITERIA, commit, tags, behaviourOnly: !!unchecked, documents: rows.length, crashes, sentForReview: rows.filter((r) => r.review === "needs_review").length, pass: unchecked ? null : v.pass, lines: v.lines, rows };
  secret(RESULT, JSON.stringify(result, null, 1));
  console.log(`${commit.slice(0, 7)} ${tags}: ${rows.length} documents, ${crashes} crashed, ${result.sentForReview} sent for review.`); for (const l of v.lines) console.log(l);
  console.log(unchecked ? "No person's answers: this says how it behaved, and nothing about accuracy." : v.pass ? "PASSED on these documents. It does not promise other documents will behave the same." : "FAILED. Record it as failed. If its failures inform a change, this set is development material from then on.");
} else throw new Error("usage: acceptanceRun.ts prepare <folder> | run [--behaviour-only]");
