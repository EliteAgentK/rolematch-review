// Page layout: turning pieces of text that have positions (from a PDF's text layer, or from OCR) into lines in reading order.
// One implementation serves both, so a scanned two-column CV is read with the same column logic as a digital one.

export interface Item { s: string; x: number; y: number; w: number; h: number }
const bigGap = (a: Item, b: Item) => b.x - (a.x + a.w) > Math.max(10, Math.max(a.h, b.h) * 1.3);

/**
 * Some PDFs store text row by row across two columns, so every line reads "sidebar item | main text".
 * When at least four rows pair up at the same column boundary, read the left column in full and then the right.
 * Tables whose left column is just dates (a date | title layout) are left row-wise, because the dates belong to the rows.
 */
function weaveColumns(lines: Item[][]): Item[][] {
  const starts = new Map<number, number>();
  for (const l of lines) if (l.length === 2 && bigGap(l[0], l[1])) { const k = Math.round(l[1].x / 8) * 8; starts.set(k, (starts.get(k) ?? 0) + 1); }
  const top = [...starts].sort((a, b) => b[1] - a[1])[0];
  if (!top || top[1] < 4) return lines;
  const X = top[0];
  type Side = "both" | "left" | "right" | "full";
  const classify = (l: Item[]): Side => {
    const first = l[0], last = l[l.length - 1];
    if (first.x >= X - 8) return "right";
    if (last.x + last.w <= X + 4) return "left";
    const crossing = l.some((it, i) => i > 0 && it.x >= X - 8 && l[i - 1].x + l[i - 1].w <= X + 4);
    return crossing && l.every((it) => it.x >= X - 8 || it.x + it.w <= X + 4) ? "both" : "full";
  };
  const sides = lines.map(classify);
  const out: Item[][] = [];
  let i = 0;
  while (i < lines.length) {
    if (sides[i] === "full") { out.push(lines[i++]); continue; }
    let j = i;
    while (j < lines.length && sides[j] !== "full") j++;
    const seg = lines.slice(i, j), segSides = sides.slice(i, j);
    const both = seg.filter((_, k) => segSides[k] === "both");
    const leftParts = both.map((l) => l.filter((it) => it.x < X - 8));
    const dateLike = leftParts.filter((p) => /\b(19|20)\d{2}\b|\x27\d{2}\b|present/i.test(p.map((it) => it.s).join(" "))).length;
    // A table whose every row pairs a sentence with a short value ("Strong Excel skills | Essential") is read row by row, not column by column.
    const rightParts = both.map((ln) => ln.filter((it) => it.x >= X - 8).map((it) => it.s).join(" "));
    const shortRight = rightParts.filter((t) => t.split(/\s+/).length <= 2 && t.length <= 16).length;
    const statusTable = both.length >= 4 && both.length / seg.length >= 0.85 && shortRight / both.length >= 0.7;
    if (both.length >= 4 && dateLike / both.length < 0.4 && !statusTable) {
      const left: Item[][] = [], right: Item[][] = [];
      seg.forEach((l, k) => {
        if (segSides[k] === "left") left.push(l);
        else if (segSides[k] === "right") right.push(l);
        else { left.push(l.filter((it) => it.x < X - 8)); right.push(l.filter((it) => it.x >= X - 8)); }
      });
      out.push(...left.filter((l) => l.length), ...right.filter((l) => l.length));
    } else if (both.length >= 4 && !statusTable) out.push(...bandByDateCell(seg, segSides, X));
    else out.push(...seg);
    i = j;
  }
  return out;
}


/**
 * A table with a date column on the left ("Sep 2021 –" / "Present" beside a job title and its bullets). Read row by row, the date of one job is cut in
 * two by the lines beside it; read column by column, dates and jobs lose each other. A date cell and the lines beside it belong together: each date cell
 * (all its lines) is emitted first, then everything to its right, then the next cell. This is the order a Word file gives for the same table.
 */
