// Real CVs mostly come through agencies, and their work history is a form rather than a list: labelled blocks, a table of columns read one cell per line, a summary followed by the same jobs in detail, dates spaced out for display or split by the page. This turns each of those into one plain line per role, "Title | Employer | dates", with the duties left where they are, for the role reader. Labels live in configuration.
import { extractionConfig as CFG } from "./extractionConfig";

const F = CFG.roleForms;
/** Between the cells of a role this reader has already understood. The role reader takes such a line as it stands, rather than guessing again which part is the title. */
export const ROLE_CELL = "\u241F";
/** One role, understood. `written` says how the document set the title and employer down, so the quote can be the document's own words: the employer on the line above the title, or "title, employer" on one line. It is carried by which separator stands between title and employer. */
export type Written = "employer above title" | "title, employer";
export const WRITTEN: Record<Written, string> = { "employer above title": "\u241E", "title, employer": "\u241D" };
const roleLine = (title: string, employer: string, dates: string, written?: Written) => `${title}${written ? WRITTEN[written] : ROLE_CELL}${employer}${ROLE_CELL}${dates}`;
const months = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const END = "present|current(?:ly)?(?: position)?|now|to date|date";
const POINT = `(?:(?:\\d{1,2}\\s+)?(?:${months})[a-z]*\\.?[\\s-]*(?:19|20)\\d{2}|(?:19|20)\\d{2}(?:[/-]\\d{1,2})?|\\d{1,2}[/.](?:19|20)\\d{2})`;
const DASH = "\\s*(?:-|–|—|to|until)\\s*", RANGE_ONLY = new RegExp(`^\\(?${POINT}${DASH}(?:${POINT}|${END})\\b[^a-z]*\\)?$`, "i");
const isDateOnly = (l: string) => RANGE_ONLY.test(l.trim());
const bullet = /^[•▪●➢⮚⬤\-–*·◼o]\s+/;
const strip = (l: string) => l.trim().replace(/^[•▪●➢⮚⬤\-–*·◼\s]+/, "").replace(/[\s|:]+$/, "").trim();
const labelWords = (l: string) => l.trim().toLowerCase().replace(/[\s:|]+$/, "");

/** Letters spaced or split for display: "J U N E 2 0 2 2 — P R E S E N T", "No v ember 2021", "Pr esent". Only where, closed up, the line is a date. */
function repairSpacedDate(line: string): string {
  const t = line.trim();
  if (!/(?:^|\s)\S{1,2}\s/.test(t) || t.length > 60) return line;
  const closed = t.replace(/\s+/g, ""), m = closed.match(new RegExp(`^((?:${months})[a-z]*)?(\\d{4})?(?:([-–—]|to)((?:${months})[a-z]*|${END})?(\\d{4})?)?$`, "i"));
  if (!m || (!m[1] && !m[2] && !m[4])) { const end = closed.match(new RegExp(`^(${END})$`, "i")); return end ? end[1] : line; }
  return [m[1], m[2], m[3], m[4], m[5]].filter(Boolean).join(" ");
}
/** "2021 June- 2022 September": a year before its month. */
const monthAfterYear = (l: string) => l.replace(new RegExp(`\\b((?:19|20)\\d{2})\\s+((?:${months})[a-z]*)\\b`, "gi"), "$2 $1");
/** A date the page stacked: "November" / "2021 -" / "Present". Up to three short pieces that are nothing but parts of a date make one line. */
function joinStackedDates(lines: string[]): string[] {
  const piece = new RegExp(`^(?:(?:${months})[a-z]*\\.?|(?:19|20)\\d{2}|[-–—]|to|${END})(?:\\s*(?:(?:${months})[a-z]*\\.?|(?:19|20)\\d{2}|[-–—]|to|${END}))*$`, "i"), out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i].trim();
    if (!piece.test(a) || !/(?:19|20)\d{2}|[a-z]{3}/i.test(a)) { out.push(lines[i]); continue; }
    let joined = a, k = i;
    while (k + 1 < lines.length && k - i < 3 && piece.test(lines[k + 1].trim()) && !isDateOnly(joined)) joined = `${joined} ${lines[++k].trim()}`;
    if (isDateOnly(joined)) { out.push(joined); i = k; } else out.push(lines[i]);
  }
  return out;
}

