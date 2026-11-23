// Asks the contact question of one document exactly as live does (hybridReader.ts contactFromModel), and prints the raw answer beside what was believed.
// Local only; one small Claude question per document.   <local settings> ANTHROPIC_API_KEY=... node --import tsx test/collection/contactCheck.ts <file>...
import { readFileSync } from "node:fs";
import { prepareDocument } from "../../src/prepare";
import { askAi, contactFromModel, type Ask } from "../../src/hybridReader";
import { defaultSettings } from "../../src/settings";
import { stopOcr } from "../../src/ocr";
for (const file of process.argv.slice(2)) {
  const p: any = await prepareDocument(new Uint8Array(readFileSync(file)), { kind: "cv", org: defaultSettings(), asOf: new Date() });
  if (!p.ok) { console.log(file, "not read", p.code); continue; }
  const inner = askAi([String(p.record.name ?? "")].filter(Boolean), "evaluation"); let raw: unknown;
  const spy: Ask = async (o) => { const a = await inner(o); raw = a.ok ? a.json : { refused: a.why, detail: (a as any).detail }; return a; };
  const got = await contactFromModel(spy, p.text, { name: p.record.name, email: p.record.email, phone: p.record.phone }, 60_000);
  console.log(file.split("/").pop(), "\n  parser:", JSON.stringify({ name: p.record.name, email: p.record.email, phone: p.record.phone }), "\n  Claude said:", JSON.stringify(raw), "\n  believed:", JSON.stringify({ name: (got as any).name, email: (got as any).email, phone: (got as any).phone }));
}
await stopOcr?.(); process.exit(0);
