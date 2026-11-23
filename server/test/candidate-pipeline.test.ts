import { Document, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, describe, expect, test, vi } from "vitest";
import { readCandidate } from "../src/candidatePipeline";
import * as model from "../src/docmodel/model";
import { prepareDocument } from "../src/prepare";
import { defaultSettings } from "../src/settings";

// The candidate pipeline, from a file to a record, on invented documents. Each test is the regression for a defect in server/test/failures/register.json.
const on = () => defaultSettings();
const AS_OF = new Date("2026-10-28T00:00:00Z");
const read = (bytes: Uint8Array, org = on()) => prepareDocument(bytes, { kind: "cv", org, asOf: AS_OF }) as Promise<any>;
const txt = (s: string) => new TextEncoder().encode(s);
async function pdf(draw: (p: any, font: any, bold: any) => void) { const d = await PDFDocument.create(), font = await d.embedFont(StandardFonts.Helvetica), bold = await d.embedFont(StandardFonts.HelveticaBold), p = d.addPage([595, 842]); draw(p, font, bold); return new Uint8Array(await d.save()); }
const BODY = ["Experience", "Financial Manager", "Northwind Traders | 2018-01 to Present | Permanent", "- Prepared monthly statements for the board and led the audit team across three regions in the group.", "- Reviewed budgets with each regional director every quarter and reported the variances to the executive committee.", "- Reduced the month end close from nine working days to five by standardising the reconciliation templates.", "Education", "BCom Accounting | University of Pretoria | Completed | 2012"];
const lines = (...l: string[]) => txt(l.join("\n"));
afterEach(() => { vi.restoreAllMocks(); });

describe("the one reader", () => {
  test("the version says so", async () => {
    const r = await read(lines("Thandi Mokoena", "thandi@mail.example", ...BODY));
    expect(r.meta.parserVersion).toContain("candidate-7"); expect(r.meta.pipeline).toBe("candidate-7");
  });
});

describe("R50 lists separated by slashes", () => {
  test("every skill, including one wrapped across lines", async () => {
    const r = await read(lines("Thandi Mokoena", "thandi@mail.example", "Skills", "Excel / Reporting / Microsoft", "Teams / Budgeting", ...BODY));
    expect(r.record.skills).toEqual(expect.arrayContaining(["Excel", "Reporting", "Microsoft Teams", "Budgeting"]));
    expect(r.record.skills).not.toContain("Microsoft");
  });
  test("a slash inside a name stays whole", async () => {
    const r = await read(lines("Thandi Mokoena", "thandi@mail.example", "Skills", "CI/CD / TCP/IP / Excel", ...BODY));
    expect(r.record.skills).toEqual(expect.arrayContaining(["CI/CD", "TCP/IP"]));
  });
});

describe("R51 and R52 columns", () => {
  const left = ["Thandi Mokoena", "thandi@mail.example", "Skills", "Excel", "Reporting", "Budgeting", "Audit"], right = ["Experience", "Financial Manager", "Northwind Traders | 2018-01 to Present | Permanent", "- Prepared monthly statements for the board.", "- Led the audit team across three regions.", "Education", "BCom Accounting | University of Pretoria | Completed | 2012"];
  test("a sidebar and a main column are not read straight across", async () => {
    const r = await read(await pdf((p, font) => { left.forEach((s, i) => p.drawText(s, { x: 40, y: 780 - i * 18, size: 10, font })); right.forEach((s, i) => p.drawText(s, { x: 230, y: 780 - i * 18, size: 10, font })); for (let i = 0; i < 14; i++) p.drawText(`Further detail on delivery line ${i} of the main column text.`, { x: 230, y: 640 - i * 16, size: 10, font }); }));
    expect(r.meta.readingOrder).toBe("columns");
    expect(r.record.skills).toEqual(expect.arrayContaining(["Excel", "Reporting", "Budgeting", "Audit"]));
    expect(r.record.workHistory[0].company).toBe("Northwind Traders");
  });
  test("headings in a margin lead what sits beside them", async () => {
    const rows: [string, string[]][] = [["SKILLS", ["Excel / Reporting / Budgeting"]], ["EXPERIENCE", ["Financial Manager", "Northwind Traders | 2018-01 to Present | Permanent", "- Prepared monthly statements for the board."]], ["EDUCATION", ["BCom Accounting | University of Pretoria | Completed | 2012"]], ["COURSES", ["Business Writing Certificate | Northbridge Learning | Completed | 2023"]]];
    const r = await read(await pdf((p, font) => { p.drawText("Thandi Mokoena", { x: 40, y: 800, size: 22, font }); p.drawText("thandi@mail.example", { x: 40, y: 775, size: 10, font }); let y = 740; for (const [h, body] of rows) { p.drawText(h, { x: 40, y, size: 10, font }); body.forEach((b) => { p.drawText(b, { x: 170, y, size: 10, font }); y -= 16; }); y -= 10; } for (let i = 0; i < 5; i++) { p.drawText(`Further detail line ${i} with enough words to fill the row.`, { x: 170, y, size: 10, font }); y -= 16; } }));
    expect(r.record.skills).toEqual(expect.arrayContaining(["Excel", "Reporting", "Budgeting"]));
    expect(r.record.workHistory[0].position).toBe("Financial Manager");
    expect(r.record.education.map((e: any) => e.degree)).toEqual(expect.arrayContaining(["Business Writing Certificate"]));
  });
  test("a table whose sides line up is read row by row", async () => {
    const r = await read(await pdf((p, font) => { p.drawText("Thandi Mokoena", { x: 40, y: 800, size: 22, font }); p.drawText("thandi@mail.example", { x: 40, y: 775, size: 10, font }); p.drawText("Skills", { x: 40, y: 750, size: 10, font }); ["Excel | Advanced", "Reporting | Good"].forEach((s, i) => p.drawText(s, { x: 40, y: 730 - i * 14, size: 10, font })); ["Northwind", "Southwind", "Eastwind", "Westwind", "Midwind", "Highwind"].forEach((s, i) => { p.drawText(`Company ${s}`, { x: 40, y: 680 - i * 16, size: 10, font }); p.drawText(`Value ${i}`, { x: 300, y: 680 - i * 16, size: 10, font }); }); BODY.forEach((b, i) => p.drawText(b.slice(0, 90), { x: 40, y: 560 - i * 16, size: 10, font })); }));
    expect(r.text, r.text).toMatch(/Company Northwind\s*\|?\s*Value 0/);
  });
});