type Kind = "company" | "title" | "start" | "end" | "dates" | "skip";
const LABELS = (Object.entries(F.labels) as [Kind, readonly string[]][]).flatMap(([kind, words]) => words.map((w) => ({ kind, w }))).sort((a, b) => b.w.length - a.w.length);
function labelled(line: string): { kind: Kind; value: string } | null {
  const t = line.trim().replace(/\s*\|\s*/g, " | "), low = t.toLowerCase();
  if (/^company\s+(?:\|\s*)?industry$/i.test(t)) return { kind: "company", value: "" };
  for (const { kind, w } of LABELS) {
    if (!low.startsWith(w)) continue;
    const rest = t.slice(w.length), sep = rest.match(/^\s*(?:\|\s*)?(?::|\|)\s*(?:\|\s*)?/);
    if (sep) return { kind, value: strip(rest.slice(sep[0].length)) };
    if (!rest.trim()) return { kind, value: "" };
    // No mark between them, as some agency forms print it: only a label in capitals, followed by a value that starts afresh.
    if (t.slice(0, w.length) === t.slice(0, w.length).toUpperCase() && /^\s+\S/.test(rest)) return { kind, value: strip(rest) };
  }
  return null;
}
/** A role's labelled block to one line. A block that only continues an earlier company over a page, with no dates, adds nothing. */
function unfoldLabelledBlocks(lines: string[]): string[] {
  const out: string[] = [];
  let cur: { company: string; titles: string[]; start: string; end: string; dates: string; at: number; last: Kind | null; withIndustry?: boolean } | null = null;
  const done = new Set<string>();
  const flush = () => {
    if (!cur) return;
    const day = (d: string) => d.replace(/^\d{1,2}\s+(?=[a-z])/i, "");
    const dates = cur.dates ? day(cur.dates) : cur.start ? `${day(cur.start)} to ${day(cur.end) || "Present"}` : "";
    if (dates && (cur.titles.length || cur.company)) { out.splice(cur.at, 0, roleLine(cur.titles.join(" / "), cur.company, dates)); done.add(cur.company.toLowerCase()); }
    cur = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], f = labelled(l);
    if (f) {
      if (f.kind === "skip" && !cur) continue;   // "Reason for leaving" says nothing about the work, in a role's block or just after it
      if (f.kind === "company") { flush(); const above = out.length ? labelled(out[out.length - 1]) : null, heldBefore = above?.kind === "title" && above.value ? [above.value] : []; if (heldBefore.length) out.pop();   // a form may give the position before the company
        cur = { company: f.value, titles: heldBefore, start: "", end: "", dates: "", at: out.length, last: "company", withIndustry: /industry/i.test(l) && !f.value }; continue; }
      if (cur) {
        if (f.kind === "title") { if (f.value) cur.titles.push(f.value); cur.last = "title"; continue; }
        if (f.kind === "start") { cur.start = f.value; cur.last = "start"; continue; }
        if (f.kind === "end") { cur.end = f.value.replace(/ position$/i, ""); cur.last = "end"; continue; }
        if (f.kind === "dates") { cur.dates = f.value.replace(/\s*\(.*$/, ""); cur.last = "dates"; continue; }
        cur.last = "skip"; continue;
      }
    }
    if (cur && cur.last) {
      const t = strip(l), short = t.length > 0 && t.length <= 60 && !/[.;]$/.test(t);
      if (short && cur.last === "company" && !cur.company) { cur.company = t; continue; }
      // "COMPANY INDUSTRY" over two values: the second is the industry. Otherwise a short line after the company is the rest of its name.
      if (short && cur.last === "company" && cur.withIndustry) { cur.last = "skip"; continue; }
      if (short && cur.last === "company" && !/^[a-z]/.test(t)) { cur.company = `${cur.company} ${t}`.trim(); continue; }
      if (short && cur.last === "title" && (bullet.test(l.trim()) || !cur.titles.length || /^\(/.test(t))) { if (/^\(/.test(t) && cur.titles.length) cur.titles[cur.titles.length - 1] += ` ${t}`; else cur.titles.push(t); continue; }
      if (cur.last === "skip" && short) { continue; }
      if ((cur.last === "dates" || cur.last === "start" || cur.last === "end") && isDateOnly(l)) { cur.dates = strip(l); continue; }
      if (cur.dates || cur.start) { flush(); out.push(l); continue; }
      // the block is still gathering, or was only a continuation: a line that is not part of it ends it
      if (bullet.test(l.trim()) || t.length > 60) { const c = cur as { company: string }; if (done.has(c.company.toLowerCase()) || !c.company) { cur = null; } else flush(); out.push(l); continue; }
    }
    out.push(l);
  }
  flush();
  return out;
}
/** "DATE" / "COMPANY" / "POSITION" as a row of names, and then a role in three cells, one per line, as a Word table comes out. The names can repeat before each block. */
function unfoldCellTriples(lines: string[]): string[] {
  const out: string[] = [], header = (i: number) => { const a = [lines[i], lines[i + 1], lines[i + 2]].map((x) => (x === undefined ? "" : labelWords(x))); return F.tripleHeads.some((h) => h.every((w, k) => a[k] === w)) ? a : null; };
  for (let i = 0; i < lines.length; i++) {
    const h = header(i);
    if (!h) { out.push(lines[i]); continue; }
    const col = (name: string[]) => h.findIndex((x) => name.includes(x)); i += 3;
    for (;;) {
      const row = [lines[i], lines[i + 1], lines[i + 2]].map((x) => (x ?? "").trim());
      if (!row[col(F.tripleWords.dates as unknown as string[])] || !isDateOnly(row[col(F.tripleWords.dates as unknown as string[])])) break;
      out.push(roleLine(strip(row[col(F.tripleWords.title as unknown as string[])]), strip(row[col(F.tripleWords.company as unknown as string[])]), row[col(F.tripleWords.dates as unknown as string[])]));
      i += 3;
      // a second title for the same dates ("C# Programmer" / "Front End Developer"): not a row of its own
      if (lines[i] !== undefined && !isDateOnly(lines[i]) && lines[i + 1] !== undefined && isDateOnly(lines[i + 1].trim()) && !labelled(lines[i])) i++;
    }
    i--;
  }
  return out;
}
/** "Netsurit (January 2018 - Present)" then "POSITION: Cloud Engineer": an employer with its dates, its title on the next line. */
function unfoldEmployerDated(lines: string[]): string[] {
  const out: string[] = [], dated = new RegExp(`^(.{2,70}?)\\s*\\(\\s*(${POINT}${DASH}(?:${POINT}|${END}|end of (?:19|20)\\d{2}))\\s*\\)$`, "i");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(dated), next = lines[i + 1]?.trim().match(/^position\s*:\s*(.+)$/i);
    if (m && next) { out.push(roleLine(next[1].trim(), m[1].trim(), m[2].trim())); i++; continue; }
    out.push(lines[i]);
  }
  return out;
}
/** Two short lines and then the dates: a job title and its employer, in either order, and sometimes both on the first line with a place on the second. A hyphen inside a title stays in it. */
function unfoldStackedRoles(lines: string[]): string[] {
  const out: string[] = [], plain = (l?: string) => !!l && !!l.trim() && !bullet.test(l.trim()) && !l.includes("|") && l.trim().length <= 90 && !/[.:;]$/.test(l.trim()) && !isDateOnly(l) && !labelled(l), titleish = (l: string) => F.titleWords.some((w) => new RegExp(`\\b${w}\\b`, "i").test(l));
  for (const l of lines) {
    // The role on one line above its dates: "Senior Developer, Northwind Traders, Cape Town". A last part after a further comma is where, not who.
    const whole = out.length && plain(out[out.length - 1]) ? out[out.length - 1].trim().match(/^(.{3,60}?)\s*,\s*(.{2,60})$/) : null;
    if (isDateOnly(l) && whole && titleish(whole[1])) { out.pop(); out.push(roleLine(whole[1], whole[2].split(/\s*,\s*/)[0], l.trim(), "title, employer")); continue; }
    if (!isDateOnly(l) || out.length < 2 || !plain(out[out.length - 1]) || !plain(out[out.length - 2])) { out.push(l); continue; }
    const b = out.pop()!.trim(), a = out.pop()!.trim(), comma = a.match(/^(.{3,60}?)\s*,\s*(.{2,60})$/);
    if (comma && titleish(comma[1])) { out.push(roleLine(comma[1], comma[2].split(/\s*,\s*/)[0].replace(/,$/, ""), l.trim(), "title, employer")); continue; }
    if (!titleish(a) && !titleish(b)) { out.push(a, b, l); continue; }
    out.push(titleish(a) ? roleLine(a, b, l.trim()) : roleLine(b, a, l.trim(), "employer above title"));
  }
  return out;
}
/** Dates in a margin come first once read down the page: "Sep 2021 - Present" / "Data Analyst, Zenith Logistics". */
function unfoldDateAboveRole(lines: string[]): string[] {
  const out: string[] = [], titleish = (l: string) => F.titleWords.some((w) => new RegExp(`\\b${w}\\b`, "i").test(l));
  for (let i = 0; i < lines.length; i++) {
    const below = lines[i + 1]?.trim() ?? "", comma = isDateOnly(lines[i]) && !/[.:;]$/.test(below) && !below.includes("|") && !labelled(below) ? below.match(/^(.{3,60}?)\s*,\s*(.{2,60})$/) : null;
    if (comma && titleish(comma[1])) { out.push(roleLine(comma[1], comma[2].split(/\s*,\s*/)[0], lines[i].trim(), "title, employer")); i++; continue; }
    out.push(lines[i]);
  }
  return out;
}
/** A summary of employment followed by the same jobs in detail. Rows it was possible to read stay, and are reconciled with the details later; a summary that came out as loose cells says nothing the details do not, so it goes. Without details it stays whole. */
function withoutUnreadSummary(lines: string[]): string[] {
  const low = lines.map(labelWords), at = low.findIndex((l) => F.summaryHeads.includes(l)); if (at < 0) return lines;
  const next = low.findIndex((l, k) => k > at && F.detailHeads.includes(l)); if (next < 0) return lines;
  return [...lines.slice(0, at), ...lines.slice(at, next).filter(isRoleLine), ...lines.slice(next)];
}
const isRoleLine = (l: string) => /[\u241D-\u241F]/.test(l);
/** Lines that repeat across a document's pages and are about the page: footers, form numbers, "Page 3 of 9". Never a bullet, and never something that reads as a sentence. */
function withoutPageFurniture(lines: string[]): string[] {
  // Only a page's own number may differ between its copies: wrapped duties that differ by a number ("project 10.4", "project 10.5") are work, not furniture.
  const key = (l: string) => l.trim().toLowerCase().replace(/\bpage\s+\d+(?:\s+of\s+\d+)?/g, "page #"), count = new Map<string, number>();
  for (const l of lines) count.set(key(l), (count.get(key(l)) ?? 0) + 1);
  const seen = new Set<string>();
  return lines.filter((l) => { const t = l.trim(), k = key(l), n = count.get(k) ?? 0, first = !seen.has(k); seen.add(k); if (/^page\s+\d+\s+of\s+\d+$/i.test(t)) return false; return first || !(n >= 3 && t.length >= 8 && !bullet.test(t) && !/[.!?]$/.test(t) && !isDateOnly(t) && !labelled(l) && !isRoleLine(t)); });
}
/** Roles read from a form sit under whatever the form called that part, or nothing. Where a role line is not already under a work-history heading, one goes before the first. */
function underExperienceHeading(lines: string[]): string[] {
  const first = lines.findIndex(isRoleLine); if (first < 0) return lines;
  for (let i = first - 1; i >= 0; i--) { const l = labelWords(lines[i]); if (F.detailHeads.includes(l)) return lines; if (F.otherHeads.includes(l)) break; }
  return [...lines.slice(0, first), "Work Experience", ...lines.slice(first)];
}
export function canonicalRoleLines(input: string[]): string[] {
  let lines = input.map((l) => monthAfterYear(repairSpacedDate(l)));
  lines = joinStackedDates(lines);
  lines = withoutPageFurniture(lines);
  lines = unfoldCellTriples(lines);
  lines = withoutUnreadSummary(lines);
  lines = unfoldEmployerDated(lines);
  lines = unfoldLabelledBlocks(lines);
  lines = unfoldDateAboveRole(lines);
  lines = unfoldStackedRoles(lines);
  return underExperienceHeading(lines);
}
