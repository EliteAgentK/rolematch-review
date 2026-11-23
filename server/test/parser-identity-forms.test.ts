import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prepareDocument } from "../src/prepare";
import { parseCv } from "../src/rules";
import { defaultSettings } from "../src/settings";

// E4 (register R44): names on recruiter forms and agency layouts. Found on real CVs the owner supplied; every example here is invented and only keeps the layout's shape.
// Pre-registered criteria are in docs/parser/REAL_CV_EVALUATION.md. Runs with the experiment on; contract.test.ts holds the default.
const BODY = ["Profile", "Finance professional with eight years of experience in reporting and audit.", "Experience", "Financial Manager, Northwind Traders, Jan 2018 - Present", "Prepared monthly statements.", "Skills", "Excel, Budgeting, Reporting", "Education", "BCom Accounting, University of Pretoria, 2015"];
const name = async (...top: string[]) => ((await prepareDocument(new TextEncoder().encode([...top, ...BODY].join("\n")), { kind: "cv", org: defaultSettings(), asOf: new Date("2026-11-05T00:00:00Z") })) as any).record.name;

test("a form label is never a person's name", async () => {
  expect(await name("Position Applied for", "Senior Accountant", "Current Location", "Pretoria, Gauteng")).not.toMatch(/position|applied|location/i);
  expect(await name("Personal Information", "Nationality", "South African")).not.toMatch(/personal|information|nationality/i);
  expect(await name("Personal Details", "Available to Relocate", "Yes")).not.toMatch(/personal|details|available|relocate/i);
});

test("a labelled candidate name is read, with any spacing before the colon, and a nickname in brackets left out", async () => {
  expect(await name("Candidate Name: Thandi Mokoena", "Date: 12 May 2024", "Position Applied for | Senior Accountant")).toBe("Thandi Mokoena");
  expect(await name("Applicant Name       :    Thandi Mokoena")).toBe("Thandi Mokoena");
  expect(await name("Candidate Name: Bartholomew (Bart) Naidoo", "Position Applied for | Senior Accountant")).toBe("Bartholomew Naidoo");
});

test("first names and a surname on separate labelled lines are joined", async () => {
  expect(await name("Personal Information", "Full names        : Anna Marie", "Surname           : Botha", "ID Number         : 800101 5009 087")).toBe("Anna Marie Botha");
  expect(await name("First Name: Sipho", "Last Name: Dlamini")).toBe("Sipho Dlamini");
  expect(await name("Full names : Anna Botha", "Surname : Botha")).toBe("Anna Botha");   // already in the first line: not repeated
});

test("a name beside a phone number on one line is read, and a job title beside a link is not a name", async () => {
  expect(await name("Thandi Mokoena | 082 555 0199", "SENIOR FINANCE MANAGER | www.example.test/in/tmokoena")).toBe("Thandi Mokoena");
  expect(await name("SENIOR FINANCE MANAGER | www.example.test/in/tmokoena")).toBe("");
  expect(await name("CT RSA | www.linkedin.example/in/tmokoena")).toBe("");   // a bar before a link says nothing about a name (it published a wrong name in the first version of E4)
});

test("a name in a summary heading after a disclaimer is read, when the document backs it up", async () => {
  const top = ["DISCLAIMER", "Please read this notice carefully before you share this document with anyone else.", "POPI NOTICE:", "Please note this document contains personal information.", "EXECUTIVE OVERVIEW – LERATO THANDEKA MOKOENA", "Lerato is an experienced professional in finance.", "With 12 years of experience, Lerato has led several teams."];
  expect(await name(...top)).toBe("Lerato Thandeka Mokoena");
});

test("counterexamples stay out: a summary heading with no backing, another person's or a company's name label, and a reference's name", async () => {
  expect(await name("Executive Summary – Excellent Communicator")).toBe("");
  expect(await name("Executive Summary – Senior Sales Manager")).toBe("");
  expect(await name("Company Name: Northwind Traders")).toBe("");
  expect(await name("Contact Name: Peter Smith")).toBe("");
  expect(await name("Consultant Name: Peter Smith", "Candidate Name: Thandi Mokoena")).toBe("Thandi Mokoena");
  const withReference = parseCv(["Thandi Mokoena", "thandi@example.test", ...BODY, "References", "Name: Peter Smith", "Tel: 011 555 0100"].join("\n"));
  expect(withReference.fullName).toBe("Thandi Mokoena");
});

