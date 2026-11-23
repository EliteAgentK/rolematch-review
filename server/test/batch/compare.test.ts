// The comparator must never report a clean result it did not establish.
import { describe, expect, test } from "vitest";
import { compareRows, SCORER_VERSION, tallyChanges, worsenings, type Row } from "./comparelib";

const row = (path: string, checks: [string, boolean][], ok = true): Row => ({ path, ok, scorerVersion: SCORER_VERSION, checks: checks.map(([id, k]) => ({ id, ok: k, field: id.split("|")[0] })) });

describe("comparator 2.0.0", () => {
  test("a check that flips is matched by its stable id, both ways", () => {
    const c = compareRows([row("a", [["name|x", true], ["email|y", false]])], [row("a", [["name|x", false], ["email|y", true]])]);
    expect(tallyChanges(c)).toEqual({ "right → wrong": 1, "wrong → right": 1 });
  });
  test("checks present in only one run are counted: added errors, added correct, removed correct, removed errors", () => {
    const c = compareRows([row("a", [["skill|old", true], ["skill|gone", false]])], [row("a", [["skill|new-bad", false], ["skill|new-good", true]])]);
    expect(tallyChanges(c)).toEqual({ "removed correct": 1, "removed error": 1, "added error": 1, "added correct": 1 });
    expect(worsenings(c).map((x) => x.change).sort()).toEqual(["added error", "removed correct"]);
  });
  test("each change carries the field of the check it describes", () => {
    const A = [{ ...row("a", []), checks: [{ id: "skill precision|pro tection", ok: false, field: "skill precision (extra, printed)" }] }];
    const B = [{ ...row("a", []), checks: [{ id: "skill precision|pro tection", ok: false, field: "skill precision (extra, printed)" }, { id: "skill precision|vulnerability", ok: false, field: "skill precision (unsupported: not in the document)" }] }];
    expect(compareRows(A, B)).toEqual([{ path: "a", id: "skill precision|vulnerability", field: "skill precision (unsupported: not in the document)", change: "added error" }]);
  });
  test("duplicate ids are compared as counts", () => {
    const c = compareRows([row("a", [["skill|sql", true], ["skill|sql", false]])], [row("a", [["skill|sql", true], ["skill|sql", true], ["skill|sql", false]])]);
    expect(tallyChanges(c)).toEqual({ "wrong → right": 1, "added error": 1 });
  });
  test("publication changes are reported", () => {
    expect(tallyChanges(compareRows([row("a", [], false)], [row("a", [["name|x", true]])]))).toEqual({ "refused → published": 1, "added correct": 1 });
  });
  test("identical runs give no changes", () => expect(compareRows([row("a", [["name|x", true]])], [row("a", [["name|x", true]])])).toEqual([]));
  test("malformed input is an error, never zero", () => {
    expect(() => compareRows([], [])).toThrow(/no scored documents/);
    expect(() => compareRows([row("a", [])], [row("b", [])])).toThrow(/same documents/);
    expect(() => compareRows([{ ...row("a", []), checks: [{ id: "", ok: true, field: "x" }] }], [row("a", [])])).toThrow(/stable id/);
    expect(() => compareRows([{ ...row("a", []), checks: [{ id: "name|", ok: true, field: "name" }] }], [row("a", [])])).toThrow(/stable id/);
    expect(() => compareRows([{ ...row("a", []), scorerVersion: "1.0.0" }], [row("a", [])])).toThrow(/re-score/);
    expect(() => compareRows([{ path: "a", ok: true, scorerVersion: SCORER_VERSION } as unknown as Row], [row("a", [])])).toThrow(/checks array/);
  });
});
