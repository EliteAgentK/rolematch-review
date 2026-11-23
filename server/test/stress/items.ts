// npm run stress:items -- <seed> : every text run on page 1 with its position, to see how a layout was drawn
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { getDocumentProxy } from "unpdf";
const OUT = fileURLToPath(new URL("../../data/stress/", import.meta.url));
const doc = await getDocumentProxy(new Uint8Array(readFileSync(join(OUT, "pdf", `${process.argv[2]}.pdf`))));
const page = await doc.getPage(Number(process.argv[3] ?? 1));
const vp = page.getViewport({ scale: 1 });
const tc = await page.getTextContent();
console.log("page", vp.width, "x", vp.height);
for (const it of tc.items as any[]) if (it.str.trim()) console.log(Math.round(it.transform[4]), Math.round(vp.height - it.transform[5]), Math.round(it.width), JSON.stringify(it.str));
process.exit(0);
