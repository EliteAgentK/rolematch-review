// npm run golden:update : re-freeze the expected outputs. Refuses to change them unless src/version.ts PARSER_VERSION was bumped first.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stopOcr } from "../../src/ocr";
import { PARSER_VERSION } from "../../src/version";
import { computeGolden, GOLDEN_DIR, hashOf } from "./outputs";

const dir = join(GOLDEN_DIR, "files"), manifestPath = join(GOLDEN_DIR, "MANIFEST.json");
const next = await computeGolden(), hash = hashOf(next);
const old = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
if (old && old.outputsHash !== hash && old.parserVersion === PARSER_VERSION) {
  console.error(`The reader's output changed, but PARSER_VERSION is still ${PARSER_VERSION}.\nBump it in src/version.ts (and say why in docs/parser/EXTRACTION_CONTRACT.md's change log), then run this again.`);
  await stopOcr(); process.exit(1);
}
mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir)) if (!(f in next)) rmSync(join(dir, f));
for (const [name, body] of Object.entries(next)) writeFileSync(join(dir, name), body);
writeFileSync(manifestPath, JSON.stringify({ parserVersion: PARSER_VERSION, outputsHash: hash, files: Object.keys(next).length, frozenOn: "2026-10-21" }, null, 1) + "\n");
console.log(`froze ${Object.keys(next).length} outputs for parser version ${PARSER_VERSION}${old && old.outputsHash !== hash ? ` (was ${old.parserVersion})` : ""}`);
await stopOcr(); process.exit(0);