function bandByDateCell(seg: Item[][], sides: string[], X: number): Item[][] {
  const text = (items: Item[]) => items.map((it) => it.s).join(" ");
  const YEAR = /\b(?:19|20)\d{2}\b|\x27\d{2}\b/g;   // 2019, or '19
const complete = (t: string) => ((t.match(YEAR) ?? []).length >= 2 || /present|now|current|to date/i.test(t) || (/\b(?:19|20)\d{2}\b|\x27\d{2}\b/.test(t) && !/[-–—]\s*$/.test(t.trim())));
  type Band = { left: Item[][]; right: Item[][] };
  const bands: Band[] = [];
  seg.forEach((line, k) => {
    const left = sides[k] === "right" ? [] : line.filter((it) => it.x < X - 8), right = sides[k] === "left" ? [] : line.filter((it) => it.x >= X - 8);
    const lt = text(left), cur = bands[bands.length - 1];
    if (!cur || (lt && complete(text(cur.left.flat())))) bands.push({ left: [], right: [] }); // a finished date cell ends the band; whatever comes next in the left column starts a new one (a date, or a heading)
    const b = bands[bands.length - 1];
    if (left.length) b.left.push(left);
    if (right.length) b.right.push(right);
  });
  return bands.flatMap((b) => [...b.left, ...b.right]);
}

/**
 * Is the stored order of this page's text unrelated to the page? Reading order moves down the page. It jumps back up only when a new
 * column starts, and then the new run of text sits beside the old one (a sidebar and a main column share no horizontal space).
 * If a run that was stored later sits ABOVE and over the same horizontal space as an earlier one, the order is scrambled.
 */
export function scrambled(items: Item[]): boolean {
  if (items.length < 10) return false;
  const typical = items.map((i) => i.h).sort((p, q) => p - q)[Math.floor(items.length / 2)] || 10;
  const runs: Item[][] = [[items[0]]];
  for (let i = 1; i < items.length; i++) { if (items[i].y - items[i - 1].y > typical * 3) runs.push([items[i]]); else runs[runs.length - 1].push(items[i]); }
  if (runs.length < 2) return false;
  // a run made only of dates (a column of date cells stored apart from the titles beside them) has to be paired with its rows by position
  if (runs.some((r) => r.length >= 5 && r.every((i) => isClosingDate(i) && /\b(?:19|20)\d{2}\b|\x27\d{2}\b|\b\d{1,2}[/.-]\d{2,4}\b/.test(i.s)))) return true;
  const span = (r: Item[]) => [Math.min(...r.map((i) => i.x)), Math.max(...r.map((i) => i.x + i.w))] as const;
  for (let i = 1; i < runs.length; i++) {
    const [a0, a1] = span(runs[i - 1]), [b0, b1] = span(runs[i]);
    const overlap = Math.min(a1, b1) - Math.max(a0, b0), narrower = Math.min(a1 - a0, b1 - b0);
    if (overlap > 0.5 * Math.max(narrower, 1)) return true;
  }
  return false;
}

/** Rebuilds lines from positions: top to bottom, and left to right within a line. (Two-column pages are then woven apart by weaveColumns.) */
export function linesByPosition(items: Item[]): Item[][] {
  const sorted = [...items].sort((p, q) => q.y - p.y || p.x - q.x);
  const lines: Item[][] = [];
  for (const it of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line[0].y - it.y) <= Math.min(line[0].h, it.h) * 0.5) line.push(it); else lines.push([it]);
  }
  for (const l of lines) l.sort((p, q) => p.x - q.x);
  return lines;
}

/** Joins the pieces of one line, putting " | " where a wide gap shows a column or tab stop. */
function joinLine(line: Item[], tabs?: Set<number>): string {   // tabs: the x positions that are table cell edges on this line
  let out = line[0].s;
  for (let i = 1; i < line.length; i++) {
    const prev = line[i - 1], cur = line[i];
    const gap = cur.x - (prev.x + prev.w);
    const fontH = Math.max(prev.h, cur.h, 1);
    const joiner = gap > Math.max(10, fontH * 1.3) || (tabs && gap > fontH * 0.55 && tabs.has(Math.round(cur.x / 4) * 4)) ? " | " : gap > fontH * 0.12 || /\s$/.test(prev.s) || /^\s/.test(cur.s) ? " " : "";
    out += (joiner === " " && (/\s$/.test(out) || /^\s/.test(cur.s)) ? "" : joiner) + cur.s;
  }
  return out;
}

