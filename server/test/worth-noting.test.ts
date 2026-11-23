import { expect, test } from "vitest";
import { worthNotingOnly } from "../src/worthNoting";

// Owner, 10 Nov 2026: 18 "Worth noting" items on one candidate were the summary and the duties again. An item is shown only when it says something the
// rest of the record does not. Invented record.
const record = {
  summary: "Owns a business workflow product used by about 340 client organisations, leading prioritisation with a cross-functional squad of nine.",
  workHistory: [{ responsibilities: ["Raised activation from 48% to 63% by simplifying onboarding, measured over two quarters."] }],
  worthNoting: [
    "Owns a business workflow product used by about 340 client organisations, leading prioritisation with a cross-functional squad of nine.",
    "Raised activation from 48% to 63% by simplifying onboarding, measured over two quarters.",
    "Raised activation from 48% to 63% by simplifying onboarding, measured over two quarters.",
    "Winner of the 2023 Cape Product Award for the best new business application.",
    "Winner of the 2023 Cape Product Award for the best new business application.",
  ],
};

test("Worth noting keeps only what the rest of the record does not say, once", () => {
  expect(worthNotingOnly(record)).toEqual(["Winner of the 2023 Cape Product Award for the best new business application."]);
});
test("a record with nothing repeated keeps every item, in order", () => {
  expect(worthNotingOnly({ summary: "Finance manager.", worthNoting: ["Chair of the school board since 2019.", "Speaks at the annual CFO forum."] })).toEqual(["Chair of the school board since 2019.", "Speaks at the annual CFO forum."]);
});