describe("R53 records written with bars", () => {
  test("a course's name, issuer and status are separate", async () => {
    const r = await read(lines("Thandi Mokoena", "thandi@mail.example", ...BODY, "Courses", "Business Writing Certificate | Northbridge Learning | Completed | 2023", "Leadership Programme | Eastshore Academy | In progress | 2027"));
    const c = r.record.education.filter((e: any) => e.type === "certificate"), by = (n: string) => c.find((e: any) => e.degree === n);
    expect(by("Business Writing Certificate")).toMatchObject({ institution: "Northbridge Learning", status: "completed" });
    expect(r.record.education.find((e: any) => e.degree === "Leadership Programme")).toMatchObject({ institution: "Eastshore Academy", status: "in_progress" });
  });
  test("one that wrapped in the middle of a piece keeps the whole issuer and its status", async () => {
    const r = await read(lines("Thandi Mokoena", "thandi@mail.example", ...BODY, "Courses", "Business Writing Certificate | Northbridge", "Professional Learning | Completed | 2023"));
    expect(r.record.education.find((e: any) => e.degree === "Business Writing Certificate")).toMatchObject({ institution: "Northbridge Professional Learning", status: "completed" });
  });
  test("one wrapped across lines is rejoined", async () => {
    const r = await read(lines("Thandi Mokoena", "thandi@mail.example", ...BODY, "Courses", "Business Writing Certificate |", "Northbridge Learning", "| Completed | 2023"));
    expect(r.record.education.find((e: any) => e.degree === "Business Writing Certificate")).toMatchObject({ institution: "Northbridge Learning" });
  });
});

test("R57 a form's employment records, each with its employer and dates", async () => {
  const r = await read(lines("Candidate Name: Thandi Mokoena", "thandi@mail.example", "Employment History", "EMPLOYER | Northwind Traders", "POSITION HELD | Financial Manager", "DURATION | Jan 2019 - Mar 2021", "- Prepared the monthly statements for the board and the audit committee each quarter.", "EMPLOYER | Southwind Holdings", "POSITION HELD | Accountant", "DURATION | Feb 2015 - Dec 2018", "- Reconciled supplier accounts across the three regional offices every month.", "Education", "BCom Accounting | University of Pretoria | Completed | 2012"));
  expect(r.record.workHistory.map((w: any) => [w.position, w.company])).toEqual([["Financial Manager", "Northwind Traders"], ["Accountant", "Southwind Holdings"]]);
  expect(r.record.workHistory[0].responsibilities.join(" ")).toMatch(/monthly statements/);
});

test("R58 'Key achievements' under one role does not lose the roles after it", async () => {
  const r = await read(lines("Thandi Mokoena", "thandi@mail.example", "Work Experience", "Financial Manager", "Northwind Traders", "March 2019 - Present", "- Prepared the monthly statements for the board and the audit committee each quarter.", "Key Achievements", "- Reduced month end by four days across the group.", "Accountant", "Southwind Holdings", "February 2015 - December 2018", "- Reconciled supplier accounts across the three regional offices every month.", "Education", "BCom Accounting | University of Pretoria | Completed | 2012"));
  expect(r.record.workHistory.map((w: any) => w.position)).toEqual(["Financial Manager", "Accountant"]);
});