/**
 * Positioned words (y grows upward, as in PDF) to text. Words that sit close together on a line are first joined into phrases (a PDF's
 * text layer arrives in runs like that; OCR gives single words), then lines are built by position, columns woven apart, and lines joined.
 */
/**
 * Is the page laid out in two columns (a sidebar beside the main text, or two text columns)? Looks for a vertical strip, clear of text, that has a
 * real amount of text on each side. A line that runs across the strip (a header spanning the page) is ignored when looking for it. Rows do not have
 * to line up between the columns, which is what separates this from weaveColumns (that one needs rows that pair up).
 */
function isClosingDate(it: Item): boolean {
  return it.s.length <= 24 && /\d/.test(it.s) && /^[\p{L}.\x27/ -]{0,12}\d{1,4}/u.test(it.s.trim());
}

/** Dates that close a row and are not lined up with the start of other text (a date in a column of its own at the left edge of a column is a different thing). */
function closingDates(lines: Item[][]): Set<Item> {
  const starts = new Map<number, number>();
  for (const it of lines.flat()) if (!isClosingDate(it)) { const k = Math.round(it.x / 4); starts.set(k, (starts.get(k) ?? 0) + 1); }
  const aligned = (it: Item) => [-1, 0, 1].some((d) => (starts.get(Math.round(it.x / 4) + d) ?? 0) >= 2);
  return new Set(lines.flatMap((ln) => { const last = ln[ln.length - 1]; return ln.length >= 2 && isClosingDate(last) && !aligned(last) ? [last] : []; }));
}

function findGutter(lines: Item[][]): number | null {
  const found = findGutterIn(lines);
  if (found !== null) return found;
  // A header block (name, headline, contact, personal details) runs across the whole page above the columns and would otherwise count as text in the gap.
  // Retry without the wide lines among the first six, but only when the page is short enough for them to matter.
  const wide = (ln: Item[]) => { const a = Math.min(...ln.map((i) => i.x)), b = Math.max(...ln.map((i) => i.x + i.w)); return b - a; };
  const all = lines.flat(), span = Math.max(...all.map((i) => i.x + i.w)) - Math.min(...all.map((i) => i.x));
  const rest = lines.filter((ln, i) => !(i < 6 && wide(ln) > span * 0.45));   // only wide lines among the first six; narrow ones (a name, a headline) stay
  return rest.length < lines.length && rest.length >= 10 ? findGutterIn(rest) : null;
}

