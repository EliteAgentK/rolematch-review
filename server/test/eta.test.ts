import { expect, test } from "vitest";
import { estimate } from "../src/eta";
import { classify, defectKey, sanitise } from "../src/occurrences";

const at = (...secs: number[]) => secs.map((s) => s * 1000);
test("no estimate until three files have finished, and none when nothing is left", () => {
  expect(estimate([], 10, 0)).toEqual({ state: "calculating", finished: 0 });
  expect(estimate(at(1, 3), 10, 4000)).toEqual({ state: "calculating", finished: 2 });
  expect(estimate(at(1, 3, 5), 0, 6000)).toEqual({ state: "none" });
});
test("the range comes from observed gaps and scales with the files left", () => {
  const e: any = estimate(at(0, 2, 4, 6, 8), 10, 9000);   // a file every 2 s
  expect(e.state).toBe("estimating"); expect(e.lowSec).toBe(20); expect(e.highSec).toBeGreaterThanOrEqual(20);
  const slower: any = estimate(at(0, 2, 4, 10, 20), 10, 21000);   // getting slower: the range widens, it is not a single number
  expect(slower.highSec).toBeGreaterThan(slower.lowSec);
  expect((estimate(at(0, 2, 4, 6, 8), 20, 9000) as any).lowSec).toBe(40);   // twice the files, twice the time
});
test("an estimate is not given for a stall, and finishing order of the input does not matter", () => {
  expect(estimate(at(0, 2, 4), 5, 400_000)).toEqual({ state: "stalled", sinceSec: 396 });
  expect(estimate(at(4, 0, 2), 5, 5000)).toEqual(estimate(at(0, 2, 4), 5, 5000));
});
test("failures are classified: expected validation is not a defect, unexplained failures are suspected only after the retries run out", () => {
  expect(classify("IDENTITY_UNRESOLVED").kind).toBe("expected_validation");
  expect(classify("LOCK-001").kind).toBe("expected_validation");
  expect(classify("SOMETHING_ODD").kind).toBe("operational_transient");
  expect(classify("PROCESSING_FAILED", { final: true })).toEqual({ kind: "suspected_defect", severity: "medium" });
  expect(classify("SOMETHING_ODD", { final: true }).kind).not.toBe("confirmed_defect");   // only a person confirms a defect
});
test("repeats group under one key whatever the file or person, and different stages do not", () => {
  expect(defectKey("pipeline", "reading", "X")).toBe(defectKey("pipeline", "reading", "X"));
  expect(defectKey("pipeline", "reading", "X")).not.toBe(defectKey("pipeline", "extracting", "X"));
});
test("stored messages carry no addresses, numbers, tokens or stack traces", () => {
  const s = sanitise("failed for thandi@example.co.za phone +27 82 123 4567 token eyJhbGciOiJIUzI1NiJ9abcdef\n    at Object.<anonymous> (file.ts:1:1)");
  expect(s).not.toMatch(/thandi|4567|eyJ|at Object/); expect(s).toContain("[email]");
});
