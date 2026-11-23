// Prints the extraction of one sample CV as JSON. Run in a fresh process by test/contract.test.ts to prove the answer does not depend on the process.
import { readFileSync } from "node:fs";
import { extractCandidate } from "../../src/extract";
import { sniff } from "../../src/formats";
import { readDocument } from "../../src/parse";
import { AS_OF } from "./outputs";
const bytes = new Uint8Array(readFileSync(process.argv[2]));
const { text } = await readDocument(bytes, sniff(bytes)!);
const e: any = await extractCandidate(text, { asOf: AS_OF });
console.log(JSON.stringify({ record: e.record, confidence: e.confidence, meta: { ...e.meta, model: undefined } }));
process.exit(0);
