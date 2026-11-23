// A qualification requirement against a candidate's qualifications, graded and explained (docs/architecture/CAPABILITY_GRAPH.md section 4):
//     credit = completion strength x level met x knowledge coverage
// taking the BEST qualification (never a sum: two degrees do not add up to more than the better one). Every factor is in [0, 1] and never falls when the
// evidence improves, so the properties proved in MATCHING_MODEL.md hold. Reported in the engine's three views: proved, expected, possible.
import type { Triple } from "../scoring";
import { extractionConfig as CFG } from "../extractionConfig";
import { classifyQualification } from "../qualifications";
import { areaById, AREAS, DEPTH_WORDS, type Depth } from "./knowledge";
import { LEVELS, NAMED } from "./qualifications";
import type { ReadQualification, Rung } from "./qualificationReader";

export const QUALIFICATION_RULES_VERSION = "0.3.0";
/** Credit for knowledge fit that cannot be judged yet (the job asks for a "relevant" field with no approved list, or the qualification is not in the
 *  graph): the same as a skill that is named but not described. A stated assumption, like the other credits. */
export const UNJUDGED_FIELD = 0.5;
/** How deep a qualification must teach the job's field for that field to count as relevant: intermediate, so a course's passing mention does not. */
const RELEVANT_DEPTH = 2;
const QUALIFICATION_NEED = /\b(degree|diploma|bachelor|master|honours|matric|qualification|certificate|nqf)\b/i;

/**
 * Completion strength per rung, in the three views. STATED ASSUMPTIONS, not findings: a deduction from dates or a bare year earns part of the credit as
 * proved and the rest as possible, until recruiter decisions calibrate these numbers (AI_PHASE_PLAN.md: learning from recruiters).
 */
export const COMPLETION_CREDIT: Record<Rung, Triple> = {
  stated: { low: 1, exp: 1, high: 1 },
  implied: { low: 1, exp: 1, high: 1 },
  dates_fit: { low: 0.75, exp: 0.75, high: 1 },
  year_only: { low: 0.5, exp: 0.5, high: 1 },
  not_stated: { low: 0, exp: 0, high: 1 },
  in_progress: { low: 0, exp: 0, high: 1 },
  short_span: { low: 0, exp: 0, high: 1 },
  not_completed: { low: 0, exp: 0, high: 0 },
};

/** What a qualification requirement needs: a minimum level, what it accepts on completion, and the knowledge it needs (alternatives joined by OR). */
export interface QualificationNeed {
  requirement: string; minNqf: number; levelWords: string;
  completion: "completed" | "studying_accepted"; completionDefaulted: boolean;
  equivalentAccepted: boolean;
  /** each entry is one acceptable knowledge profile; empty means any field */
  fields: { name: string; needs: Record<string, Depth> }[];
  vague: boolean; // "relevant", "related", "similar": the field list must be proposed by the job reader and approved by a recruiter
  /** the subject the requirement names ("Critical Care Nursing"): where RoleMatch's list cannot compare it with a qualification, what the qualification itself says decides. Never "any field" */
  namedSubject?: string;
  /** a named credential that is not a level (a trade test, a certificate): only a credential of the same kind meets it, never any qualification */
  credential?: string;
}

const core = (p: Record<string, Depth>) => Object.fromEntries(Object.entries(p).filter(([, d]) => d >= 2)) as Record<string, Depth>;

