// Regenerates the RoleMatch brand images in /public from the Outfit typeface (SIL Open Font Licence, from @fontsource/outfit).
// Wordmark and compact mark. The compact mark (favicon, app icons) is the supplied artwork.
//   Role  = the same multi-colour letter treatment the logo already uses (blue, orange, yellow, green)
//   Match = solid black on light backgrounds; white on dark backgrounds (the existing logo already switched its second word to white in dark mode)
// Run: node scripts/buildBrand.mjs   (needs Google Chrome; the generated PNG/ICO files are committed)
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FONT = pathToFileURL(join(ROOT, "node_modules/@fontsource/outfit/files/outfit-latin-900-normal.woff2")).href;
const { createCanvas, loadImage } = await import(pathToFileURL(join(ROOT, "server/node_modules/@napi-rs/canvas/index.js")).href);
const WORK = join(tmpdir(), "rolematch-brand"); mkdirSync(WORK, { recursive: true });

const ROLE = [["R", "#007BA7"], ["o", "#F55F3C"], ["l", "#FFD600"], ["e", "#3DB58C"]]; // the first four colours of the existing letter treatment
const span = (t, c) => `<span style="color:${c}">${t}</span>`;
const page = (inner) => `<html><style>@font-face{font-family:Outfit9;src:url("${FONT}")}body{margin:0;background:transparent}div{font-family:Outfit9;font-weight:900;font-size:420px;line-height:1.3;letter-spacing:-0.012em;white-space:nowrap;display:inline-block;padding:60px}</style><body><div>${inner}</div></body></html>`;

function shot(name, html, w, h) {
  const file = join(WORK, `${name}.html`), out = join(WORK, `${name}.png`);
  writeFileSync(file, html);
  spawnSync(CHROME, ["--headless=new", "--disable-gpu", "--allow-file-access-from-files", `--user-data-dir=${join(WORK, "profile")}`, "--hide-scrollbars", "--default-background-color=00000000", `--window-size=${w},${h}`, `--screenshot=${out}`, pathToFileURL(file).href], { stdio: "ignore" });
  return out;
}
async function trimmed(path) {
  const img = await loadImage(readFileSync(path));
  const c = createCanvas(img.width, img.height), ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height).data;
  let x0 = img.width, y0 = img.height, x1 = 0, y1 = 0;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (d[(y * img.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { img, box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
}
async function wordmark(variant) {
  const matchColour = variant === "dark" ? "#FFFFFF" : "#000000";
  const { img, box } = await trimmed(shot(`word-${variant}`, page(ROLE.map(([t, c]) => span(t, c)).join("") + span("Match", matchColour)), 2600, 700));
  // Same canvas size and margins as the previous logo files (1500 wide, about 68 px at the sides) so every place it appears keeps its proportions.
  const W = 1500, side = 68, scale = (W - side * 2) / box.w, H = Math.round(box.h * scale + 36);
  const c = createCanvas(W, H), ctx = c.getContext("2d");
  ctx.drawImage(img, box.x, box.y, box.w, box.h, side, 18, box.w * scale, box.h * scale);
  writeFileSync(join(ROOT, "public", `logo-${variant}.png`), c.toBuffer("image/png"));
}
// The compact mark is the supplied artwork (design/rolematch-mark.webp): a colourful R and a black M. Its empty margins are trimmed and it is
// centred on white with an even border, so it stays recognisable down to 16 pixels.
const MARK = join(ROOT, "design", "rolematch-mark.webp");
async function mark(size) {
  const img = await loadImage(readFileSync(MARK));
  const c0 = createCanvas(img.width, img.height), x0 = c0.getContext("2d"); x0.drawImage(img, 0, 0);
  const d = x0.getImageData(0, 0, img.width, img.height).data;
  let minX = img.width, minY = img.height, maxX = 0, maxY = 0;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) { const i = (y * img.width + x) * 4; if (d[i + 3] > 8 && (d[i] < 240 || d[i + 1] < 240 || d[i + 2] < 240)) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; } }
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const c = createCanvas(size, size), ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
  const pad = size <= 32 ? 0.06 : 0.14, scale = (size * (1 - 2 * pad)) / Math.max(w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, minX, minY, w, h, (size - w * scale) / 2, (size - h * scale) / 2, w * scale, h * scale);
  return c.toBuffer("image/png");
}
await wordmark("light"); await wordmark("dark");
const sizes = { "favicon-16x16.png": 16, "favicon-32x32.png": 32, "apple-touch-icon.png": 180, "android-chrome-192x192.png": 192, "android-chrome-512x512.png": 512 };
const pngs = {};
for (const [name, size] of Object.entries(sizes)) { pngs[size] = await mark(size); writeFileSync(join(ROOT, "public", name), pngs[size]); }
// favicon.ico: an ICO container holding the 16 and 32 pixel PNGs
const entries = [16, 32].map((s) => ({ s, data: pngs[s] }));
const header = Buffer.alloc(6); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
let offset = 6 + entries.length * 16; const dir = [], bodies = [];
for (const { s, data } of entries) { const e = Buffer.alloc(16); e[0] = s; e[1] = s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12); offset += data.length; dir.push(e); bodies.push(data); }
writeFileSync(join(ROOT, "public", "favicon.ico"), Buffer.concat([header, ...dir, ...bodies]));
console.log("RoleMatch brand images written to /public");
// The default profile picture was a crop of the old logo; it is now the compact mark.
writeFileSync(join(ROOT, "public", "uploads", "profiles", "default-avatar.png"), await mark(256));
console.log("default profile picture written");
