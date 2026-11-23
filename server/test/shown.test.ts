import { expect, test } from "vitest";
import { shownReplacer } from "../src/shown";

// Owner, 11 Nov 2026: "why is Sipho Dlamini in caps ... everything needs to show up the same ... configure consistency through the site". Every reply goes
// through one rule; the record itself keeps the CV's wording.
const reply = (data: unknown) => JSON.parse(JSON.stringify(data, shownReplacer()));

test("a name, title, employer or qualification in capitals is shown in normal capitalisation, in the AI's form where it gave one, everywhere in a reply", () => {
  const out = reply({
    strongest: [{ candidateName: "SIPHO DLAMINI", candidateRole: "HEAD OF CENTRE OF EXCELLENCE", jobTitle: "CHIEF FINANCIAL OFFICER (CFO)" }],
    candidate: { name: "SIPHO DLAMINI", role: "HEAD OF TECHNOLOGY", displayNames: { "COASTLINE LIFE ASSURANCE": "Coastline Life Assurance" },
      workHistory: [{ position: "CIO", company: "COASTLINE LIFE ASSURANCE" }], education: [{ degree: "BCOM INFORMATICS", institution: "UNIVERSITY OF PRETORIA" }],
      summary: "LEADS A TEAM OF 40.", skills: ["SAP", "SQL"] },
    member: { name: "NALEDI KHUMALO", role: "admin" },
  });
  expect(out.strongest[0]).toEqual({ candidateName: "Sipho Dlamini", candidateRole: "Head of Centre of Excellence", jobTitle: "Chief Financial Officer (CFO)" });
  expect(out.candidate.name).toBe("Sipho Dlamini");
  expect(out.candidate.workHistory[0]).toEqual({ position: "CIO", company: "Coastline Life Assurance" });
  expect(out.candidate.education[0]).toEqual({ degree: "BCom Informatics", institution: "University of Pretoria" });
  expect(out.candidate.summary).toBe("LEADS A TEAM OF 40.");   // the CV's own sentences are never rewritten
  expect(out.candidate.skills).toEqual(["SAP", "SQL"]);
  expect(out.member).toEqual({ name: "Naledi Khumalo", role: "admin" });
});

test("a value that is not all capitals is the person's own writing and is left exactly as written", () => {
  expect(reply({ name: "Sipho Dlamini", title: "Head of IT", company: "Veldt IT" })).toEqual({ name: "Sipho Dlamini", title: "Head of IT", company: "Veldt IT" });
});

test("a job's stated facts are shown in their written form; codes that share a key are never touched", () => {
  const out = reply({ job: { title: "Business Analyst", requirements: [], location: "east london", type: "permanent", workArrangement: "remote within South Africa", reportsTo: "department manager",
    remuneration: "R2.1 million to R2.7 million", keyFacts: [{ label: "Notice", value: "one calendar month" }] },
    member: { role: "admin" }, education: [{ type: "certificate", degree: "Advanced Excel" }], portal: { role: "hiring_manager" } });
  expect(out.job).toMatchObject({ location: "East London", type: "Permanent", workArrangement: "Remote within South Africa", reportsTo: "Department Manager", remuneration: "R2.1 million to R2.7 million" });
  expect(out.job.keyFacts[0].value).toBe("One calendar month");
  expect(out.member.role).toBe("admin"); expect(out.education[0].type).toBe("certificate"); expect(out.portal.role).toBe("hiring_manager");
});