test("a labelled candidate name lower down an agency form is still read", async () => {
  const form = ["Position Applied for", "Senior Accountant", "Current Location", "Pretoria", ...Array.from({ length: 20 }, (_, i) => `Note ${i}: please read this section about the role carefully.`), "To arrange an interview with this candidate please contact:", "Recruitment Name", "Peter Smith", "Candidate Name: Thandi Mokoena"];
  expect(await name(...form)).toBe("Thandi Mokoena");
});

test("regressions the invented batch caught in the first version: a place, and a company in a heading, are not people", async () => {
  expect(await name("East London | someone@candidate.example | +27 00 540 0424")).not.toMatch(/east london/i);
  expect(await name("Johannesburg | someone@candidate.example")).not.toMatch(/johannesburg/i);
  const cv = ["CAREER PROFILE", "Ashleigh Matsoso", "Junior Financial Accountant", "Johannesburg | ashleighmatsoso.552@candidate.example | +27 00 552 0424", "Profile - Cedarwell Business Services", "At Cedarwell Business Services I prepared statements.", "Cedarwell Business Services promoted me twice."];
  expect(await name(...cv)).toBe("Ashleigh Matsoso");
});

test("regression on the real document's shape: an employer beside its dates is not a person, and the name above the contact line is found", async () => {
  const top = ["CAREER PROFILE", "Ashleigh Matsoso", "Junior Financial Accountant", "Johannesburg | ashleighmatsoso.552@candidate.example | +27 00 552 0424", "PROFILE", "Background in finance, with", "EXPERIENCE", "Financial Accountant", "Cedarwell Business Services | 2024-02 to Present | Fixed term contract", "Prepared statements."];
  expect(parseCv(top.join("\n")).fullName).toBe("Ashleigh Matsoso");
  expect(await name("Cedarwell Business Services | 2024-02 to Present | Fixed term contract")).toBe("");
  expect(await name("Northwind Traders Limited | 2019 - 2023")).toBe("");
});

test("a name directly above a job title is found when headings or a scan's order pushed it down, and other words above a title are not", async () => {
  expect(await name("PROFILE", "EXPERIENCE", "SKILLS", "EDUCATION", "COURSES", "PROJECTS", "DETAILS", "Tumelo", "HLONGWANE", "Senior ESG Analyst", "Worked on sustainability reporting for several clients.")).toBe("Tumelo Hlongwane");
  expect(await name("PROFILE", "EXPERIENCE", "Thandi Mokoena", "Finance Manager", "Worked on budgets.")).toBe("Thandi Mokoena");
  for (const above of ["Johannesburg", "Cape Town", "Current Position", "Work History", "Personal Details", "Northwind Traders Ltd: 2019"]) expect(await name("PROFILE", "EXPERIENCE", above, "Finance Manager", "Worked on budgets."), above).toBe("");
});

test("regressions the invented batch caught in the name-above-title rule: a preference, a sentence and a wrapped job title are not people", async () => {
  const nameOf = name;
  expect(await nameOf("PROFILE", "Working preference:", "Office based", "Senior Legal Operations Coordinator", "Worked on legal matters.")).toBe("");
  expect(await nameOf("EXPERIENCE", "Tracked currency exposure schedules", "Updated short term liquidity forecasts.", "Assistant Treasury Analyst", "Worked on treasury matters.")).toBe("");
  expect(await nameOf("Profile", "Senior Legal Operations", "Coordinator with", "ten years of experience in contracts.")).toBe("");
  expect(await nameOf("experience in sustainability teams.", "Analyst")).toBe("");
  expect(await nameOf("Pieter van der Merwe", "Finance Manager", "pieter@example.test")).toBe("Pieter van der Merwe");
});

test("names OCR left with stray bars, or printed over two lines above a title or contact line, are read", async () => {
  const nameOf = name;
  expect(await nameOf("| Siyanda Mahlako", "Junior Operations Manager", "Remote preferred")).toBe("Siyanda Mahlako");
  expect(await nameOf("Wandile | Sayed", "Senior Supply Chain Planner")).toBe("Wandile Sayed");
  expect(await nameOf("PROFILE", "TEBELLO", "CHAUKE", "Junior Management", "Worked on planning.")).toBe("Tebello Chauke");
  expect(await nameOf("PROFILE", "SKILLS", "Wandile", "Singh", "Windhoek | wandilesingh.528@candidate.example")).toBe("Wandile Singh");
  expect(await nameOf("Remote preferred", "Office based", "Three months")).not.toMatch(/remote|office/i);   // what the default parser published as names on the invented batch
});