/** The rule-based reading of a requirement. A degree named without a word about completion is taken as completed (a recruiter can change it). */
export function readQualificationNeed(requirement: string): QualificationNeed {
  const t = requirement;
  const levels = [...new Set([...t.matchAll(/\b(matric\w*|national senior certificate|higher certificate|advanced diploma|national diploma|diploma|degree|bachelor'?s?|honou?rs|master'?s?|doctorate|ph\.?d)\b/gi)].map((m) => classifyQualification(m[0]).level))];
  const nqfs = levels.map((l) => LEVELS[l]?.nqf ?? 0).filter((n) => n > 0);
  const studying = /\b(?:or (?:currently )?(?:studying|working) towards|currently (?:enrolled|studying)|final[- ]year students?|completing)\b/i.test(t);
  const completedWords = /\b(completed|must (?:hold|have completed)|fully qualified|obtained)\b/i.test(t);
  const anyField = /\b(?:any (?:degree|discipline|field)|degree in any)\b/i.test(t);
  // "or equivalent relevant experience" is about the experience, not the field: only a word about the qualification makes it vague.
  const aboutField = t.replace(/\b(?:or\s+)?(?:equivalent\s+)?(?:relevant|related|similar|appropriate)\s+(?:\w+\s+)?(?:experience|exposure|work)\b/gi, "");
  const vague = !anyField && /\b(relevant|related|similar|equivalent (?:field|discipline)|appropriate|quantitative|numerate|stem)\b/i.test(aboutField);
  const fields: QualificationNeed["fields"] = [];
  if (!anyField) {
    // every named field the requirement mentions is one acceptable alternative ("BCom, BSc or similar degree in a quantitative field")
    const seen = new Set<string>();
    for (const part of t.split(/,|\bor\b|\/|\band\b/i)) {
      const n = NAMED.find((q) => q.match.test(part) && !/^qual:(commerce-general|arts-general|business-administration)$/.test(q.id));
      if (n && !seen.has(n.id)) { seen.add(n.id); fields.push({ name: n.name, needs: core(n.profile) }); }
    }
    if (/\b(quantitative|numerate)\b/i.test(t)) fields.push({ name: "a quantitative field", needs: { "area:mathematics": 2, "area:statistics": 2 } as Record<string, Depth> });
    if (/\bstem\b/i.test(t)) for (const a of ["natural-sciences", "mathematics", "computer-science", "electrical-engineering", "mechanical-engineering", "civil-engineering"]) fields.push({ name: `STEM (${areaById(`area:${a}`)!.name})`, needs: { [`area:${a}`]: 2 } as Record<string, Depth> });
  }
  // A trade test or certificate is a specific credential, not a level: a nursing diploma does not meet "trade test certificate".
  const kind = classifyQualification(t);
  const credential = !nqfs.length && kind.type === "certificate" ? kind.level : undefined;
  const subject = anyField || vague ? undefined : subjectNamedIn(t);
  return {
    credential, namedSubject: subject,
    requirement, minNqf: nqfs.length ? Math.min(...nqfs) : 0, levelWords: levels.join(" or ") || "a qualification",
    completion: studying ? "studying_accepted" : "completed", completionDefaulted: !studying && !completedWords,
    equivalentAccepted: /\bor (?:an? )?(?:equivalent|comparable)\b|\bor \d+\+? years?\b|equivalent (?:practical )?experience/i.test(t),
    fields, vague: vague && fields.length === 0 ? true : vague,
  };
}

/** What field a job is in, from its title first: the title says what the person will do, while every job's text mentions management and communication. Empty when the title places it nowhere and its requirements do not either. */
export function jobAreas(job: { title?: string; requirements?: string[] }): string[] {
  // A whole name in the title ("civil", "financial accounting") places a job. A word that only starts like one ("account" in Account Manager, "accounting") is a hint: what the job asks for has a say.
  const inText = (text: string, like = sameWord) => { const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
    return AREAS.filter((a) => [a.name, ...a.aliases].some((n) => { const need = n.toLowerCase().match(/[a-z]+/g) ?? []; return need.length > 0 && need.every((w) => words.some((x) => like(x, w))); })).map((a) => a.id); };
  const person = (a: string, b: string) => a === b || PERSON_ENDINGS.some(([who, subject]) => a.endsWith(who) && b.endsWith(subject) && a.slice(0, -who.length) === b.slice(0, -subject.length));
  const fromTitle = inText(job.title ?? ""), sure = inText(job.title ?? "", person), specific = sure.filter((a) => !BROAD_AREAS.has(a));
  if (specific.length) return specific;
  // Otherwise the title is a hint and the job's own requirements decide alongside it.
  const counts = new Map<string, number>(); for (const r of job.requirements ?? []) for (const a of inText(r)) if (!BROAD_AREAS.has(a)) counts.set(a, (counts.get(a) ?? 0) + 1);
  const most = Math.max(0, ...counts.values());
  return [...new Set([...fromTitle, ...[...counts].filter(([, n]) => n === most).map(([a]) => a)])];
}
/** How a word for the person meets the word for the subject: accountant and accounting, nurse and nursing, engineer and engineering. */
const PERSON_ENDINGS = CFG.qualifications.personEndings;
/** Areas nearly every job touches: on their own they place a job, beside a specific one they do not. */
const BROAD_AREAS = new Set(CFG.qualifications.broadAreas);
/** One word, written for a person or for the subject: nurse and nursing, accountant and accounting, developer and development. Short words must be the same word. */
const sameWord = (a: string, b: string) => { if (a === b) return true; if (Math.min(a.length, b.length) < 5) return false; let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i >= 4 && i >= Math.min(a.length, b.length) - 3; };

