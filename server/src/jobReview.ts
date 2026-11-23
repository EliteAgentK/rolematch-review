// WORDING REVIEW OF JOB REQUIREMENTS. Before candidates are compared with a job, every requirement is read for wording that may be unfair or unclear, so a recruiter can confirm it is a genuine requirement of the job, reword it, or remove it.
//
// What this is: a fixed, versioned list of patterns with a plain reason for each. What it is not: a legal judgement. A flag means "a person should look at
// this", never "this is unlawful". Some flagged requirements are legitimate (a driver's licence for a delivery driver, a clean criminal record for a cash
// role, citizenship for a security clearance); the Employment Equity Act allows a distinction based on an inherent requirement of the job. The platform
// never removes, rewrites or down-weights a requirement on its own: it shows the flag, and the recruiter decides. Qualified legal review is still needed.
//
// Kinds:  fairness       may disadvantage people for a reason unrelated to the work (age, sex, family, health, language, religion, appearance)
//         justification  often legitimate, but only when the job genuinely needs it (licence, own car, record checks, citizenship)
//         unclear        cannot be assessed consistently from documents ("rockstar", "culture fit")

export const REVIEW_RULES_VERSION = "1.0.0";

type FlagKind = "fairness" | "justification" | "unclear";
export interface ReviewFlag { code: string; kind: FlagKind; matched: string; reason: string }

interface Rule { code: string; kind: FlagKind; pattern: RegExp; reason: string }

const RULES: Rule[] = [
  // Age, directly or through stand-ins for it.
  { code: "AGE", kind: "fairness", pattern: /\b(young(er)?|youthful|youth|energetic young|mature (?:person|candidate|lady|gentleman)|digital natives?|under (?:the age of )?\d{2}\b|over (?:the age of )?\d{2}\b|aged? (?:between )?\d{2}|\d{2}\s*(?:-|to)\s*\d{2} years old|years of age|age (?:limit|restriction|requirement)|not older than|maximum age)\b/i, reason: "Refers to age or a stand-in for it. Age is a ground on which unfair discrimination is prohibited; state the skill or experience needed instead." },
  { code: "AGE-GRAD", kind: "fairness", pattern: /\b(recent(?:ly)?\s+(?:[a-z]+\s+)?(?:graduated|graduates?|matriculants?|matriculated|qualified)|graduated (?:in|after|within) (?:the last|\d{4}))\b/i, reason: "Asks for a recent qualification, which tends to exclude older people. Ask for the qualification itself, or for current knowledge if that is what matters." },
  // Sex, gender, pregnancy, marital status, family responsibility.
  { code: "SEX", kind: "fairness", pattern: /\b(male|female|man|woman|men|women|gentleman|lady|ladies|salesman|saleslady|chairman|manpower|he or she|he\/she|s\/he)\b/i, reason: "Refers to sex or gender. Unless the job genuinely requires it, describe the work, not the person." },
  { code: "FAMILY", kind: "fairness", pattern: /\b(single|married|unmarried|no (?:children|kids|dependants|dependents)|without (?:children|family)|family (?:status|commitments)|pregnan\w*|maternity)\b/i, reason: "Refers to marital status, pregnancy or family responsibility. If the job needs travel or long hours, state that requirement instead." },
  // Health and disability.
  { code: "HEALTH", kind: "fairness", pattern: /\b(able[- ]bodied|no disabilit\w*|without disabilit\w*|good (?:physical )?health|healthy|physically fit|fit and healthy|hiv|medical history|no (?:chronic|medical) conditions?)\b/i, reason: "Refers to health, disability or HIV status. If the job has a genuine physical demand, state the task (for example lifting 20 kg) so reasonable accommodation can be considered." },
  // Language, origin, religion, culture.
  { code: "LANG", kind: "fairness", pattern: /\b(native (?:speaker|english|afrikaans|language)|mother[- ]tongue|first[- ]language|home language|accent|no accent)\b/i, reason: "Asks for a native or home language, which stands in for origin. Ask for the level of language ability the work needs." },
  { code: "ORIGIN", kind: "fairness", pattern: /\b(race|racial|colou?r(?:ed)?|ethnic\w*|tribe|tribal|nationality|born in|local (?:people|candidates) only|culture fit|cultural fit)\b/i, reason: "Refers to race, origin or 'culture fit'. Employment-equity targets are a separate, governed process and are never part of the alignment score." },
  { code: "RELIGION", kind: "fairness", pattern: /\b(christian|muslim|hindu|jewish|religio\w*|church(?:goer| member)|god[- ]fearing|believer)\b/i, reason: "Refers to religion or belief. State it only if the organisation's purpose genuinely requires it, and have it reviewed." },
  { code: "LOOKS", kind: "fairness", pattern: /\b(attractive|good[- ]looking|presentable|pleasant appearance|well[- ]groomed|neat appearance|slim|height|tall|photo(?:graph)?s? (?:required|attached|with (?:cv|application)))\b/i, reason: "Refers to appearance or asks for a photograph. Appearance is not evidence of ability; a photograph reveals protected traits and is never used by RoleMatch." },
  // Often legitimate, but only when the job genuinely needs it.
  { code: "LICENCE", kind: "justification", pattern: /\b(driver'?s licen[cs]e|drivers licen[cs]e|driving licen[cs]e|code (?:8|10|14|eb|c1|ec)|own (?:car|vehicle|transport)|reliable transport)\b/i, reason: "A licence or own transport excludes people who do not drive or own a car. Keep it only if driving is part of the work." },
  { code: "RECORD", kind: "justification", pattern: /\b(clean (?:criminal|credit) record|criminal record|credit record|credit check|no criminal|itc (?:check|clear)|blacklist\w*)\b/i, reason: "A record check must be relevant to the duties (for example handling cash or sensitive data) and handled with the person's consent." },
  { code: "CITIZEN", kind: "justification", pattern: /\b(south african citizen\w*|sa citizen\w*|citizenship|permanent residen\w*|valid (?:sa )?id(?: document)?|work permit)\b/i, reason: "Citizenship or residency limits who can apply. Keep it only where law, a clearance or a permit genuinely requires it." },
  // Cannot be assessed consistently from documents.
  { code: "VAGUE", kind: "unclear", pattern: /\b(rock ?star|ninja|guru|wizard|superstar|unicorn|work hard,? play hard|go[- ]getter|self[- ]starter|team player|hungry|passionate|dynamic|vibrant|bubbly|outgoing personality|sense of humou?r)\b/i, reason: "This cannot be judged consistently from a CV. Describe the behaviour or result you need (for example 'leads a weekly client meeting')." },
];


/** Flags for one requirement. RoleMatch never judges a figure a company asks for (owner, 10 Nov 2026); `title` is kept for callers. */
export function reviewRequirement(text: string, title = ""): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  for (const r of RULES) {
    const m = text.match(r.pattern);
    if (m) flags.push({ code: r.code, kind: r.kind, matched: m[0], reason: r.reason });
  }
  return flags;
}

/** Every flag across a job's requirements, by requirement text. */
export function reviewJob(job: { title: string; requirements: string[]; preferredRequirements?: string[] }): { requirement: string; flags: ReviewFlag[] }[] {
  return [...job.requirements, ...(job.preferredRequirements ?? [])]
    .map((requirement) => ({ requirement, flags: reviewRequirement(requirement, job.title) }))
    .filter((r) => r.flags.length);
}
