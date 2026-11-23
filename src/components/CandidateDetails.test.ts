import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import type { Candidate } from "@/types/records";
import { renderText } from "../testing/ssr";
import CandidateDetails from "./CandidateDetails";

const candidate = (extra: Partial<Candidate> = {}) => ({ id: "c1", name: "Ann Dube", role: "Analyst", skills: ["Excel"], status: "new", version: 3, recruiterNotes: "", ...extra }) as unknown as Candidate;
const panel = (c: Candidate) => renderText(h(CandidateDetails, { candidate: c, onClose: () => {}, onChange: async (x: Candidate) => x }));

// Code review, 16 Nov 2026, E-M3: a CV being read again could still be opened, and its panel offered Edit. A correction saved then can be overwritten
// when the new reading lands, or is refused. The job panel already withheld Edit and said the record was being read again; the candidate panel did neither.
describe("the candidate panel while the CV is being read again", () => {
  it("offers no Edit, and says the record is being read again", async () => {
    const text = await panel(candidate({ rereading: { since: "2026-11-16T10:00:00Z" } } as Partial<Candidate>));
    expect(text).not.toContain("Edit candidate");
    expect(text).toContain("Being read again by the AI");
  });
  it("offers Edit as before once the reading is in", async () => {
    const text = await panel(candidate());
    expect(text).toContain("Edit candidate");
    expect(text).not.toContain("Being read again by the AI");
  });
});