test("R59 only what names a language is a language", async () => {
  const r = await read(lines("Thandi Mokoena", "thandi@mail.example", ...BODY, "Languages", "English | Excellent | Excellent", "isiZulu (fluent)", "Read Write Speak"));
  expect(r.record.languages).toEqual(["English", "isiZulu"]);
});

test("R60 stacked dates in any form", async () => {
  const r = await read(lines("Thandi Mokoena", "thandi@mail.example", "Employment record", "2020/01", "to", "Current", "Financial Manager", "Northwind Traders | Permanent", "- Prepared the monthly statements for the board and the audit committee each quarter.", "Education", "BCom Accounting | University of Pretoria | Completed | 2012", "Further reading on delivery work in this role, across all of the regional offices, for the board."));
  expect(r.record.workHistory[0]).toMatchObject({ position: "Financial Manager", company: "Northwind Traders" }); expect(r.record.workHistory[0].startDate).toBeTruthy();
});

test("R60 dates with a full stop, or stacked in a narrow column, are still dates", async () => {
  const r = await read(lines("Thandi Mokoena", "thandi@mail.example", "Work Experience", "Jan. 2021", "to", "Current", "Financial Manager", "Northwind Traders | Permanent", "- Prepared the monthly statements for the board and the audit committee each quarter.", "Accountant", "Southwind Holdings | Feb. 2015 - Dec. 2020 | Permanent", "- Reconciled supplier accounts across the three regional offices every month.", "Education", "BCom Accounting | University of Pretoria | Completed | 2012"));
  expect(r.record.workHistory.map((w: any) => [w.position, w.startDate])).toEqual([["Financial Manager", "Jan 2021"], ["Accountant", "Feb 2015"]]);
});

test("R61 a role carried over a page break is one role, and a later heading does not become its employer", async () => {
  const r = await read(lines("Thandi Mokoena", "thandi@mail.example", "Professional Experience", "Financial Manager", "Northwind Traders | 2018-01 to Present | Permanent", "- Prepared the monthly statements for the board and the audit committee each quarter.", "Financial Manager at Northwind Traders continued", "- Reviewed budgets with each regional director every quarter and reported the variances.", "Qualifications and projects", "Earlier work experience", "Accountant", "Southwind Holdings | 2015-02 to 2017-12 | Permanent", "- Reconciled supplier accounts across the three regional offices every month.", "Education", "BCom Accounting | University of Pretoria | Completed | 2012"));
  expect(r.record.workHistory.map((w: any) => [w.position, w.company])).toEqual([["Financial Manager", "Northwind Traders"], ["Accountant", "Southwind Holdings"]]);
  expect(r.record.workHistory[0].responsibilities.join(" ")).toMatch(/regional director/);
});

test("R62 a qualification and its institution on two lines stay two fields", async () => {
  const r = await read(lines("Thandi Mokoena", "thandi@mail.example", ...BODY.slice(0, 6), "Qualifications", "BCom Risk Management", "Moorland Business College | Completed | 2010", "Training record", "Internal Quality Review | Hillmere Skills Academy | In progress | 2027", "Availability and languages", "Notice period: Two calendar months", "Working preference: Office based"));
  expect(r.record.education.find((e: any) => e.degree === "BCom Risk Management")).toMatchObject({ institution: "Moorland Business College" });
  expect(r.record.education.find((e: any) => e.degree === "Internal Quality Review")).toMatchObject({ institution: "Hillmere Skills Academy", status: "in_progress" });
  expect(r.record.education.map((e: any) => e.degree).join(" ")).not.toMatch(/Notice period|Working preference/);
});

test("R63 running text beside a skills list does not become skills", async () => {
  const r = await read(lines("Thandi Mokoena", "thandi@mail.example", "Skills overview", "Reporting / Risk registers / Excel", "Examples of applied capability", "Reporting | Risk registers", "I begin an assignment by checking the source, expected | When information is missing, I record the gap", ...BODY));
  expect(r.record.skills).toEqual(expect.arrayContaining(["Reporting", "Risk registers", "Excel"]));
  expect(r.record.skills.join(" ")).not.toMatch(/expected|When information/);
});

test("R64 a line break inside a Word paragraph separates two lines", async () => {
  const doc = new Document({ sections: [{ children: [new Paragraph("Thandi Mokoena"), new Paragraph({ children: [new TextRun({ text: "Financial Manager" }), new TextRun({ text: "Pretoria", break: 1 })] }), ...["thandi@mail.example", ...BODY].map((t) => new Paragraph(t))] }] });
  const r = await read(new Uint8Array(await Packer.toBuffer(doc)));
  expect(r.record.role).toBe("Financial Manager"); expect(r.record.location).toBe("Pretoria");
});

