import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { CASES, VARIANTS } from "./failures/library";
import { gate, type Scorecard } from "./failures/gate";
import { prototype, score } from "./failures/run";

// The retained failure library and the gate. Recurrence is tracked in failures/ledger.json: what passes there must keep passing, and a case known to fail is held to that too, so a fix is noticed and recorded.
const ledger = JSON.parse(readFileSync(new URL("./failures/ledger.json", import.meta.url), "utf8")) as { baseline: { current: Scorecard; prototype: Scorecard }; openInPrototype: Record<string, string> };

const card = (over: Partial<Scorecard> = {}): Scorecard => ({ fields: { "name|pdf": { correct: 8, wrong: 1, missing: 1, total: 10 } }, passing: ["F-001/pdf", "F-002/pdf"], medianMs: 100, failures: 0, ...over });
describe("the gate itself, with deliberately bad candidates", () => {
  test("the same result passes", () => expect(gate(card(), card()).verdict).toBe("pass"));
  test("a genuine improvement passes and is named", () => { const g = gate(card(), card({ fields: { "name|pdf": { correct: 9, wrong: 0, missing: 1, total: 10 } } })); expect(g.verdict).toBe("pass"); expect(g.gains.join()).toMatch(/wrong 1 -> 0/); });
  test("one more wrong published value fails, even with nothing else worse", () => expect(gate(card(), card({ fields: { "name|pdf": { correct: 8, wrong: 2, missing: 0, total: 10 } } })).verdict).toBe("fail"));
  test("refusing everything fails: fewer wrong values cannot pass if correct ones were lost", () => { const g = gate(card(), card({ fields: { "name|pdf": { correct: 0, wrong: 0, missing: 10, total: 10 } } })); expect(g.verdict).toBe("fail"); expect(g.problems.join()).toMatch(/correct values fell/); });
  test("a case that passed and now fails is a recurrence", () => { const g = gate(card(), card({ passing: ["F-001/pdf"] })); expect(g.verdict).toBe("fail"); expect(g.problems.join()).toMatch(/recurrence.*F-002/); });
  test("documents dropped from the run make it incomplete, not a pass", () => { expect(gate(card(), card({ fields: { "name|pdf": { correct: 7, wrong: 1, missing: 1, total: 9 } } })).verdict).toBe("incomplete"); expect(gate(card(), card({ fields: {} })).verdict).toBe("incomplete"); expect(gate(card(), card({ fields: { "name|docx": { correct: 8, wrong: 1, missing: 1, total: 10 } } })).verdict).toBe("incomplete"); });
  test("counts that do not add up make it incomplete", () => expect(gate(card(), card({ fields: { "name|pdf": { correct: 8, wrong: 1, missing: 2, total: 10 } } })).verdict).toBe("incomplete"));
  test("more processing failures, and much slower, both fail", () => { expect(gate(card(), card({ failures: 1 })).verdict).toBe("fail"); expect(gate(card(), card({ medianMs: 400 })).verdict).toBe("fail"); expect(gate(card(), card({ medianMs: 150 })).verdict).toBe("pass"); });
});

describe("the library", () => {
  test("every case says what went wrong and why, is invented, and judges something", () => {
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
    for (const c of CASES) { expect(c.rootCause.length, c.id).toBeGreaterThan(5); expect(c.register, c.id).toMatch(/^R\d+$/); expect(Object.keys(c.expect).length, c.id).toBeGreaterThan(0); for (const row of c.rows) expect(row.t, c.id).not.toMatch(/@(?!(?:[a-z]+\.)?(?:example|test)\b|mail\.example|agency\.example|candidate\.example)[a-z]+\.[a-z]/i); }
    expect(CASES.filter((c) => c.kind === "counterexample").length).toBeGreaterThanOrEqual(10);
  });
  test("the prototype holds what it has fixed, and known gaps are named: a gap that closes must be recorded", async () => {
    const { card: now, failing } = await score(prototype());
    expect(failing.filter((id) => !(id in ledger.openInPrototype)), "newly failing").toEqual([]);
    expect(Object.keys(ledger.openInPrototype).filter((id) => !failing.includes(id)), "now passing: remove from openInPrototype and record the fix").toEqual([]);
    expect(gate(ledger.baseline.prototype, now, { latencyFactor: 10, latencySlackMs: 500 }).problems).toEqual([]);
  }, 180000);
  test("every variant is covered", () => expect(VARIANTS.length).toBe(4));
});
