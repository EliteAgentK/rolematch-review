import { describe, expect, it } from "vitest";
import { ON_SHORTLIST as SERVER_ON_SHORTLIST } from "../../server/src/shortlist";
import { ON_SHORTLIST, onShortlist, shortlistedFor } from "./stages";

// Code review, 16 Nov 2026, G-M3: a job's panel counted anyone not marked Not suitable as "on the shortlist" (Reviewed included, and any status an
// organisation adds), while the Overview and Needs attention counted only Shortlisted and the stages after it. One definition now, the server's.
describe("on the shortlist", () => {
  const app = (candidateId: string, status: string) => ({ id: candidateId, candidateId, jobId: "j", jobTitle: "", jobCompany: "", status, updatedAt: "" });
  it("is shortlisted or further for the job: never Reviewed, Archived, Not suitable or a status the organisation added", () => {
    const all = [app("a", "shortlisted"), app("b", "reviewed"), app("c", "interviewed"), app("d", "declined"), app("e", "archived"), app("f", "offer made"), app("g", "hired")];
    expect(shortlistedFor(all, "j").map((a) => a.candidateId)).toEqual(["a", "c", "g"]);
    expect(onShortlist("awaiting interview")).toBe(true);
    expect(onShortlist("reviewed")).toBe(false);
  });
  it("is the same list as the server's", () => {
    expect(ON_SHORTLIST).toEqual(SERVER_ON_SHORTLIST);
  });
});
