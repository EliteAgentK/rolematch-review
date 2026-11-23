// THE ROLEMATCH RULES. One frozen, versioned definition of how candidates are scored.
//
// - Recruiters and client administrators cannot change this: there is no screen, no API route and no setting for it.
// - Only RoleMatch developers change it, through a reviewed code change that also bumps `version`.
// - Every match result records `version` and a fingerprint of this file plus the skill dictionary,
//   so it can be proven later that every candidate was scored under identical rules.
import { createHash } from "node:crypto";
import { SKILLS } from "./skills";
import { AREAS, GRAPH_VERSION } from "./graph/knowledge";
import { NAMED } from "./graph/qualifications";
import { COMPLETION_CREDIT, QUALIFICATION_RULES_VERSION, UNJUDGED_FIELD } from "./graph/qualificationMatch";
import { DESIGNATIONS } from "./qualifications";

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === "object") { Object.values(o).forEach(deepFreeze); Object.freeze(o); }
  return o;
};

export const ruleset = deepFreeze({
  version: "3.0.0",

  // Score v3 (docs/assessment/SCORE_V3.md, owner 8 Nov 2026): the score is the weighted mean of the parts of the job, not of every requirement line.
  // A part the job does not ask about passes its share to the others in proportion. Location is not a part: logistics is shown beside the score.
  dimensions: { role: 0.35, experience: 0.2, skills: 0.3, qualification: 0.15 },
  roleFit: { titleShare: 0.5, maxResponsibilities: 12 },

  // How much each kind of requirement is worth. Location is not here: logistics (place, on-site, hybrid) is a separate answer shown beside the score,
  // never part of it (from 2.1.0; see logistics.ts).
  weights: { mandatory: 10, preferred: 4 },

  // THE SCORING MODEL (see docs/architecture/MATCHING_MODEL.md). Every number that shapes a score is here and nowhere else.
  scoring: {
    params: {
      direct: 1,          // credit when the document describes the skill being used
      listed: 0.8,        // credit when the document only names it (a skills list). 0.5 until 3.0.0; owner, 8 Nov 2026: one skill not shown in use should not knock a candidate down (docs/assessment/SCORE_V3.md)
      unknownPrior: 0,    // chance a person has a skill they did not write down. 0 until it can be calibrated on recruiter judgements: no invented numbers. Raise it only from data.
    },
    // A role counts towards "N years of X" only when at least this share of X's subject words appear in it. Below this, a role about something else
    // (a head of technology in a cloud-engineering requirement) is not counted.
    // sharedRoleWords: the first letters of words in job titles that appear across many unrelated professions, measured from the role families of the invented packs (scripts/deriveSharedRoleWords.ts): "Property Manager" says nothing about project management.
    // aliases: what people write for the same subject. The language model may propose more; a person approves them.
    relevance: { fieldOfTechnicalSkills: ["softw"], minSubjectShare: 0.5, sharedRoleWords: ["junio", "coord", "assis", "senio", "volun", "admin", "analy", "manag", "speci", "offic"], aliases: { hr: "human resources", it: "information technology", qa: "quality assurance", pm: "project management", ld: "learning and development" } },
    // How requirements combine. 1 is the ordinary weighted mean. Below 1, a weak requirement pulls the total down harder (balanced coverage beats lopsided).
    // Kept at 1 until recruiter data justifies another value; any value above 0 keeps every property proved in MATCHING_MODEL.md.
    aggregation: { p: 1 },
  },

  // What counts as DESCRIBED use of a skill: a line with at least this many words that say what was done, once skill names, empty verbs ("did", "used",
  // "worked on") and small words are taken out. "Wrote Python automation" describes use; "Did SEO." only names it. Rules 2.2.0.
  // A person leading a team that uses a technology has not been shown using it; "Managed Kubernetes clusters" is hands-on and "Managed the team running Kubernetes" is not. So a technical skill in a line that both opens with
  // one of `oversight.openings` and speaks of `oversight.about` in its first words counts as named only. So does a line that only claims `hedges`. Rules 2.3.0.
  evidence: {
    describedLineMinContentWords: 2,
    oversight: { openings: ["lead", "led", "leading", "leads", "oversaw", "oversee", "oversees", "overseeing", "manage", "manages", "managed", "managing", "head", "headed", "supervise", "supervised", "direct", "directed", "driving", "drove", "provide leadership", "provided leadership", "providing leadership", "responsible for"], about: ["team", "teams", "practice", "practices", "department", "departments", "staff", "centre", "center", "function", "functions", "vendors", "vendor", "leadership", "community", "offshore"], withinWords: 6 },
    hedges: ["familiar with", "exposure to", "exposed to", "basic knowledge", "some experience", "awareness of", "aware of", "interest in", "learning about"],
    // A line can name a skill and say the person did not do it: they never have, they would like to, or someone else did. Such a line names the skill at most. Rules 2.4.0.
    ownWordsWithin: 2,   // how many words apart the words of a skill's name may be for a sentence to be describing it in other words
    notDone: ["no hands-on experience", "no direct experience", "no practical experience", "not used", "not worked", "never used", "never worked", "have not", "has not", "had not", "did not", "haven't", "hasn't", "didn't", "no experience", "would like to", "want to learn", "wants to learn", "hope to", "hoping to", "plan to", "planning to", "aim to learn", "keen to learn", "looking to learn", "not yet"],
    // The person saying outright that they have none of it: what follows is contradicted, not merely unshown, unless the CV shows them doing it. Narrower than notDone on purpose: "did not" is about one occasion, these are about the person.
    statesNone: ["no hands-on experience", "no direct experience", "no practical experience", "no experience", "never used", "never worked with"],
    // What may come before it in the sentence: nothing, or the person speaking in the present.
    statesNoneOpens: ["", "i have", "i've", "ive", "i", "have", "i currently have", "currently"],
    // Where such a statement stops applying: "no experience with Terraform but used Kubernetes daily".
    statesNoneEnds: [" but ", " although ", " though ", " however ", ";"],
    // ", who built models in Python": the clause is about other people.
    someoneElse: [", who ", " who ", " whose "],
    // Described use in the document's own words: all of a skill's words, by their stems, in one line of work that says something. "Diary management" is described by "Managed executive diary and meeting arrangements".
    stems: { length: 5, minLineWords: 4, share: 0.6 },
  },

  // Using one thing shows knowledge of what it is built on. That earns the credit of a skill named without described use, never more, and the explanation says it was implied. Each entry is a fact about the technology.
  implications: {
    React: ["JavaScript"], "Next.js": ["React", "JavaScript"], TypeScript: ["JavaScript"], "Node.js": ["JavaScript"], Vue: ["JavaScript"], Angular: ["JavaScript", "TypeScript"], Svelte: ["JavaScript"],
    FastAPI: ["REST APIs", "Python"], Django: ["Python"], Flask: ["Python"], Express: ["Node.js", "REST APIs"], Supabase: ["PostgreSQL", "Cloud deployment"], Vercel: ["Cloud deployment"], AWS: ["Cloud deployment"], Azure: ["Cloud deployment"], "Google Cloud": ["Cloud deployment"], Kubernetes: ["Docker"], Flutter: ["Dart"],
  } as Record<string, string[]>,

  // A requirement asking for a certificate that still stands, and the words that say it is about a certificate at all. An expired certificate is history: it does not meet the first kind of requirement (owner, 2026-11-04). Rules 2.4.0.
  certificates: {
    asksCurrent: ["current", "currently", "valid", "active", "up to date", "up-to-date", "unexpired", "in date", "in-date", "in good standing"],
    isCredential: ["certif", "licence", "license", "registration", "registered", "accredit", "permit", "designation"],
  },

  // How a job's own wording changes what a line is. A line with `softer` is not mandatory, wherever it sits. A line with `notARequirement` says what else will be accepted, and is shown but not scored. Rules 2.3.0.
  requirements: {
    softer: ["not mandatory", "not essential", "not required", "preferred", "advantageous", "beneficial", "desirable", "nice to have", "an advantage", "would be an"],
    notARequirement: ["will be considered", "may be considered", "can be considered"],
  },

  // Context shown beside a result and never scored. A described skill whose last dated use is at least this many years before the reference date gets a
  // "last shown in use" note. Display only: whether recency should weigh is to be decided from recruiter data.
  context: { oldUseYears: 5 },

  // A mandatory requirement the evidence contradicts caps the score instead of being averaged away.
// Unreadable work history changes the answer when a requirement that counts on it is mandatory or carries at least this share of the weight, and is not already met.
  assessment: { materialShare: 10 },
    contradictedMandatoryCap: 40,

  // Score bands, highest first. Wording describes documented evidence, not the person.
  bands: [
    { min: 90, label: "Exceptional documented fit" },
    { min: 80, label: "Strong documented fit" },
    { min: 65, label: "Plausible fit with material gaps" },
    { min: 45, label: "Partial alignment" },
    { min: 0, label: "Limited documented evidence" },
  ],

  // Confidence measures the quality and completeness of the evidence, never the quality of the candidate: how tightly the evidence pins the score
  // down (one minus the width of the range between what is proved and what is possible) times how well the documents were read.
  confidence: {
    thresholds: { high: 0.75, medium: 0.5 },
    defaultExtractionQuality: 0.5,
    // The extraction quality a rule-based read can reach at best (its confidence is 0.2 + 0.4 x coverage, so 0.6 is a complete read). Quality is measured against this.
    extractionFull: 0.6,
    // Confidence is multiplied by this while the job's requirements are still a draft (not yet approved by a recruiter).
    unapprovedJobFactor: 0.85,
  },

  // Wording of the recommendation. It always points to human review; the platform never decides.
  recommendation: { proceedMinScore: 80, reviewMinScore: 65 },

  // Candidate ratings, age, gender and similar traits are never inputs. This list is checked by a test.
  neverUsedAsInputs: ["rating", "name", "email", "phone", "avatar", "age", "gender", "race", "religion", "nationality"],
});


/** A short fingerprint of every rule plus the skill dictionary. Changes if anything that affects a score changes. */
export function fingerprintOf(rules: unknown = ruleset): string {
  // the qualification rules and graph are part of what decides a score (rules 2.2.0), so they are part of the fingerprint too
  return createHash("sha256").update(JSON.stringify({ rules, skills: SKILLS, graph: { version: GRAPH_VERSION, areas: AREAS, qualifications: NAMED.map((q) => [q.id, q.match.source, q.profile]), completion: COMPLETION_CREDIT, unjudgedField: UNJUDGED_FIELD, qualificationRules: QUALIFICATION_RULES_VERSION, designations: DESIGNATIONS.map((d) => d.source) } })).digest("hex").slice(0, 12);
}
export const rulesetFingerprint = fingerprintOf();