test("R67 a label with its value on the same row is not itself a value", async () => {
  const r = await read(lines("Thandi Mokoena", "Address: | Sunninghill", "Phone: | +27 82 555 0199", "Email: | thandi@mail.example", ...BODY));
  expect(r.record.location).toBe("Sunninghill"); expect(r.record.phone).toBe("+27 82 555 0199");
});

test("R68 a Word table's rows stay records, and a running header is not an employer", async () => {
  const { Table, TableCell, TableRow } = await import("docx");
  const row = (...c: string[][]) => new TableRow({ children: c.map((ps) => new TableCell({ children: ps.map((t) => new Paragraph(t)) })) });
  const doc = new Document({ sections: [{ children: ["Thandi Mokoena", "thandi@mail.example", "Experience", "Financial Manager", "Northwind Traders | 2018-01 to Present | Permanent", "- Prepared the monthly statements for the board and the audit committee each quarter.", "Thandi Mokoena | Financial Manager", "Earlier Experience", "Southwind Holdings", "Accountant | 2014-02 to 2017-12 | Permanent", "- Reconciled supplier accounts across the three regional offices every month.", "Certifications"].map((t) => new Paragraph(t) as any).concat([new Table({ rows: [row(["Course and issuer"], ["Status"], ["Year"]), row(["Business Writing Certificate", "Northbridge Learning"], ["Completed"], ["2023"])] })]) }] });
  const r = await read(new Uint8Array(await Packer.toBuffer(doc)));
  expect(r.record.education.find((e: any) => e.degree === "Business Writing Certificate")).toMatchObject({ institution: "Northbridge Learning", status: "completed" });
  expect(r.record.workHistory.map((w: any) => w.company)).toEqual(["Northwind Traders", "Southwind Holdings"]);
});

test("R69 a job description's labels stay apart from their values", async () => {
  const { TextRun: TR } = await import("docx");
  const doc = new Document({ sections: [{ children: [new Paragraph("Senior Software Developer"), new Paragraph("Meridian Digital Solutions"), new Paragraph({ children: [new TR("Location"), new TR({ text: "Johannesburg South Africa", break: 1 })] }), new Paragraph("Required experience"), ...["Strong experience with TypeScript and JavaScript.", "Production experience with React and Node.js.", "Experience with Git and automated testing across a large team of engineers."].map((t) => new Paragraph(t))] }] });
  const r: any = await prepareDocument(new Uint8Array(await Packer.toBuffer(doc)), { kind: "jd", org: on(), asOf: AS_OF });
  // The text Claude reads keeps the label apart from its value; the job's fields themselves are Claude's to read (jobReader.ts; job-reader.test.ts).
  expect(r.text).not.toMatch(/LocationJohannesburg/);
  expect(r.text).toMatch(/Location\s+Johannesburg South Africa/);
  expect(r.meta.method).toBe("ai");
});

test("R75 a duty that wrapped keeps its opening, so what it says about leading others stands", async () => {
  const r = await read(lines("Thandi Mokoena", "thandi@mail.example", "Work Experience", "Head of Engineering", "Northwind Traders | 2018-01 to Present | Permanent", "- Lead the Centre of Excellence, driving the development of key technology practices, including", "Guidewire and Azure.", "- Managed the budget for the whole of the technology department and its vendors.", "Education", "BCom Accounting | University of Pretoria | Completed | 2012"));
  expect(r.record.workHistory[0].responsibilities[0]).toMatch(/including Guidewire and Azure\.$/);
});

test("R78, the cause of R77: a turned panel matches the paper, with no dark edge across its letters", async () => {
  const { invertDarkRegions } = await import("../src/imageprep");
  const w = 960, h = 960, g = new Float32Array(w * h).fill(245);
  for (let y = 100; y < 700; y++) for (let x = 60; x < 400; x++) g[y * w + x] = 130;   // a panel whose edges fall inside the grid's blocks
  for (let y = 200; y < 600; y += 30) for (let x = 70; x < 390; x += 4) for (let d = 0; d < 6; d++) g[(y + d) * w + x] = 248;   // light writing on it, right up to its edges
  const { out, inverted } = invertDarkRegions(g, w, h, 48, true);
  expect(inverted).toBeGreaterThan(0);
  expect(Math.abs(out[150 * w + 200] - 245)).toBeLessThan(8);     // inside the panel: the paper's colour
  expect(Math.abs(out[150 * w + 40] - 245)).toBeLessThan(8);      // just outside it, in a block the panel only partly fills: untouched
  expect(Math.abs(out[150 * w + 410] - 245)).toBeLessThan(8);
  expect(out[202 * w + 70]).toBeLessThan(60);                     // the writing at its very edge is dark
});

