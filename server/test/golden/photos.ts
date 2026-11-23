// The three photographed copies of a sample CV that the frozen outputs include (test/golden/outputs.ts). They are kept as files, so the frozen
// outputs depend only on the reader, never on how the image library of the day renders a PDF page (a canvas upgrade once changed these photos and
// therefore the "reader's" output). `npm run golden:photos` makes them again from the invented sample CV, deliberately and visibly.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { degrade, pageImages, PROFILES } from "../ocr/eval";

export const PHOTO_IDS = ["clean-scan", "phone-good", "phone-poor"] as const;
const DIR = fileURLToPath(new URL("./photos/", import.meta.url));
const SAMPLE = fileURLToPath(new URL("../../../sample-documents/cvs/cv03-lindiwe-dlamini.pdf", import.meta.url));
const fileOf = (id: string) => join(DIR, `${id}.jpg`);

export async function makePhotos(): Promise<void> {
  mkdirSync(DIR, { recursive: true });
  const page = (await pageImages(new Uint8Array(readFileSync(SAMPLE))))[0];
  for (const id of PHOTO_IDS) writeFileSync(fileOf(id), await degrade(page, PROFILES.find((p) => p.id === id)!));
}

/** The saved photos; refuses rather than silently re-rendering when one is missing. */
export function savedPhoto(id: (typeof PHOTO_IDS)[number]): Buffer {
  if (!existsSync(fileOf(id))) throw new Error(`test/golden/photos/${id}.jpg is missing: run npm run golden:photos`);
  return readFileSync(fileOf(id));
}

if (fileURLToPath(import.meta.url) === process.argv[1]) { await makePhotos(); console.log(`wrote ${PHOTO_IDS.length} photos to test/golden/photos`); process.exit(0); }