function findGutterIn(lines: Item[][]): number | null {
  const items = lines.flat();
  if (items.length < 30 || lines.length < 10) return null;
  const minX = Math.min(...items.map((i) => i.x)), maxX = Math.max(...items.map((i) => i.x + i.w)), width = maxX - minX;
  if (width < 100) return null;
  const bins = 200, step = width / bins, covered = new Uint16Array(bins);
  for (const it of items) { const a = Math.max(0, Math.floor((it.x - minX) / step)), b = Math.min(bins - 1, Math.floor((it.x + it.w - minX) / step)); for (let k = a; k <= b; k++) covered[k]++; }
  const limit = Math.max(2, Math.floor(lines.length * 0.12));   // a few full-width lines (a header) do not count as text across the strip
  let best: { from: number; to: number } | null = null;
  // A date that closes a row ("Clicks - Sous Chef ........ 2022 - 2026") belongs to the text on its left, so the empty strip before such dates is not a gutter.
  const closingDate = closingDates(lines);
  for (let k = Math.floor(bins * 0.12); k < Math.floor(bins * 0.75); k++) {
    if (covered[k] > limit) continue;
    let e = k; while (e < bins && covered[e] <= limit) e++;
    const edge = minX + e * step, beside = items.filter((i) => i.x >= edge - step && i.x <= edge + 30);
    const datesOnly = beside.length > 0 && beside.filter((i) => closingDate.has(i)).length >= beside.length * 0.5;
    // ...and a column of dates that OPENS each entry ("Aug 2025 to Present | Unit Manager") likewise ends just before its strip: that strip separates dates from text, not two columns
    const startEdge = minX + k * step, endEdge = minX + e * step;
    // (only dates that have text to their right on the same line: a date that ENDS its line belongs to the text before it)
    const before = items.filter((i) => i.x + i.w >= startEdge - 4 * step && i.x + i.w <= startEdge + step && items.some((o) => o !== i && o.x >= endEdge - step && Math.abs(o.y - i.y) <= Math.max(i.h, 1) * 0.6));
    const datesBefore = before.length >= 2 && before.filter((i) => i.s.length <= 24 && /\d/.test(i.s)).length >= before.length * 0.6;
    if (!datesOnly && !datesBefore && (e - k) * step >= Math.max(14, width * 0.025) && (!best || e - k > best.to - best.from)) best = { from: k, to: e };
    k = e;
  }
  if (!best) return null;
  const x = minX + ((best.from + best.to) / 2) * step;
  // Each side must hold a real share of the TEXT (by characters, so a column of dates at the right edge does not count as a column), and each side must
  // appear on several lines. Rows do NOT have to be one-sided: in most two-column pages the sidebar and the main text share the same lines.
  const chars = (xs: Item[]) => xs.reduce((n, i) => n + i.s.length, 0);
  const leftItems = items.filter((i) => i.x + i.w / 2 < x), rightItems = items.filter((i) => i.x + i.w / 2 >= x), total = chars(items);
  const linesWith = (side: "l" | "r") => lines.filter((ln) => ln.some((i) => (side === "l" ? i.x + i.w / 2 < x : i.x + i.w / 2 >= x))).length;
  return chars(leftItems) >= total * 0.15 && chars(rightItems) >= total * 0.15 && linesWith("l") >= 6 && linesWith("r") >= 6 ? x : null;
}