test("R79 skills one per line stay whole; a label does not stick to a title; a course and its issuer are not headings", async () => {
  const r = await read(lines("Thandi Mokoena", "Role Financial Manager", "thandi@mail.example", "SKILLS", "Reconciliations", "Report writing", "Stakeholder communication", "EXPERIENCE", "Financial Manager", "Northwind Traders | 2018-01 to Present | Permanent", "- Prepared the monthly statements for the board and the audit committee each quarter.", "CERTIFICATIONS", "Operational Reporting Certificate", "Harbour Learning Centre", "Supervisory Practice Programme", "Bridgeway Professional Training", "EDUCATION", "BCom Accounting | University of Pretoria | Completed | 2012"));
  expect(r.record.skills).toEqual(expect.arrayContaining(["Reconciliations", "Report writing", "Stakeholder communication"])); expect(r.record.skills).not.toContain("Stakeholder");
  expect(r.record.role).toBe("Financial Manager");
  expect(r.record.education.map((e: any) => e.degree)).toEqual(expect.arrayContaining(["Operational Reporting Certificate", "Supervisory Practice Programme"]));
});

test("R54 a skill keeps the name the document prints, never one from the dictionary", async () => {
  const r = await read(lines("Thandi Mokoena", "thandi@mail.example", "Profile", "Five years across supply chain teams in the group, improving delivery.", ...BODY));
  expect(r.record.skills).not.toContain("Supply chain management");
});

test("R55 a title above the name does not pull the contact line into the work history", async () => {
  const r = await read(lines("PROFESSIONAL EXPERIENCE AND CAPABILITIES", "Thandi Mokoena", "Financial Manager", "Pretoria | thandi@mail.example | 082 555 0199", ...BODY));
  expect(r.record.workHistory.map((w: any) => w.company)).not.toContain("Pretoria");
  expect(r.record.location).toBe("Pretoria");
});

test("R56 a name hidden in a Word file is not read as the person", async () => {
  const doc = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun({ text: "Sipho Dlamini", vanish: true, size: 60 })] }), ...["Thandi Mokoena", "thandi@mail.example", ...BODY].map((t) => new Paragraph({ children: [new TextRun(t)] }))] }] });
  const r = await read(new Uint8Array(await Packer.toBuffer(doc)));
  expect(r.record.name).toBe("Thandi Mokoena");
});

describe("each field says what happened to it", () => {
  test("found, with where it came from", async () => {
    const r = await read(lines("Thandi Mokoena", "thandi@mail.example", "082 555 0199", "Skills", "Excel, Reporting, Audit", ...BODY));
    expect(r.meta.fields.name).toMatchObject({ state: "found" }); expect(r.meta.fields.name.source).toBeTruthy(); expect(r.review.state).toBe("ok");
  });
  test("missing, and a usable record is still published and sent for review", async () => {
    const r = await read(lines("thandi@mail.example", "Skills", "Excel, Reporting, Audit", ...BODY));
    expect(r.ok).toBe(true); expect(r.record.name).toBe(""); expect(r.meta.fields.name.state).not.toBe("found"); expect(r.review.state).toBe("needs_review");
    expect(r.record.skills.length).toBeGreaterThan(0); expect(r.record.workHistory.length).toBeGreaterThan(0);
  });
  test("conflict: two names too close", async () => {
    const r = await read(lines("Candidate Name: Thandi Mokoena", "Candidate Name: Lerato Dube", ...BODY));
    expect(r.meta.fields.name.state).toBe("conflict"); expect(r.record.name).toBe(""); expect(r.review.state).toBe("needs_review");
  });
  test("conflict: two addresses with nothing to choose between them", async () => {
    const r = await read(lines("Thandi Mokoena", "tm1990@mail.example", "tm1991@other.example", ...BODY));
    expect(r.meta.fields.email.state).toBe("conflict"); expect(r.review.reasons.join(" ")).toMatch(/more than one address/);
  });
  test("unreadable: a heading with nothing readable under it", async () => {
    const r = await read(lines("Thandi Mokoena", "thandi@mail.example", "Profile", "Finance professional with eight years of experience.", "Education", "BCom Accounting | University of Pretoria | Completed | 2012", "Work Experience"));
    expect(r.meta.fields.workHistory.state).toBe("unreadable");
  });
  test("failed: if the layout cannot be read, the plain reading survives and says so", async () => {
    vi.spyOn(model, "buildDocModel").mockRejectedValue(new Error("boom"));
    const r = await read(lines("Thandi Mokoena", "thandi@mail.example", ...BODY));
    expect(r.ok).toBe(true); expect(r.record.name).toBe("Thandi Mokoena"); expect(r.meta.fields.name.state).toBe("failed"); expect(r.review.state).toBe("needs_review");
  });
  test("failed: if reading the layout never finishes, the document does not wait for it", async () => {
    vi.spyOn(model, "buildDocModel").mockReturnValue(new Promise(() => {}));
    const r = await readCandidate(lines("Thandi Mokoena", "thandi@mail.example", ...BODY), "txt", { text: ["Thandi Mokoena", "thandi@mail.example", ...BODY].join("\n"), issues: [] }, 0.05);
    expect(r.model).toBeNull(); expect(r.failed).toMatch(/within/); expect(r.text).toContain("Northwind Traders");
  });
  test("a document that does not read as a CV is still refused", async () => {
    const r = await read(lines("Invoice", ...Array.from({ length: 12 }, (_, i) => `Item ${i} of the delivery was invoiced to the customer as agreed in the order.`)));
    expect(r.ok).toBe(false); expect(r.code).toBe("IDENTITY_UNRESOLVED");
  });
});

