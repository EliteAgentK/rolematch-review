// Renders every persona x layout to PDF (headless Chrome) and DOCX. Output goes to test/messy/files (git-ignored).
// Usage: node --import tsx test/messy/build.ts [--force]
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Packer } from "docx";
import { DOCX_LAYOUTS } from "./docxLayouts";
import { PERSONAS } from "./personas";
import { PERSONAS_R4 } from "./personas4";
import { LAYOUTS } from "./templates";
import { LAYOUTS_R2 } from "./templates2";
import { LAYOUTS_R3 } from "./templates3";
import { spawnProc } from "../helpers";

export const R4_LAYOUTS = ["classic", "noperiod", "companyfirst", "datefirst", "sidebar", "inline", "narrative", "nodates"];
export const FILES = fileURLToPath(new URL("./files/", import.meta.url));
/** The Chrome that renders the corpus: CHROME_PATH if set, else the Mac's own Chrome, else Playwright's Chromium (the PC). Empty when there is none, and the tests then skip. */
export const CHROME = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ...playwrightChromes()].find((p) => p && existsSync(p)) ?? "";
function playwrightChromes() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), process.platform === "darwin" ? "Library/Caches/ms-playwright" : ".cache/ms-playwright");
  try { return readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().flatMap((d) => [join(root, d, "chrome-linux64/chrome"), join(root, d, "chrome-linux/chrome")]); } catch { return []; }
}

// Chrome refuses to start as root without --no-sandbox (the PC's tests run as root inside WSL); it only ever opens our own fictional HTML here.
// A render that fails is an error, not a missing file: on the PC every PDF once failed silently and the corpus was measured on its 32 Word files alone.
async function render(html: string, out: string, id: string) {
  const flags = ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", ...(process.getuid?.() === 0 ? ["--no-sandbox"] : [])];
  const proc = spawnProc([CHROME, ...flags, `--user-data-dir=${join(tmpdir(), `th-chrome-${id}`)}`, `--print-to-pdf=${out}`, `file://${html}`], { stdout: "ignore", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0 || !existsSync(out)) throw new Error(`Chrome could not render ${id} (exit ${code}): ${(await new Response(proc.stderr).text()).slice(0, 300)}`);
}

// The corpus is rebuilt whenever the code that makes it changes. Files were only ever added when missing, so a machine that built the corpus weeks ago
// kept measuring old documents (the Mac's Word files dated from 19 Oct) while a fresh machine measured new ones: two answers to one test.
const SOURCES = ["build.ts", "templates.ts", "templates2.ts", "templates3.ts", "docxLayouts.ts", "personas.ts", "personas4.ts"];
const corpusVersion = () => createHash("sha256").update(SOURCES.map((f) => readFileSync(fileURLToPath(new URL(`./${f}`, import.meta.url)))).join("\0")).digest("hex").slice(0, 16);

export async function build(force = false) {
  const version = corpusVersion(), stamp = join(FILES, ".version");
  if (!existsSync(stamp) || readFileSync(stamp, "utf8").trim() !== version) { rmSync(join(FILES, "pdf"), { recursive: true, force: true }); rmSync(join(FILES, "docx"), { recursive: true, force: true }); force = true; }
  mkdirSync(join(FILES, "pdf"), { recursive: true });
  mkdirSync(join(FILES, "docx"), { recursive: true });
  const jobs: (() => Promise<void>)[] = [];
  for (const l of [...LAYOUTS, ...LAYOUTS_R2, ...LAYOUTS_R3]) for (const p of PERSONAS) {
    const out = join(FILES, "pdf", `${l.id}__${p.id}.pdf`);
    if (!force && existsSync(out)) continue;
    jobs.push(async () => {
      const html = join(tmpdir(), `th-${l.id}-${p.id}.html`);
      writeFileSync(html, l.build(p));
      await render(html, out, `${l.id}-${p.id}`);
    });
  }
  for (const l of DOCX_LAYOUTS) for (const p of PERSONAS) {
    const out = join(FILES, "docx", `${l.id}__${p.id}.docx`);
    if (!force && existsSync(out)) continue;
    jobs.push(async () => { writeFileSync(out, new Uint8Array(await Packer.toBuffer(l.build(p)))); });
  }
  // Round 4: other occupations, in a mix of the earlier layouts
  const ALL = [...LAYOUTS, ...LAYOUTS_R2, ...LAYOUTS_R3];
  for (const id of R4_LAYOUTS) {
    const l = ALL.find((x) => x.id === id)!;
    for (const p of PERSONAS_R4) {
      const out = join(FILES, "pdf", `${l.id}__${p.id}.pdf`);
      if (!force && existsSync(out)) continue;
      jobs.push(async () => {
        const html = join(tmpdir(), `th-${l.id}-${p.id}.html`);
        writeFileSync(html, l.build(p));
        await render(html, out, `${l.id}-${p.id}`);
      });
    }
  }
  // Four at a time keeps Chrome from fighting itself.
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { while (next < jobs.length) await jobs[next++](); }));
  writeFileSync(stamp, version + "\n");
  return jobs.length;
}
if (import.meta.main) { const n = await build(process.argv.includes("--force")); console.log(`built ${n} files into ${FILES}`); }
