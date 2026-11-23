import { describe, expect, it } from "vitest";
import { axisSteps } from "./chartAxis";

describe("axisSteps: round numbers on a chart's axis", () => {
  it("never gives the owner's 0, 43, 87, 130, 174 again: a tallest day of 151 reads 0, 50, 100, 150, 200", () => {
    expect(axisSteps(151).ticks).toEqual([0, 50, 100, 150, 200]);
  });
  it("every step is 1, 2 or 5 times a power of ten, and the top is above the tallest value", () => {
    for (let t = 0; t <= 5000; t += 7) {
      const { step, top, ticks } = axisSteps(t);
      const m = step / 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 5]).toContain(m);
      expect(top).toBeGreaterThanOrEqual(t);
      expect(ticks[0]).toBe(0);
      expect(ticks[ticks.length - 1]).toBe(top);
      expect(ticks.length).toBeGreaterThanOrEqual(2);
      expect(ticks.length).toBeLessThanOrEqual(7);
    }
  });
  it("counts never get fractional steps: an empty or tiny chart reads 0, 1, 2…", () => {
    expect(axisSteps(0).ticks).toEqual([0, 1]);
    expect(axisSteps(3).ticks).toEqual([0, 1, 2, 3, 4]);
  });
});
