// Reading order from positions, shared by every reader that has them. Rows are built word by word so a slightly curved photo stays on one row, and a page is read in
// columns only where a clear vertical gap holds for several rows and it is not a table. Evidence for a table is that its two sides line up row by row and neither holds a heading.
import { extractionConfig as CFG } from "../extractionConfig";
import type { Item } from "../layout";

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const HEADINGS = new Set(CFG.evidence.sectionHeadings);
// A scan or photo can leave stray marks beside a heading ("A | PROFILE"), so one- or two-letter pieces are not counted.
const isHeading = (r: Item[]) => HEADINGS.has(r.map((i) => i.s.trim()).filter((s) => s.length > 2).join(" ").toLowerCase().replace(/[:\s]+$/, "").trim());
const isSpeck = (r: Item[]) => r.map((i) => i.s).join("").replace(/[^\p{L}\p{N}]/gu, "").length < 2;
const avgY = (r: Item[]) => r.reduce((a, i) => a + i.y, 0) / r.length;

/** Items to rows, left to right: each joins the row whose last item it continues, so a row can drift gently up or down across a photo. */
export function rowsOf(items: Item[]): Item[][] {
  const rows: Item[][] = [];
  for (const it of [...items].sort((a, b) => a.x - b.x)) {
    let best: Item[] | null = null, bestGap = Infinity;
    for (const r of rows) { const last = r[r.length - 1], gap = Math.abs(last.y - it.y); if (gap <= Math.min(last.h, it.h) * 0.55 && last.x + last.w <= it.x + Math.max(last.h, it.h) && gap < bestGap) { best = r; bestGap = gap; } }
    if (best) best.push(it); else rows.push([it]);
  }
  return rows.sort((a, b) => avgY(b) - avgY(a));
}

/** Rows that follow each other at line spacing, as blocks. */
function blocksOf(rows: Item[][]): Item[][][] {
  const blocks: Item[][][] = [];
  for (const r of rows) { const prev = blocks.at(-1)?.at(-1); if (prev && avgY(prev) - avgY(r) <= Math.max(prev[0].h, r[0].h) * 1.7) blocks.at(-1)!.push(r); else blocks.push([r]); }
  return blocks;
}
/** One side holds only short labels set well apart, beside a side that does the talking: labels in a margin, whatever they say. A sidebar of skills or contact details runs on line after line, so its blocks are long, and a column of years belongs to its rows. */
function marginLabels(side: Item[][], other: Item[][]): boolean {
  const blocks = blocksOf(side), words = (r: Item[]) => r.map((i) => i.s).join(" ").trim().split(/\s+/).length, chars = (rows: Item[][]) => rows.flat().reduce((a, i) => a + i.s.length, 0);
  // Rows set at the same pitch as the other side are a list running down a sidebar, however short its items: labels sit further apart than the lines beside them.
  const pitch = (rows: Item[][]) => median(rows.slice(1).map((r, k) => avgY(rows[k]) - avgY(r))), apart = median(blocks.slice(1).map((b, k) => avgY(blocks[k][0]) - avgY(b[0])));
  if (apart <= pitch(other) * 1.5) return false;
  // A table's two sides have the same number of rows and hold about as much; labels have several lines of the other side to each.
  return blocks.length >= 2 && blocks.every((b) => b.length <= 3 && b.every((r) => words(r) <= 4 && !/\d/.test(r.map((i) => i.s).join("")))) && other.length >= blocks.length * 2 && chars(other) >= chars(side) * 3;
}