/** With a gutter: between lines that run across the page, the left column is read whole, then the right. */
function orderByColumns(lines: Item[][], gutter: number): Item[][] {
  const side = (ln: Item[]) => (forcedLeft.has(ln) ? "left" : ln.every((i) => i.x + i.w / 2 < gutter) ? "left" : ln.every((i) => i.x + i.w / 2 >= gutter) ? "right" : "full");
  const sides = lines.map(side);
  // The columns start where the narrower column (usually the sidebar) starts. A few lines above that are a header block (a name centred over the page sits
  // right of the gutter and would otherwise be read AFTER the whole sidebar).
  const chars = (s: string) => lines.reduce((n, ln, i) => (sides[i] === s ? n + ln.reduce((m, it) => m + it.s.length, 0) : n), 0);
  const narrow = chars("left") <= chars("right") ? "left" : "right";
  const firstNarrow = sides.indexOf(narrow);
  // ...but only when those lines really are a header: one of them carries the e-mail address, the phone number or an Email / Phone / Address label.
  const contactCue = (ln: Item[]) => /@|\b(?:email|phone|tel|cell|mobile|address)\s*:|\+?\d[\d ()-]{7,}\d/i.test(ln.map((i) => i.s).join(" "));
  // Only lines clearly ABOVE the narrow column count: a line on the same baseline as its first line is the other column's first line, not a header.
  const narrowTop = firstNarrow >= 0 ? lines[firstNarrow][0].y : 0, narrowH = firstNarrow >= 0 ? lines[firstNarrow][0].h : 10;
  let above = 0; while (above < lines.length && above < 6 && lines[above][0].y > narrowTop + narrowH * 1.0) above++;
  // A contact line that runs across both columns near the top closes the header: everything above it (a headline that happens to sit over one column) belongs to it.
  const lastAcross = Math.max(-1, ...lines.slice(0, 8).map((ln, k) => (sides[k] === "full" && contactCue(ln) ? k : -1)));
  // Likewise the lines above where BOTH columns have begun, when they carry the contact details: a name, a headline and an address block sitting over the columns.
  // (where both columns have begun = the topmost row that has a left line and a right line side by side; the lines may arrive in any order, so this goes by height)
  const paired = lines.filter((ln, k) => (sides[k] === "left" || sides[k] === "right") && lines.some((o, j) => (sides[j] === "left" || sides[j] === "right") && sides[j] !== sides[k] && Math.abs(o[0].y - ln[0].y) <= Math.max(ln[0].h, 1) * 0.8));
  const bothY = paired.length ? Math.max(...paired.map((ln) => ln[0].y)) : null;
  const aboveBoth = bothY === null ? [] : lines.filter((ln) => ln[0].y > bothY + Math.max(ln[0].h, 1) * 0.8);
  const band = aboveBoth.length > 0 && aboveBoth.length <= 8 && aboveBoth.some(contactCue) ? new Set(aboveBoth) : new Set<Item[]>();
  const headerCount = Math.max(firstNarrow > 0 && above > 0 && lines.slice(0, above).some(contactCue) ? above : 0, lastAcross + 1);
  const headerSet = new Set<Item[]>([...lines.slice(0, headerCount), ...band]);
  const out: Item[][] = lines.filter((ln) => headerSet.has(ln));
  if (band.size) out.sort((p, q) => q[0].y - p[0].y);
  const header = out.reduce<Item[][]>((acc, ln) => { const prev = acc[acc.length - 1], o = pieceOrigin.get(ln); if (prev && o && pieceOrigin.get(prev) === o) { const whole = [...prev, ...ln]; pieceOrigin.set(whole, o); acc[acc.length - 1] = whole; } else acc.push(ln); return acc; }, []);
  out.length = 0; out.push(...header);
  let left: Item[][] = [], right: Item[][] = [];
  const flush = () => { out.push(...left, ...right); left = []; right = []; };
  for (let k = 0; k < lines.length; k++) {
    if (headerSet.has(lines[k])) continue;
    const s = sides[k];
    if (s === "full") { flush(); out.push(lines[k]); }
    else if (s === "left") left.push(lines[k]); else right.push(lines[k]);
  }
  flush();
  return out;
}

/** Reading order for a page's lines: by columns when the page has a real gutter, otherwise by rows that pair up (weaveColumns). */
/**
 * Cell edges of a table: x positions (to the nearest 4 units) where a non-first item starts in at least THREE LINES IN A ROW. Rows of a table follow
 * each other; the same x recurring on lines that are far apart (a wrapped date in a date column, say) is not a table.
 */
export function columnTabs(lines: Item[][]): Map<Item[], Set<number>> {
  const out = new Map<Item[], Set<number>>();
  const keys = lines.map((ln) => new Set(ln.slice(1).map((it) => Math.round(it.x / 4) * 4)));
  const all = new Set(keys.flatMap((s) => [...s]));
  for (const k of all) {
    let run: number[] = [];
    // two lines in a row are enough when the cell stands clearly apart from the one before it (more than a word space)
    const apart = (i: number) => lines[i].some((it, n) => n > 0 && Math.round(it.x / 4) * 4 === k && it.x - (lines[i][n - 1].x + lines[i][n - 1].w) >= Math.max(lines[i][n - 1].h, it.h, 1) * 0.9);
    const flush = () => { if (run.length >= 3 || (run.length === 2 && run.every(apart))) for (const i of run) (out.get(lines[i]) ?? out.set(lines[i], new Set()).get(lines[i])!).add(k); run = []; };
    for (let i = 0; i < lines.length; i++) { if (keys[i].has(k)) run.push(i); else flush(); }
    flush();
  }
  return out;
}

