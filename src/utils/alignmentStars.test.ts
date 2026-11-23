import { describe, expect, test } from "vitest";
import { alignmentStars, describeStars } from "./alignmentStars";

describe("alignment stars: percentage ÷ 20, shown to the nearest half star", () => {
  test.each([
    [0, 0], [4, 0], [5, 0.5], [9, 0.5], [14, 0.5], [15, 1], [20, 1], [24, 1], [25, 1.5], [45, 2.5], [50, 2.5], [74, 3.5], [75, 4],
    [84, 4], [85, 4.5], [87, 4.5], [90, 4.5], [93, 4.5], [94, 4.5], [95, 5], [100, 5],
  ])("%i%% shows %d stars", (percent, shown) => {
    expect(alignmentStars(percent)!.shown).toBe(shown);
  });
  test("the exact value is kept unrounded", () => {
    expect(alignmentStars(87)!.exact).toBeCloseTo(4.35, 10);
    expect(alignmentStars(93)!.exact).toBeCloseTo(4.65, 10);
  });
  test("87% and 93% both show 4.5 stars but keep their own percentages", () => {
    const a = alignmentStars(87)!, b = alignmentStars(93)!;
    expect(a.shown).toBe(b.shown);
    expect(describeStars(a)).toBe("4.5 of 5 stars (87%)");
    expect(describeStars(b)).toBe("4.5 of 5 stars (93%)");
  });
  test("a decimal percentage is converted the same way", () => {
    expect(alignmentStars(84.9)!.shown).toBe(4);
    expect(alignmentStars(85.0)!.shown).toBe(4.5);
  });
  test.each([[undefined], [null], [Number.NaN], [Infinity], [-1], [100.1], ["90"]])("%s is not an assessment: unavailable, never 0 stars", (x) => {
    expect(alignmentStars(x)).toBeNull();
  });
  test("0% is a real assessment (0 stars), distinct from unavailable", () => {
    expect(alignmentStars(0)).toEqual({ percent: 0, exact: 0, shown: 0 });
    expect(describeStars(alignmentStars(0)!)).toBe("0 of 5 stars (0%)");
  });
});