/** Rows in reading order: a run of rows split by one vertical gap is read as its left side, then its right. */
export function inColumns(allRows: Item[][], width: number, specks = false): Item[][] {
  const rows = specks ? allRows.filter((r) => !isSpeck(r)) : allRows;   // OCR's stray marks: a row with no more than a letter on it
  if (rows.length < 6 || !width) return rows;
  const gapWidth = Math.max(width * 0.012, median(rows.flat().map((i) => i.h)) * 0.6);
  // The writer's own word space is no gutter: a row with words either side of x, no further apart than words are, is one line, however the short rows around it left that spot clear.
  const oneLineAcross = (r: Item[], x: number) => { const before = r.filter((i) => i.x + i.w <= x).at(-1), after = r.find((i) => i.x >= x); return !!before && !!after && after.x - (before.x + before.w) <= Math.min(before.h, after.h) * CFG.layout.wordSpaceOfHeight; };
  const crosses = (r: Item[], x: number) => r.some((i) => i.x < x + gapWidth / 2 && i.x + i.w > x - gapWidth / 2) || oneLineAcross(r, x);
  type Run = { from: number; to: number };
  const runsAt = (x: number) => {
    const runs: Run[] = []; let from = -1;
    const close = (to: number) => { if (from < 0) return; const seg = rows.slice(from, to), left = seg.filter((r) => r.some((i) => i.x + i.w <= x)).length, right = seg.filter((r) => r.some((i) => i.x >= x)).length; if (seg.length >= 4 && left >= 3 && right >= 3) runs.push({ from, to }); from = -1; };
    rows.forEach((r, k) => { if (crosses(r, x)) close(k); else if (from < 0) from = k; });
    close(rows.length);
    return runs;
  };
  let bestX = 0, bestRuns: Run[] = [], bestCount = 0;
  for (let x = width * 0.2; x <= width * 0.8; x += width / 300) { const runs = runsAt(x), count = runs.reduce((a, s) => a + s.to - s.from, 0); if (count > bestCount) { bestX = x; bestRuns = runs; bestCount = count; } }
  if (bestCount < 6) return rows;
  const out: Item[][] = []; let at = 0;
  for (const run of bestRuns) {
    out.push(...rows.slice(at, run.from));
    const seg = rows.slice(run.from, run.to), leftOf = (r: Item[]) => r.filter((i) => i.x + i.w <= bestX), rightOf = (r: Item[]) => r.filter((i) => i.x >= bestX);
    const both = seg.filter((r) => leftOf(r).length && rightOf(r).length), headed = seg.some((r) => (leftOf(r).length && isHeading(leftOf(r))) || (rightOf(r).length && isHeading(rightOf(r))));
    // One side is nothing but headings: a form with its headings in the margin, so each heading leads what sits beside and below it. Read down the page, not side by side.
    // Dates down one side, and the headings among them: a margin of dates, each leading what sits beside it, read down the page.
    // A narrow column wraps them: "Sep 2021 –" / "Present".
    const isDateRow = (r: Item[]) => /^(?:(?:\p{L}{3,9}\.?\s+)?(?:19|20)\d{2}|present|current|now)(?:\s*(?:[-–—]|to)(?:\s*(?:(?:\p{L}{3,9}\.?\s+)?(?:19|20)\d{2}|present|current|now))?)?$/iu.test(rowText(r).trim());
    // A narrow margin wraps a date over several rows ("November" / "2021 -" / "Present"), so it is the block that reads as a date, not each row.
    const dateMargin = (list: Item[][]) => { const own = list.filter((r) => !isHeading(r)); if (own.length < 2) return false; const blocks = blocksOf(own).map((b) => [{ ...b[0][0], s: b.map(rowText).join(" ") }]); return own.filter(isDateRow).length / own.length >= 0.7 || (blocks.length >= 2 && blocks.filter(isDateRow).length / blocks.length >= 0.7); };
    const sides = [seg.map(leftOf).filter((r) => r.length), seg.map(rightOf).filter((r) => r.length)], margin = sides.find(dateMargin) ?? sides.find((list) => list.length >= 2 && list.filter(isHeading).length / list.length >= 0.7) ?? sides.find((list, k) => marginLabels(list.filter((r) => avgY(r) <= avgY(sides[1 - k][0] ?? r) + r[0].h), sides[1 - k]));   // what sits above the other side's first row is a header, not a label
    if (margin) {
      // A label that wraps ("Summary of" / "experience") is one label, and it leads what sits beside it.
      const labels = blocksOf(margin).map((b) => [{ ...b[0][0], s: b.map(rowText).join(" ") }]), other = sides.find((list) => list !== margin)!, key = (r: Item[]) => (labels.includes(r) ? r[0].y + r[0].h * 1.2 : avgY(r));   // a heading sits a little lower than the first line beside it, and still comes first
      out.push(...[...labels, ...other].sort((a, b) => key(b) - key(a))); at = run.to; continue;
    }
    const words = (r: Item[]) => r.map((i) => i.s).join(" ").trim().split(/\s+/).length, shortCells = both.filter((r) => words(leftOf(r)) <= 5 && words(rightOf(r)) <= 5).length >= both.length * 0.7;
    const headedBothSides = seg.some((r) => leftOf(r).length > 0 && isHeading(leftOf(r))) && seg.some((r) => rightOf(r).length > 0 && isHeading(rightOf(r)));
    // Rows above and below the part that has two sides say nothing about whether that part is a table.
    const firstBoth = seg.findIndex((r) => both.includes(r)), lastBoth = seg.length - 1 - [...seg].reverse().findIndex((r) => both.includes(r)), span = both.length ? lastBoth - firstBoth + 1 : seg.length;
    // One side holding mostly years and statuses is a table's columns, whatever else is in the run: those values mean nothing away from their rows.
    const rightRows = seg.map(rightOf).filter((r) => r.length), values = rightRows.filter((r) => /^(?:\S+\s+)?(?:(?:19|20)\d{2}|completed?|in progress|not completed|expired|ongoing)\b/i.test(r.map((i) => i.s).join(" ").trim())).length;
    if (rightRows.length >= 2 && values / rightRows.length >= 0.6) { out.push(...seg); at = run.to; continue; }
    // Text that runs on from row to row is not cells: a table's row ends where its cell does. One side's row ending on a list mark, or the next row starting in lower case, is a sentence or a list that wrapped.
    const runsOn = (list: Item[][]) => list.filter((r, k) => { const t = r.map((i) => i.s).join(" ").trim(), next = list[k + 1]?.[0]?.s.trim() ?? ""; return /[/|,;]$/.test(t) || /^\p{Ll}/u.test(next); }).length;
    const flowing = Math.max(runsOn(sides[0]), runsOn(sides[1])) >= Math.max(2, both.length * 0.3);
    if (!flowing && both.length / span >= 0.7 && (!headed || (shortCells && !headedBothSides))) { out.push(...seg); at = run.to; continue; }   // lines up row by row with no heading on either side: a table, whose rows belong together
    out.push(...seg.map(leftOf).filter((r) => r.length), ...seg.map(rightOf).filter((r) => r.length));
    at = run.to;
  }
  out.push(...rows.slice(at));
  return out;
}

export const rowText = (r: Item[]) => r.map((it, k) => { if (!k) return it.s; const p = r[k - 1], gap = it.x - (p.x + p.w); return (gap > Math.max(p.h, it.h) * 1.5 ? " | " : !p.s.endsWith(" ") && !it.s.startsWith(" ") && gap > Math.min(p.h, it.h) * 0.12 ? " " : "") + it.s; }).join("").replace(/\s+/g, " ").trim();
