import { expect, test } from "vitest";
import { assess } from "../src/match";
import { arrangementOf, assessLogistics } from "../src/logistics";
import { compareWhere, PLACES, whereIs } from "../src/geo";
import { reviewJob, reviewRequirement } from "../src/jobReview";
import type { Candidate, Job } from "../src/types";

const cand = (over: Partial<Candidate> = {}): Candidate => ({
  id: "c", name: "Test Person", role: "Developer", status: "new", avatar: "", skills: ["JavaScript", "React"], rating: 0, experience: "6",
  location: "Johannesburg, South Africa", email: "", phone: "", appliedDate: "2026-01-01",
  workHistory: [{ company: "Acme", position: "Senior Developer", startDate: "2018-01", endDate: "Present", responsibilities: ["Built React and JavaScript applications."] }],
  extractionConfidence: 0.9, ...over,
});
const job = (over: Partial<Job> = {}): Job => ({
  id: "j", title: "Developer", location: "Johannesburg, South Africa", company: "X", skills: [], type: "", department: "", description: "",
  requirements: ["Strong experience with TypeScript and JavaScript."], preferredRequirements: ["Experience with Docker."], responsibilities: [], postedDate: "",
  status: "open", extractionConfidence: 0.9, workArrangement: "On-site", ...over,
});
const sameScore = (a: ReturnType<typeof assess>, b: ReturnType<typeof assess>) => [a.scoreFloor, a.score, a.scoreCeiling, a.confidenceScore, a.coverage].join() === [b.scoreFloor, b.score, b.scoreCeiling, b.confidenceScore, b.coverage].join();

// ---------- places: city, province, country ----------
test("a location is read as city, province and country; business districts belong to their city; unknown places are never guessed", () => {
  expect(whereIs("Sandton, Johannesburg")).toEqual({ place: "Sandton", city: "Johannesburg", province: "Gauteng", country: "South Africa" });
  expect(whereIs("Port Elizabeth, South Africa")).toMatchObject({ city: "Gqeberha", province: "Eastern Cape" });
  expect(whereIs("Johannesburg South Africa").city).toBe("Johannesburg");          // no comma: a known name inside the text
  expect(whereIs("Engineering, Cape Town office").city).toBe("Cape Town");
  expect(whereIs("East London").city).toBe("East London");                         // the longer name wins over "London"
  expect(whereIs("Gauteng")).toEqual({ province: "Gauteng", country: "South Africa" });
  expect(whereIs("Durban North, KZN")).toMatchObject({ city: "Durban", province: "KwaZulu-Natal" });
  expect(whereIs("Gaborone, Botswana")).toEqual({ country: "Botswana" });
  expect(whereIs("London, UK")).toEqual({ country: "United Kingdom" });
  expect(whereIs("Atlantis")).toEqual({});
  expect(whereIs("I can work in the US office")).toEqual({});                      // short codes only count as a whole part
  for (const p of PLACES) expect(whereIs(p.name).country).toBe("South Africa");
});

test("places compare by level: same city, same province, same country, another country, or unknown", () => {
  expect(compareWhere(whereIs("Sandton"), whereIs("Randburg"))).toBe("same city");
  expect(compareWhere(whereIs("Johannesburg"), whereIs("Pretoria"))).toBe("same province");
  expect(compareWhere(whereIs("Johannesburg"), whereIs("Cape Town"))).toBe("same country");
  expect(compareWhere(whereIs("Gauteng"), whereIs("Midrand"))).toBe("same province");
  expect(compareWhere(whereIs("Cape Town"), whereIs("Harare, Zimbabwe"))).toBe("different country");
  expect(compareWhere(whereIs("Cape Town"), whereIs("Atlantis"))).toBe("unknown");
});

// ---------- logistics ----------
test("the job's arrangement is read from its own field; hybrid wins over a passing mention of remote days", () => {
  expect(arrangementOf({ workArrangement: "Hybrid (2 remote days)", location: "Sandton" })).toBe("hybrid");
  expect(arrangementOf({ workArrangement: "On-site", location: "" })).toBe("on-site");
  expect(arrangementOf({ workArrangement: "", location: "Remote, South Africa" })).toBe("remote");
  expect(arrangementOf({ workArrangement: "", location: "Durban" })).toBe("not stated");
});

