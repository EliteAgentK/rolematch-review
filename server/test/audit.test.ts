import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

// Guards the reasoning in audit-allowlist.json: the accepted sprintf-js advisory is only safe while nothing we run can reach it.
const SRC = fileURLToPath(new URL("../src", import.meta.url));
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));

test("our source never imports argparse or sprintf-js", () => {
  for (const f of walk(SRC).filter((f) => /\.(ts|js)$/.test(f))) expect(/argparse|sprintf-js/.test(readFileSync(f, "utf8")), f).toBe(false);
});

test("reading a Word file loads neither argparse nor sprintf-js", async () => {
  const mammoth = (await import("mammoth")).default;
  const docx = readFileSync(fileURLToPath(new URL("../../sample-documents/cvs/cv01-thandi-mokoena.docx", import.meta.url)));
  const text = await mammoth.extractRawText({ buffer: docx });
  expect(text.value.length).toBeGreaterThan(200); // extraction really worked
  const loaded = Object.keys(createRequire(import.meta.url).cache);
  expect(loaded.some((f) => /\/(argparse|sprintf-js)\//.test(f))).toBe(false);
});

test("mammoth's library entry point does not require argparse (only its command-line script does)", () => {
  const root = fileURLToPath(new URL("../node_modules/mammoth", import.meta.url));
  for (const f of walk(join(root, "lib")).filter((f) => f.endsWith(".js"))) expect(/require\(["']argparse["']\)/.test(readFileSync(f, "utf8")), f).toBe(false);
  expect(readFileSync(join(root, "bin/mammoth"), "utf8")).toContain('require("argparse")'); // the one place it is used
});