/**
 * Text lines from ordered lines, with soft wraps undone. A line that stopped only because the next word would not fit (its right edge plus that
 * word's width reaches the column's edge) continues on the next line, so "Senior Professional Nurse at Cobalt" / "Digital, 12/2024 - 09/2026"
 * reads as one line, and so does an education entry or a bullet that wrapped in a narrow column. A line that ends early (a heading, the end of a
 * paragraph, a short bullet) is left alone, as is a line that starts with a bullet or sits at a different indent.
 */
export function linesToText(ordered: Item[][], tabs?: Map<Item[], Set<number>>): string {
  const text = ordered.map((ln) => joinLine(ln, tabs?.get(ln)));
  const left = ordered.map((ln) => ln[0].x), right = ordered.map((ln) => ln[ln.length - 1].x + ln[ln.length - 1].w);
  // The column's right edge: the furthest any line starting here reaches, ignoring lines that run over into a column that starts further right (a footer across the page)
  const edgeFor = (i: number) => {
    const starts = left.filter((x) => x > left[i] + 60 && ordered.filter((_, j) => Math.abs(left[j] - x) <= 8).length >= 3);
    const barrier = starts.length ? Math.min(...starts) : Infinity;
    return Math.max(...ordered.map((_, j) => (Math.abs(left[j] - left[i]) <= 8 && right[j] <= barrier ? right[j] : 0)));
  };
  const bulletStart = (t: string) => /^\s*(?:[-–—•·●○◉◦▪▫■□◆◇❖✦✧★☆►▶▷➤➢➔→⇒‣⁃✓✔✗✘☑☐*»«]|\d{1,2}[.)])\s?/u.test(t);
  const out: string[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const prev = out.length - 1;
    const j = i - 1;
    if (j >= 0 && prev >= 0 && !bulletStart(text[i]) && !/[.!?:;]$/.test(text[j].trim()) && text[j].trim().split(/\s+/).length >= 3) {   // a finished sentence, a heading or a short label is never a soft wrap
      const next = ordered[i][0], word = next.s.split(/\s+/)[0] ?? "", wordW = next.s.length ? next.w * (word.length / next.s.length) : 0;
      const edge = edgeFor(j), h = Math.max(ordered[j][ordered[j].length - 1].h, 1);
      const sameIndent = Math.abs(left[i] - left[j]) <= 8 || (bulletStart(text[j]) && left[i] >= left[j] && left[i] - left[j] <= 36);
      const vertical = Math.abs(ordered[j][0].y - next.y) <= h * 2.2 && ordered[j][0].y > next.y - 1;   // directly below, not a jump to another block
      const sameFont = Math.abs(ordered[j][ordered[j].length - 1].h - next.h) <= Math.max(ordered[j][0].h, next.h) * 0.14;   // a name above its headline, a heading above its text: different sizes
      // A line that happens to end near the margin proves little (a qualification above its institution can both end near a narrow sidebar's edge), so
      // the line must also READ like a continuation: the next starts in lowercase, or this one ends on a comma, a joining word or a hyphen.
      const reads = (/^\p{Ll}/u.test(text[i]) && !/^\S*[@\/]|^(?:www\.|https?:)/.test(text[i])) || /[,]$|\b(?:and|or|of|at|for|the|in|to|with|a|an|on|by|as)$/i.test(text[j].trim()) || /\p{L}-$/u.test(text[j].trim());
      // a line under a bullet, indented to where the bullet's TEXT starts (a hanging indent) or flush with the bullet itself, continues that bullet whatever its first letter (it must also reach the column edge, below)
      const hanging = bulletStart(text[j]) && ((left[i] > left[j] + 2 && left[i] - left[j] <= 20) || Math.abs(left[i] - left[j]) <= 3);
      const wrapped = (reads || hanging) && sameFont && sameIndent && vertical && right[j] + wordW + h * 0.28 >= edge - 1.5 && right[j] >= edge - Math.max(wordW * 3, 60) && !/^[A-Z0-9 &:.|-]{3,}$/.test(text[i]);
      if (wrapped) { out[prev] = /\p{L}-$/u.test(out[prev]) ? out[prev] + text[i] : `${out[prev]} ${text[i]}`; continue; }
    }
    out.push(text[i]);
  }
  return out.join("\n");
}

