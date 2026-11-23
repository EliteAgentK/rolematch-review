import { expect, test } from "vitest";
import { inReviewOrder } from "./reviewOrder";

const row = (job: string, score: number, floor = score, ceiling = score, conf = 50) => ({ candidate: { id: "c1" }, job: { id: job }, matchResult: { score, scoreFloor: floor, scoreCeiling: ceiling, confidenceScore: conf } });

test("results come back in the approved order whatever order they were fetched in (a 6% result arriving first stays last)", () => {
  expect(inReviewOrder([row("analyst", 6), row("developer", 88)], "candidate-to-jobs").map((r) => r.job.id)).toEqual(["developer", "analyst"]);
});
test("the supported score ranks first, not the headline score: 87% fully supported comes before 93% only partly supported", () => {
  expect(inReviewOrder([row("a", 93, 60, 100), row("b", 87, 87, 87)], "candidate-to-jobs").map((r) => r.job.id)).toEqual(["b", "a"]);
});
test("equal scores showing the same stars keep a fixed order (no chance tie-breaks)", () => {
  const once = inReviewOrder([row("y", 90), row("x", 90)], "candidate-to-jobs").map((r) => r.job.id);
  expect(once).toEqual(inReviewOrder([row("x", 90), row("y", 90)], "candidate-to-jobs").map((r) => r.job.id));
});
