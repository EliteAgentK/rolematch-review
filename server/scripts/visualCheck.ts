// npm run visual:baseline  : screenshots every public page of the running website (http://localhost:5173) into data/visual/baseline
// npm run visual:compare   : screenshots them again and compares pixel by pixel with the baseline, reporting how much of each page changed
// Used around every dependency upgrade, so "nothing changed" is shown, not assumed. Needs Google Chrome and the website running (npm run dev).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnProc } from "../test/helpers";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.VISUAL_URL ?? "http://localhost:5173";
const PAGES = ["/", "/features", "/pricing", "/contact", "/login", "/signup"];
const SIZES: [string, number, number][] = [["desktop", 1440, 2400], ["phone", 390, 2400]];
const DIR = fileURLToPath(new URL("../data/visual/", import.meta.url));
const nameOf = (page: string, size: string) => `${page === "/" ? "home" : page.slice(1)}-${size}.png`;

async function shoot(into: string) {
  mkdirSync(into, { recursive: true });
  for (const p of PAGES) for (const [size, w, h] of SIZES) {
    // a generous wait for animations to settle; reduced motion keeps them still where the page honours it
    await spawnProc([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-prefers-reduced-motion", `--user-data-dir=${join(tmpdir(), "rm-visual-chrome")}`, `--window-size=${w},${h}`, "--virtual-time-budget=8000", `--screenshot=${join(into, nameOf(p, size))}`, BASE + p], { stdout: "ignore", stderr: "ignore" }).exited;
  }
}

async function compare() {
  const { loadImage, createCanvas } = await import("@napi-rs/canvas");
  const now = join(DIR, "now"); await shoot(now);
  const rows: string[] = [];
  let worst = 0;
  for (const p of PAGES) for (const [size] of SIZES) {
    const f = nameOf(p, size);
    const [a, b] = await Promise.all([loadImage(readFileSync(join(DIR, "baseline", f))), loadImage(readFileSync(join(now, f)))]);
    if (a.width !== b.width || a.height !== b.height) { rows.push(`${f}: size changed`); worst = 100; continue; }
    const pixels = (img: typeof a) => { const c = createCanvas(img.width, img.height), x = c.getContext("2d"); x.drawImage(img, 0, 0); return x.getImageData(0, 0, img.width, img.height).data; };
    const pa = pixels(a), pb = pixels(b);
    let diff = 0;
    for (let i = 0; i < pa.length; i += 4) if (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]) > 30) diff++;
    const share = (100 * diff) / (pa.length / 4);
    worst = Math.max(worst, share);
    rows.push(`${f}: ${share.toFixed(2)}% of pixels differ`);
  }
  writeFileSync(join(DIR, "compare.txt"), rows.join("\n") + "\n");
  console.log(rows.join("\n"));
  console.log(`largest difference: ${worst.toFixed(2)}%  (screenshots in server/data/visual/now; animations can account for small differences)`);
}

if (process.argv.includes("--compare")) await compare(); else { await shoot(join(DIR, "baseline")); console.log(`baseline saved: ${PAGES.length * SIZES.length} screenshots in server/data/visual/baseline`); }
process.exit(0);
