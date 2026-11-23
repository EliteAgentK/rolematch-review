import { describe, expect, test } from "vitest";
import { groupsOf } from "./jobGroups";

describe("a job's list under its own headings", () => {
  test("each heading takes its count of items, in order", () => {
    expect(groupsOf(["a", "b", "c"], [{ heading: "Strategy", count: 2 }, { heading: "People", count: 1 }])).toEqual([{ heading: "Strategy", items: ["a", "b"] }, { heading: "People", items: ["c"] }]);
  });
  test("a list with no headings is one group without a heading; an empty list is no groups", () => {
    expect(groupsOf(["a", "b"])).toEqual([{ heading: "", items: ["a", "b"] }]);
    expect(groupsOf([], [])).toEqual([]);
  });
  test("when a recruiter's edit changed the list so the counts no longer add up, the list is shown whole, never cut or put under the wrong heading", () => {
    expect(groupsOf(["a", "b", "c", "d"], [{ heading: "Strategy", count: 2 }, { heading: "People", count: 1 }])).toEqual([{ heading: "", items: ["a", "b", "c", "d"] }]);
    expect(groupsOf(["a"], [{ heading: "Strategy", count: 2 }])).toEqual([{ heading: "", items: ["a"] }]);
  });
});