// Was a known gap in the older reading; the identity reader judges the line, so no word list is needed. Older note:; docs/parser/OWN_PARSER_AND_OCR.md replaces it.
test("a name with a stray bar above a title the word list does not know", async () => {
  expect(await name("Siyanda Chauke |", "Sales Account Manager")).toBe("Siyanda Chauke");
});

test("ordinary CVs are unchanged", async () => {
  expect(await name("Thandi Mokoena", "Senior Accountant", "thandi@example.test")).toBe("Thandi Mokoena");
  expect(await name("Name: Thandi Mokoena")).toBe("Thandi Mokoena");
  expect(await name("Pieter van der", "Merwe", "pieter@example.test")).toBe("Pieter van der Merwe");
});

// E5 (register R44): a recruitment agency's contact details are not the candidate's. On real agency CVs the agency's e-mail and phone were published as the candidate's own.
describe("E5: agency contact details", () => {
    const form = ["Candidate Name: Thandi Mokoena", "Position Applied for | Senior Accountant", "Candidate Summary", "Thandi is a finance professional.", "To arrange an interview with this candidate please contact:", "Recruitment Name | Peter Smith", "Recruitment Number | 082 555 0100", "Recruitment Email | peter.smith@agency.example"];
  const contact = async (...top: string[]) => { const c: any = ((await prepareDocument(new TextEncoder().encode([...top, ...BODY].join("\n")), { kind: "cv", org: defaultSettings(), asOf: new Date("2026-11-05T00:00:00Z") })) as any).record; return { name: c.name, email: c.email, phone: c.phone }; };

  test("an interview-contact block is the agency's, on one line or on two", async () => {
    expect(await contact(...form)).toEqual({ name: "Thandi Mokoena", email: "", phone: "" });
    expect(await contact("Candidate Name: Thandi Mokoena", "Recruitment Name", "Peter Smith", "Recruitment Number", "+27 82 555 0100", "Recruitment Email", "peter.smith@agency.example")).toEqual({ name: "Thandi Mokoena", email: "", phone: "" });
    expect(await contact("Candidate Name: Thandi Mokoena", "Consultant Email: peter@agency.example", "Account Manager: 011 555 0100")).toEqual({ name: "Thandi Mokoena", email: "", phone: "" });
  });
  test("a letterhead line with a fax number is the organisation's", async () => {
    expect(await contact("EXECUTIVE OVERVIEW – LERATO MOKOENA", "Lerato has led teams.", "Lerato built systems.", "Tel: (+27 011) 555 010 Fax: (+27 011) 555 011 E-mail: office@agency.example")).toEqual({ name: "Lerato Mokoena", email: "", phone: "" });
  });
  test("an agency whose name appears in its own disclaimer is still an agency", async () => {
    expect(await contact("DISCLAIMER", "This document is confidential to Brightpath Recruitment.", "EXECUTIVE OVERVIEW – LERATO MOKOENA", "Lerato has led teams.", "Lerato built systems.", "Tel: (+27 011) 555 010 Fax: (+27 011) 555 011 E-mail: brightpath@agency.example")).toEqual({ name: "Lerato Mokoena", email: "", phone: "" });
  });
  test("the candidate's own details beside an agency block are kept", async () => {
    expect(await contact("Candidate Name: Thandi Mokoena", "thandi@mail.example", "082 555 0199", "Recruitment Email | peter.smith@agency.example", "Recruitment Number | 083 555 0100")).toEqual({ name: "Thandi Mokoena", email: "thandi@mail.example", phone: "082 555 0199" });
  });
  test("counterexamples keep their details: an ordinary CV, a recruiter's own CV, and a person's own fax", async () => {
    expect(await contact("Thandi Mokoena", "thandi@mail.example", "082 555 0199")).toEqual({ name: "Thandi Mokoena", email: "thandi@mail.example", phone: "082 555 0199" });
    expect(await contact("Thandi Mokoena", "Recruitment Consultant at Agency Ltd", "thandi@agency.example", "082 555 0199")).toEqual({ name: "Thandi Mokoena", email: "thandi@agency.example", phone: "082 555 0199" });
    expect(await contact("Thandi Mokoena", "Tel: 082 555 0199 Fax: 011 555 0100 E-mail: thandi.mokoena@mail.example")).toMatchObject({ name: "Thandi Mokoena", email: "thandi.mokoena@mail.example" });
  });
});

