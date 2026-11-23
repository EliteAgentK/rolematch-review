import { ruleset as R, rulesetFingerprint } from "./ruleset";
import { ROLE_KEY, type AiJudgement, type AiJudgements } from "./aiJudgement";
import { toMonth, yearsCovered } from "./dates";
import { aggregate, confidence as evidenceConfidence, groupCredit, levelCredit, yearsCredit, type Level, type ScoringParams, type Triple } from "./scoring";
import { findSkills, isTechnicalSkill, quoteFor, SKILLS, skillMatches, textMentions, type SkillDef } from "./skills";
import type { Candidate, EvidenceState, Job, AssessmentState, EvidenceContract, MatchEvidence, MatchResult } from "./types";
import { assessLogistics } from "./logistics";
import { REVIEW_RULES_VERSION, reviewRequirement } from "./jobReview";
import { readQualifications } from "./graph/qualificationReader";
import { assessQualification, readQualificationNeed, type FieldJudgements } from "./graph/qualificationMatch";
import { certificateValidity, DESIGNATIONS } from "./qualifications";
import { firstSentence, overviewOf, type Notice } from "./overview";

const WEIGHT = R.weights;
const P = R.scoring.params as ScoringParams;
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const STOP = new Set(["strong", "experience", "working", "knowledge", "ability", "skills", "written", "verbal", "evidence", "complex", "features", "through", "production", "professional", "including", "within", "should", "ensure"]);

const label = (text: string) => text.replace(/\.$/, "").slice(0, 90);
/** Names in a short reason: the first three, then how many more (the full list is in the explanation). */
const names = (xs: string[]) => xs.length > 3 ? `${xs.slice(0, 3).join(", ")} and ${xs.length - 3} more` : xs.join(", ");
const REASON_MAX = 160;
/** One requirement's short reason: its parts' reasons in order, as many as fit (each part's own words, never new ones). */
function fitReason(reasons: string[]): string {
  let out = "";
  for (const r of reasons.filter(Boolean)) { const next = out ? `${out} ${r}` : r; if (next.length > REASON_MAX) break; out = next; }
  return out || reasons[0].slice(0, REASON_MAX - 1).replace(/\s+\S*$/, "") + "…";
}

interface Relevant { years: number; undated: number; lastYear: number | null; roles: string[] }
interface Ctx { /** what the language model said of this match's qualifications, by requirement */ fieldJudgements?: Record<string, FieldJudgements>; candidate: Candidate; credentials: string[]; experienceText: string; selfText: string; sourceText: string; /** the original text without the lines saying the person did not do something */ namedText: string; saidNotDone: string[]; years: number; asOf: Date; relevant: (job: Job, requirement: string) => Relevant;
  /** lines that describe work (duties, projects, things worth noting) and the job titles held, kept apart so a bare mention can be told from described use */
  describedLines: string[]; titleLines: string[]; fromTitle: Map<string, string>; shortMentions: Set<string>; notHandsOn: Set<string>; impliedBy: Map<string, string> }

type Role = Candidate["workHistory"][number];
/** The latest year a set of dated roles reaches ("Present" is the reference date), or null when none is dated. */
const lastYearOf = (roles: Role[], asOf: Date) => roles.reduce<number | null>((y, w) => { const m = toMonth(String(w.endDate ?? ""), asOf) ?? toMonth(String(w.startDate ?? ""), asOf); return m === null ? y : Math.max(y ?? 0, Math.floor(m / 12)); }, null);
const roleText = (w: Role) => `${w.position} ${w.responsibilities.join(" ")}`;

const GENERIC = new Set([...Object.keys(NUMBER_WORDS), "year", "plus", "professional", "experience", "years", "least", "more", "strong", "working", "knowledge", "proven", "demonstrable", "senior", "junior", "intermediate", "lead", "minimum", "relevant", "previous", "with", "and", "the", "of", "in", "a", "an", "or", "for", "to", "on", "as", "at", "least", "must", "have", "good", "excellent", "solid", "hands", "work", "role", "environment"]);
/** Five-letter stems of the subject words in a requirement ("software-development experience" -> softw, devel). */
const sentencesOf = (text: string) => text.split(/\n+|(?<=[.!?;])\s+(?=\p{Lu})/u).map((x) => x.trim()).filter(Boolean);
const stemsOf = (text: string) => [...new Set((text.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !GENERIC.has(w)).map((w) => w.slice(0, 5)))];
/** What a requirement or title is about. Words many unrelated professions share ("manager", "officer") do not say which profession; they count only when nothing else is left to go on. */
const SHARED = new Set(R.scoring.relevance.sharedRoleWords);
const subjectOf = (text: string) => { const stems = stemsOf(withAliases(text)), specific = stems.filter((x) => !SHARED.has(x)); return specific.length ? specific : stems; };
/** What people write for the same subject, spelled out, so "HR Manager" and "human resources" are found to be about the same thing. */
const ALIASES = Object.entries(R.scoring.relevance.aliases as Record<string, string>).map(([short, full]) => [new RegExp(`\\b${short}\\b`, "i"), full] as const);
const withAliases = (text: string) => ALIASES.reduce((t, [re, full]) => (re.test(t) ? `${t} ${full}` : t), text);

const anyWord = (words: readonly string[]) => new RegExp(`\\b(?:${words.join("|")})`, "i");
const ASKS_CURRENT = new RegExp(`\\b(?:${R.certificates.asksCurrent.join("|")})\\b`, "i"), IS_CREDENTIAL = anyWord(R.certificates.isCredential);
/**
 * A requirement that names a certificate the CV lists. Only a certificate's validity is decided here: expired against a requirement for a current one is contradicted by what the CV itself prints, and unknown is an open question, not a failure.
 * Stated validity is still the candidate's own claim, so it never earns more than partial. Returns null when the requirement names no listed certificate, or validity makes no difference, and the other rules judge it.
 */
function judgeCertificate(text: string, ctx: Ctx): { state: EvidenceState; explanation: string; reason: string; source: string } | null {
  const designation = DESIGNATIONS.find((re) => re.test(text)), wantsCurrent = ASKS_CURRENT.test(text);
  if (!IS_CREDENTIAL.test(text) && !designation) return null;
  const subject = (text.match(/[A-Za-z][A-Za-z.()]{2,}/g) ?? []).map((w) => w.toLowerCase()).filter((w) => !STOP.has(w) && !ASKS_CURRENT.test(w) && !IS_CREDENTIAL.test(w) && !GENERIC.has(w));
  const names = (name: string) => { const n = name.toLowerCase(); return subject.length > 0 && subject.filter((w) => n.includes(w.slice(0, 5))).length / subject.length >= 0.6; };
  const held = (ctx.candidate.education ?? []).find((e) => e.type === "certificate" && (designation?.test(e.degree) || names(e.degree)));
  if (!held) return null;
  const v = certificateValidity(held, ctx.asOf), what = held.degree.trim().slice(0, 120), said = v.evidence ? ` ("${v.evidence.slice(0, 60)}")` : "";
  if (v.state === "expired" && wantsCurrent) return { state: "contradicted", source: what, explanation: `The CV shows "${what}" as expired${said} at the assessment date. That is history: it does not meet a requirement for a current certificate. Ask whether it has been renewed.`, reason: "Expired according to the CV; a current one is required." };
  if (v.state === "expired") return { state: "partial", source: what, explanation: `The CV shows "${what}" as expired${said}. This requirement does not ask for it to be current, so it counts as past evidence for a recruiter to judge.`, reason: "Held in the past; expired according to the CV." };
  if (!wantsCurrent) return null;
  if (v.state === "current") return { state: "partial", source: what, explanation: `The CV states "${what}" is current${said}. This is the candidate's own statement: verify it with the issuer.`, reason: "Stated as current; verify it with the issuer." };
  return { state: "partial", source: what, explanation: `The CV lists "${what}" but does not say whether it is still valid. Confirm this with the candidate: the CV is silent, which is not proof either way.`, reason: "Listed, but the CV does not say whether it is still valid." };
}