describe("agency documents", () => {
  const form = ["Candidate Name: Thandi Mokoena", "To arrange a meeting with this candidate or to request further information please contact:", "Consultants Name | Peter Smith", "Consultants Number | 082 555 0100", "Consultants Email | peter.smith@brightpath.example", "Brightpath Recruitment", ...BODY];
  test("the candidate's fields hold none of the agency's details", async () => {
    const r = await read(lines(...form));
    expect(r.record.email).toBe(""); expect(r.record.phone).toBe("");
    expect(r.record.submission).toMatchObject({ contactRoute: "through-agency", agency: { name: "Brightpath Recruitment" }, recruiter: { name: "Peter Smith", email: "peter.smith@brightpath.example", phone: "082 555 0100" } });
  });
  test("being reachable through an agency is not a reason to review", async () => {
    expect((await read(lines(...form, "Skills", "Excel, Reporting, Audit"))).review.state).toBe("ok");
  });
  test("an agency's address cannot make a false duplicate: duplicates are checked on the candidate's own", async () => {
    let seen: any; await prepareDocument(lines(...form), { kind: "cv", org: on(), asOf: AS_OF, beforeReview: async (rec) => { seen = { ...rec }; } });
    expect(seen.email).toBe("");
  });
  test("a personal CV has no submission", async () => {
    expect((await read(lines("Thandi Mokoena", "thandi@mail.example", "082 555 0199", ...BODY))).record.submission).toBeUndefined();
  });
});

describe("review is for what matters", () => {
  test("a short skills list does not send a document to a person", async () => {
    const r = await read(lines("Thandi Mokoena", "thandi@mail.example", "082 555 0199", "Skills", "Excel", ...BODY));
    expect(r.review.state).toBe("ok"); expect(r.review.reasons).toEqual([]);
  });
  test("no way of reaching anyone does", async () => {
    expect((await read(lines("Thandi Mokoena", "Skills", "Excel, Audit, Reporting", ...BODY))).review.reasons.join(" ")).toMatch(/no way to reach/);
  });
});

// The test that a heading list cannot pass. The same CV under headings nobody has seen, in any order, must give the same record, because sections are read from what they hold.
describe("R65 sections are read from what they hold, whatever the headings say", () => {
  const SECTIONS: Record<string, string[]> = {
    work: ["Financial Manager", "Northwind Traders | 2018-01 to Present | Permanent", "- Prepared monthly statements for the board and led the audit team across three regions.", "Accountant", "Southwind Holdings | 2014-02 to 2017-12 | Permanent", "- Reconciled supplier accounts across the three regional offices every month."],
    skills: ["Excel / Reporting / Budgeting / Audit / Forecasting"],
    study: ["BCom Accounting | University of Pretoria | Completed | 2012", "Postgraduate Diploma in Tax | University of Johannesburg | In progress | 2027"],
    courses: ["Business Writing Certificate | Northbridge Learning | Completed | 2023", "Internal Quality Review | Hillmere Academy | In progress | 2027"],
    prose: ["I am a finance professional with eight years of experience in reporting, and I enjoy explaining the outcome to the people affected by it."],
  };
  const HEADS: Record<string, Record<string, string>> = {
    usual: { prose: "Profile", work: "Work Experience", skills: "Skills", study: "Education", courses: "Certifications" },
    unseen: { prose: "A Little About How I Think", work: "Where I Have Been", skills: "What I Bring", study: "What I Studied", courses: "Further Learning" },
    nonsense: { prose: "Part One", work: "Part Two", skills: "Part Three", study: "Part Four", courses: "Part Five" },
  };
  const ORDERS = [["prose", "work", "skills", "study", "courses"], ["courses", "study", "skills", "work", "prose"], ["skills", "prose", "courses", "work", "study"]];
  const asText = (heads: Record<string, string>, order: string[]) => lines("Thandi Mokoena", "thandi@mail.example", "082 555 0199", ...order.flatMap((k) => [heads[k].toUpperCase(), ...SECTIONS[k]]));
  const asPdf = (heads: Record<string, string>, order: string[]) => pdf((p, font, bold) => { let y = 810; const row = (s: string, f: any) => { p.drawText(s.slice(0, 95), { x: 40, y, size: 10, font: f }); y -= 15; }; p.drawText("Thandi Mokoena", { x: 40, y, size: 20, font: bold }); y -= 24; row("thandi@mail.example", font); row("082 555 0199", font); for (const k of order) { y -= 6; row(heads[k], bold); for (const l of SECTIONS[k]) row(l, font); } });
  const shape = (r: any) => ({ roles: r.record.workHistory.map((w: any) => [w.position, w.company]).sort(), skills: [...r.record.skills].filter((x: string) => ["Excel", "Reporting", "Budgeting", "Audit", "Forecasting"].includes(x)).sort(), edu: r.record.education.map((e: any) => [e.degree, e.institution]).sort(), summary: /finance professional/.test(r.record.summary ?? "") });
  const WANT = { roles: [["Accountant", "Southwind Holdings"], ["Financial Manager", "Northwind Traders"]], skills: ["Audit", "Budgeting", "Excel", "Forecasting", "Reporting"], edu: [["BCom Accounting", "University of Pretoria"], ["Business Writing Certificate", "Northbridge Learning"], ["Internal Quality Review", "Hillmere Academy"], ["Postgraduate Diploma in Tax", "University of Johannesburg"]].sort(), summary: true };
  for (const [name, heads] of Object.entries(HEADS)) for (const [o, order] of ORDERS.entries()) {
    test(`text in capitals, ${name} headings, order ${o + 1}`, async () => { expect(shape(await read(asText(heads, order)))).toEqual(WANT); });
    test(`PDF with bold headings, ${name} headings, order ${o + 1}`, async () => { expect(shape(await read(await asPdf(heads, order)))).toEqual(WANT); });
  }
});

