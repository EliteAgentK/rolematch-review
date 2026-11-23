// Makes a deliberately heavy scan: two pages stored as huge lossless pictures (several MB), to prove the optimiser shrinks them.
// Run: npm run build:heavy   (needs Google Chrome; the result is committed so tests do not need it)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { spawnProc } from "../helpers";
import { CVS } from "./content";

const OUT = fileURLToPath(new URL("../../../sample-documents/cvs", import.meta.url));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const cv = CVS.find((c) => c.id === "cv01-thandi-mokoena")!;
const dir = join(tmpdir(), "th-heavy"); mkdirSync(dir, { recursive: true });
const run = (args: string[]) => spawnProc([CHROME, "--headless=new", "--disable-gpu", `--user-data-dir=${join(dir, "profile")}`, ...args], { stdout: "ignore", stderr: "ignore" }).exited;
for (let p = 0; p < 2; p++) {
  const body = cv.sections.map((s, i) => (i === 0 ? `<h1>${esc(s.lines[0])}</h1>${s.lines.slice(1).map((l) => `<p>${esc(l)}</p>`).join("")}` : `${s.h ? `<h3>${esc(s.h)}</h3>` : ""}${s.lines.map((l) => `<p>${esc(l)}</p>`).join("")}`)).join("");
  // a speckled paper background makes the picture noisy, like a real photocopy, so it cannot be stored small losslessly
  const noise = Array.from({ length: 400 }, () => `<i style="left:${Math.random() * 100}%;top:${Math.random() * 100}%;opacity:${Math.random() * 0.25}"></i>`).join("");
  writeFileSync(join(dir, `p${p}.html`), `<html><style>body{font-family:Georgia,serif;font-size:15px;margin:0;padding:40px;width:720px;height:1020px;background:#f4f1ea;position:relative;overflow:hidden;color:#222}i{position:absolute;width:3px;height:3px;background:#555;border-radius:50%}h1{margin:0}h3{margin:18px 0 4px;border-bottom:1px solid #999}p{margin:4px 0}</style><body>${noise}${body}<p style="margin-top:20px">Page ${p + 1} of 2</p></body></html>`);
  await run(["--hide-scrollbars", "--force-device-scale-factor=2", "--window-size=800,1100", `--screenshot=${join(dir, `p${p}.png`)}`, `file://${join(dir, `p${p}.html`)}`]);
}
// Embed the lossless pictures as they are (no re-encoding), the way a careless scanner does.
const doc = await PDFDocument.create();
const { createCanvas, loadImage } = await import("@napi-rs/canvas");
for (let p = 0; p < 2; p++) {
  // Film-grain noise on every pixel, like a real photocopy, so the lossless picture cannot be stored small.
  const shot = await loadImage(readFileSync(join(dir, `p${p}.png`)));
  const canvas = createCanvas(shot.width, shot.height); const ctx = canvas.getContext("2d"); ctx.drawImage(shot, 0, 0);
  const data = ctx.getImageData(0, 0, shot.width, shot.height);
  for (let i = 0; i < data.data.length; i += 4) { const n = Math.floor(Math.random() * 9) - 4; data.data[i] += n; data.data[i + 1] += n; data.data[i + 2] += n; }
  ctx.putImageData(data, 0, 0);
  const img = await doc.embedPng(canvas.toBuffer("image/png"));
  doc.addPage([595, 842]).drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
}
writeFileSync(join(OUT, "cv13-thandi-heavy-scan.pdf"), await doc.save());
console.log("built cv13-thandi-heavy-scan.pdf");
