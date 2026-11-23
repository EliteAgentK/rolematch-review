// Prints a document's numbered lines as the readers see them (readerInput), with the line number where a phrase first appears. Local only, nothing sent.
//   ROLEMATCH_ENV_FILE=/dev/null node --import tsx test/collection/showLines.ts <file> [phrase]
import { readFileSync } from "node:fs";
import { prepareDocument } from "../../src/prepare";
import { readerInput } from "../../src/modelReader";
import { stopOcr } from "../../src/ocr";
import { defaultSettings } from "../../src/settings";
const [file, phrase] = process.argv.slice(2);
const p: any = await prepareDocument(new Uint8Array(readFileSync(file)), { kind: "cv", org: defaultSettings(), asOf: new Date() });
if (!p.ok) { console.log("not read:", p.code); process.exit(0); }
const { byNumber } = readerInput(p.text);
const hit = phrase ? [...byNumber].find(([, l]) => l.toLowerCase().includes(phrase.toLowerCase())) : undefined;
console.log(`parser name: ${JSON.stringify(p.record.name ?? "")}, role: ${JSON.stringify(p.record.role ?? "")}`);
console.log(`lines: ${byNumber.size}${phrase ? `, "${phrase}" first at line ${hit?.[0] ?? "(not found)"}` : ""}`);
for (const [n, l] of [...byNumber].slice(0, 40)) console.log(`[${n}] ${l.slice(0, 90)}`);
await stopOcr?.(); process.exit(0);
