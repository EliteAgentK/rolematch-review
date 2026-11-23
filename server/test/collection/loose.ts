// Loose files at the top of Downloads that their names do not identify. Read here, on this machine, to tell whether each is a CV, a job or neither. Prints only an opaque ID, its type, what the reader made of it in counts, and the verdict: never a name or a line of the document. Its verdict is recorded in the private manifest.
import { createHash } from "node:crypto";
import { appendFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, relative } from "node:path";
import { stopOcr } from "../../src/ocr";
import { prepareDocument } from "../../src/prepare";
import { defaultSettings } from "../../src/settings";

const HOME = homedir(), DOWNLOADS = join(HOME, "Downloads"), DOC = new Set([".pdf", ".docx", ".doc", ".odt", ".rtf", ".txt", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp", ".heic"]), org = defaultSettings(), asOf = new Date("2026-11-05T00:00:00Z"), MANIFEST = join(import.meta.dirname, "../../data/collection/manifest.jsonl");
const known = new Set(readFileSync(MANIFEST, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.collection === "loose").map((r) => r.realPath));
for (const name of readdirSync(DOWNLOADS)) {
  const f = join(DOWNLOADS, name); if (!statSync(f).isFile() || !DOC.has(extname(name).toLowerCase()) || known.has(relative(HOME, f))) continue;
  const bytes = new Uint8Array(readFileSync(f)), hash = createHash("sha256").update(bytes).digest("hex"), id = `RL-${hash.slice(0, 6)}`;
  const o: any = await prepareDocument(bytes, { kind: "cv", org, asOf }).catch((e) => ({ ok: false, code: "CRASH", message: String(e) }));
  const text: string = o.text ?? "", r = o.record ?? {}, ranges = (text.match(/\b(?:19|20)\d{2}\s*(?:-|–|—|to)\s*(?:(?:19|20)\d{2}|present|current)/gi) ?? []).length;
  const heads = (w: RegExp) => text.split("\n").filter((l) => l.trim().length < 40 && w.test(l)).length;
  const cvMarks = [heads(/^(work |employment |career )?(experience|history)\b/i), heads(/^(education|qualifications)\b/i), heads(/^(skills|key skills|competenc)/i), ranges >= 2 ? 1 : 0, r.email || r.phone ? 1 : 0].filter(Boolean).length;
  const jobMarks = [heads(/^(requirements?|responsibilities|duties|minimum requirements|key responsibilities|about the role|the role|job description)\b/i), /\b(we are looking for|the successful candidate|apply|closing date)\b/i.test(text) ? 1 : 0].filter(Boolean).length;
  const verdict = jobMarks >= 2 && cvMarks < 4 ? "jd" : cvMarks >= 3 ? "cv" : "neither";
  console.log(`${id} ${extname(name).slice(1)} ${Math.round(bytes.length / 1024)} KB read=${o.ok ?? false} code=${o.code ?? "-"} chars=${text.length} cvMarks=${cvMarks} jobMarks=${jobMarks} roles=${r.workHistory?.length ?? 0} -> ${verdict}`);
  if (verdict !== "neither") appendFileSync(MANIFEST, JSON.stringify({ id: `loose/${id}/${extname(name).slice(1).toLowerCase()}`, family: `loose/${id}`, stem: id, collection: "loose", kind: verdict, format: extname(name).slice(1).toLowerCase(), real: true, sha: hash.slice(0, 16), bytes: bytes.length, realPath: relative(HOME, f), byContent: true }) + "\n");
}
await stopOcr().catch(() => {});
process.exit(0);
