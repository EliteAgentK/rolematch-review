import { describe, expect, test } from "vitest";
import { currentEmployer, highestQualification, profileAtAGlance } from "./candidateFacts";

describe("employer", () => {
  test("the role marked Present wins, wherever it sits in the list", () => {
    expect(currentEmployer([{ company: "Old Co", endDate: "2020-01" }, { company: "New Co", endDate: "Present" }])).toBe("New Co");
  });
  test("with no current role, the first listed (most recent) employer", () => {
    expect(currentEmployer([{ company: "Last Co", endDate: "2023-05" }, { company: "Earlier Co", endDate: "2019-01" }])).toBe("Last Co");
  });
  test("roles without a company are skipped; nothing found means nothing shown", () => {
    expect(currentEmployer([{ company: "", endDate: "Present" }, { company: "Real Co", endDate: "2022" }])).toBe("Real Co");
    expect(currentEmployer([])).toBe("");
    expect(currentEmployer(undefined)).toBe("");
  });
});

describe("highest qualification", () => {
  test("ranks by level, not by order", () => {
    expect(highestQualification([{ degree: "National Senior Certificate" }, { degree: "BSc Computer Science" }, { degree: "Certificate in Labour Relations" }])).toBe("BSc Computer Science");
    expect(highestQualification([{ degree: "BCom Accounting" }, { degree: "MBA" }])).toBe("MBA");
    expect(highestQualification([{ degree: "Diploma in Nursing" }, { degree: "Advanced Diploma in Perioperative Nursing" }])).toBe("Diploma in Nursing"); // equal level keeps the CV's order
    expect(highestQualification([{ degree: "PhD Physics" }, { degree: "MSc Physics" }])).toBe("PhD Physics");
  });
  test("an unknown qualification is still shown, and an empty list shows nothing", () => {
    expect(highestQualification([{ degree: "Ambagstoets (Trade test)" }])).toBe("Ambagstoets (Trade test)");
    expect(highestQualification([])).toBe("");
    expect(highestQualification([{ degree: "  " }])).toBe("");
  });
});

describe("profile at a glance", () => {
  test("only facts the CV states, joined plainly", () => {
    expect(profileAtAGlance({ role: "Software Architect", experience: "9", location: "Johannesburg, South Africa", education: [{ degree: "BSc Computer Science" }], workHistory: [{ company: "Natus Lab", endDate: "Present" }] }))
      .toBe("Software Architect at Natus Lab · 9+ years of dated experience · BSc Computer Science · Johannesburg, South Africa");
  });
  test("the job held at the employer is named by its own title, not by the candidate's headline", () => {
    expect(profileAtAGlance({ role: "HR Generalist", workHistory: [{ position: "HR Manager", company: "Rand Auto Parts", endDate: "Present" }, { position: "HR Officer", company: "Gold Reef Services", endDate: "2018" }] }))
      .toBe("HR Manager at Rand Auto Parts");
  });
  test("missing facts are left out, not guessed", () => {
    expect(profileAtAGlance({ role: "Nurse" })).toBe("Nurse");
    expect(profileAtAGlance({})).toBe("");
    expect(profileAtAGlance({ experience: "0", role: "Graduate" })).toBe("Graduate · under a year of dated experience");
  });
});

describe("highest qualification and whether it was finished", () => {
  test("prefers a finished qualification over a higher one still being studied", () => {
    expect(highestQualification([{ degree: "MBA", status: "in_progress" }, { degree: "BCom Accounting", status: "completed" }])).toBe("BCom Accounting");
  });
  test("says so when the only qualification is still in progress", () => {
    expect(highestQualification([{ degree: "BSc Computer Science", status: "in_progress" }])).toBe("BSc Computer Science (in progress)");
  });
  test("never shows a qualification that was not completed", () => {
    expect(highestQualification([{ degree: "BA Law", status: "not_completed" }])).toBe("");
    expect(highestQualification([{ degree: "BA Law", status: "not_completed" }, { degree: "Matric", status: "completed" }])).toBe("Matric");
  });
  test("treats an entry with no stated status as finished, so older records keep working", () => {
    expect(highestQualification([{ degree: "Diploma in Nursing" }])).toBe("Diploma in Nursing");
  });
  // Code review, 16 Nov 2026, G-M10: an MBA the record says has no record of completion was shown bare ("12+ yrs · MBA · Johannesburg") while the
  // Education tab said "No record of completion".
  test("never shows a qualification with no record of completion as held: a finished one wins, and alone it says so", () => {
    expect(highestQualification([{ degree: "MBA", status: "not_stated" }, { degree: "BCom Accounting", status: "completed" }])).toBe("BCom Accounting");
    expect(highestQualification([{ degree: "MBA", status: "not_stated" }])).toBe("MBA (no record of completion)");
    expect(highestQualification([{ degree: "MBA", status: "not_stated" }, { degree: "BSc", status: "in_progress" }])).toBe("BSc (in progress)");
    expect(highestQualification([{ degree: "BCom", status: "listed" }])).toBe("BCom");   // listed in the CV as held: shown as completed (as listed)
  });
});
