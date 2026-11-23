import { expect, test, vi } from "vitest";

// Register R95, temporary. With the containment on, a scan always goes to a person, and a typed document is judged on its own merits. With it off, a clean scan is not flagged for being a scan.
const fields = Object.fromEntries(["name", "email", "phone", "location", "workHistory", "education", "skills"].map((k) => [k, { state: "found" }])) as any;
const rec = { name: "Thandi Mokoena", email: "thandi.mokoena@example.test", phone: "+27 00 000 0000", location: "Durban", workHistory: [{ startDate: "2020-01" }] };
const th = { flagNoContact: true, flagNoWorkHistory: true, flagNoEducation: true } as any;
const review = async (on: boolean, ocr: boolean) => {
  vi.resetModules();
  process.env.REVIEW_ALL_SCANS = on ? "true" : "false";
  const { reviewCandidateFields } = await import("../src/candidatePipeline");
  return reviewCandidateFields(rec, fields, null, [], ocr, 2000, th);
};
test("on: every scan needs review, with a plain reason; a typed document does not", async () => {
  const scan = await review(true, true);
  expect(scan.state).toBe("needs_review");
  expect(scan.reasons.join(" ")).toContain("Read from a scan");
  expect((await review(true, false)).state).toBe("ok");
});
test("off: being a scan is not a reason by itself", async () => {
  expect((await review(false, true)).state).toBe("ok");
});