test("a sentence is not a name, whatever its place on the page", async () => {
  for (const line of ["Worked on budgets.", "Remote preferred", "Office based", "experience in sustainability teams."]) expect(await name(line, "Finance Manager"), line).not.toBe(line);
  // while a name can still carry initials and particles
  expect(await name("J.P. Smith", "Finance Manager", "jp@example.test")).toBe("J.P. Smith");
  expect(await name("Anna de la Rey", "Finance Manager", "anna@example.test")).toBe("Anna de la Rey");
});

// Known gap, kept visible: a name written all in lower case is left blank and sent to a person, which is safe but not read.
test.fails("a name in lower case is read when the address confirms it", async () => {
  expect(await name("thandi mokoena", "thandi.mokoena@example.test")).toMatch(/thandi mokoena/i);
});

// Known gap, kept visible: spaced initials leave the name blank and send it to a person, which is safe but not read.
test.fails("spaced initials are read", async () => {
  expect(await name("J. P. Smith", "Finance Manager", "jp@example.test")).toBe("J. P. Smith");
});

// Found by reading the messy documents the way the service reads them (2026-11-05). Each published a wrong or missing fact on the live path.
test("lettering spaced for display: the person's own address gives the word boundary", async () => {
  expect(await name("A H M E D P A T E L", "ahmed.patel@example.test | 060 555 0107")).toBe("Ahmed Patel");
  expect(await name("J O Ã O P E R E I R A", "joao.pereira@example.test")).toBe("João Pereira");
});
test("a section after References ends them: contact details printed last are the person's own", async () => {
  const lines = ["Ahmed Patel", "Experience", "Data Analyst, Zenith Logistics | Sep 2021 - Present", "Built Power BI dashboards used by operations managers every week.", "Education", "BSc Statistics, University of Johannesburg, 2018", "References", "Mr J. Referee, Head of Department", "jordan.referee@othercompany.test", "Cell: 083 999 0000", "Contact Details", "Email: ahmed.patel@example.test", "Cell: 060 555 0107"];
  const c: any = ((await prepareDocument(new TextEncoder().encode(lines.join("\n")), { kind: "cv", org: defaultSettings(), asOf: new Date("2026-11-05T00:00:00Z") })) as any).record;
  expect(c.email).toBe("ahmed.patel@example.test");
  expect(c.phone.replace(/\D/g, "")).toBe("0605550107");
});

// What an agency's name is, on real agency forms (shapes reproduced with invented names, 2026-11-05).
const agencyOf = async (...top: string[]) => (((await prepareDocument(new TextEncoder().encode([...top, ...BODY].join("\n")), { kind: "cv", org: defaultSettings(), asOf: new Date("2026-11-05T00:00:00Z") })) as any).record.submission?.agency?.name ?? "") as string;
test("an agency's name is its name: not the heading beside it, and not its phone number", async () => {
  expect(await agencyOf("Candidate Name: Thandi Mokoena", "Brightpath Consultants Interview Feedback", "To arrange a meeting with this candidate or to request further information please contact:", "Consultants Name | Peter Smith", "Consultants Email | peter@brightpath.example")).toBe("Brightpath Consultants");
});
test("presented by an agency, in so many words", async () => {
  expect(await agencyOf("CANDIDATE NAME: Thandi Mokoena PRESENTED BY: BRIGHTPATH PORTFOLIOS", "CONSULTANT: GLENDA PILLAY")).toMatch(/brightpath portfolios/i);
  expect(await agencyOf("PRESENTS", "THANDI MOKOENA", "CONSULTANT: GLENDA PILLAY", "BRIGHTPATH PORTFOLIOS TERMS AND CONDITIONS")).toMatch(/brightpath portfolios/i);
  expect(await agencyOf("Candidate: Thandi Mokoena", "Receipt of this curriculum vitae is deemed as acceptance of Network Search's standard terms & conditions of business")).toMatch(/network search/i);
});
