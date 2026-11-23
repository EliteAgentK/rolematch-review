import { expect, test } from "vitest";
import { aggregate, confidence, groupCredit, levelCredit, requirementCredit, yearsCredit, type Level, type ScoringParams, type Triple } from "../src/scoring";
import { ruleset } from "../src/ruleset";

// A small seeded generator, so every run tries the same few thousand cases and a failure can be reproduced exactly.
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }
const P = ruleset.scoring.params as ScoringParams;
const LEVELS: Level[] = ["absent", "listed", "direct"];
const RANK: Record<Level, number> = { absent: 0, listed: 1, direct: 2 };
const EPS = 1e-12;

const pickLevel = (r: () => number): Level => LEVELS[Math.floor(r() * 3)];
const genGroup = (r: () => number): Level[] => Array.from({ length: 1 + Math.floor(r() * 3) }, () => pickLevel(r));
const genReq = (r: () => number): Level[][] => Array.from({ length: 1 + Math.floor(r() * 4) }, () => genGroup(r));
const within = (t: Triple) => t.low >= -EPS && t.low <= t.exp + EPS && t.exp <= t.high + EPS && t.high <= 1 + EPS;
const geq = (a: Triple, b: Triple) => a.low >= b.low - EPS && a.exp >= b.exp - EPS && a.high >= b.high - EPS;

test("the configured credits are ordered: absent prior <= listed <= direct <= 1", () => {
  expect(P.unknownPrior).toBeGreaterThanOrEqual(0);
  expect(P.unknownPrior).toBeLessThanOrEqual(P.listed);
  expect(P.listed).toBeLessThanOrEqual(P.direct);
  expect(P.direct).toBeLessThanOrEqual(1);
});

test("P1 bounds: low <= exp <= high, all within [0, 1], for groups, requirements and whole matches", () => {
  const r = rng(1);
  for (let i = 0; i < 3000; i++) {
    expect(within(groupCredit(genGroup(r), P))).toBe(true);
    expect(within(requirementCredit(genReq(r), P))).toBe(true);
    const items = Array.from({ length: 1 + Math.floor(r() * 8) }, () => ({ weight: 0.5 + r() * 20, credit: requirementCredit(genReq(r), P) }));
    expect(within(aggregate(items))).toBe(true);
    expect(within(yearsCredit(r() * 30, 1 + Math.floor(r() * 10), Math.floor(r() * 3)))).toBe(true);
  }
});

test("P2 monotone: raising any alternative's evidence never lowers any view of the score", () => {
  const r = rng(2);
  for (let i = 0; i < 3000; i++) {
    const req = genReq(r);
    const g = Math.floor(r() * req.length), a = Math.floor(r() * req[g].length);
    const better = req.map((grp) => [...grp]); // raise one alternative by one step
    if (RANK[better[g][a]] < 2) better[g][a] = LEVELS[RANK[better[g][a]] + 1];
    expect(geq(requirementCredit(better, P), requirementCredit(req, P))).toBe(true);
    const base = Array.from({ length: 4 }, () => ({ weight: 1 + r() * 9, credit: requirementCredit(genReq(r), P) }));
    const raised = base.map((x, k) => (k === 0 ? { ...x, credit: requirementCredit(better, P) } : x));
    const lowered = base.map((x, k) => (k === 0 ? { ...x, credit: requirementCredit(req, P) } : x));
    expect(geq(aggregate(raised), aggregate(lowered))).toBe(true);
  }
  // years: more relevant years never lowers the credit
  for (let y = 0; y < 20; y += 0.5) expect(geq(yearsCredit(y + 0.5, 5, 0), yearsCredit(y, 5, 0))).toBe(true);
});

test("P3 symmetric: shuffling requirements, groups and alternatives changes nothing", () => {
  const r = rng(3);
  const shuffle = <T,>(xs: T[]) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  for (let i = 0; i < 2000; i++) {
    const req = genReq(r);
    const same = (x: Triple, y: Triple) => Math.abs(x.low - y.low) < EPS && Math.abs(x.exp - y.exp) < EPS && Math.abs(x.high - y.high) < EPS;
    expect(same(requirementCredit(req, P), requirementCredit(shuffle(req.map(shuffle)), P))).toBe(true);
    const items = Array.from({ length: 6 }, () => ({ weight: 1 + r() * 9, credit: requirementCredit(genReq(r), P) }));
    expect(same(aggregate(items), aggregate(shuffle(items)))).toBe(true);
  }
});

test("P4 homogeneous: scaling every weight by the same factor changes nothing", () => {
  const r = rng(4);
  for (let i = 0; i < 2000; i++) {
    const items = Array.from({ length: 5 }, () => ({ weight: 1 + r() * 9, credit: requirementCredit(genReq(r), P) }));
    const k = 0.1 + r() * 50, a = aggregate(items), b = aggregate(items.map((x) => ({ ...x, weight: x.weight * k })));
    expect(Math.abs(a.exp - b.exp)).toBeLessThan(1e-9); expect(Math.abs(a.low - b.low)).toBeLessThan(1e-9); expect(Math.abs(a.high - b.high)).toBeLessThan(1e-9);
  }
});

test("P5 OR semantics: a group is its best alternative; adding an alternative never lowers it", () => {
  const r = rng(5);
  for (let i = 0; i < 2000; i++) {
    const g = genGroup(r), extra = pickLevel(r);
    expect(geq(groupCredit([...g, extra], P), groupCredit(g, P))).toBe(true);
  }
  // "Bash or Python scripting" with Python used and Bash not mentioned is fully met
  expect(groupCredit(["absent", "direct"], P)).toEqual({ low: P.direct, exp: P.direct, high: 1 });
});

