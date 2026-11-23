import { describe, expect, it } from "vitest";
import { recordedNote } from "./CandidateMatchPanel";

// Code review, 16 Nov 2026, E-M6: the assessment told recruiters a recorded score "changes only if either is edited". The server returns a pair's first
// finished match for ever (server/src/index.ts, recordedMatch), so a recruiter who corrected a job expecting a new score kept getting the old one.
describe("what a finished assessment says about its score", () => {
  it("says the recorded assessment does not change, and never that an edit changes it", () => {
    const note = recordedNote("12 November 2026");
    expect(note).not.toMatch(/changes only if/i);
    expect(note).toMatch(/does not change/);
    expect(note).toMatch(/editing either of them, or matching them again, shows this same assessment/);
    expect(note).toMatch(/^Scored on 12 November 2026/);
  });
});
