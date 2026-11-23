// Every style class in RoleMatch's stylesheets must be used by some screen. A class nothing uses is a leftover from replaced code: it is removed in
// the same change that stopped using it (owner, 19 Nov 2026: no quick patches, no leftovers). Run by `npm run check:leftovers` and on every change in CI.
//   node scripts/checkStyles.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const read = (f) => readFileSync(f, "utf8");
const unused = [];

/** Each class a stylesheet names must appear as a word in the code that draws its pages. A class the code builds from a fixed start and a value
 * (class="state-${tone}") counts as used when that start is built somewhere. */
function check(where, sheet, code) {
  const css = sheet.replace(/\/\*[\s\S]*?\*\//g, "").replace(/url\([^)]*\)/g, "").replace(/\$\{[^}]*\}/g, "");
  const selectors = css.replace(/\{[^{}]*\}/g, "{}").split(/[{}]/).filter((s) => !s.trim().startsWith("@"));
  const names = new Set(selectors.flatMap((s) => [...s.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1])));
  const words = new Set(code.match(/[A-Za-z_][\w-]*/g)), built = [...code.matchAll(/([A-Za-z_][\w-]*-)\$\{/g)].map((m) => m[1]);
  for (const name of names) if (!words.has(name) && !built.some((b) => name.startsWith(b))) unused.push(`${where}: .${name}`);
}

// The website: its stylesheets against every screen (tests do not count as use).
const site = walk(join(ROOT, "src"));
const siteCode = site.filter((f) => /\.(jsx?|tsx?)$/.test(f) && !/\.test\.(jsx?|tsx?)$/.test(f)).map(read).join("\n") + read(join(ROOT, "index.html"));
const sheets = site.filter((f) => f.endsWith(".css"));
for (const sheet of sheets) check(relative(ROOT, sheet), read(sheet), siteCode);

// The pages the server draws itself carry their stylesheet inside the code: the owner's console (one stylesheet for every page) and the document viewer.
const consoleDir = join(ROOT, "server/src/console"), consoleCss = read(join(consoleDir, "view.ts")).match(/export const CSS = `([\s\S]*?)`;/)[1];
check("server/src/console/view.ts (CSS)", consoleCss, walk(consoleDir).filter((f) => f.endsWith(".ts")).map(read).join("\n").replace(consoleCss, ""));
const viewer = read(join(ROOT, "server/src/viewer.ts")), viewerCss = viewer.match(/<style>([\s\S]*?)<\/style>/)[1];
check("server/src/viewer.ts (style)", viewerCss, viewer.replace(viewerCss, ""));

if (unused.length) { console.error(`Style classes no screen uses (${unused.length}). Remove them, or use them:\n  ${unused.join("\n  ")}`); process.exit(1); }
console.log(`Every style class is used (${sheets.length + 2} stylesheets checked).`);
