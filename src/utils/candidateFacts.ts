// Facts a recruiter wants at a glance, worked out ONLY from what the CV states. Nothing here invents anything: if the CV does not say it, it is absent.
import { displayCase, employerName } from "./displayCase";

export interface RoleFacts { position?: string; company?: string; startDate?: string; endDate?: string }
export interface EducationFacts { degree?: string; institution?: string; year?: string; type?: string; status?: "completed" | "listed" | "in_progress" | "not_completed" | "not_stated" }

// Words for "still there" in English, Afrikaans and Portuguese. Kept equal to PRESENT_WORDS in server/src/dates.ts by a test.
const CURRENT = /present|current|now|today|to date|till date|ongoing|hede|tans|huidig|heden|presente|atual|atualmente|actualidade/i;

/** Who this person is today, in one sentence, from the dated roles (owner, 9 Nov 2026: "I need to know who you are today"): the job that runs to the
 *  present, or, if none does, the most recent one, said as past. Only what the CV's roles state; empty when there is no role to speak of. */
export function whoToday(history: RoleFacts[] = [], names?: Record<string, string>): string {
  const job = currentJob(history) ?? history.find((r) => (r.position ?? "").trim());
  if (!job || !(job.position ?? "").trim()) return "";
  const what = `${displayCase(job.position!.trim(), names)}${(job.company ?? "").trim() ? ` at ${employerName(job.company!.trim(), names)}` : ""}`, start = displayCase((job.startDate ?? "").trim(), names), end = displayCase((job.endDate ?? "").trim(), names);
  return CURRENT.test(end) ? `Currently ${what}${start ? ` (since ${start})` : ""}.` : `Most recently ${what}${end ? ` (until ${end})` : ""}.`;
}

/** The job the candidate holds now, or the most recent one with an employer. Roles are expected newest first, as CVs list them. */
export function currentJob(history: RoleFacts[] = []): RoleFacts | undefined {
  const withCompany = history.filter((r) => (r.company ?? "").trim());
  return withCompany.find((r) => CURRENT.test(r.endDate ?? "")) ?? withCompany[0];
}

/** The employer the candidate works for now, or the most recent one. */
export function currentEmployer(history: RoleFacts[] = []): string {
  return currentJob(history)?.company?.trim() ?? "";
}

// Higher rank = higher qualification. Matched against the qualification's own wording.
const LEVELS: [RegExp, number][] = [
  [/\b(ph\.?d|doctorate|doctoral|dphil)\b/i, 7],
  [/\b(master|msc|m\.sc|mba|mcom|m\.com|ma\b|m\.a\b|meng|mphil|llm|mtech)\b/i, 6],
  [/\b(honou?rs|b\.?(sc|a|com|eng|tech|ed|soc ?sci)\b.*\bhon|bsc\s*\(hons\)|postgraduate)\b/i, 5],
  [/\b(bachelor|bsc|b\.sc|ba\b|b\.a\b|bcom|b\.com|beng|btech|b\.tech|bed|llb|degree)\b/i, 4],
  [/\b(advanced diploma|national diploma|diploma|nqf ?(6|7))\b/i, 3],
  [/\b(national senior certificate|matric|grade 12|senior certificate|a-?levels?)\b/i, 2],
  [/\b(certificate|certification|short course|course)\b/i, 1],
];
/** A form's label on its own ("Institution:"), not a value (the same test as the reader's, server/src/modelReader.ts isLabel). */
const isLabel = (v: string) => /^[\p{L}][\p{L} &/]{1,40}:$/u.test(v.trim());
/** A title without the table's dividing lines around and between its parts, every word as written (the same as the reader's tidyTitle): records read
 *  before 10 Nov 2026 show cleanly without being read again; the stored reading stays as it was, as the evidence. */
export const tidyTitle = (t: string) => t.replace(/\s*\|\s*/g, " / ").replace(/(?:\s*\/\s*){2,}/g, " / ").replace(/^[\s/•·–—-]+|[\s/•·–—-]+$/g, "").replace(/\s{2,}/g, " ").trim();
const qualificationLevel = (text: string) => LEVELS.find(([re]) => re.test(text))?.[1] ?? 0;

/**
 * The highest qualification the CV says was FINISHED, exactly as the CV words it. "listed" (a degree the CV lists as held, with no date or word) counts as
 * finished, as the Education tab shows it ("Completed (as listed)"); so does an entry with no status at all, from records read before completion was read.
 * Only when nothing is finished is another shown, and it says what it is: one still being studied ("BSc Computer Science (in progress)"), else one with no
 * record of completion ("MBA (no record of completion)", the Education tab's own words). One that was not completed is never shown. Ties keep the CV's order.
 * Code review, 16 Nov 2026, G-M10: "not_stated" was counted as finished, so the card's snapshot showed an unconfirmed MBA as held.
 */
export function highestQualification(education: EducationFacts[] = []): string {
  const all = education
    .map((e, i) => ({ text: (e.degree ?? "").trim(), i, level: qualificationLevel(e.degree ?? ""), status: e.status }))
    .filter((e) => e.text && !isLabel(e.text));   // a form's label on its own ("Institution:") is not a qualification
  const best = (xs: typeof all) => [...xs].sort((a, b) => b.level - a.level || a.i - b.i)[0];
  const finished = best(all.filter((e) => e.status === "completed" || e.status === "listed" || e.status === undefined));
  if (finished) return finished.text;
  const studying = best(all.filter((e) => e.status === "in_progress"));
  if (studying) return `${studying.text} (in progress)`;
  const unconfirmed = best(all.filter((e) => e.status === "not_stated"));
  return unconfirmed ? `${unconfirmed.text} (no record of completion)` : "";
}

/** The recruiter's snapshot after "who they are today" (owner, 9 Nov 2026: as a top agency writes a shortlist): years of experience, highest qualification
 *  and where they live, each only where the CV states it, in normal capitalisation. "12+ yrs · BCom Accounting · Johannesburg". */
export function snapshotFacts(c: { experience?: string; education?: EducationFacts[]; location?: string; displayNames?: Record<string, string> }): string[] {
  const years = c.experience ? (c.experience === "0" ? "under 1 yr" : `${c.experience}+ yrs`) : "";
  return [years, displayCase(highestQualification(c.education), c.displayNames), displayCase((c.location ?? "").trim(), c.displayNames)].filter(Boolean);
}

export interface GlanceInput { role?: string; experience?: string; location?: string; education?: EducationFacts[]; workHistory?: RoleFacts[]; skills?: string[] }

/** A short factual line for CVs that have no summary of their own: "Software Architect at Natus Lab · 2+ yrs · BSc Computer Science · Johannesburg". */
export function profileAtAGlance(c: GlanceInput): string {
  // "X at Y" names the job actually held at Y: when the CV gives that job its own title ("HR Manager, Rand Auto Parts"), that title is used,
  // never a headline the candidate gives themselves ("HR Generalist"), which may not be their title there. Without one, the headline stands.
  const job = currentJob(c.workHistory), employer = job?.company?.trim() ?? "";
  const title = job?.position?.trim() || c.role || "";
  const years = c.experience && c.experience !== "0" ? `${c.experience}+ years of dated experience` : c.experience === "0" ? "under a year of dated experience" : "";
  const parts = [
    [title, employer && `at ${employer}`].filter(Boolean).join(" "),
    years,
    highestQualification(c.education),
    c.location,
  ].filter((p) => p && p.trim());
  return parts.join(" · ");
}
