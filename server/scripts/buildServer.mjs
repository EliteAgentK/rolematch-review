// Turns the TypeScript server into plain JavaScript for the image, so production starts with node alone (no development tool loads the code at run time).
// Each file stays at the same place in the tree, because the code finds its neighbours by relative path (migrations, word lists). Node needs full file names in imports,
// so every relative import is written out; one that points at no file stops the build, rather than failing later when that code first runs.
//   node scripts/buildServer.mjs <output directory>
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { transform } from "esbuild";

const SRC = resolve(import.meta.dirname, "../src"), OUT = resolve(process.argv[2] ?? "build/src");
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const RELATIVE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.\.?\/[^"']+)\2/g;

function written(file, spec) {
  const target = resolve(dirname(file), spec);
  if (existsSync(target) && statSync(target).isFile()) return spec.replace(/\.ts$/, ".js");
  if (existsSync(`${target}.ts`)) return `${spec}.js`;
  if (existsSync(join(target, "index.ts"))) return `${spec}/index.js`;
  throw new Error(`${relative(SRC, file)} imports ${spec}, which is not a file`);
}

let files = 0, imports = 0;
for (const file of walk(SRC)) {
  const to = join(OUT, relative(SRC, file));
  mkdirSync(dirname(to), { recursive: true });
  if (!file.endsWith(".ts") || file.endsWith(".d.ts")) { if (!file.endsWith(".d.ts")) cpSync(file, to); continue; }
  const { code } = await transform(readFileSync(file, "utf8"), { loader: "ts", format: "esm", target: "node24", sourcefile: file });
  writeFileSync(to.replace(/\.ts$/, ".js"), code.replace(RELATIVE, (_, lead, q, spec) => { imports++; return `${lead}${q}${written(file, spec)}${q}`; }));
  files++;
}
console.log(`Built ${files} files, ${imports} relative imports checked, into ${OUT}`);