test("logistics: same city or province compatible; another province or country is 'to confirm', never a mismatch; remote jobs need no check", () => {
  expect(assessLogistics(job(), cand()).status).toBe("compatible");
  const near = assessLogistics(job({ location: "Sandton" }), cand({ location: "Randburg" }));
  expect(near.status).toBe("compatible"); expect(near.level).toBe("same city");
  expect(assessLogistics(job({ location: "Pretoria" }), cand()).level).toBe("same province");
  const abroad = assessLogistics(job(), cand({ location: "Windhoek, Namibia" }));
  expect(abroad.status).toBe("to_confirm"); expect(abroad.checks[0].explanation).toMatch(/right to work .* never assumed/);
  const far = assessLogistics(job({ location: "Cape Town" }), cand());
  expect(far.status).toBe("to_confirm"); expect(far.checks[0].explanation).toMatch(/not a mismatch/);
  expect(assessLogistics(job({ workArrangement: "Remote" }), cand({ location: "Cape Town" })).status).toBe("not_required");
});

test("a stated willingness to relocate turns a distance into 'compatible, confirm it'; 'remote only' against an on-site job is a conflict to resolve", () => {
  const moving = assessLogistics(job({ location: "Cape Town" }), cand(), "Open to relocation for the right role.");
  expect(moving.status).toBe("compatible"); expect(moving.checks[0].source).toMatch(/relocation/);
  const remoteOnly = assessLogistics(job(), cand(), "Looking for remote-only roles.");
  expect(remoteOnly.status).toBe("conflict"); expect(remoteOnly.checks.at(-1)!.source).toMatch(/remote-only/);
});

test("'unable to relocate' is no conflict when the job is where the person already lives; it is one only when the job would mean moving (code review, 16 Nov 2026, C-M4)", () => {
  // Sandton is in Johannesburg: nobody has to move, so a refusal to move says nothing against this job.
  for (const said of ["Unable to relocate.", "I am not willing to relocate.", "Cannot relocate for family reasons.", "No relocation."]) {
    const home = assessLogistics(job({ location: "Sandton" }), cand({ location: "Sandton, Johannesburg" }), said);
    expect(home.status, said).toBe("compatible");
    expect(home.checks.some((c) => c.status === "conflict"), said).toBe(false);
    // the same province is a commute, not a move
    expect(assessLogistics(job({ location: "Pretoria" }), cand(), said).status, said).toBe("compatible");
  }
  // A job in another province would mean moving: the person's own words against it are a conflict to resolve with them, quoted back.
  const far = assessLogistics(job({ location: "Cape Town" }), cand(), "Unable to relocate.");
  expect(far.status).toBe("conflict"); expect(far.checks.at(-1)!.source).toBe("Unable to relocate.");
  // Where the places cannot be compared, whether they would have to move is a question, not a conflict.
  expect(assessLogistics(job({ location: "Sandton" }), cand({ location: "" }), "Unable to relocate.").status).toBe("to_confirm");
  // Not wanting to work on site at all still conflicts with an on-site job in their own city.
  expect(assessLogistics(job({ location: "Sandton" }), cand({ location: "Sandton" }), "Looking for remote-only roles.").status).toBe("conflict");
});

test("logistics never moves the alignment score: same requirements, any place, any arrangement, any statement", () => {
  const base = assess(cand(), job());
  for (const [c, j, text] of [
    [cand({ location: "Cape Town" }), job(), ""], [cand({ location: "" }), job(), ""], [cand(), job({ location: "Durban" }), ""],
    [cand(), job({ workArrangement: "Remote" }), ""], [cand(), job({ workArrangement: "Hybrid" }), ""], [cand(), job(), "Remote only, not willing to relocate."],
  ] as [Candidate, Job, string][]) {
    const r = assess(c, j, text);
    expect([r.scoreFloor, r.score, r.scoreCeiling]).toEqual([base.scoreFloor, base.score, base.scoreCeiling]);
    expect(r.evidence.some((e) => /location/i.test(e.label))).toBe(false);
  }
});

test("an on-site or hybrid job with no location is never blocked: matching says the location could not be checked", () => {
  const r = assess(cand(), job({ location: "" }));
  expect(r.logistics?.checks[0].label).toBe("Job location");
  expect(r.recommendation).toMatch(/Logistics: confirm/);
});

// ---------- requirement wording review ----------
test("wording review flags age, sex, family, health, language, appearance and vague wording, with a reason; plain requirements are not flagged", () => {
  const codes = (t: string, title = "") => reviewRequirement(t, title).map((f) => f.code);
  expect(codes("Must be a dynamic, energetic young person")).toEqual(expect.arrayContaining(["AGE", "VAGUE"]));
  expect(codes("Looking for a recent male graduate")).toEqual(expect.arrayContaining(["AGE-GRAD", "SEX"]));
  expect(codes("Applicants must be under 35 years of age")).toContain("AGE");
  expect(codes("Single, no children, able to travel")).toContain("FAMILY");
  expect(codes("Must be physically fit and in good health")).toContain("HEALTH");
  expect(codes("Native English speaker")).toContain("LANG");
  expect(codes("Presentable, photo with CV")).toContain("LOOKS");
  expect(codes("Own car and valid driver's licence")).toContain("LICENCE");
  for (const plain of ["5+ years of experience with TypeScript and Node.js.", "Bachelor's degree in Computer Science.", "Experience with Docker and Kubernetes.", "Strong SQL and data modelling skills."]) expect(codes(plain)).toEqual([]);
  expect(reviewRequirement("Must be a young graduate")[0].reason.length).toBeGreaterThan(40);
});

