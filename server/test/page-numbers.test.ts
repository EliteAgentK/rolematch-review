// A page number is never part of a CV (11 Nov 2026: 21 duties on live read "Page N of M"). It keeps its line number, so evidence still points at the
// document's own lines, but the reader never sees it and no list can take it in.
import { describe, expect, it } from "vitest";
import { isPageNumber } from "../src/parse";
import { readerInput } from "../src/modelReader";

describe("page numbers", () => {
  it("knows a page number from a line that only holds numbers for another reason", () => {
    for (const l of ["Page 8 of 24", "page 2", "3 / 5", "3/5", "2 of 3", " Page 10 of 12 "]) expect(isPageNumber(l), l).toBe(true);
    for (const l of ["2019 - 2021", "Managed 3 of 5 regional teams", "Page layout and design", "R 25 000", "2021", "Pages 2-3 of the report"]) expect(isPageNumber(l), l).toBe(false);
  });
  it("is never shown to the reader, and the lines after it keep their own numbers", () => {
    const { parts, byNumber } = readerInput("Sales Manager\nAcme Ltd\n• Led the team\nPage 1 of 2\n• Grew sales by 20%");
    expect(parts.join("\n")).not.toMatch(/Page 1 of 2/);
    expect(byNumber.has(4)).toBe(false);
    expect(byNumber.get(5)).toBe("• Grew sales by 20%");
  });
});
