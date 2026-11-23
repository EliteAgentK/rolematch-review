import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Read from the file itself, as src/overview/overviewCss.test.ts does: the board's lists are worked out inside React's useMemo, which only works them out
// again when something in its list of inputs changes. This project has no browser test runner for unit tests, so the lists of inputs are checked here.
const source = readFileSync(new URL("./Dashboard.tsx", import.meta.url), "utf8");
/** The names a useMemo for `name` is worked out again on, from `const name = useMemo(... }, [a, b, c]);`. */
const inputsOf = (name: string) => {
  const start = source.indexOf(`const ${name} = useMemo(`);
  expect(start).toBeGreaterThan(-1);   // fails if the file is not really read, or the list is no longer made this way
  const end = source.indexOf("]);", start), open = source.lastIndexOf("}, [", end);
  return source.slice(open + 4, end).split(",").map((s) => s.trim());
};

// Code review, 16 Nov 2026, E-M2: "Show only needs review" above the jobs (and "Review flagged records" in a job batch's summary) turned the button to
// "Showing" but left the list unfiltered, because the jobs list was not worked out again when the toggle changed. The candidates' list was.
describe("the board's filtered lists follow every filter they read", () => {
  it("the jobs list is worked out again when Show only needs review is pressed", () => {
    expect(inputsOf("filteredJobs")).toContain("jobsNeedReview");
  });
  it("the candidates list is too (it already was)", () => {
    expect(inputsOf("filteredCandidates")).toContain("candidatesNeedReview");
  });
});
