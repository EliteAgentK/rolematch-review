import { describe, expect, test } from "vitest";
import { ALWAYS_EDITABLE, CONFIGURABLE, defaultEditing, editableFields, NEVER_EDITABLE } from "../src/editPolicy";
import { defaultSettings } from "../src/settings";

describe("what a recruiter may change", () => {
  test("by default: notes and corrections to who the person is; everything the CV states is locked", () => {
    const e = defaultEditing(), can = editableFields("candidate", e);
    expect(can.sort()).toEqual(["email", "location", "name", "phone", "recruiterNotes"].sort());
    for (const locked of ["role", "summary", "skills", "workHistory", "education", "projects", "worthNoting"]) expect(can, locked).not.toContain(locked);
  });
  test("what the platform works out is never editable, whatever an organisation sets", () => {
    const everything = { candidate: Object.fromEntries(Object.keys(CONFIGURABLE.candidate).map((k) => [k, true])), job: Object.fromEntries(Object.keys(CONFIGURABLE.job).map((k) => [k, true])) };
    const can = editableFields("candidate", everything);
    for (const f of NEVER_EDITABLE.candidate) expect(can, f).not.toContain(f);   // years of experience, certifications list, languages
    expect(can).toContain("workHistory");                                       // while an organisation that chooses to may edit the CV's own content
  });
  test("a job's own specification is editable by default, but skills (worked out from the requirements) are not", () => {
    const can = editableFields("job", defaultEditing());
    for (const f of ["title", "company", "location", "department", "type", "workArrangement", "description", "responsibilities", "requirements", "preferredRequirements", "status"]) expect(can, f).toContain(f);
    expect(can).not.toContain("skills");
  });
  test("the recruiter's own notes cannot be switched off; a person's stage is worked out from their status for each job, never edited on them", () => {
    expect(ALWAYS_EDITABLE.candidate).toEqual(["recruiterNotes"]);
    expect(NEVER_EDITABLE.candidate).toContain("status");   // production review, 12 Nov 2026: set for a job (applications.ts), never on the person
    const none = { candidate: Object.fromEntries(Object.keys(CONFIGURABLE.candidate).map((k) => [k, false])), job: Object.fromEntries(Object.keys(CONFIGURABLE.job).map((k) => [k, false])) };
    expect(editableFields("candidate", none).sort()).toEqual(["recruiterNotes"]);
  });
  test("the policy is part of every organisation's settings, with these defaults", () => {
    expect(defaultSettings().editing).toEqual(defaultEditing());
  });
});
