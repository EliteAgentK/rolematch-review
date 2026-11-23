// The arithmetic of a match, and nothing else. No text, no skills, no database: numbers in, numbers out, so every property below can be proved and tested.
//
// A job requirement is a list of GROUPS joined by AND. A group is a list of ALTERNATIVES joined by OR ("Bash or Python scripting" is one group of two).
// For each alternative the evidence is one of three levels:
//     direct  the document describes the skill being used in work or projects
//     listed  the document names the skill (a skills list) but describes no use
//     absent  the document does not mention it (this is NOT proof the person lacks it)
//
// Every quantity is reported three ways, because "unknown" is a fact about the document, not a zero:
//     low   the most the documents PROVE (absent counts as not met)
//     exp   the expected value (absent counts as a small prior chance the person has it but did not write it down)
//     high  the most it could be if every gap were confirmed as met
//
// Properties (proved in docs/architecture/MATCHING_MODEL.md, checked on random cases in test/scoring.test.ts):
//   P1 bounds        0 <= low <= exp <= high <= 1, for every group, requirement and for the whole match
//   P2 monotone      more evidence never lowers any of the three
//   P3 symmetric     the order of requirements, groups and alternatives does not change anything
//   P4 homogeneous   multiplying every weight by the same amount changes nothing (only relative weight matters)
//   P5 OR semantics  a group is as good as its best alternative; adding an alternative never lowers it
//   P6 proportional  with k of n independent groups evidenced, a requirement earns k/n, not "partial" or "full"

export type Level = "direct" | "listed" | "absent";
export interface Triple { low: number; exp: number; high: number }

/** The only numbers that shape a score. They live in `ruleset.ts` (versioned and fingerprinted); this module takes them as input. */
export interface ScoringParams {
  direct: number;       // credit for described use
  listed: number;       // credit for a bare mention
  unknownPrior: number; // chance a person has a skill they did not mention, used only for the expected value
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Credit of one alternative at each of the three views. */
export function levelCredit(level: Level, p: ScoringParams): Triple {
  if (level === "direct") return { low: p.direct, exp: p.direct, high: 1 };
  if (level === "listed") return { low: p.listed, exp: p.listed, high: 1 };
  return { low: 0, exp: p.unknownPrior, high: 1 };
}

/** A group (OR): the best alternative. P5. An empty group has no evidence and counts as absent. */
export function groupCredit(levels: Level[], p: ScoringParams): Triple {
  if (!levels.length) return levelCredit("absent", p);
  const cs = levels.map((l) => levelCredit(l, p));
  return { low: Math.max(...cs.map((c) => c.low)), exp: Math.max(...cs.map((c) => c.exp)), high: Math.max(...cs.map((c) => c.high)) };
}

/** A requirement (AND of groups): the mean of its groups. P6. */
export function requirementCredit(groups: Level[][], p: ScoringParams): Triple {
  if (!groups.length) return { low: 0, exp: 0, high: 1 };
  const cs = groups.map((g) => groupCredit(g, p));
  return { low: mean(cs.map((c) => c.low)), exp: mean(cs.map((c) => c.exp)), high: mean(cs.map((c) => c.high)) };
}

/**
 * Years of relevant experience against a requirement of `required` years. Credit rises in a straight line to full at `required` and stays there
 * (more years than asked earns nothing extra: that is a different question from "does the person meet the requirement").
 * `datedYears` is what dated roles prove; `undatedRoles` is how many relevant-looking roles had no dates (they could close the gap, so they raise only `high`).
 */
export function yearsCredit(datedYears: number, required: number, undatedRoles: number): Triple {
  if (required <= 0) return { low: 1, exp: 1, high: 1 };
  const low = clamp01(datedYears / required);
  return { low, exp: low, high: undatedRoles > 0 ? 1 : low };
}

export interface Weighted { weight: number; credit: Triple }

/**
 * The weighted power mean of values in [0, 1]: (sum w x^p / sum w)^(1/p), for p > 0. p = 1 is the ordinary weighted mean (a shortfall in one requirement
 * can be made up by strength in another); p below 1 lets a weak requirement pull the result down harder, so balanced coverage beats lopsided coverage;
 * p -> 0 approaches the geometric mean. For every p > 0 it is bounded, symmetric, homogeneous in the weights and monotone in every value (P1 to P4 hold),
 * and it never exceeds the ordinary mean for p < 1 (Jensen's inequality). p is configuration, defaulting to 1 until recruiter data says otherwise.
 */
export function powerMean(values: number[], weights: number[], p = 1): number {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || !values.length) return 0;
  if (p === 1) return clamp01(values.reduce((s, v, i) => s + weights[i] * v, 0) / total);
  return clamp01(Math.pow(values.reduce((s, v, i) => s + weights[i] * Math.pow(clamp01(v), p), 0) / total, 1 / p));
}

/** The whole match: the weighted power mean of every requirement's credit, in each of the three views. P1, P3, P4. */
export function aggregate(items: Weighted[], p = 1): Triple {
  const w = items.map((i) => i.weight);
  const f = (pick: (t: Triple) => number) => powerMean(items.map((i) => pick(i.credit)), w, p);
  return items.reduce((s, i) => s + i.weight, 0) > 0 ? { low: f((t) => t.low), exp: f((t) => t.exp), high: f((t) => t.high) } : { low: 0, exp: 0, high: 0 };
}

/**
 * A total order on results, so the same candidates always come out in the same order and a tie is never broken by chance or by arrival order:
 * higher proved score first, then higher expected, then the narrower range (firmer evidence), then higher confidence, then the id.
 */
export interface Rankable { id: string; scoreFloor: number; score: number; scoreCeiling: number; confidenceScore: number; assessment?: { state: string } }
/** Assessments that could not be completed come after the ranked ones, as a separate group in a fixed order: their numbers are not comparable, so they are not ranked by them. */
export function compareRank(a: Rankable, b: Rankable): number {
  const incomplete = (r: Rankable) => r.assessment?.state === "incomplete";
  if (incomplete(a) !== incomplete(b)) return incomplete(a) ? 1 : -1;
  if (incomplete(a)) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return b.scoreFloor - a.scoreFloor || b.score - a.score || (a.scoreCeiling - a.scoreFloor) - (b.scoreCeiling - b.scoreFloor) || b.confidenceScore - a.confidenceScore || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * How firmly the evidence pins the score down: one minus the width of [low, high]. A match whose result could be anything from 20 to 100 because the
 * CV says little has low evidence confidence however good the best case looks. Extraction quality (how well the document was read) multiplies it,
 * because a badly read document cannot give firm evidence either. Both are in [0, 1], so the product is.
 */
export function confidence(t: Triple, extractionQuality: number): number {
  return clamp01(1 - (t.high - t.low)) * clamp01(extractionQuality);
}