const DATE_END = String.raw`(?:\d{4}|[A-Za-z]{3,9}\.?\s+\x27?\d{2,4}|\d{1,2}[/.-]\d{2,4}|\x27\d{2})`;
const CUT_RANGE = new RegExp(`^${DATE_END}\\s*(?:[-–—]|to|until)$`, "iu"), BARE_DATE = new RegExp(`^(?:${DATE_END}|present|current|now|date|ongoing)$`, "iu");

/**
 * A date range cut in two by a narrow cell ("2014 -" over "2017", or "January 2026 –" over "September 2026") is put back together as one cell, so the
 * dates are read as a range and not as a lone year with a dash. The second half must stand directly under the first (same left edge) and be a bare date.
 */
export function rejoinWrappedDates(lines: Item[][]): Item[][] {
  lines=lines.map(line=>line.map(item=>({...item})));
  const gone = new Set<Item>();
  for (const ln of lines) for (let k = 0; k < ln.length; k++) {
    const t = ln[k];
    let start = t, end = t, text = t.s.trim();
    // a justified line spreads the pieces apart: "2014" and "-" are separate items
    if (/^(?:[-–—]|to)$/i.test(text) && k > 0 && BARE_DATE.test(ln[k - 1].s.trim()) && !gone.has(ln[k - 1])) { start = ln[k - 1]; text = start.s.trim() + " " + text; }
    if (!CUT_RANGE.test(text)) continue;
    const below = lines.flat().filter((b) => !gone.has(b) && b !== t && BARE_DATE.test(b.s.trim()) && Math.abs(b.x - start.x) <= 8 && start.y - b.y > 0 && start.y - b.y <= Math.max(start.h, 1) * 2.2);
    if (below.length !== 1) continue;
    const b = below[0];
    const merged = { ...start, s: text + " " + b.s.trim(), w: Math.max(end.x + end.w, b.x + b.w) - start.x };
    gone.add(b); if (start !== end) gone.add(start);
    Object.assign(end, merged);
  }
  if (!gone.size) return lines;
  return lines.map((ln) => ln.filter((i) => !gone.has(i))).filter((ln) => ln.length > 0);
}

export function orderLines(lines: Item[][]): Item[][] {
  lines = rejoinWrappedDates(lines);
  const gutter = findGutter(lines);
  if (gutter !== null && columnsAreReal(lines, gutter)) return splitAtGutter(lines, gutter);
  return weaveColumns(lines);
}

/**
 * Like orderLines, but when the page has a narrower RIGHT column (a sidebar of skills, languages, certificates) that column is returned apart, as `aside`.
 * A sidebar that appears only on the first page would otherwise sit in the middle of the jobs, which carry on, under no heading, on the next page.
 * Sections are found by their headings, so the aside can safely be read after the last page.
 */
export function orderLinesWithAside(lines: Item[][]): { main: Item[][]; aside: Item[][] } {
  const ordered = orderLines(lines);
  const flat = rejoinWrappedDates(lines), gutter = findGutter(flat);
  if (gutter === null || !columnsAreReal(flat, gutter)) return { main: ordered, aside: [] };
  const isRight = (ln: Item[]) => ln.every((i) => i.x + i.w / 2 >= gutter);
  const isLeft = (ln: Item[]) => ln.every((i) => i.x + i.w / 2 < gutter);
  const chars = (xs: Item[][]) => xs.reduce((n, ln) => n + ln.reduce((m, i) => m + i.s.length, 0), 0);
  const right = ordered.filter(isRight), left = ordered.filter(isLeft);
  if (!right.length || chars(right) >= chars(left)) return { main: ordered, aside: [] };
  // only a right column that begins at the top of its side (not the continuation of the left one) is an aside
  return { main: ordered.filter((ln) => !isRight(ln)), aside: right };
}