const SUBJECT_STEM = 5;
// Word lists are patches, and these are called that: they only decide what to do when the model is off or down, because whether a field counts is the model's to judge (A5, R136). They live in platform configuration.
const LEVEL_WORD = new Set(CFG.qualifications.notSubjectWords), SHARED_SUBJECT_WORD = new Set(CFG.qualifications.sharedSubjectWords);
const subjectWords = (x: string) => (x.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !LEVEL_WORD.has(w));
const sharesSubject = (subject: string, degree: string) => {
  const words = subjectWords(subject), specific = words.filter((w) => !SHARED_SUBJECT_WORD.has(w)), stems = (l: string[]) => new Set(l.map((w) => w.slice(0, SUBJECT_STEM))), has = stems(subjectWords(degree));
  return [...stems(specific.length ? specific : words)].some((w) => has.has(w));
};
/** The subject a requirement names: "Diploma in Critical Care Nursing or equivalent", "Veterinary degree". Undefined when it names only a kind of qualification. */
function subjectNamedIn(t: string): string | undefined {
  const after = t.match(/\b(?:certificate|diploma|degree|bachelor'?s?|honou?rs|master'?s?|doctorate|ph\.?d|qualification)\s+in\s+(.+?)(?=\s+or\b|\s+with\b|\s+from\b|[,;.]|$)/i)?.[1]?.trim();
  if (after) return after;
  const before = t.match(/\b([a-z][a-z'-]+(?:\s+[a-z][a-z'-]+){0,2})\s+(?:degree|diploma)\b/i)?.[1];
  const words = before?.split(/\s+/).filter((w) => w.length >= 4 && !LEVEL_WORD.has(w.toLowerCase().replace(/'s$/, "")) && !/^(bachelor'?s?|master'?s?)$/i.test(w));
  return words?.length ? words.join(" ") : undefined;
}

/** Share of the needed knowledge a profile covers: the mean over needed areas of min(1, depth held / depth needed). 1 when nothing specific is needed.
 *  Nothing at all of what the field is at its core (the areas it needs at the deepest level) means it is another field, whatever it shares around the edges: BCom Accounting's business management is not supply chain. Knowing more never lowers this. */
export function coverage(needs: Record<string, Depth>, has: Record<string, Depth>): number {
  const keys = Object.keys(needs);
  if (!keys.length) return 1;
  const core = keys.filter((k) => needs[k] === 3);
  if (core.length && core.every((k) => !has[k])) return 0;
  return keys.reduce((s, k) => s + Math.min(1, (has[k] ?? 0) / needs[k]), 0) / keys.length;
}

export interface QualificationVerdict { credit: Triple; best?: ReadQualification; field?: string; coverage?: number; lines: string[]; /** what a careful recruiter verifies or asks before relying on it */ checks: string[] }

/**
 * What a careful recruiter at a large employer does before relying on a qualification: verify it at the source (a CV is a claim), settle any deduced
 * completion with a direct question, check that a foreign qualification has been evaluated, and ask about majors when the knowledge comes only from the
 * programme's typical content. Never a judgement of the institution's prestige.
 */
function checksFor(q: ReadQualification, need: QualificationNeed): string[] {
  const out = [`Verify ${q.degree} with the institution or SAQA's verification service before an offer: the CV is the candidate's claim.`];
  const r = q.completion.rung;
  if (r === "dates_fit" || r === "year_only") out.push(`Ask: "Did you complete the ${q.degree}, and when did you graduate?" (completion is deduced from the dates, not stated)`);
  if (r === "not_stated") out.push(`Ask whether and when the ${q.degree} was completed (the CV gives no year).`);
  if (r === "short_span") out.push(`Ask about the ${q.degree}: the dates are shorter than the usual length (${q.completion.quote}). Credits transferred, an exemption, or not finished?`);
  if (r === "in_progress") out.push(`Ask for the expected completion date and the modules still outstanding.`);
  if (need.fields.length && q.profileFrom === "programme") out.push(`Ask which majors or modules the ${q.degree} included: the knowledge shown here is the programme's typical content, not the candidate's own subjects.`);
  if (/\b(uk|united kingdom|usa|united states|india|nigeria|zimbabwe|kenya|australia|canada|germany)\b/i.test(q.degree)) out.push("A foreign qualification: ask for SAQA's evaluation of its NQF level.");
  return out;
}

/** The best of a candidate's qualifications against one need, with the reasons in words (the differentials a recruiter sees). */
/** What the language model said of a qualification and this requirement's field, by qualification. Asked only about what the rules cannot be sure of; measured as experiment A5. */
type FieldJudgement = { verdict: "same_field" | "related_field" | "different_field"; why: string };
export type FieldJudgements = Record<string, FieldJudgement>;
export function assessQualification(need: QualificationNeed, quals: ReadQualification[], job?: { title?: string; requirements?: string[] }, judged?: FieldJudgements): QualificationVerdict {
  const areas = job && need.vague && !need.fields.length ? jobAreas(job) : [];
  let best: QualificationVerdict = { credit: { low: 0, exp: 0, high: 1 }, lines: ["No qualification in the CV meets this. That is an evidence gap, not proof the candidate has none."], checks: ["Ask whether the candidate holds a qualification that meets this; CVs often leave things out."] };
  for (const q of quals) {
    if (q.nqf < need.minNqf) continue; // a lower level does not meet it (a diploma is not a degree)
    if (need.credential && q.level !== need.credential) continue; // only the same kind of credential meets a named credential
    let comp = COMPLETION_CREDIT[q.completion.rung];
    if (need.completion === "studying_accepted" && q.completion.rung === "in_progress") comp = { low: 1, exp: 1, high: 1 };
    // knowledge: the best acceptable field; a vague requirement with no approved field list cannot be judged on knowledge yet (possible, not proved)
    let cov = 1, field: string | undefined, known = true, relevance: string | undefined;
    const judgement = judged?.[q.degree];
    if (judgement?.verdict === "different_field") { if (!best.best) best.lines = [`The language model read ${q.degree} as another field than this requirement needs: ${judgement.why} That is not proof the candidate has none; a recruiter can say this field counts.`]; continue; }
    if (judgement) {
      field = undefined; known = judgement.verdict === "same_field";
      relevance = `The language model read ${q.degree} as ${judgement.verdict === "same_field" ? "in the field this requirement needs" : "a neighbouring field"}: ${judgement.why}`;
    } else if (need.namedSubject && (!need.fields.length || !Object.keys(q.profile).length)) {
      // Nothing in the list to compare them with, so the qualification's own words decide: sharing the subject's words is possible, not proved; sharing none is not this qualification at all.
      if (!sharesSubject(need.namedSubject, q.degree)) { if (!best.best) best.lines = [`The job asks for a qualification in ${need.namedSubject}. ${q.degree} does not show it: the CV's qualifications are in other subjects. That is an evidence gap, not proof the candidate has none.`]; continue; }
      known = false;
    } else if (need.fields.length) {
      const profileKnown = Object.keys(q.profile).length > 0;
      const scored = need.fields.map((f) => ({ f, c: coverage(f.needs, q.profile) })).sort((a, b) => b.c - a.c)[0];
      cov = scored.c; field = scored.f.name; known = profileKnown;
    } else if (need.vague && job) {
      // "A relevant field" is relevant to this job, so the job says what counts. The level alone never does (the owner, 2026-11-05).
      const relevantArea = areas.find((a) => (q.profile[a] ?? 0) >= RELEVANT_DEPTH);
      if (relevantArea) { field = areaById(relevantArea)!.name; relevance = `${q.degree} is relevant to this job: it teaches ${field.toLowerCase()}, the job's field.`; }
      else if (Object.keys(q.profile).length && areas.length) { if (!best.best) best.lines = [`The job asks for a relevant field. ${q.degree} does not teach ${areas.map((a) => areaById(a)!.name.toLowerCase()).join(" or ")}, so it does not show one. That is not proof the candidate has none; a recruiter can say this field counts.`]; continue; }
      else if (sharesSubject(`${job.title ?? ""} ${(job.requirements ?? []).filter((r) => !QUALIFICATION_NEED.test(r)).join(" ")}`, q.degree)) { known = false; relevance = `${q.degree} may be relevant to this job: its words are the job's own, but RoleMatch's list cannot confirm what it teaches.`; }
      else { if (!best.best) best.lines = [`The job asks for a relevant field. Nothing shows ${q.degree} is one: it is not in RoleMatch's list, and it shares no subject with the job. That is not proof the candidate has none; a recruiter can say this field counts.`]; continue; }
    } else if (need.vague) known = false;
    const credit: Triple = known
      ? { low: comp.low * cov, exp: comp.exp * cov, high: comp.high * cov }
      : { low: comp.low * UNJUDGED_FIELD, exp: comp.exp * UNJUDGED_FIELD, high: comp.high };
    if (credit.low > best.credit.low || (credit.low === best.credit.low && credit.high > best.credit.high) || !best.best) {
      const lines: string[] = [];
      lines.push(`${q.degree}: ${q.level.toLowerCase()}${q.nqf ? ` (NQF ${q.nqf})` : ""}.`);
      if (need.minNqf === 4 && q.nqf > 4) lines.push(`A higher qualification, which normally requires matric; matric itself is not listed.`);
      lines.push(`Completion: ${q.completion.rung.replace(/_/g, " ")}, because ${q.completion.tell}${q.completion.quote ? ` ("${q.completion.quote}")` : ""}.`);
      if (judgement) lines.push(relevance!);
      else if (need.fields.length && known) {
        const f = need.fields.find((x) => x.name === field)!;
        const parts = Object.entries(f.needs).map(([a, d]) => `${areaById(a)?.name.toLowerCase()} ${DEPTH_WORDS[(q.profile[a] ?? 0) as Depth]} of ${DEPTH_WORDS[d]} needed`);
        lines.push(`Knowledge against ${field}: ${parts.join("; ")}, so ${Math.round(cov * 100)}% covered (from the ${q.profileFrom}${q.named && !q.named.reviewed ? ", draft profile awaiting review" : ""}).`);
      } else if (need.fields.length) lines.push(`What this qualification teaches is not in RoleMatch's list yet, so its fit to ${field} is unknown, not a mismatch.`);
      else if (relevance) lines.push(relevance);
      else if (need.vague) lines.push(`The job asks for a relevant field without naming one: the field list must be proposed and approved for this job before knowledge can be judged.`);
      best = { credit, best: q, field, coverage: cov, lines, checks: checksFor(q, need) };
    }
  }
  if (need.equivalentAccepted) best.lines.push("The job also accepts equivalent experience, which the experience evidence may show.");
  if (need.completionDefaulted) best.lines.push("The job does not say whether a qualification still in progress is accepted, so a completed one is assumed; the recruiter can change this.");
  return best;
}
