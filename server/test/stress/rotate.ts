// npm run stress:rotate : what happens to OCR when a scanned page arrives turned 0, 90, 180 or 270 degrees (no camera flag, as from a scanner or a forwarded image)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { stopOcr } from "../../src/ocr";
import { readDocument } from "../../src/parse";
import { degrade, pageImages, PROFILES, readPhoto } from "../ocr/eval";
const OUT = fileURLToPath(new URL("../../data/stress/pdf/", import.meta.url));
const profile = PROFILES.find((p) => p.id === "faded")!;
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
function cer(a: string, b: string) { a = norm(a); b = norm(b); if (!b.length) return 1; let prev = Array.from({ length: b.length + 1 }, (_, j) => j); for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; } return Math.min(1, prev[b.length] / b.length); }
async function turn(png: Buffer, deg: number) {
  const img = await loadImage(png), swap = deg % 180 !== 0, c = createCanvas(swap ? img.height : img.width, swap ? img.width : img.height), x = c.getContext("2d");
  x.translate(c.width / 2, c.height / 2); x.rotate((deg * Math.PI) / 180); x.drawImage(img, -img.width / 2, -img.height / 2);
  return c.toBuffer("image/png");
}
const seeds = (process.env.SEEDS ?? "1,2,3,5,6,7").split(",").map(Number), res: Record<number, number[]> = { 0: [], 90: [], 180: [], 270: [] };
for (const seed of seeds) {
  const pdf = new Uint8Array(readFileSync(join(OUT, `${seed}.pdf`)));
  const want = (await readDocument(pdf, "pdf")).text, pages = (await pageImages(pdf)).slice(0, 1);
  for (const deg of [0, 90, 180, 270]) { const img = await turn(await degrade(pages[0], profile), deg); res[deg].push(cer((await readPhoto([img])).text, want.slice(0, 1500))); }
}
const mean = (x: number[]) => Math.round((x.reduce((a, b) => a + b, 0) / x.length) * 1000) / 10;
console.log("CER by rotation:", Object.entries(res).map(([d, x]) => `${d}deg ${mean(x)}%`).join("  "));
await stopOcr(); process.exit(0);