// R82 and R84: why PDF lost skills that Word kept (longform-b1, mod 2, development group: 292 of 344 before, 331 after).
describe("R84 PDF skills: layouts and lists", () => {
  const label = (p: any, font: any, text: string, y: number) => p.drawText(text, { x: 40, y, size: 10, font });
  test("labels in a margin lead what sits beside them, whatever they say", async () => {
    const r = await read(await pdf((p, font) => {
      p.drawText("Thandi Mokoena", { x: 40, y: 800, size: 20, font }); p.drawText("thandi@mail.example", { x: 40, y: 775, size: 10, font }); p.drawText("+27 82 555 0100", { x: 40, y: 762, size: 10, font });
      const main = ["I work in finance, with a focus on monthly reporting and on explaining the outcome.", "Over ten years I moved from clerk to a senior role, and I enjoy the detail of it.", "SAP | Inventory | Forecasting | Demand planning | Replenishment | Report writing |", "Stakeholder communication", "Financial Manager", "Northwind Traders", "2018-01 - Present | Permanent", "Prepared monthly statements for the board.", "Led the audit team across three regions.", "Reconciled the accounts with the commercial teams.", "Reviewed stock cover and its exceptions every week."];
      const y = [720, 707, 668, 655, 616, 603, 590, 577, 564, 551, 538]; main.forEach((t, i) => p.drawText(t, { x: 150, y: y[i], size: 10, font }));
      label(p, font, "Summary of", 720); label(p, font, "experience", 707); label(p, font, "Professional", 668); label(p, font, "competencies", 655); label(p, font, "Current", 616); label(p, font, "appointment", 603);
    }));
    expect(r.record.skills).toEqual(expect.arrayContaining(["Inventory", "Demand planning", "Replenishment", "Stakeholder communication"]));
    expect(r.text).toMatch(/Professional competencies\nSAP \|/);
  });
  test("counterexample: a column of years is not labels", async () => {
    const r = await read(await pdf((p, font) => { p.drawText("Thandi Mokoena", { x: 40, y: 800, size: 20, font }); p.drawText("thandi@mail.example", { x: 40, y: 775, size: 10, font }); for (let i = 0; i < 4; i++) { p.drawText(String(2019 + i), { x: 40, y: 720 - i * 60, size: 10, font }); ["Certificate in Records Number " + i, "Harbour Learning Centre", "Completed", "Worked through the course over one long year."].forEach((t, k) => p.drawText(t, { x: 150, y: 720 - i * 60 - k * 13, size: 10, font })); } }));
    expect(r.text).not.toMatch(/^2019 Certificate/m);
  });
  test("words printed plainly in a list and in bold elsewhere are still items of the list", async () => {
    const m = (await import("../src/candidatePipeline")).emphasisedLines({ pages: [{ lines: [{ text: "Maintenance", style: { bold: true } }, { text: "Maintenance", style: { bold: false } }, { text: "SKILLS", style: { bold: true } }] }] } as any);
    expect(m.has("Maintenance")).toBe(false); expect(m.has("SKILLS")).toBe(true);
  });
  test("a list's row is not a heading, and the short line above a wrapped list is", async () => {
    const { sectionsByContent } = await import("../src/rules");
    const s = sectionsByContent(["Thandi Mokoena", "Areas of practice", "Change control / Governance /", "Dependencies / Reporting / MS", "Project / Budgeting / Report", "writing / Stakeholder", "communication", "Employment", "Financial Manager", "Northwind | 2018-01 to Present"]);
    expect(s.blocks.map((b: any) => [b.heading, b.kind])).toEqual(expect.arrayContaining([["Areas of practice", "skills"]]));
    expect(s.blocks.some((b: any) => /^Project \//.test(b.heading))).toBe(false);
  });
  test("counterexample: the first row of a slash list is not a heading above the rest of it", async () => {
    const { sectionsByContent } = await import("../src/rules");
    const s = sectionsByContent(["Thandi Mokoena", "SKILLS", "Microsoft 365 / Matter", "administration / Document control /", "Contract registers / Reporting /", "Planning", "EDUCATION", "BCom | University of Pretoria | Completed | 2014"]);
    expect(s.blocks.some((b: any) => /^Microsoft/.test(b.heading))).toBe(false);
  });
  test("counterexample: an ordinary short line above sentences is not made a heading by the list rule", async () => {
    const { sectionsByContent } = await import("../src/rules");
    const s = sectionsByContent(["Thandi Mokoena", "Skills", "Excel, Word", "Worked mainly in Durban", "I prepared the monthly statements and reconciled them with the bank."]);
    expect(s.blocks.some((b: any) => b.heading === "Worked mainly in Durban")).toBe(false);
  });
  test("a sentence running on across rows beside a list is two columns, not a table", async () => {
    const r = await read(await pdf((p, font) => { p.drawText("Thandi Mokoena", { x: 40, y: 800, size: 20, font }); p.drawText("thandi@mail.example", { x: 40, y: 775, size: 10, font }); const left = ["Based in Durban, I have worked in teams", "since 2013. My experience covers budgets,", "reports and the people who use them. I am", "comfortable with deadlines and with project", "work, and I keep good records of them."], right = ["Change control /", "Governance /", "Budgeting / Audit /", "Report writing /", "Payroll"]; p.drawText("Professional statement", { x: 40, y: 740, size: 10, font }); p.drawText("Areas of practice", { x: 320, y: 740, size: 10, font }); left.forEach((t, i) => p.drawText(t, { x: 40, y: 720 - i * 13, size: 10, font })); right.forEach((t, i) => p.drawText(t, { x: 320, y: 720 - i * 13, size: 10, font })); }));
    expect(r.record.skills).toEqual(expect.arrayContaining(["Change control", "Governance", "Budgeting", "Audit", "Report writing", "Payroll"]));
  });
});

describe("R76 a certificate that expired", () => {
  const cv = (certs: string[]) => lines("Thandi Mokoena", "thandi@mail.example", ...BODY, "Certifications", ...certs);
  test("is told apart from one still current and one the CV says nothing about", async () => {
    const r = await read(cv(["First Aid Certificate | Northbridge Learning | Expired | 2020", "Forklift Certificate | Northbridge Learning | Completed | 2024", "Fire Safety Certificate | Northbridge Learning | Valid until 2029"]));
    const by = (name: string) => r.record.education.find((e: any) => e.degree.startsWith(name));
    expect(by("First Aid")).toMatchObject({ validity: "expired", status: "completed" }); expect(by("Forklift").validity).toBe("unknown"); expect(by("Fire Safety").validity).toBe("current"); expect(by("Fire Safety").status).not.toBe("in_progress");
  });
});

// From the failed run lf-unseen-4 (R88), which then became development material.
describe("R88 what the failed run found", () => {
  const body = ["Skills", "Excel, Budgeting, Audit, Reporting", ...BODY];
  test("a form's words printed beside the name are not part of it, and do not make two rival names", async () => {
    const r = await read(lines("CURRICULUM Simphiwe Mashiane", "VITAE", "Customer Success Manager", "simphiwemashiane@mail.example | +27 82 555 0100 | Pretoria", ...body));
    expect(r.record.name).toBe("Simphiwe Mashiane");
  });
  test("counterexample: a person whose surname is also a form word keeps it when only two words would be left", async () => {
    const r = await read(lines("Thandi Position", "thandiposition@mail.example", ...body));
    expect(r.record.name).toBe("Thandi Position");
  });
  test("a name sharing a row with the address is still found", async () => {
    const r = await read(lines("George", "rochelledomingo@mail.example Rochelle Domingo", "+27 82 555 0100", ...body));
    expect(r.record.name).toBe("Rochelle Domingo"); expect(r.record.email).toBe("rochelledomingo@mail.example");
  });
  test("'Senior' in front of an earlier post stays in the title; a form's label does not", async () => {
    const senior = await read(lines("Thandi Mokoena", "Senior Financial Manager", "thandi@mail.example", ...body));
    expect(senior.record.role).toBe("Senior Financial Manager");
    const form = await read(lines("Thandi Mokoena", "Role Financial Manager", "thandi@mail.example", ...body));
    expect(form.record.role).toBe("Financial Manager");
  });
});
