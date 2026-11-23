import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

// R92, R93: the production image installs only `dependencies`, and holds only src/. Anything the running server loads from elsewhere crashes it at start or, worse, when that code path first runs.
const SRC = join(import.meta.dirname, "../src"), pkg = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8"));
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") && !p.endsWith(".d.ts") ? [p] : []; });
const files = walk(SRC).map((f) => ({ f: f.slice(SRC.length + 1), text: readFileSync(f, "utf8") }));
const specifiers = (text: string) => [...text.matchAll(/(?:^|[\s;])(?:import|export)\s[^"';]*?from\s*["']([^"']+)["']|(?:^|[\s(=;])import\(\s*["']([^"']+)["']/gm)].map((m) => m[1] ?? m[2]);

// Optional engines, off in production and loaded only when their setting names them. A new entry here needs the same reason.
const OPTIONAL: Record<string, string> = {
  "onnxruntime-node": "paddleOcr.ts: the trial OCR engine, only with OCR_ENGINE=paddle",
  "onnxruntime-common": "paddleOcr.ts: as above",
  "@gutenye/ocr-node": "paddleOcr.ts: as above",
  "@gutenye/ocr-models": "ocr.ts: as above",
  "@gutenye/ocr-common": "paddleOcr.ts: as above",
};
const packageOf = (s: string) => (s.startsWith("@") ? s.split("/").slice(0, 2).join("/") : s.split("/")[0]);

test("everything the server imports is a production dependency, or a listed optional engine that cannot load by default", () => {
  const missing = new Set<string>();
  for (const { f, text } of files) for (const s of specifiers(text)) {
    if (!s || s.startsWith(".") || s.startsWith("node:")) continue;
    const name = packageOf(s);
    if (!pkg.dependencies[name] && !OPTIONAL[name]) missing.add(`${f}: ${name}`);
  }
  expect([...missing]).toEqual([]);
});

test("nothing under src/ reaches outside it for code, and no development tool is needed to start", () => {
  const outside = files.flatMap(({ f, text }) => specifiers(text).filter((s) => s?.startsWith("..") && !join("src", f, "..", s).startsWith("src")).map((s) => `${f}: ${s}`));
  expect(outside).toEqual([]);
  expect(pkg.dependencies.tsx).toBeUndefined();
  expect(pkg.dependencies.esbuild).toBeUndefined();
});