test("a flagged requirement is still assessed exactly as written (the recruiter decides), and the result says it needs review", () => {
  const plain = assess(cand(), job({ requirements: ["Strong experience with JavaScript."] }));
  const flagged = assess(cand(), job({ requirements: ["Strong experience with JavaScript. Young applicants preferred."] }));
  expect(flagged.evidence[0].reviewFlags?.length).toBeGreaterThan(0);
  expect(flagged.scoreFloor).toBe(plain.scoreFloor);
  expect(flagged.warnings.some((w) => /wording a recruiter should review/.test(w))).toBe(true);
  expect(reviewJob({ title: "Developer", requirements: ["Docker"], preferredRequirements: ["Young and hungry"] })).toHaveLength(1);
});

// ---------- the assessment framework's invariants ----------
test("direction and pool invariance: a pair's result is the same whether one candidate meets many jobs or one job meets many candidates", () => {
  const asOf = new Date("2026-10-01T00:00:00Z");
  const people = [cand(), cand({ id: "c2", skills: ["Docker"] }), cand({ id: "c3", workHistory: [] })];
  const jobs = [job(), job({ id: "j2", requirements: ["Experience with Docker."] }), job({ id: "j3", requirements: ["Experience with Python or Go."] })];
  for (const c of people) for (const j of jobs) {
    const oneCandidateManyJobs = jobs.map((jj) => assess(c, jj, "", asOf)).find((_, k) => jobs[k] === j)!;
    const oneJobManyCandidates = [...people].reverse().map((cc) => assess(cc, j, "", asOf)).find((_, k) => [...people].reverse()[k] === c)!;
    expect(JSON.stringify(oneCandidateManyJobs)).toBe(JSON.stringify(oneJobManyCandidates));
  }
});

test("the reference date is recorded and fixes 'Present', so the same inputs and date always reproduce the same result", () => {
  const a = assess(cand(), job({ requirements: ["8+ years of JavaScript experience."] }), "", new Date("2026-01-01T00:00:00Z"));
  const b = assess(cand(), job({ requirements: ["8+ years of JavaScript experience."] }), "", new Date("2026-01-01T00:00:00Z"));
  const later = assess(cand(), job({ requirements: ["8+ years of JavaScript experience."] }), "", new Date("2027-01-01T00:00:00Z"));
  expect(a.referenceDate).toBe("2026-01-01");
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  expect(later.scoreFloor).toBeGreaterThanOrEqual(a.scoreFloor); // a current role adds time, never takes it away
});

test("points: every requirement's share adds up to 100, and the proved points add up to the proved score", () => {
  const r = assess(cand({ skills: ["JavaScript", "React", "Docker"] }), job({ requirements: ["Strong experience with TypeScript and JavaScript.", "Experience with React."], preferredRequirements: ["Experience with Docker.", "Experience with Kubernetes."] }));
  const shares = r.evidence.reduce((a, e) => a + (e.share ?? 0), 0), proved = r.evidence.reduce((a, e) => a + (e.pointsProved ?? 0), 0);
  expect(shares).toBeCloseTo(100, 9);
  expect(Math.round(proved)).toBe(r.scoreFloor);
});

// rules 3.0.0 (SCORE_V3.md): a named skill earns 0.8, and the role itself is a part of the job; a CV with no dated role says nothing about that part.
test("coverage is separate from the score: a CV that lists every skill but no dated role covers the skills, not the role, and proves part of it", () => {
  const listed = assess(cand({ workHistory: [], skills: ["TypeScript", "JavaScript", "Docker"] }), job());
  expect(listed.coverage).toBe(46);     // the skills part, 0.30 of the 0.65 this job has
  expect(listed.scoreFloor).toBe(37);   // 0.8 × 0.30 / 0.65
  const silent = assess(cand({ workHistory: [], skills: [] }), job());
  expect(silent.coverage).toBe(0);
});

test("changing the candidate's place or the job's arrangement never changes coverage, confidence or score", () => {
  expect(sameScore(assess(cand(), job()), assess(cand({ location: "Polokwane" }), job({ workArrangement: "Remote" })))).toBe(true);
});
