// R38: a test run's clean-up removed the servers and schemas of ANOTHER run still in progress (starting a second `vitest run` mid-run killed the first
// run's servers: "other side closed", then "relation does not exist"). The record now says which test process made each entry, and only entries of
// ended processes are removed. Pure: no database, no processes started.
import { expect, test } from "vitest";
import { leftBehind } from "./globalSetup";

test("a sweep keeps what a running test process made and removes what an ended one left", () => {
  const isAlive = (pid: number) => pid === 111;
  const r = leftBehind("test_aaaaaaaaaaaa 111\ntest_bbbbbbbbbbbb 222\n", isAlive);
  expect(r.remove).toEqual(["test_bbbbbbbbbbbb"]);
  expect(r.keep).toEqual(["test_aaaaaaaaaaaa 111"]);
});
test("server process ids follow the same rule", () => {
  expect(leftBehind("5001 111\n5002 222", (p) => p === 111)).toEqual({ remove: ["5002"], keep: ["5001 111"] });
});
test("a line from an older run without an owner counts as left behind (the old behaviour, for old records only)", () => {
  expect(leftBehind("test_cccccccccccc\n\n", () => true)).toEqual({ remove: ["test_cccccccccccc"], keep: [] });
});
test("this very process counts as running", () => {
  expect(leftBehind(`test_dddddddddddd ${process.pid}`).keep).toHaveLength(1);
});
