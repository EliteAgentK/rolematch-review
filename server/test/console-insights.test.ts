// The console's Activity and Organisations shaping (src/console/insights.ts): whole numbers, plain words, nothing invented when a day has nothing.
import { expect, test } from "vitest";
import { change, shapeActivity, shapeOrganisations } from "../src/console/insights";
import { area, spark } from "../src/console/view";

test("a change is said in words and whole percentages, against the period before", () => {
  expect(change(12, 10)).toBe("up 20% on the period before");
  expect(change(9, 10)).toBe("down 10% on the period before");
  expect(change(10, 10)).toBe("the same as before");
  expect(change(5, 0)).toBe("new this period");
  expect(change(0, 0)).toBe("none before either");
});

test("thirty days become each metric's series, total and change; an empty answer shows nothing, never made-up numbers", () => {
  const a = shapeActivity({ days: 2, series: [{ date: "2026-11-10", cvs: 3, aiMicroUsd: 1_500_000 }, { date: "2026-11-11", cvs: 1 }], previous: { cvs: 2 } });
  const cvs = a.metrics.find((m) => m.key === "cvs")!;
  expect(cvs).toMatchObject({ total: 4, previous: 2, series: [3, 1], change: "up 100% on the period before" });
  expect(a.metrics.find((m) => m.key === "aiMicroUsd")!.total).toBe(1_500_000);
  expect(shapeActivity(null).metrics.every((m) => m.total === 0 && m.series.length === 0)).toBe(true);
  expect(shapeOrganisations([{ name: "Acme", aiMicroUsdThisMonth: 2_000_000 }])[0]).toMatchObject({ name: "Acme", aiUsd: 2, cvs: 0, lastActivity: null });
});

test("charts are plain SVG with their numbers in words for anyone who cannot see them", () => {
  expect(spark([1, 2, 3], "r")).toMatch(/^<svg class="spark r"/);
  const svg = area(["2026-11-10", "2026-11-11"], [{ label: "CVs read", colour: "r", values: [3, 1] }]);
  expect(svg).toContain('aria-label="CVs read, day by day"');
  expect(svg).toMatch(/<title>[^<]*CVs read 3<\/title>/);
  expect(svg).not.toMatch(/<script/i);
});
