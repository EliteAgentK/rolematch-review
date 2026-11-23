// npm run stress:headings : how well do font weight and size alone find a CV's section headings?
// For every generated PDF, lines are marked "heading-like" (bold or clearly larger than the body, short, no sentence punctuation), then compared with the
// headings the generator actually wrote. Reports precision (flagged lines that are headings) and recall (headings that were flagged).
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { getDocumentProxy } from "unpdf";
import { makeStyle } from "./render";
const OUT = fileURLToPath(new URL("../../data/stress/pdf/", import.meta.url));
const N = Number(process.argv[2] ?? 120);
const isBoldName = (n: string) => /bold|black|heavy|semibold|demi|extrabold/i.test(n);
const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
let tp = 0, fp = 0, fn = 0, files = 0; const misses: string[] = [], falses: string[] = [];
for (let seed = 1; seed <= N; seed++) {
  const file = join(OUT, `${seed}.pdf`); if (!existsSync(file)) continue;
  const st = makeStyle(seed), heads = new Set(Object.values(st.headings).map(squash));
  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(file)), { fontExtraProperties: true } as never);
  const lines: { text: string; bold: boolean; size: number; y: number }[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page: any = await pdf.getPage(n); const content = await page.getTextContent(); await page.getOperatorList();
    const names = new Map<string, string>();
    for (const it of content.items as any[]) if (it.fontName && !names.has(it.fontName)) names.set(it.fontName, await new Promise<any>((r) => page.commonObjs.get(it.fontName, r)).then((f) => String(f?.name ?? "")));
    const byY = new Map<number, any[]>();
    for (const it of content.items as any[]) if (it.str.trim()) { const k = Math.round(it.transform[5] / 3) + n * 10000; (byY.get(k) ?? byY.set(k, []).get(k)!).push(it); }
    for (const items of byY.values()) {
      items.sort((a, b) => a.transform[4] - b.transform[4]);
      const text = items.map((i) => i.str).join("").replace(/\s+/g, " ").trim();
      lines.push({ text, bold: items.every((i) => isBoldName(names.get(i.fontName) ?? "")), size: Math.max(...items.map((i) => Math.abs(i.transform[3]))), y: n * 10000 - items[0].transform[5] });
    }
  }
  files++;
  const sizes = lines.map((l) => l.size).sort((a, b) => a - b), body = sizes[Math.floor(sizes.length / 2)] || 10;
  const all = squash(lines.map((l) => l.text).join(""));
  const present = [...heads].filter((h) => all.includes(h));
  const flagged = lines.slice(2).filter((l) => l.text.length <= 48 && !/[.!?]$/.test(l.text) && (l.bold || l.size >= body * 1.15) && l.text.split(" ").length <= 6);
  const flaggedSet = new Set(flagged.map((l) => squash(l.text).replace(/:$/, "")));
  for (const l of flagged) { if ([...heads].some((h) => squash(l.text) === h || squash(l.text).startsWith(h))) tp++; else { fp++; if (falses.length < 8) falses.push(`${seed}: ${l.text}`); } }
  for (const h of present) if (![...flaggedSet].some((t) => t === h || t.startsWith(h))) { fn++; if (misses.length < 8) misses.push(`${seed}: ${h}`); }
}
console.log({ files, flaggedHeadings: tp, flaggedOther: fp, missedHeadings: fn, precision: +(tp / Math.max(1, tp + fp)).toFixed(2), recall: +(tp / Math.max(1, tp + fn)).toFixed(2) });
console.log("sample false flags:", falses.join(" | ")); console.log("sample misses:", misses.join(" | "));
process.exit(0);