test("P6 proportional: k of n independent groups evidenced earns k/n, whatever n is", () => {
  for (let n = 1; n <= 8; n++) for (let k = 0; k <= n; k++) {
    const groups: Level[][] = Array.from({ length: n }, (_, i) => [i < k ? "direct" : "absent"]);
    const c = requirementCredit(groups, P);
    expect(c.low).toBeCloseTo((k * P.direct) / n, 12);
  }
});

test("the extremes: everything described is 1, nothing mentioned proves nothing but could still be everything", () => {
  const all = requirementCredit([["direct"], ["direct"]], P), none = requirementCredit([["absent"], ["absent"]], P);
  expect(all).toEqual({ low: 1, exp: 1, high: 1 });
  expect(none.low).toBe(0); expect(none.high).toBe(1); expect(none.exp).toBeCloseTo(P.unknownPrior, 12);
});

test("years: linear to the requirement, then flat; undated roles can only raise the ceiling", () => {
  expect(yearsCredit(0, 5, 0)).toEqual({ low: 0, exp: 0, high: 0 });
  expect(yearsCredit(2.5, 5, 0).low).toBeCloseTo(0.5, 12);
  expect(yearsCredit(5, 5, 0).low).toBe(1);
  expect(yearsCredit(40, 5, 0).low).toBe(1);               // more than asked earns nothing extra
  expect(yearsCredit(2.5, 5, 1)).toEqual({ low: 0.5, exp: 0.5, high: 1 });
});

test("confidence: a wide range cannot give high confidence, however good the best case is; a badly read document cannot either", () => {
  expect(confidence({ low: 0.2, exp: 0.5, high: 1 }, 1)).toBeCloseTo(0.2, 12);
  expect(confidence({ low: 0.9, exp: 0.9, high: 0.9 }, 1)).toBe(1);
  expect(confidence({ low: 0.9, exp: 0.9, high: 0.9 }, 0.4)).toBeCloseTo(0.4, 12);
  const r = rng(6);
  for (let i = 0; i < 1000; i++) { const t = aggregate([{ weight: 1, credit: requirementCredit(genReq(r), P) }]); const c = confidence(t, r()); expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1); }
});

test("levelCredit is consistent with the ordering of evidence", () => {
  const a = levelCredit("absent", P), l = levelCredit("listed", P), d = levelCredit("direct", P);
  expect(a.low <= l.low && l.low <= d.low && a.exp <= l.exp && l.exp <= d.exp).toBe(true);
});

import { compareRank, powerMean } from "../src/scoring";

test("power mean: bounded, symmetric, homogeneous and monotone for every exponent; p=1 is the ordinary mean", () => {
  const r = rng(7);
  for (const p of [0.25, 0.5, 1, 2, 3]) for (let i = 0; i < 800; i++) {
    const n = 1 + Math.floor(r() * 6), v = Array.from({ length: n }, () => r()), w = Array.from({ length: n }, () => 0.1 + r() * 9);
    const m = powerMean(v, w, p);
    expect(m).toBeGreaterThanOrEqual(Math.min(...v) - 1e-9); expect(m).toBeLessThanOrEqual(Math.max(...v) + 1e-9);           // between the smallest and largest value
    const order = v.map((_, k) => k).sort(() => r() - 0.5);
    expect(Math.abs(powerMean(order.map((k) => v[k]), order.map((k) => w[k]), p) - m)).toBeLessThan(1e-9);                    // symmetric
    expect(Math.abs(powerMean(v, w.map((x) => x * 7.3), p) - m)).toBeLessThan(1e-9);                                           // homogeneous in the weights
    const k = Math.floor(r() * n), up = v.map((x, j) => (j === k ? Math.min(1, x + r() * 0.3) : x));
    expect(powerMean(up, w, p)).toBeGreaterThanOrEqual(m - 1e-9);                                                              // monotone in every value
  }
  expect(powerMean([0.2, 0.8], [1, 1], 1)).toBeCloseTo(0.5, 12);
});

test("power mean with p < 1 never exceeds the ordinary mean (Jensen), so balanced coverage is never worse than lopsided coverage", () => {
  const r = rng(8);
  for (let i = 0; i < 1500; i++) {
    const n = 2 + Math.floor(r() * 5), v = Array.from({ length: n }, () => r()), w = Array.from({ length: n }, () => 0.1 + r() * 9);
    expect(powerMean(v, w, 0.5)).toBeLessThanOrEqual(powerMean(v, w, 1) + 1e-9);
    expect(powerMean(v, w, 2)).toBeGreaterThanOrEqual(powerMean(v, w, 1) - 1e-9);
  }
  // same total evidence, spread evenly versus concentrated: the even spread scores at least as well when p < 1
  expect(powerMean([0.5, 0.5], [1, 1], 0.5)).toBeGreaterThan(powerMean([1, 0], [1, 1], 0.5));
});

test("ranking is a total order: the same results always sort the same way, whatever order they arrive in", () => {
  const r = rng(9);
  const items = Array.from({ length: 60 }, (_, i) => ({ id: `id${String(i).padStart(3, "0")}`, scoreFloor: Math.floor(r() * 5) * 10, score: Math.floor(r() * 5) * 10, scoreCeiling: 50 + Math.floor(r() * 5) * 10, confidenceScore: Math.floor(r() * 3) * 25 }));
  const sorted = [...items].sort(compareRank).map((x) => x.id);
  for (let t = 0; t < 20; t++) expect([...items].sort(() => r() - 0.5).sort(compareRank).map((x) => x.id)).toEqual(sorted);
  for (const a of items) expect(compareRank(a, a)).toBe(0);
  for (const a of items.slice(0, 20)) for (const b of items.slice(20, 40)) expect(Math.sign(compareRank(a, b))).toBe(-Math.sign(compareRank(b, a)));     // antisymmetric
});