function buildCtx(candidate: Candidate, sourceText: string, asOf: Date): Ctx {
  // Years are credited only from roles the reading stands behind. A role in question earns nothing until a person settles it, and the assessment says so: see assessmentOf.
  const settledRoles = candidate.workHistory.filter((w) => w.status !== "uncertain" && w.status !== "conflicting");
  // Described use: what the person did in roles and projects. A profile summary is self-description ("experienced Kubernetes engineer"), so a skill named
  // only there counts as named, not as described use: otherwise a summary could claim full credit for anything (rules 2.1.0).
  const experienceText = [
    candidate.role,
    ...candidate.workHistory.flatMap((w) => [w.position, w.company, ...w.responsibilities]),
    ...(candidate.projects ?? []), ...(candidate.worthNoting ?? []),
  ].filter(Boolean).join("\n");
  const selfText = candidate.summary ?? "";
  // One sentence at a time: a paragraph of a long CV is about many things, and "not done" in one sentence says nothing of the next.
  const describedLines = [...candidate.workHistory.flatMap((w) => w.responsibilities), ...(candidate.projects ?? []), ...(candidate.worthNoting ?? [])].flatMap((l) => sentencesOf(l ?? "")).filter((l) => l && !saysNotDone(l));
  const titleLines = [candidate.role, ...candidate.workHistory.map((w) => w.position)].filter(Boolean);
  return {
    candidate, fromTitle: new Map(), experienceText, selfText, sourceText, namedText: sourceText.split("\n").filter((l) => !saysNotDone(l)).join("\n"), saidNotDone: [...candidate.workHistory.flatMap((w) => w.responsibilities), ...(candidate.projects ?? []), ...(candidate.worthNoting ?? []), ...sourceText.split("\n")].filter((l) => l && saysNotDone(l)), asOf, describedLines, titleLines, shortMentions: new Set<string>(), notHandsOn: new Set<string>(), impliedBy: new Map<string, string>(),
    // What the CV states about registrations, certificates and languages. These are claims, so they only ever earn "partial".
    credentials: [...(candidate.certifications ?? []), ...(candidate.languages ?? []), ...(candidate.education ?? []).map((e) => `${e.degree} ${e.institution}`)].filter((x) => x.trim()),
    years: yearsCovered(settledRoles, asOf),
    relevant: (job, requirement) => {
      // A role counts when enough of the requirement's own subject words appear in it, or it uses a skill the requirement itself names.
      // The requirement's own subject decides; the job title is only a fallback when the requirement has none. A head of technology does not
      // count as "cloud operations" because the word "operations" appears once: at least half of the subject words must (scoring.relevance).
      // "data analysis or reporting" names two subjects, either of which will do: each is judged on its own words.
      const subject = requirement.replace(/^.*?\byears?\b(?:\s+of)?\s*/i, ""), choices = subject.split(/\s+or\s+/i).map(subjectOf).filter((c) => c.length);
      const own = subjectOf(requirement);
      const stems = own.length ? own : subjectOf(job.title), alternatives = choices.length > 1 ? choices : [stems];
      const ownTerms = findSkills(requirement).map((sk) => sk.name);
      // A hyphenated subject is one thing: "software-development" needs both words, or "developed an intern programme" would count. Lines about leading others do not count as doing the work.
      const compounds = (requirement.toLowerCase().match(/[a-z]{4,}-[a-z]{4,}/g) ?? []).map((c) => c.split("-").map((w) => w.slice(0, 5)));
      const roles = settledRoles.filter((w) => {
        const t = withAliases(`${w.position} ${w.responsibilities.filter(handsOn).join(" ")}`).toLowerCase();
        const title = w.position.toLowerCase();
        // A hyphenated subject has its own test, and it decides: both words in the work, or either in the title ("Developer" for "software-development").
        if (compounds.length) return compounds.some((c) => c.every((st) => t.includes(st)) || c.some((st) => title.includes(st))) || findSkills(t).some((sk) => ownTerms.includes(sk.name));
        // "Software" is the field its tools belong to: a developer whose work names two technical tools is doing software, whether or not the word is printed. A named field ("frontend") stays as particular as it was.
        const inField = (st: string) => R.scoring.relevance.fieldOfTechnicalSkills.includes(st) && findSkills(t).filter((sk) => isTechnicalSkill(sk.name)).length >= 2;
        // Two words name one thing: "intensive care" is not "primary health care", and "frontend development" is not Java development. Only a longer subject can be half met.
        const met = (st: string[]) => { const share = st.length ? st.filter((x) => t.includes(x) || inField(x)).length / st.length : 0; return share >= (st.length <= 2 ? 1 : R.scoring.relevance.minSubjectShare); };
        return alternatives.some(met) || findSkills(t).some((sk) => ownTerms.includes(sk.name));
      });
      return { years: yearsCovered(roles, asOf), undated: roles.filter((w) => !String(w.startDate ?? "").trim()).length, lastYear: lastYearOf(roles, asOf), roles: roles.map((w) => [w.position, w.company].filter(Boolean).join(", ")) };
    },
  };
}

/** "Bash or Python" is one group of alternatives; "Docker and Terraform" is two groups; "Java, Python or Go" is one group. Anything unclear stays separate (stricter). */
export function skillGroups(text: string): SkillDef[][] {
  // A name inside a longer one is the longer one: "risk assessment" is not also "assessment".
  const all = skillMatches(text), hits = all.filter((h) => !all.some((o) => o !== h && o.index <= h.index && o.end >= h.end && o.end - o.index > h.end - h.index));
  const groups: SkillDef[][] = [];
  let run: typeof hits = [], connectors: string[] = [];
  const flush = () => {
    if (!run.length) return;
    const hasOr = connectors.some((c) => c === "or" || c === "and/or"), hasAnd = connectors.some((c) => c === "and" || c === "&" || c === "/" || c === "plus");
    if (run.length > 1 && hasOr && !hasAnd) groups.push(run.map((h) => h.skill)); else run.forEach((h) => groups.push([h.skill]));
    run = []; connectors = [];
  };
  for (const h of hits) {
    if (run.length) {
      const gap = text.slice(run[run.length - 1].end, h.index), m = gap.match(/^[\s,;]*(and\/or|or|and|&|\/|plus)?[\s,;]*$/i);
      if (m) connectors.push((m[1] ?? "").toLowerCase()); else flush();
    }
    run.push(h);
  }
  flush();
  return groups;
}

