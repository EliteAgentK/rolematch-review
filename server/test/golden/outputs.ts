// The frozen expected outputs of the reader: what it produces for a fixed set of documents, with "today" fixed. test/contract.test.ts compares the
// live reader against these files. They change only through `npm run golden:update`, which refuses unless src/version.ts was bumped.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractCandidate } from "../../src/extract";
import { sniff } from "../../src/formats";
import { readDocument } from "../../src/parse";
import { readPhoto } from "../ocr/eval";
import { PHOTO_IDS, savedPhoto } from "./photos";

export const GOLDEN_DIR = fileURLToPath(new URL("./", import.meta.url));
const SAMPLES = fileURLToPath(new URL("../../../sample-documents/", import.meta.url));
export const AS_OF = new Date("2026-10-21T00:00:00Z");

/** Only what a person could see or that decides what they see; the extraction never depends on anything else. */
const shape = (e: any) => ({ record: e.record, confidence: e.confidence, meta: { ...e.meta, model: undefined } });

export async function computeGolden(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const put = (name: string, value: unknown) => { out[name] = JSON.stringify(value, null, 1) + "\n"; };
  // job descriptions are read by Claude since 10 Nov 2026 (src/jobReader.ts): only the CV reader has frozen outputs
  for (const [dir, kind] of [["cvs", "cv"]] as const) {
    for (const f of readdirSync(join(SAMPLES, dir)).sort()) {
      const bytes = new Uint8Array(readFileSync(join(SAMPLES, dir, f)));
      const type = sniff(bytes);
      if (!type) continue;
      const { text, issues } = await readDocument(bytes, type);
      const e = await extractCandidate(text, { asOf: AS_OF });
      put(`${kind}-${f}.json`, { readingIssues: issues, ...shape(e) });
    }
  }
  // photos: three degraded prints of one sample CV, saved as files (test/golden/photos.ts) so only the reader can change these outputs
  for (const id of PHOTO_IDS) {
    const read = await readPhoto([savedPhoto(id)]);
    put(`photo-${id}.json`, { text: read.text, confidence: Math.round(read.confidence * 100) / 100, ...shape(await extractCandidate(read.text, { asOf: AS_OF })) });
  }
  return out;
}

export const hashOf = (files: Record<string, string>) => createHash("sha256").update(Object.keys(files).sort().map((k) => `${k}\n${files[k]}`).join("\n")).digest("hex");
