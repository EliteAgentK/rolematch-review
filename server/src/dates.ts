/** The words a CV uses for "still there" (English, Afrikaans, Portuguese). The ONE list: the parser, the card's "employer" and the tests all use it. */
export const PRESENT_WORDS = "present|current|now|today|to date|till date|ongoing|date|hede|tans|huidig|heden|presente|atual|atualmente|actualidade";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// English abbreviations plus Afrikaans (maa = Maart, mei, okt = Oktober, des = Desember).
// plus Portuguese (fev, abr, mai, ago, set, out, dez)
const ALIAS: Record<string, number> = { maa: 2, mei: 4, okt: 9, des: 11, fev: 1, abr: 3, mai: 4, ago: 7, set: 8, out: 9, dez: 11 };
const monthIndex = (m3: string) => (m3 in ALIAS ? ALIAS[m3] : MONTHS.indexOf(m3));

/** Parse "2021-08", "Aug 2021", "2021" or "Present" into a month index, or null if unclear. */
export function toMonth(value: string, nowDate = new Date()): number | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (new RegExp(`^(${PRESENT_WORDS})$`).test(v)) return nowDate.getFullYear() * 12 + nowDate.getMonth();
  let m = v.match(/^(\d{4})[-/](\d{1,2})/);
  if (m) return Number(m[1]) * 12 + Number(m[2]) - 1;
  m = v.match(/^(\d{1,2})[/.-](\d{4})$/);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return Number(m[2]) * 12 + Number(m[1]) - 1;
  m = v.match(/^([a-z]{3})[a-z]*\.?,?\s+(\d{4})$/);
  if (m && monthIndex(m[1]) >= 0) return Number(m[2]) * 12 + monthIndex(m[1]);
  m = v.match(/^([a-z]{3})[a-z]*\.?\s*['’]?(\d{2})$/); // Mar'21 and Mar 21
  if (m && monthIndex(m[1]) >= 0) return (2000 + Number(m[2])) * 12 + monthIndex(m[1]);
  m = v.match(/^(\d{1,2})\/(\d{2})$/); // 03/21 (month/year)
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return (2000 + Number(m[2])) * 12 + Number(m[1]) - 1;
  m = v.match(/^([a-z]{3})[a-z]*\.?\s*['’](\d{2})$/);
  if (m && monthIndex(m[1]) >= 0) return (2000 + Number(m[2])) * 12 + monthIndex(m[1]);
  m = v.match(/^(\d{4})$/);
  if (m) return Number(m[1]) * 12 + 5; // year only: mid-year, deliberately approximate
  return null;
}

/** Years covered by dated roles, to one decimal, counting overlapping roles once and every month a role covers (January to December is 12
 *  months), the same count as each role's own line (aiMatch.ts datedRole). Undated roles add nothing. */
export function yearsCovered(roles: { startDate: string; endDate: string }[], nowDate = new Date()): number {
  const spans = roles
    .map((r) => [toMonth(r.startDate, nowDate), toMonth(r.endDate, nowDate)] as const)
    .filter((s): s is readonly [number, number] => s[0] !== null && s[1] !== null && s[1] >= s[0])
    .sort((a, b) => a[0] - b[0]);
  let months = 0;
  let end = -Infinity;
  for (const [s, e] of spans) {
    if (s > end) { months += e - s + 1; end = e; }
    else if (e > end) { months += e - end; end = e; }
  }
  return Math.round((months / 12) * 10) / 10;
}

/** A record's years of experience, as stored and shown ("12" for 12+ years; empty with no dated role): worked out by the platform from the roles the record
 *  holds, never typed. One rule wherever the roles are set: when a CV is read (reconcile.ts) and when a recruiter changes the roles (employmentReview.ts,
 *  store.ts), so a removed or corrected role never leaves the years as first read (code review, 16 Nov 2026, C-M3). */
export function experienceOf(roles: { startDate?: string; endDate?: string }[] = [], asOf = new Date()): string {
  const years = yearsCovered(roles.map((r) => ({ startDate: r.startDate ?? "", endDate: r.endDate ?? "" })), asOf);
  return years ? String(Math.floor(years)) : "";
}