const RE = R.evidence, wordsIn = (xs: string[]) => new RegExp(`\\b(?:${xs.join("|")})\\b`, "i");
const OVERSIGHT_OPENING = new RegExp(`^[^\\p{L}]*(?:${RE.oversight.openings.join("|")})\\b`, "iu"), OVERSIGHT_ABOUT = wordsIn(RE.oversight.about), HEDGE = wordsIn(RE.hedges);
/** Whether a line shows someone doing the work: not leading those who do, and not only saying they are familiar with it. */
const NOT_DONE = wordsIn(RE.notDone), SOMEONE_ELSE = new RegExp(RE.someoneElse.join("|"), "i");
/** The line itself says the person did not do this: they have not, they would like to, or the clause is about someone else. */
const saysNotDone = (line: string) => NOT_DONE.test(line) || SOMEONE_ELSE.test(line);
const handsOn = (line: string) => !HEDGE.test(line) && !saysNotDone(line) && !(OVERSIGHT_OPENING.test(line) && OVERSIGHT_ABOUT.test(line.split(/\s+/).slice(0, RE.oversight.withinWords).join(" ")));
/** All of a skill's words, by their stems, in one line that says something: the document's own wording for the same thing. */
/** "Reconciled the accounts" for "Account reconciliation". Each word of the skill's name begins a word here, near enough to be about one thing: "static" is not "statistics", and "managed ... performance" is not performance management. */
const stemOf = (w: string) => w.slice(0, Math.max(RE.stems.length, Math.ceil(w.length * RE.stems.share)));
const describedInOwnWords = (line: string, t: SkillDef) => {
  const words = t.name.toLowerCase().split(/[\s/-]+/).filter(Boolean), lineWords = line.toLowerCase().match(/[\p{L}][\p{L}'-]+/gu) ?? [];
  if (!words.length || lineWords.length < RE.stems.minLineWords) return false;
  const at = words.map((w) => lineWords.flatMap((l, i) => (w.length < 3 ? l === w : l.startsWith(stemOf(w))) ? [i] : []));
  if (at.some((x) => !x.length)) return false;
  if (words.length === 1) return words[0] === t.name.toLowerCase() && lineWords.some((l) => l.startsWith(stemOf(words[0])) && l.length >= words[0].length - 3);
  return at[0].some((i) => at.every((x) => x.some((k) => Math.abs(k - i) <= R.evidence.ownWordsWithin)));
};


const stateCredit = (state: EvidenceState): Triple => state === "verified" ? { low: 1, exp: 1, high: 1 } : state === "partial" ? levelCredit("listed", P) : state === "contradicted" ? { low: 0, exp: 0, high: 0 } : levelCredit("absent", P);
const meanOf = (ts: Triple[]): Triple => ({ low: ts.reduce((a, t) => a + t.low, 0) / ts.length, exp: ts.reduce((a, t) => a + t.exp, 0) / ts.length, high: ts.reduce((a, t) => a + t.high, 0) / ts.length });
const stateOf = (c: Triple): EvidenceState => (c.low >= 1 - 1e-9 ? "verified" : c.low > 0 ? "partial" : "not_demonstrated");

// Words that say nothing about WHAT was done: empty verbs and small words. "Did SEO." and "Worked on Python." are made only of these and skill names.
const EMPTY = new Set(["did", "do", "does", "done", "doing", "use", "used", "uses", "using", "work", "worked", "works", "working", "know", "knew", "known", "knowledge", "familiar", "familiarity", "exposure", "exposed", "experience", "experienced", "skill", "skills", "basic", "basics", "good", "some", "various", "stuff", "things", "thing", "help", "helped", "helping", "assist", "assisted", "assisting", "involved", "responsible", "handled", "dealt", "with", "on", "in", "of", "and", "the", "a", "an", "to", "for", "as", "at", "by", "from", "my", "our", "etc", "also", "other", "all", "any", "was", "were", "had", "have", "has", "been", "be", "is", "are", "this", "that", "it", "i", "we", "me", "us"]);
/**
 * A line DESCRIBES use of a skill only when, after taking out every skill name, empty verbs and small words, at least `describedLineMinContentWords`
 * words remain to say what was done ("Wrote Python automation": wrote, automation). A bare line ("Did SEO.", "Used Python.", "Did Google Ads and Meta
 * Ads.") only names the skill. Rules 2.2.0: on the long-CV test set a buzzword CV made of such lines outscored a chartered accountant.
 */
function describes(line: string, t: SkillDef): boolean {
  if (!textMentions(line, t)) return false;
  let rest = line;
  for (const h of [...skillMatches(line)].sort((a, b) => b.index - a.index)) rest = rest.slice(0, h.index) + " " + rest.slice(h.end);
  const content = (rest.toLowerCase().match(/[\p{L}][\p{L}'-]{2,}|\d+/gu) ?? []).filter((w) => !EMPTY.has(w));
  return content.length >= R.evidence.describedLineMinContentWords;
}

const wordAt = (stem: string) => new RegExp(`\\b${stem}`, "i");
/** What a requirement says beyond the broad skill named in it: "patient" in "Patient assessment". Those words are what it is really about. */
function qualifiersOf(text: string): string[] {
  let rest = text;
  for (const h of [...skillMatches(text)].sort((a, b) => b.index - a.index)) rest = rest.slice(0, h.index) + " " + rest.slice(h.end);
  return [...new Set((rest.match(/[A-Za-z][A-Za-z-]{2,}/g) ?? []).map((w) => w.toLowerCase()).filter((w) => !STOP.has(w) && !GENERIC.has(w) && !SHARED.has(w.slice(0, 5)) && !ASKS_WORDS.has(w)).map((w) => w.slice(0, 5)))];
}
const ASKS_WORDS = new Set(["demonstrated", "practical", "exposure", "experience", "hands-on", "understanding", "familiarity", "using", "ability", "able", "good", "sound", "solid", "required", "essential", "desirable", "preferred", "advantage", "advantageous"]);
/** The evidence narrowed to sentences that are about the requirement's own subject. With thousands of words in a long CV, a general word appears somewhere whatever the person did. */
function aboutOnly(ctx: Ctx, stems: string[]): Ctx {
  const on = (x: string) => stems.some((st) => wordAt(st).test(x)), keep = (xs: string[]) => xs.flatMap(sentencesOf).filter(on), text = (x: string) => keep([x]).join("\n");
  return { ...ctx, describedLines: keep(ctx.describedLines), titleLines: ctx.titleLines.filter(on), credentials: ctx.credentials.filter(on), selfText: text(ctx.selfText), experienceText: text(ctx.experienceText), sourceText: text(ctx.sourceText), namedText: text(ctx.namedText), candidate: { ...ctx.candidate, skills: ctx.candidate.skills.filter(on) } };
}
/** The sentence that earned the credit: a long CV's paragraph says many other things. */
const sentenceFor = (line: string | undefined, t: SkillDef) => { if (!line) return undefined; const all = sentencesOf(line); return (all.find((x) => textMentions(x, t)) ?? all.find((x) => describedInOwnWords(x, t)) ?? all[0] ?? line).slice(0, 240); };

function levelOf(t: SkillDef, ctx: Ctx): Level {
  const skillNames = ctx.candidate.skills.map((x) => x.toLowerCase());
  const shown = isTechnicalSkill(t.name) ? ctx.describedLines.filter(handsOn) : ctx.describedLines;
  // a technology goes by its exact name ("Java" is not "JavaScript"); a broad ability is written many ways
  const several = t.name.trim().includes(" ");
  if (shown.some((l) => describes(l, t) || (several && !isTechnicalSkill(t.name) && describedInOwnWords(l, t)))) return "direct"; // described work
  // One word like the skill's name, in a sentence about something else or about it: "additional budget", "managed the budget". Only a person or the model can tell which, so it is named, not shown.
  if (!several && !isTechnicalSkill(t.name) && shown.some((l) => describedInOwnWords(l, t))) { ctx.shortMentions.add(t.name); return "listed"; }
  // A role named after it: relevant, so it earns credit, and being a title rather than described work, as named (the owner, R110). Only ever a title naming what this requirement asks for: a Java engineer's title says nothing towards HR.
  const title = ctx.titleLines.find((l) => textMentions(l, t));
  if (title) { ctx.fromTitle.set(t.name, title); return "listed"; }
  if (ctx.describedLines.some((l) => describes(l, t))) { ctx.shortMentions.add(t.name); ctx.notHandsOn.add(t.name); return "listed"; }   // only in a line about leading others, or one that claims familiarity
  if (ctx.describedLines.some((l) => textMentions(l, t))) { ctx.shortMentions.add(t.name); return "listed"; }       // only a bare line names it
  // Named without described use: a skills list, the summary, a certificate or qualification title, or anywhere in the original text.
  if (skillNames.includes(t.name.toLowerCase()) || ctx.candidate.skills.some((x) => textMentions(x, t)) || textMentions(ctx.selfText, t) || ctx.credentials.some((c) => textMentions(c, t)) || textMentions(ctx.namedText, t)) return "listed";
  // not named, but what it is built on is shown
  const via = Object.entries(R.implications).find(([from, to]) => to.includes(t.name) && (SKILL_BY_NAME.get(from) ? levelOf(SKILL_BY_NAME.get(from)!, ctx) !== "absent" : false))?.[0];
  if (via) { ctx.impliedBy.set(t.name, via); return "listed"; }
  return "absent";
}
const SKILL_BY_NAME = new Map(SKILLS.map((s) => [s.name, s]));
/** The sentence in which the person says they have none of this skill, or undefined. The skill must follow the statement, in the same clause. */
const statesNoneOf = (t: SkillDef, ctx: Ctx) => sentencesOf(ctx.sourceText).find((l) => {
  const low = l.toLowerCase();
  // About the person, now: the sentence opens with the statement or with "I have". "The team had no experience", "I had no experience when I joined" and "no experience is required" are not this.
  if (/\b(?:required|necessary|needed)\b/.test(low)) return false;
  return R.evidence.statesNone.some((phrase) => { const at = low.indexOf(phrase); if (at < 0 || !R.evidence.statesNoneOpens.includes(low.slice(0, at).replace(/[^a-z' ]/g, "").trim())) return false;
    const ends = R.evidence.statesNoneEnds.map((e) => low.indexOf(e, at)).filter((i) => i >= 0);
    return textMentions(l.slice(at, ends.length ? Math.min(...ends) : undefined), t); });
});

function evalGroups(groups: SkillDef[][], ctx: Ctx): { credits: Triple[]; explanation: string; reason: string; source?: string; statedNone?: boolean } {
  const direct: string[] = [], listed: string[] = [], none: string[] = [], dated: string[] = [], denied: { name: string; line: string }[] = [], statedNone: { name: string; line: string }[] = [];
  const credits: Triple[] = [];
  const nowYear = ctx.asOf.getUTCFullYear();
  let source: string | undefined;
  for (const g of groups) {
    const levels = g.map((t) => levelOf(t, ctx));
    const name = g.map((t) => t.name).join(" or ");
    // Only when no alternative in the group is shown in use, and the person says so of every one of them.
    const said = levels.includes("direct") ? [] : g.map((t) => statesNoneOf(t, ctx));
    if (said.length && said.every(Boolean)) { credits.push({ low: 0, exp: 0, high: 0 }); statedNone.push({ name, line: said[0]! }); continue; }
    credits.push(groupCredit(levels, P));
    const best: Level = levels.includes("direct") ? "direct" : levels.includes("listed") ? "listed" : "absent";
    const shown = g.length > 1 ? g.filter((_, i) => levels[i] === best).map((t) => t.name).join(" or ") : name;
    if (best === "direct") direct.push(shown); else if (best === "listed") listed.push(shown); else { const line = ctx.saidNotDone.find((l) => g.some((t) => textMentions(l, t))); if (line) denied.push({ name, line }); else none.push(g.length > 1 ? `${name} (any one would meet it)` : name); }
    if (best === "direct") { // recency is shown, not scored: whether it should weigh is for recruiter data to decide
      const last = lastYearOf(ctx.candidate.workHistory.filter((w) => g.some((t) => levels[g.indexOf(t)] === "direct" && textMentions(roleText(w), t))), ctx.asOf);
      if (last !== null && nowYear - last >= R.context.oldUseYears) dated.push(`${shown} in ${last}`);
    }
    if (!source && best !== "absent") {
      const t = g[levels.indexOf(best)], ownWords = ctx.describedLines.find((l) => describes(l, t) || (!isTechnicalSkill(t.name) && describedInOwnWords(l, t)));
      source = ctx.fromTitle.get(t.name) ?? sentenceFor(ownWords, t) ?? sentenceFor(quoteFor(ctx.experienceText, t), t) ?? sentenceFor(quoteFor(ctx.sourceText, t), t) ?? (ctx.impliedBy.get(t.name) ? `Implied by ${ctx.impliedBy.get(t.name)}` : undefined);
    }
  }
  const parts: string[] = [];
  if (direct.length) parts.push(`Used in described work: ${direct.join(", ")}.`);
  const titled = groups.flat().filter((t) => ctx.fromTitle.has(t.name)).map((t) => `${t.name} ("${ctx.fromTitle.get(t.name)}")`), listedPlain = listed.filter((n) => !groups.flat().some((t) => ctx.fromTitle.has(t.name) && n.includes(t.name)));
  if (titled.length) parts.push(`Named in a role title, which is relevant to this requirement, but no duties describe it: ${titled.join(", ")}. Ask the candidate what the role involved.`);
  if (listedPlain.length) parts.push(`Named but not described in use (skills list, summary, certificate, or a bare line that only names it): ${listedPlain.join(", ")}.`);
  const bare = groups.flat().filter((t) => ctx.shortMentions.has(t.name)).map((t) => t.name);
  const bareOnly = bare.filter((b) => !ctx.notHandsOn.has(b)), overseen = bare.filter((b) => ctx.notHandsOn.has(b)), implied = groups.flat().filter((t) => ctx.impliedBy.has(t.name)).map((t) => `${t.name} (from ${ctx.impliedBy.get(t.name)})`);
  if (bareOnly.length) parts.push(`A short line only names ${[...new Set(bareOnly)].join(", ")} without saying what was done, so it counts as named, not as described use.`);
  if (overseen.length) parts.push(`${[...new Set(overseen)].join(", ")} appears only in a line about leading others or claiming familiarity, so it counts as named, not as hands-on use.`);
  if (implied.length) parts.push(`Not named, but implied by what the CV shows: ${[...new Set(implied)].join(", ")}. Check this with the candidate.`);
  if (dated.length) parts.push(`Last shown in use: ${dated.join(", ")} (recency is shown, not scored).`);
  if (none.length) parts.push(`Not mentioned in the CV: ${none.join(", ")}. This is an evidence gap, not proof the candidate lacks it.`);
  for (const d of denied) parts.push(`${d.name} appears only in a line that does not show the candidate doing it: "${d.line.trim().slice(0, 120)}". Read the line and ask the candidate.`);
  for (const d of statedNone) { parts.push(`The CV says the person does not have ${d.name}: "${d.line.trim().slice(0, 160)}". Confirm this with the candidate.`); source ??= d.line.trim(); }
  const short: string[] = [];
  if (direct.length) short.push(`Used in described work: ${names(direct)}.`);
  if (listed.length) short.push(`Named without described use: ${names(listed)}.`);
  if (none.length) short.push(`Not found in the CV: ${names(none.map((x) => x.replace(/ \(any one would meet it\)$/, "")))}.`);
  if (denied.length) short.push(`${names(denied.map((d) => d.name))}: the CV's line does not show the candidate doing it.`);
  if (statedNone.length) short.push(`The CV says the person does not have ${names(statedNone.map((d) => d.name))}.`);
  return { credits, explanation: parts.join(" "), reason: fitReason(short), source, statedNone: statedNone.length === groups.length };
}

function evalYears(required: number, job: Job, ctx: Ctx, requirement: string): { credit: Triple; explanation: string; reason: string; source?: string } {
  const rel = ctx.relevant(job, requirement), source = rel.roles.length ? rel.roles.slice(0, 6).join("; ") : undefined;
  const credit = yearsCredit(rel.years, required, rel.undated);
  if (!ctx.years) return { credit, explanation: `${required}+ years required. No dated roles could be read from the CV, so duration is unknown.`, reason: "No dated roles could be read from the CV, so duration is unknown." };
  // No dated role could be tied to this requirement: say so, rather than "about 0 years", which reads as a finding that the candidate has none.
  if (!rel.years) return { credit, explanation: `${required}+ years required. Relevant experience could not be established from the CV: none of its dated roles (${ctx.years} year${ctx.years === 1 ? "" : "s"} overall) could be tied to this requirement${rel.undated ? `, and ${rel.undated} relevant role${rel.undated === 1 ? " has" : "s have"} no dates and could close the gap` : ""}. The CV may not show every year of experience.`, reason: "Relevant experience could not be established from the CV." };
  const note = `About ${rel.years} year${rel.years === 1 ? "" : "s"} of dated, relevant roles found (${ctx.years} overall). Dates are approximate${rel.undated ? `; ${rel.undated} relevant role${rel.undated === 1 ? " has" : "s have"} no dates and could close the gap` : " and undated roles are not counted"}.`;
  const old = rel.lastYear !== null && ctx.asOf.getUTCFullYear() - rel.lastYear >= R.context.oldUseYears ? ` The most recent relevant role ended in ${rel.lastYear} (recency is shown, not scored).` : "";
  return { credit, source, explanation: (rel.years >= required ? `${required}+ years required. ${note}` : `${required}+ years required. ${note} The CV may not show every year of experience.`) + old,
    reason: `About ${rel.years} year${rel.years === 1 ? "" : "s"} of relevant, dated roles shown (${required}+ required).` };
}

// a requirement about a qualification's LEVEL or FIELD (a degree, a diploma, matric), judged through the capability graph
const QUALIFICATION_WORDS = /\b(degree|diploma|bachelor'?s?|honou?rs|master'?s?|doctorate|ph\.?d|matric\w*|national senior certificate|higher certificate|b\.?sc|bcom|b\.com|b\.?eng|llb|b\.?tech|nqf|trade test)\b/i;

function evalRequirement(text: string, mandatory: boolean, job: Job, ctx: Ctx): MatchEvidence {
  const parts: Triple[] = [];
  const explanations: string[] = [];
  const reasons: string[] = [];   // one short reason per part, from the same finding as its explanation
  let source: string | undefined;
  let contradicted = false; // only an explicit statement in the CV sets this (a qualification stated as not completed); absence never does

  // "5+ years", "five years", "three or more years", "5-7 years" (the lower bound is what is required)
  const yearsMatch = text.match(/(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:[-–]\s*\d+\s*)?\+?\s*(?:or more\s*)?years/i);
  if (yearsMatch) {
    const n = NUMBER_WORDS[yearsMatch[1].toLowerCase()] ?? Number(yearsMatch[1]);
    const y = evalYears(n, job, ctx, text);
    parts.push(y.credit); explanations.push(y.explanation); reasons.push(y.reason); source = y.source;
  }
  // A qualification requirement ("A degree in Marketing or Communication") is judged through the capability graph (level, completion tells, what the
  // qualification teaches), never as a skill: "Communication" here names a field of study, not a soft skill (rules 2.2.0).
  const qualification = QUALIFICATION_WORDS.test(text) && !/\b(certif\w*|registration|registered|licen[cs]e)\b/i.test(text.replace(/national senior certificate|higher certificate|matric certificate|trade test certificate/gi, ""));
  if (qualification) {
    const need = readQualificationNeed(text), v = assessQualification(need, readQualifications(ctx.candidate.education ?? [], { text: ctx.sourceText, asOf: ctx.asOf }), job, ctx.fieldJudgements?.[label(text)]);
    const credit = need.equivalentAccepted ? { ...v.credit, high: 1 } : v.credit; // equivalent experience may still close it
    parts.push(credit); explanations.push([...v.lines, ...(v.checks.length ? [`To verify: ${v.checks.join(" ")}`] : [])].join(" ")); source = v.best?.degree;
    reasons.push(v.lines[0] ? firstSentence(v.lines[0]) : "The qualification could not be assessed from the CV.");
    contradicted = v.best?.completion.rung === "not_completed" && credit.high === 0;
  }
  const certificate = qualification ? null : judgeCertificate(text, ctx);
  if (certificate) { parts.push(stateCredit(certificate.state)); explanations.push(certificate.explanation); reasons.push(certificate.reason); source = certificate.source; contradicted = contradicted || certificate.state === "contradicted"; }
  const groups = qualification || certificate ? [] : skillGroups(text);
  if (groups.length) {
    // A broad skill in a requirement about something more particular is judged on what the CV says about that: an engineer's "assessment of the release process" says nothing of "Patient assessment". A named tool stays judged by its name.
    const particular = qualifiersOf(text), broad = groups.flat().every((x) => !isTechnicalSkill(x.name)), scoped = particular.length > 0 && broad;
    const t = evalGroups(groups, scoped ? aboutOnly(ctx, particular) : ctx);
    if (scoped && t.credits.every((c) => c.low === 0 && c.exp === stateCredit("not_demonstrated").exp)) {
      // Nothing found as skills; the CV's own words may still describe it ("IT security", "disaster recovery planning") (rules 2.11.0).
      const w = wordedEvidence(text, ctx);
      parts.push(w.credit); explanations.push(w.explanation); reasons.push(w.reason); if (w.source) source = w.source;
    } else { parts.push(...t.credits); explanations.push(t.explanation); reasons.push(t.reason); source = t.source; contradicted = contradicted || !!t.statedNone; }
  }
  // Any skill the CV itself lists counts, even if it is not in our taxonomy ("Negotiation", "CRM").
  const mentions = (sk: string, within: string) => new RegExp(`(?<![a-z0-9])${sk.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`, "i").test(within);
  const custom = parts.length ? [] : ctx.candidate.skills.filter((sk) => sk.length >= 3 && mentions(sk, text));
  if (custom.length) {
    const asDef = (sk: string): SkillDef => ({ name: sk, aliases: [sk] });
    const used = custom.filter((sk) => ctx.describedLines.some((l) => describes(l, asDef(sk)) || describedInOwnWords(l, asDef(sk))) || ctx.titleLines.some((l) => mentions(sk, l)));
    parts.push(...custom.map((sk) => levelCredit(used.includes(sk) ? "direct" : "listed", P)));
    explanations.push(`${used.length ? `Used in described work: ${used.join(", ")}. ` : ""}${custom.length > used.length ? `Listed in the CV's skills but no described use: ${custom.filter((c) => !used.includes(c)).join(", ")}.` : ""}`.trim());
    reasons.push(fitReason([used.length ? `Used in described work: ${names(used)}.` : "", custom.length > used.length ? `Listed in the CV's skills, no described use: ${names(custom.filter((c) => !used.includes(c)))}.` : ""]));
    source = custom[0];
  }
  // Professional designations a requirement can name exactly ("CA(SA)", "Pr.Eng", "PMP"): found anywhere the CV states them, as a claim (partial);
  // one stated as in progress or being studied does not meet it yet.
  if (!parts.length) {
    const d = DESIGNATIONS.find((re) => re.test(text));
    if (d) {
      const lines = [...ctx.credentials, ...ctx.experienceText.split("\n"), ...ctx.selfText.split("\n"), ...ctx.sourceText.split("\n")], line = lines.find((l) => d.test(l));
      if (!line) { parts.push(stateCredit("not_demonstrated")); explanations.push("The designation is not mentioned in the CV. This is an evidence gap, not proof the candidate does not hold it."); reasons.push("Not found in the CV."); }
      else if (/\b(in progress|studying|busy with|working towards|candidate|applied)\b/i.test(line)) { parts.push(stateCredit("not_demonstrated")); explanations.push(`The CV says "${line.trim().slice(0, 120)}": in progress, so not held yet. Ask for the expected date.`); reasons.push("In progress according to the CV, so not held yet."); source = line.trim().slice(0, 220); }
      else { parts.push(stateCredit("partial")); explanations.push(`The CV states "${line.trim().slice(0, 120)}". This is the candidate's own statement: verify it with the professional body.`); reasons.push("Stated in the CV; verify it with the professional body."); source = line.trim().slice(0, 220); }
    }
  }
  // Registrations and certificates: "Current BLS certification", "Registration with SANC". A stated credential is a claim, not proof.
  if (!parts.length) {
    const acronyms = [...new Set(text.match(/\b[A-Z][A-Z]{2,7}\b/g) ?? [])].filter((x) => !STOP.has(x.toLowerCase()));
    const found = acronyms.map((x) => ({ x, line: [...ctx.credentials, ...ctx.experienceText.split("\n")].find((c) => new RegExp("(?<![A-Za-z])" + x + "(?![A-Za-z])").test(c)) })).find((f) => f.line);
    if (found?.line) { parts.push(stateCredit("partial")); explanations.push("The CV mentions \"" + found.line.slice(0, 120) + "\". This is the candidate's own statement and has not been checked."); reasons.push("Stated in the CV; not checked."); source = found.line.slice(0, 220); }
  }
  // Spoken languages: "Fluent English and Afrikaans".
  if (!parts.length && /\b(fluent|fluency|proficien\w*|bilingual|speak\w*|languages?)\b/i.test(text)) {
    const named = ["english", "afrikaans", "zulu", "xhosa", "sotho", "tswana", "venda", "tsonga", "swati", "ndebele", "portuguese", "french", "german"].filter((l) => text.toLowerCase().includes(l));
    const spoken = named.filter((l) => (ctx.candidate.languages ?? []).some((c) => c.toLowerCase().includes(l)));
    if (named.length) {
      parts.push(stateCredit(spoken.length ? "partial" : "not_demonstrated"));
      explanations.push(spoken.length === named.length ? "The CV lists " + spoken.join(" and ") + ". Fluency is self-reported and has not been checked." : spoken.length ? "The CV lists " + spoken.join(", ") + " but not " + named.filter((l) => !spoken.includes(l)).join(", ") + "." : "No languages are listed in the CV. This is an evidence gap, not proof the candidate lacks them.");
      reasons.push(spoken.length === named.length ? "Listed in the CV; fluency is self-reported." : spoken.length ? `The CV lists ${spoken.join(", ")} but not ${named.filter((l) => !spoken.includes(l)).join(", ")}.` : "No languages are listed in the CV.");
      source = (ctx.candidate.languages ?? []).join(", ") || undefined;
    }
  }
  if (!parts.length) {
    const w = wordedEvidence(text, ctx);
    parts.push(w.credit); explanations.push(w.explanation); reasons.push(w.reason); if (w.source) source = w.source;
  }
  const credit = meanOf(parts);
  const possible = mandatory ? WEIGHT.mandatory : WEIGHT.preferred;
  // Coverage: the share of this requirement's parts the documents say anything about (described, listed or some relevant years), whatever the credit.
  const covered = parts.filter((p) => p.low > 0).length / parts.length;
  const flags = reviewRequirement(text, job.title);
  const dimension = yearsMatch ? "experience" as const : qualification || certificate ? "qualification" as const : "skills" as const;
  return { ...(yearsMatch ? { basis: "employment" as const } : {}), dimension, label: label(text), state: contradicted ? "contradicted" : stateOf(credit), credit, points: credit.exp * possible, possible, covered, explanation: explanations.join(" "), reason: fitReason(reasons), source, mandatory, ...(flags.length ? { reviewFlags: flags } : {}) };
}

// A requirement no specific check recognises, judged on the CV's own words (rules 2.11.0, 8 Nov 2026: a CV headed "Head of Centre of Excellence" met
// "Experience leading a technology centre of excellence, shared services hub or captive delivery centre" 0 times because every word had to stand in one sentence).
// "A, B or C" is a list of alternatives, any one enough; "A, B and C" a list of parts, each needed. A part is found when its own words stand together in one
// sentence. Found under a dated role (its title or what was done in it) is described work; found only in the summary or a credential is the person's claim.
// Words that name no thing of their own: an alternative made only of them ("ITIL 4 Foundation or higher", "TOGAF or another …") is not a second way to meet it.
const FILLER = new Set(["higher", "above", "equivalent", "similar", "another", "other", "equally", "comparable", "level", "record", "track", "sound", "practical", "interest", "modern", "such", "like", "including", "related", "exposure", "implementations", "implementation", "ability", "skills", "skill", "background", "understanding", "familiarity", "able", "capability", "capabilities"]);
function wordedEvidence(text: string, ctx: Ctx): { credit: Triple; explanation: string; reason: string; source?: string } {
  const subject = text.replace(/^(?:a |an )?(?:demonstrated |practical |proven |sound |hands-on |strong |solid )*(?:experience|exposure|knowledge|record|track record|understanding|background|interest)(?: (?:with|of|in|to))?\s*/i, "").replace(/[.\s]+$/, "");
  const keyWords = (s: string) => [...new Set((s.toLowerCase().match(/[a-z][a-z0-9+#]{2,}/g) ?? []).filter((x) => !STOP.has(x) && !GENERIC.has(x) && !FILLER.has(x)))];
  const isOr = /\b(?:or|and\/or)\b/i.test(subject);
  const pieces = subject.split(isOr ? /\s*(?:,\s*)?\b(?:and\/or|or)\b\s*|\s*,\s*/i : /\s*,\s*|\s+\band\b\s+/i).map((x) => x.trim()).filter((x) => keyWords(x).length);
  // A role's own line names its title and employer together: "Loan Platform Team Lead at Rand Merchant Bank" is evidence of banking.
  const roleLines = [...ctx.titleLines, ...ctx.candidate.workHistory.map((r) => `${r.position ?? ""} at ${r.company ?? ""}`), ...ctx.describedLines], claimLines = [...sentencesOf(ctx.selfText), ...ctx.credentials, ...ctx.candidate.skills];
  // Pieces are short, so their words need only share a sentence. A word matches its own forms ("leading", "lead", "led"), and leading matches heading a function.
  const root = (x: string) => x.replace(/(?:ments?|ings?|ers?|ed|es|s)$/, "") || x;
  const same = (want: string, got: string) => { const r = root(want); return r.length >= 3 ? root(got).startsWith(r) || got.startsWith(r) || got.startsWith(stemOf(want)) || root(want).startsWith(root(got)) && root(got).length >= 6 : got === want; };
  const LEADS = /^(?:lead|led|head|direct|manag|run|ran|oversaw|oversee)/;
  // The words must stand together, as the CV's own words for one thing ("reporting to the general manager" is not "management reporting"): every word
  // within a few words of the first. A piece of four or more words may lack one of them, and is then only partly met.
  const positions = (lw: string[], x: string) => lw.flatMap((y, n) => (same(x, y) || (/^lead/.test(x) && LEADS.test(y)) ? [n] : []));
  // Two words must be close ("management reporting"); a longer statement may spread a little more, two words per extra word.
  const near = (lw: string[], ws: string[]) => { const at = ws.map((x) => positions(lw, x)), reach = R.evidence.ownWordsWithin + 1 + 2 * Math.max(0, ws.length - 2); return at.every((x) => x.length) && at[0].some((n) => at.every((x) => x.some((k) => Math.abs(k - n) <= reach))); };
  const together = (l: string, ws: string[]): "all" | "most" | null => { const lw = l.toLowerCase().match(/[a-z0-9+#]+/g) ?? []; if (near(lw, ws)) return "all"; return ws.length >= 4 && ws.some((_, i) => near(lw, ws.filter((__, j) => j !== i))) ? "most" : null; };
  const find = (piece: string) => {
    const ws = keyWords(piece);
    for (const [where, lines] of [["role", roleLines], ["claim", claimLines]] as const) {
      const all = lines.find((l) => together(l, ws) === "all"); if (all) return { piece, where, line: all, whole: true };
    }
    for (const [where, lines] of [["role", roleLines], ["claim", claimLines]] as const) {
      const most = lines.find((l) => together(l, ws) === "most"); if (most) return { piece, where, line: most, whole: false };
    }
    return { piece, where: "none" as const, line: "", whole: false };
  };
  const found = (pieces.length ? pieces : [subject]).map(find), hits = found.filter((f) => f.where !== "none");
  const quote = (l: string) => `"${l.trim().slice(0, 140)}"`;
  if (!hits.length) return { credit: stateCredit("not_demonstrated"), explanation: `Not mentioned in the CV: ${subject}. This is an evidence gap, not proof the candidate lacks it.`, reason: `Not mentioned in the CV: ${subject}.` };
  if (isOr) {
    const best = hits.find((f) => f.where === "role" && f.whole) ?? hits.find((f) => f.where === "role") ?? hits[0];
    return best.where === "role" && best.whole
      ? { credit: levelCredit("direct", P), explanation: `The CV's described work covers "${best.piece}": ${quote(best.line)}.`, reason: `Described in the CV's work: ${best.piece}.`, source: best.line.trim().slice(0, 220) }
      : { credit: stateCredit("partial"), explanation: `The CV states it (${quote(best.line)}) but no dated role describes it.`, reason: `Stated in the CV, not described in a role: ${best.piece}.`, source: best.line.trim().slice(0, 220) };
  }
  const inRoles = found.filter((f) => f.where === "role"), missing = found.filter((f) => f.where === "none").map((f) => f.piece);
  const credit = inRoles.length === found.length && inRoles.every((f) => f.whole) ? levelCredit("direct", P) : stateCredit("partial");
  const parts = hits.map((f) => `${f.piece} (${f.where === "role" ? "described work" : "stated"})`).join("; ");
  return { credit, explanation: `Found in the CV: ${parts}.${missing.length ? ` Not mentioned: ${missing.join(", ")}; an evidence gap, not proof the candidate lacks it.` : ""}`, reason: missing.length ? `Partly shown: ${hits.map((f) => f.piece).join(", ")}; not mentioned: ${missing.join(", ")}.` : `Described in the CV: ${hits.map((f) => f.piece).join(", ")}.`, source: hits[0].line.trim().slice(0, 220) };
}

// Role fit (score v3, docs/assessment/SCORE_V3.md): what the candidate does and did, against what this job is. Half how close the titles of their dated roles are to the
// job's title (its own words; level and recency are context, never scored), half how much of the job's responsibilities their described work covers.
const LEVEL_WORDS = new Set(["head", "senior", "snr", "junior", "jnr", "lead", "principal", "chief", "assistant", "associate", "intermediate", "graduate", "trainee", "intern"]);
function roleFitOf(job: Job, ctx: Ctx): MatchEvidence {
  const words = (s: string) => [...new Set((s.toLowerCase().match(/[a-z][a-z0-9+#]{2,}/g) ?? []).filter((x) => !STOP.has(x) && !GENERIC.has(x) && !FILLER.has(x) && !LEVEL_WORDS.has(x)))];
  const jobWords = words(job.title);
  // Only titles of roles the reading stands behind: the CV's own headline is how the person describes themselves, not a job they held.
  const titles = ctx.candidate.workHistory.filter((w) => w.status !== "uncertain" && w.status !== "conflicting").map((w) => ({ t: String(w.position ?? "") })).filter((x) => x.t.trim());
  // Level and recency are shown as context, never scored (levelContext): the title's own words decide, the level words aside.
  const closeness = (t: string) => { if (!jobWords.length) return 0; const tw = words(t); return jobWords.filter((w) => tw.some((x) => x.startsWith(stemOf(w)) || w.startsWith(stemOf(x)))).length / jobWords.length; };
  const best = titles.map((x) => ({ ...x, c: closeness(x.t) })).sort((a, b) => b.c - a.c)[0];
  const duties = (job.responsibilities ?? []).filter((r) => r && r.trim()).slice(0, R.roleFit.maxResponsibilities);
  const met = duties.map((d) => ({ d, w: wordedEvidence(d, ctx) }));
  const dutyFit = met.length ? met.reduce((a, x) => a + x.w.credit.low, 0) / met.length : 0;
  const titleFit = best?.c ?? 0, fit = met.length ? R.roleFit.titleShare * titleFit + (1 - R.roleFit.titleShare) * dutyFit : titleFit;
  const credit: Triple = { low: fit, exp: fit, high: 1 };
  const covered = met.filter((x) => x.w.credit.low > 0);
  const titleLine = best && titleFit > 0 ? `Closest title: "${best.t}" (${Math.round(titleFit * 100)}% of the job title's own words).` : "No recent title shares the job title's own words.";
  const dutyLine = met.length ? ` Described work covers ${covered.length} of the job's ${met.length} responsibilities${covered.length ? `, for example: ${covered[0].d.slice(0, 90)}` : ""}.` : "";
  return { dimension: "role", label: "What they do and did, against this role", state: stateOf(credit), credit, points: credit.exp, possible: 1, covered: fit > 0 ? 1 : 0, mandatory: false,
    explanation: `${titleLine}${dutyLine}`, reason: `${titleLine}${dutyLine}`.trim(), source: best?.t };
}

/** A line as Claude judged it: its state and credit, its reason and the CV's own words; the rules' reading kept beside it for anyone checking. */
function withAi(e: MatchEvidence, j: AiJudgement): MatchEvidence {
  const credit: Triple = j.state === "verified" ? levelCredit("direct", P) : j.state === "partial" ? stateCredit("partial") : j.state === "contradicted" ? { low: 0, exp: 0, high: 0 } : stateCredit("not_demonstrated");
  const said = j.quotes.length ? ` The CV: "${j.quotes[0].slice(0, 160)}"` : "";
  return { ...e, state: j.state, credit, points: credit.exp * e.possible, covered: credit.low > 0 ? 1 : e.covered, judgedBy: "ai", ruleState: e.state,
    explanation: `${j.rationale}${said} (Judged by the AI against the CV's own words. The rules said: ${e.reason ?? e.state}.)`, reason: j.rationale, source: j.quotes[0]?.slice(0, 220) ?? e.source };
}

// The level a job title implies. Shown beside the result, not scored: what "senior" means differs between organisations and roles, and a table for it is a
// decision to be made with recruiter data (points catalogue E07), not assumed here.
const TITLE_LEVELS: [RegExp, string][] = [
  [/\b(head of|director|chief|vice president|vp|cto|cio|cfo|ceo|coo|general manager|manager)\b/i, "management"],
  [/\b(principal|staff|lead|architect)\b/i, "lead"],
  [/\b(senior|snr|sr)\b/i, "senior"],
  [/\b(intermediate|mid[- ]level)\b/i, "intermediate"],
  [/\b(junior|jnr|graduate|entry[- ]level|intern|trainee|learnership)\b/i, "entry-level"],
];

function levelContext(job: Job, ctx: Ctx): string[] {
  const level = TITLE_LEVELS.find(([re]) => re.test(job.title))?.[1];
  if (!level) return [];
  const rel = ctx.relevant(job, job.title);
  const latest = [...ctx.candidate.workHistory].sort((a, b) => (toMonth(String(b.endDate ?? ""), ctx.asOf) ?? -1) - (toMonth(String(a.endDate ?? ""), ctx.asOf) ?? -1))[0];
  return [`The job title suggests a${level === "entry-level" || level === "intermediate" ? "n" : ""} ${level} role. Level is not part of the score: the CV shows about ${rel.years} year${rel.years === 1 ? "" : "s"} in roles related to "${job.title}"${latest?.position ? `, most recently "${latest.position}"` : ""}. Judge the level from the evidence.`];
}

/**
 * What a requirement asks for, independent of its wording: its groups of skills (alternatives sorted) and its years figure. Two requirements with the same
 * signature ask for the same thing. "Docker" and "Docker experience required" are one demand, however many times a job description repeats it.
 */
export function requirementSignature(text: string): string {
  const groups = skillGroups(text).map((g) => g.map((t) => t.name).sort().join("|")).sort();
  const years = text.match(/(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:[-–]\s*\d+\s*)?\+?\s*(?:or more\s*)?years/i);
  const n = years ? NUMBER_WORDS[years[1].toLowerCase()] ?? Number(years[1]) : 0;
  return groups.length || n ? `${groups.join(",")};y${n}` : "";
}

const band = (s: number) => R.bands.find((b) => s >= b.min)!.label;
const pct = (x: number) => Math.round(x * 100);

/** Can a percentage honestly be given? Only the job can say whether what could not be read matters: uncertain work history is no obstacle to a job that does not count on it, or that it already meets. A person is never ranked low because their CV could not be read. */
function assessmentOf(candidate: Candidate, evidence: MatchEvidence[]): AssessmentState {
  const employment = candidate.reading?.employment;
  if (!employment || employment.state === "supported" || employment.state === "not evidenced") return { state: "complete", reasons: [], affected: [] };
  const affected = evidence.filter((e) => e.basis === "employment" && !e.duplicateOf && e.state !== "verified" && (e.mandatory || (e.share ?? 0) >= R.assessment.materialShare));
  return affected.length ? { state: "incomplete", reasons: employment.reasons, affected: affected.map((e) => e.label) } : { state: "complete", reasons: [], affected: [] };
}
function contractOf(e: MatchEvidence, uncertain: boolean): EvidenceContract {
  return { requirement: e.label, requirementSource: e.mandatory ? "mandatory" : "preferred", candidateEvidence: e.source ?? null, support: e.state === "verified" ? "direct" : e.state === "partial" ? "listed" : "none", transferable: "not assessed", progression: "not assessed", missingEvidence: e.state === "verified" || e.state === "not_applicable" ? null : (e.reason ?? e.explanation), extractionUncertain: uncertain && e.basis === "employment", contradiction: e.state === "contradicted" ? e.explanation : null };
}

/**
 * Assess one candidate against one job. A pure function of its inputs: the same candidate record, job record, CV text and reference date always give the
 * same result, whichever direction the comparison was started from and however many other candidates or jobs are in the list (nothing is relative to a pool).
 * `asOf` is the reference date for "Present" in a CV; it is recorded in the result so the calculation can be repeated exactly.
 */
export function assess(candidate: Candidate, job: Job, sourceText = "", asOf: Date = new Date(), fieldJudgements?: Record<string, FieldJudgements>, aiJudgements?: AiJudgements): MatchResult {
  const ctx = buildCtx(candidate, sourceText, asOf);
  ctx.fieldJudgements = fieldJudgements;
  // A job's own wording decides what a line is: "preferred" is not mandatory wherever it sits, and "will also be considered" is not a requirement at all.
  const SOFTER = wordsIn(R.requirements.softer), NOT_ONE = wordsIn(R.requirements.notARequirement);
  const judged = (r: string, mandatory: boolean): MatchEvidence => { if (NOT_ONE.test(r)) return { label: label(r), state: "not_applicable", points: 0, possible: 0, explanation: "This says what else will be accepted; it is not a requirement, so it is shown and not scored.", reason: "Not a requirement.", mandatory: false } as MatchEvidence; const asWritten = evalRequirement(r, mandatory, job, ctx); return asWritten.reviewFlags?.length || !SOFTER.test(r) ? asWritten : evalRequirement(r, false, job, ctx); };   // a line flagged for its wording is assessed exactly as written
  const evidence: MatchEvidence[] = [
    ...job.requirements.map((r) => judged(r, true)),
    ...(job.preferredRequirements ?? []).map((r) => judged(r, false)),
  ];
  // Logistics (place, on-site or hybrid) is a separate answer, never part of the alignment percentage: see logistics.ts.
  const logistics = assessLogistics(job, candidate, sourceText);

  // Never count the same demand twice: a requirement that repeats an earlier one (mandatory ones come first, so a repeat can never outrank the original)
  // is shown but carries no weight of its own.
  const texts = [...job.requirements, ...(job.preferredRequirements ?? [])], seen = new Map<string, string>();
  texts.forEach((t, i) => {
    const sig = requirementSignature(t);
    if (!sig) return;
    const first = seen.get(sig);
    if (first === undefined) { seen.set(sig, evidence[i].label); return; }
    // the fuller wording of the same demand is the one judged: "Five or more years" says less than "five years of software-development experience"
    const earlierAt = texts.findIndex((x) => requirementSignature(x) === sig);
    if (stemsOf(texts[earlierAt]).length === 0 && stemsOf(t).length > 0 && evidence[earlierAt].mandatory === evidence[i].mandatory) { const short = evidence[earlierAt]; evidence[earlierAt] = { ...short, possible: 0, points: 0, duplicateOf: evidence[i].label, explanation: `Counted once: "${evidence[i].label}" says the same with more detail.` , reason: "Counted once." }; seen.set(sig, evidence[i].label); return; }
    evidence[i] = { ...evidence[i], possible: 0, points: 0, duplicateOf: first, explanation: `Counted once: this repeats an earlier requirement ("${first}"). ${evidence[i].explanation}`, reason: fitReason(["Counted once: repeats an earlier requirement.", evidence[i].reason ?? ""]) };
  });

  // Score v3: what they do and did, against what this job is, is a part of its own (docs/assessment/SCORE_V3.md).
  if (evidence.some((e) => e.state !== "not_applicable")) evidence.push(roleFitOf(job, ctx));   // last, so each requirement keeps its place in the list
  // Claude's judgements (aiMatch.ts), each already checked against the CV's passages, replace the rules' state and credit for the lines it judged.
  if (aiJudgements) for (const [i, e] of evidence.entries()) { const j = aiJudgements[e.dimension === "role" ? ROLE_KEY : e.label]; if (j && e.state !== "not_applicable" && e.dimension !== "experience") evidence[i] = withAi(e, j); }
  const assessable = evidence.filter((e) => e.state !== "not_applicable");
  // Each part of the job is one weighted mean of its own lines; the score is the weighted mean of the parts present (a part the job does not ask about
  // passes its share on). Three views as before (see scoring.ts): what the documents prove, the expected value, and the most it could be.
  const DIMS = Object.keys(R.dimensions) as (keyof typeof R.dimensions)[];
  const partsPresent = DIMS.map((d) => ({ d, lines: assessable.filter((e) => (e.dimension ?? "skills") === d && e.possible > 0) })).filter((x) => x.lines.length);
  const shareSum = partsPresent.reduce((a, x) => a + R.dimensions[x.d], 0);
  const partOf = new Map(partsPresent.map((x) => [x.d, { share: R.dimensions[x.d] / shareSum, agg: aggregate(x.lines.map((e) => ({ weight: e.possible, credit: e.credit! })), R.scoring.aggregation.p), weight: x.lines.reduce((a, e) => a + e.possible, 0) }]));
  const total = partsPresent.length ? (["low", "exp", "high"] as const).reduce((t, k) => ({ ...t, [k]: partsPresent.reduce((a, x) => a + partOf.get(x.d)!.share * partOf.get(x.d)!.agg[k], 0) }), {} as Triple)
    : aggregate([], R.scoring.aggregation.p);
  let score = pct(total.exp), scoreFloor = pct(total.low), scoreCeiling = pct(total.high);
  // Points: each requirement's weight as a share of 100, so a requirement's proved points are exactly its contribution to the proved score.
  // A line's share of 100 is its part's share times its weight within the part, so its proved points are exactly its contribution to the proved score.
  const shareOf = (e: MatchEvidence) => { const p = partOf.get(e.dimension ?? "skills"); return p && p.weight > 0 && e.state !== "not_applicable" ? (e.possible / p.weight) * p.share * 100 : 0; };
  for (const e of evidence) { const share = shareOf(e); e.share = share; e.pointsProved = (e.credit?.low ?? 0) * share; }
  const coverage = pct(assessable.reduce((a, e) => a + (shareOf(e) / 100) * (e.covered ?? 0), 0));
  const flagged = evidence.filter((e) => e.reviewFlags?.length);
  const context = levelContext(job, ctx);

  const mandatory = evidence.filter((e) => e.mandatory && !e.duplicateOf);
  const contradictedMandatory = mandatory.filter((e) => e.state === "contradicted").length;
  const unresolvedMandatory = mandatory.filter((e) => e.state === "not_demonstrated" || e.state === "partial").length;
  if (contradictedMandatory) { // a failed mandatory requirement is not averaged away
    score = Math.min(score, R.contradictedMandatoryCap); scoreFloor = Math.min(scoreFloor, score); scoreCeiling = Math.min(scoreCeiling, R.contradictedMandatoryCap);
  }

  const extractionQ = ((candidate.extractionConfidence ?? R.confidence.defaultExtractionQuality) + (job.extractionConfidence ?? R.confidence.defaultExtractionQuality)) / 2;
  const approved = job.status === "open" ? 1 : 0;
  // A job whose requirements a recruiter has not approved may have been read wrongly, so every result against it is less firm.
  const conf = evidenceConfidence(total, extractionQ / R.confidence.extractionFull) * (approved ? 1 : R.confidence.unapprovedJobFactor);
  const confidenceScore = pct(conf);
  const confidence = conf >= R.confidence.thresholds.high ? "High" : conf >= R.confidence.thresholds.medium ? "Medium" : "Low";

  const reasons: string[] = [];
  reasons.push(`Document extraction quality: ${Math.round(extractionQ * 100)}%.`);
  reasons.push(`The documents prove ${scoreFloor}%, the expected fit is ${score}%, and it could reach ${scoreCeiling}% if every gap were confirmed as met. The narrower that range, the firmer the evidence.`);
  if (unresolvedMandatory) reasons.push(`${unresolvedMandatory} mandatory requirement${unresolvedMandatory > 1 ? "s are" : " is"} not fully evidenced.`);
  if (!approved) reasons.push("The job requirements have not been approved by a recruiter yet.");
  reasons.push(`The documents speak to ${coverage}% of what the job asks for (by weight). The rest is not mentioned, which is a gap in evidence, not a finding against the candidate.`);

  // Every warning keeps its words; its code says where it is shown. Consequential ones stay in view at a glance; the rest describe the method.
  const notices: Notice[] = [];
  const notice = (code: string, text: string, consequential = true) => notices.push({ code, text, consequential });
  if (!job.requirements.length && !(job.preferredRequirements ?? []).length) notice("no_requirements", "This job has no requirements recorded, so there is nothing to assess. Add requirements to the job first.");
  if (!approved) notice("job_unapproved", "This job is still a draft: a recruiter should approve its requirements before this result is relied on.");
  const extractionWarnings = [...(candidate.extraction?.warnings ?? []), ...(job.extraction?.warnings ?? [])].filter((w) => !/approved by a recruiter/.test(w));
  const builtIn = extractionWarnings.some((w) => w.startsWith("Read by the built-in")), aiRead = (candidate as any).aiReading?.state === "read";
  if (builtIn) notice("built_in_parser", aiRead ? "The CV was read by the AI with RoleMatch's parser, and the job by the parser. Check both against the original documents." : "The CV and job were read by RoleMatch's built-in parser (no AI service). It handles standard layouts; check both against the original documents.", false);
  for (const w of extractionWarnings.filter((w) => !w.startsWith("Read by the built-in") && !w.startsWith("Read by the AI"))) notice("extraction", w);
  if (flagged.length) notice("wording_flags", `${flagged.length} job requirement${flagged.length > 1 ? "s use" : " uses"} wording a recruiter should review (possible unfairness, unclear or excessive). It is still assessed as written; see the flags on each requirement.`);
  if (!sourceText) notice("no_source_text", "Original CV text was not available; only the structured record was assessed.");
  const warnings = notices.map((n) => n.text);

  const recommendation = contradictedMandatory ? "A mandatory requirement is contradicted by the evidence. Review before any progression."
    : unresolvedMandatory ? `Verify ${unresolvedMandatory} mandatory requirement${unresolvedMandatory > 1 ? "s" : ""} before progression.`
    : score >= R.recommendation.proceedMinScore && confidence !== "Low" ? "Proceed to human review." : score >= R.recommendation.reviewMinScore ? "Review the gaps and confirm unknowns." : "Additional evidence is needed before progression.";
  const logisticsNote = logistics.status === "conflict" ? " Logistics: the candidate's stated work arrangement conflicts with the job's; confirm with them before progression."
    : logistics.status === "to_confirm" ? ` Logistics: confirm the candidate can work ${logistics.arrangement === "not stated" ? "in" : `${logistics.arrangement} in`} ${job.location || "the job's location"}.` : "";

  const assessment = assessmentOf(candidate, evidence);
  const uncertain = candidate.reading?.employment.state === "uncertain" || candidate.reading?.employment.state === "conflicting";
  for (const e of evidence) e.contract = contractOf(e, uncertain);
  const jobTerms = new Set([...(job.skills ?? []), ...findSkills(job.requirements.join(" ")).map((x) => x.name)].map((x) => x.toLowerCase()));
  return {
    assessment, score, scoreFloor, scoreCeiling, band: assessment.state === "incomplete" ? "Assessment incomplete" : band(score), confidence, confidenceScore, confidenceReasons: reasons, evidence,
    matchingSkills: candidate.skills.filter((x) => jobTerms.has(x.toLowerCase())),
    locationMatch: logistics.required ? logistics.checks[0]?.status === "compatible" : null,
    context, coverage, logistics, referenceDate: asOf.toISOString().slice(0, 10), reviewRulesVersion: REVIEW_RULES_VERSION,
    experienceYears: ctx.years,   // worked out on the match's own date from the settled roles, never the whole-year figure stored when the CV was read
    recommendation: assessment.state === "incomplete" ? `Assessment incomplete: review the CV evidence for ${assessment.affected.join("; ")}.${logisticsNote}` : recommendation + logisticsNote,
    counts: {   // a requirement that repeats another is shown, and counted once
      verified: evidence.filter((e) => !e.duplicateOf && e.state === "verified").length,
      partial: evidence.filter((e) => !e.duplicateOf && e.state === "partial").length,
      notDemonstrated: evidence.filter((e) => !e.duplicateOf && e.state === "not_demonstrated").length,
      contradicted: evidence.filter((e) => !e.duplicateOf && e.state === "contradicted").length,
    },
    disclaimer: "This measures documented alignment with this job's requirements. It is a recommendation for human review, not a hiring decision, and it does not treat missing information as a failing.",
    warnings, notices, overview: overviewOf(evidence), engineVersion: `rules-${R.version}`, rulesVersion: R.version, rulesFingerprint: rulesetFingerprint, candidateVersion: candidate.version ?? 1, jobVersion: job.version ?? 1,
  };
}
