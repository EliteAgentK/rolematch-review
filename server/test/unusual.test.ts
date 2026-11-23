// Unusual activity (src/unusual.ts; owner, 12 Nov 2026): each rule with figures, and an ordinary day says nothing.
import { expect, test } from "vitest";
import { judge, UNUSUAL } from "../src/unusual";

const when = { day: "2026-11-12", month: "2026-11" };
const row = (o: Partial<Parameters<typeof judge>[0][number]> = {}) => ({ portal: "p1", org: "o1", company: "Acme", day: when.day, month: when.month, uploads: 10, failed: 0, usual: 8, ...o });
const co = (o: Partial<Parameters<typeof judge>[1][number]> = {}) => ({ org: "o1", company: "Acme", aiToday: 0.4, aiUsual: 0.3, spentMonth: 3, cap: 20, ...o });

test("an ordinary day says nothing", () => { expect(judge([row()], [co()], when)).toEqual([]); });

test("uploads: over ten times the usual and at least fifty", () => {
  expect(judge([row({ uploads: 640, usual: 12 })], [co()], when).map((f) => f.fingerprint)).toEqual(["unusual:uploads:p1:2026-11-12"]);
  expect(judge([row({ uploads: 49, usual: 1 })], [co()], when)).toEqual([]);                  // under fifty: not worth a message, however unusual
  expect(judge([row({ uploads: 120, usual: 20 })], [co()], when)).toEqual([]);                // six times: a busy day, not an unusual one
});

test("failures: more than one in ten of the day's documents, and at least five", () => {
  const f = judge([row({ uploads: 30, failed: 6 })], [co()], when);
  expect(f.map((x) => x.fingerprint)).toEqual(["unusual:failed:p1:2026-11-12"]);
  expect(f[0].title).toBe("Acme: 6 of 36 documents could not be read today");
  expect(judge([row({ uploads: 300, failed: 6, usual: 100 })], [co()], when)).toEqual([]);   // six in three hundred: under one in ten
});

test("AI spend: over five times the usual and at least two dollars; and a company at four fifths of its allowance", () => {
  expect(judge([row()], [co({ aiToday: 4, aiUsual: 0.5 })], when).map((f) => f.fingerprint)).toEqual(["unusual:ai:o1:2026-11-12"]);
  expect(judge([row()], [co({ aiToday: 1.5, aiUsual: 0.1 })], when)).toEqual([]);
  const a = judge([row()], [co({ spentMonth: 16.2, cap: 20 })], when);
  expect(a.map((f) => [f.fingerprint, f.title])).toEqual([["unusual:allowance:o1:2026-11", "Acme has used 81% of its monthly AI allowance"]]);
  expect(UNUSUAL.allowanceShare).toBe(0.8);
});