export function textFromPositions(items: Item[]): string {
  const lines = linesByPosition(items.filter((i) => i.s.trim() !== "")).map((line) => {
    const phrases: Item[] = [];
    for (const it of line) {
      const last = phrases[phrases.length - 1];
      if (last && !bigGap(last, it)) phrases[phrases.length - 1] = { ...last, s: last.s + " " + it.s, w: it.x + it.w - last.x };
      else phrases.push({ ...it });
    }
    return phrases;
  });
  const ordered = orderLines(lines);
  return linesToText(ordered, columnTabs(ordered));
}

/** A table that pairs every row with a short value (dates, a status) has a gutter too, but it is read row by row, never column by column. */
function columnsAreReal(rawLines: Item[][], gutter: number): boolean {
  // words of one phrase (a justified line arrives word by word) are one cell: only a real gap starts another
  const lines = rawLines.map((ln) => ln.reduce<Item[]>((cells, it) => { const last = cells[cells.length - 1]; if (last && it.x - (last.x + last.w) <= Math.max(10, Math.max(last.h, it.h, 1) * 1.3)) cells[cells.length - 1] = { ...last, s: last.s + " " + it.s, w: it.x + it.w - last.x }; else cells.push(it); return cells; }, []));
  // a date column ("Jan 2023 - Present | Financial Manager"): the dates belong to the rows, so the page is read row by row
  const dateish = (s: string) => s.length <= 24 && /\d/.test(s) && s.split(/\s+/).length <= 5 && /^[\p{L}.'/ -]{0,12}\d{1,4}/u.test(s.trim());
  // ...but only when the dates stand LEFT of the gutter (a column of dates, then the text); a main column whose roles start with a date cell, beside a sidebar of text, is two real columns
  const cellsOf = lines.filter((ln) => ln.length >= 2).flat().filter((i) => dateish(i.s));
  const datesLeft = cellsOf.filter((i) => i.x + i.w / 2 < gutter).length;
  if (datesLeft >= 4 && datesLeft >= cellsOf.length * 0.6) return false;
  const shortCells = lines.filter((ln) => ln.length >= 2 && ln[ln.length - 1].s.split(/\s+/).length <= 2 && ln[ln.length - 1].s.length <= 16).length;
  return shortCells / Math.max(1, lines.length) < 0.4;
}

/** Rows whose only right-hand piece is a date that closes a left-hand entry ("Clicks - Sous Chef ........ 2022 - 2026"): the date belongs to the left column. */
const forcedLeft = new WeakSet<Item[]>();
/** The line a piece was cut from, so that a header line cut at the gutter (a contact line running over both columns) is put back together. */
const pieceOrigin = new WeakMap<Item[], Item[]>();

/** Lines that straddle the gutter are split into their left and right pieces first, so a row that spans both columns is not lost. */
function splitAtGutter(lines: Item[][], gutter: number): Item[][] {
  const pieces: Item[][] = [], closing = closingDates(lines);
  for (const ln of lines) {
    const l = ln.filter((i) => i.x + i.w / 2 < gutter), r = ln.filter((i) => i.x + i.w / 2 >= gutter);
    if (l.length && r.length && r.length === 1 && closing.has(r[0]) && r[0].x - gutter < 60 && !ln.some((i) => i.x < gutter && i.x + i.w > gutter)) { forcedLeft.add(ln); pieces.push(ln); continue; }
    // a contact line ("✉ mail ☎ phone ⌂ town") that runs over both columns is ONE line, however far apart its icons sit
    const icons = new Set(ln.map((i) => i.s.trim()).filter((t) => /^[\u2709\u260e\u2302\u2706\u{1F4DE}\u{1F4E7}\u{1F4CD}]\uFE0F?$/u.test(t)));
    if (l.length && r.length && icons.size >= 2 && lines.indexOf(ln) < 8) { pieces.push(ln); continue; }
    if (l.length && r.length && ln.some((i) => i.x < gutter && i.x + i.w > gutter)) pieces.push(ln);   // an item that crosses the gutter: a line across the page
    else { for (const p of [l, r]) if (p.length) { pieces.push(p); pieceOrigin.set(p, ln); } }
  }
  return orderByColumns(pieces, gutter);
}
