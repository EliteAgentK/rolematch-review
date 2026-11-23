// Says at which stage each contact value was lost on an OCR document, using the words the engine gave and a closer look at the row the value sits on. Answers are from a synthetic pack's reference.
// Stages: "assignment" the whole value is one word and another was chosen; "spaces" the characters are right on one row with spaces inside the value; "wrap" the value continues on the next row;
// "dropped" the characters are on the image and a closer look reads them, the page reading did not; "characters" no reading gives them. Usage: contactStages.ts <pack> <out.json> [--ids a,b] [--dirs 03,04]
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDocumentProxy, renderPageAsImage } from "unpdf";
import { prepareForOcr } from "../../src/imageprep";
import { OCR_ENGINES, levenshtein, stopOcr, type OcrWord } from "../../src/ocr";

const args = process.argv.slice(2), [pack, outFile] = args, flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const ids = flag("--ids")?.split(","), dirs = (flag("--dirs") ?? "03_Scanned_PDF,04_Phone_Photo_PDF").split(","), mod = flag("--mod")?.split(":").map(Number);
const flat = (s: string) => s.toLowerCase().replace(/\s+/g, ""), digits = (s: string) => s.replace(/\D/g, "");
const rowsOf = (words: OcrWord[]) => { const used = words.filter((w) => w.text?.trim()).sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1)), rows: OcrWord[][] = []; for (const w of used) { const mid = (w.y0 + w.y1) / 2, r = rows.find((x) => Math.abs((x[0].y0 + x[0].y1) / 2 - mid) < (w.y1 - w.y0) * 0.6); if (r) r.push(w); else rows.push([w]); } return rows.map((r) => r.sort((a, b) => a.x0 - b.x0)); };
const out: any[] = [];
const { createCanvas, loadImage } = await import("@napi-rs/canvas");
const engine = OCR_ENGINES.tesseract;
async function crop(png: Buffer, x0: number, y0: number, x1: number, y1: number, k: number) { const img = await loadImage(png), w = x1 - x0, h = y1 - y0, c = createCanvas(Math.round(w * k), Math.round(h * k)), ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, x0, y0, w, h, 0, 0, c.width, c.height); return Buffer.from(await c.encode("png")); }
for (const dir of dirs) for (const f of readdirSync(join(pack, dir)).filter((x) => /CV\d{4}/.test(x)).sort()) {
  const id = f.match(/CV\d{4}/)![0]; if (ids && !ids.includes(id)) continue; if (mod && Number(id.slice(2)) % mod[0] !== mod[1]) continue;
  const e = JSON.parse(readFileSync(join(pack, "Reference", "Expected_CVs", `${id}.json`), "utf8")), bytes = new Uint8Array(readFileSync(join(pack, dir, f)));
  const raw = Buffer.from(await renderPageAsImage(bytes, 1, { canvasImport: () => import("@napi-rs/canvas"), scale: 3.5 })), clean = (await prepareForOcr(new Uint8Array(raw), { exactPanels: true })).png;
  const r = await engine.recognise(clean, "eng+afr"), rows = rowsOf(r.words), img = await loadImage(clean);
  const email = flat(e.email), phone = digits(e.phone);
  const emailWord = r.words.some((w) => flat(w.text) === email);
  const rowJoined = rows.map((row) => flat(row.map((w) => w.text).join("")));
  const atRow = rows.findIndex((row) => row.some((w) => w.text.includes("@")));
  const closer: Record<string, string> = {};
  if (atRow >= 0) { const row = rows[atRow], h = Math.max(...row.map((w) => w.y1 - w.y0)), y0 = Math.max(0, Math.min(...row.map((w) => w.y0)) - h * 0.7), y1 = Math.min(img.height, Math.max(...row.map((w) => w.y1)) + h * 0.7); closer.row3x = (await engine.recognise(await crop(clean, 0, y0, img.width, y1, 3), "eng+afr")).text.trim(); }
  const emailStage = emailWord ? "word" : rowJoined.some((j) => j.includes(email)) ? "spaces" : rowJoined.some((j, i) => (j + (rowJoined[i + 1] ?? "")).includes(email)) ? "wrap" : Object.values(closer).some((t) => flat(t).includes(email)) ? "dropped" : "characters";
  const near = atRow >= 0 ? rows[atRow].map((w) => w.text).join(" ") : "";
  const phoneRow = rows.findIndex((row) => digits(row.map((w) => w.text).join("")).includes(phone));
  out.push({ id, dir: dir.slice(0, 2), email: e.email, emailStage, emailRow: near, closer, phone: e.phone, phoneOnRow: phoneRow >= 0, emailDistance: atRow >= 0 ? Math.min(...rows[atRow].map((w) => levenshtein(flat(w.text), email))) : null });
  console.log(id, dir.slice(0, 2), emailStage, "|", near.slice(0, 80), "|", (closer.row3x ?? "").slice(0, 80));
}
writeFileSync(outFile, JSON.stringify(out, null, 1));
const tally: Record<string, number> = {}; for (const o of out) { const k = `${o.dir} ${o.emailStage}`; tally[k] = (tally[k] ?? 0) + 1; } console.log(tally);
await stopOcr();
