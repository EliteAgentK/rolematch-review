import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Document, Packer, Paragraph } from "docx";
import { supported } from "../src/extract";
import { readText, sniff } from "../src/parse";
import { parseCv } from "../src/rules";
import { CVS } from "./corpus";

const toDocx = async (t: string) => new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children: t.split("\n").map((l) => new Paragraph(l)) }] })));
const pdf = (id: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`./corpus/pdf/${id}.pdf`, import.meta.url))));

// PDFs wrap long paragraphs onto different lines than Word, so compare the facts, not the quoted line.
const noQuotes = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (k, x) => (k === "quote" ? undefined : x)));

async function both(kind: "cv", id: string) {
  const text = CVS[id];
  const d = await readText(await toDocx(text), "docx");
  const p = await readText(pdf(`${kind}-${id}`), "pdf");
  return { d, p, docx: parseCv(d), pdf: parseCv(p) };
}

describe("file reading", () => {
  test("real PDFs and Word files are recognised by their bytes", async () => {
    expect(sniff(pdf("cv-classic"))).toBe("pdf");
    expect(sniff(await toDocx("hello"))).toBe("docx");
    expect(sniff(new TextEncoder().encode("MZ executable"))).toBeNull();
  });
  test("Word and PDF versions of the same document parse identically", async () => {
    for (const id of Object.keys(CVS)) { const r = await both("cv", id); expect(noQuotes(r.pdf), `cv ${id}`).toEqual(noQuotes(r.docx)); }
  });
});

describe("CV parser", () => {
  test("classic layout", async () => {
    const { docx: c } = await both("cv", "classic");
    expect(c).toMatchObject({ fullName: "Jordan Example", email: "jordan.example@example.test", phone: "011 000 0000", location: "Johannesburg, South Africa", currentRole: "Senior Developer" });
    expect(c.skills.map((s) => s.name)).toEqual(expect.arrayContaining(["TypeScript", "JavaScript", "React", "Node.js", "PostgreSQL", "REST APIs", "Git", "Docker", "AWS", "Jest"]));
    expect(c.workHistory.map((w) => [w.position, w.company, w.startDate, w.endDate])).toEqual([["Senior Developer", "Acme Software", "2019-03", "Present"], ["Developer", "Bright Apps", "2016-01", "2019-02"]]);
    expect(c.workHistory[0].responsibilities).toHaveLength(2);
    expect(c.education[0]).toMatchObject({ qualification: "BSc Computer Science", institution: "University of Example", period: "2015" });
    expect(c.projects).toHaveLength(1);
  });

  test("stacked layout, uppercase headings, categorised skills, certifications, languages", async () => {
    const { docx: c } = await both("cv", "stacked");
    expect(c.fullName).toBe("Samantha Test-Ngwenya");
    expect(c.location).toBe("Cape Town, South Africa");
    expect(c.skills.map((s) => s.name)).toEqual(expect.arrayContaining(["Python", "SQL", "Scala", "AWS", "Spark", "Airflow", "Kafka", "Docker", "CI/CD"]));
    expect(c.workHistory.map((w) => [w.position, w.company, w.startDate, w.endDate])).toEqual([["Lead Data Engineer", "Northwind Analytics", "March 2021", "Present"], ["Data Engineer", "Contoso Retail", "January 2017", "February 2021"]]);
    expect(c.education[0]).toMatchObject({ qualification: "BSc (Hons) Information Systems", institution: "University of Cape Town", period: "2012 - 2015" });
    expect(c.education.filter((e) => e.fromCertifications).map((e) => e.qualification)).toEqual(["AWS Certified Data Analytics - Specialty"]); // certifications are entries of the Education list
    expect(c.languages).toEqual(["English", "Afrikaans"]);
  });

  test("'Title at Company | dates' style with MM/YYYY and 'Sept' dates", async () => {
    const { docx: c } = await both("cv", "atstyle");
    expect(c.currentRole).toBe("Product Designer");
    expect(c.workHistory.map((w) => [w.position, w.company, w.startDate, w.endDate])).toEqual([["Product Designer", "Wave Studio", "08/2019", "11/2023"], ["UX Designer", "Pixel Co", "Sept 2016", "July 2019"]]);
    expect(c.education[0]).toMatchObject({ qualification: "Diploma in Graphic Design", institution: "Durban Institute of Design", period: "2015" });
    expect(c.skills.map((s) => s.name)).toEqual(expect.arrayContaining(["Figma", "Design systems", "User research", "Prototyping", "Agile"]));
  });

  test("non-technical CV (sales, matric, South African qualification wording)", async () => {
    const { docx: c } = await both("cv", "sales");
    expect(c.workHistory.map((w) => [w.position, w.company, w.startDate, w.endDate])).toEqual([["Sales Manager", "BrightFoods", "2017", "2023"], ["Sales Representative", "FreshCo", "2012", "2016"]]);
    expect(c.education[0]).toMatchObject({ qualification: "National Senior Certificate", institution: "Pretoria Boys High School" });
    expect(c.skills.map((s) => s.name)).toEqual(expect.arrayContaining(["Negotiation", "Account management", "Excel", "CRM"]));
  });

  test("graduate: projects, internship and volunteering are captured; a role-word surname is still a name", async () => {
    const { docx: c } = await both("cv", "graduate");
    expect(c.fullName).toBe("Naledi Graduate");
    expect(c.projects).toHaveLength(2);
    expect(c.workHistory).toHaveLength(1);
    expect(c.workHistory[0]).toMatchObject({ position: "Software Intern", company: "Example Labs" });
    expect(c.worthNoting[0].text).toContain("coding club");
  });

  test("a sentence that merely mentions dates is not turned into a job", async () => {
    const { docx: c } = await both("cv", "trap");
    expect(c.workHistory.map((w) => w.position)).toEqual(["Operations Lead", "Operations Analyst"]);
    expect(c.workHistory[0].responsibilities.join(" ")).toContain("doubled throughput");
    expect(c.location).toBe("Port Elizabeth, South Africa");
  });

  test("a cover letter with no headings: finds what is stated and invents nothing", async () => {
    const { docx: c } = await both("cv", "noheadings");
    expect(c.fullName).toBe("Chris Letter");
    expect(c.email).toBe("chris.letter@example.test");
    expect(c.skills.map((s) => s.name).sort()).toEqual(["Django", "Python"]);
    expect(c.workHistory).toEqual([]);
    expect(c.education).toEqual([]);
    expect(c.location).toBe("");
  });

  test("every extracted fact is grounded: its quote really appears in the document (Word and PDF)", async () => {
    for (const id of Object.keys(CVS)) {
      const r = await both("cv", id);
      for (const [text, c] of [[r.d, r.docx], [r.p, r.pdf]] as const)
        for (const item of [...c.skills, ...c.workHistory, ...c.education, ...c.projects, ...c.worthNoting]) expect(supported(text, (item as any).quote), `${id}: ${JSON.stringify(item).slice(0, 80)}`).toBe(true);
    }
  });

  test("never fabricates: empty and garbage input produce empty records, not invented people", () => {
    expect(parseCv("")).toMatchObject({ fullName: "", email: "", workHistory: [], skills: [], education: [] });
    const g = parseCv("asdf qwer 1234 !!!\n\n???");
    expect(g.workHistory).toEqual([]);
    expect(g.fullName).toBe("");
  });
});

// Job descriptions are read by Claude (src/jobReader.ts, test/job-reader.test.ts) since 10 Nov 2026; the job parser and its tests are removed.

describe("skills read from a scan", () => {
  test("dots misread as colons and dashes still split the list", () => {
    const c = parseCv("Ahmed Patel\nahmed@example.test | 060 555 0107\nSkills\nSQL - Python - Power BI: Excel - Data cleaning : Statistics\nExperience\nAnalyst, Acme (Jan 2020 - Present)\nBuilt reports.");
    expect(c.skills.map((s) => s.name)).toEqual(expect.arrayContaining(["SQL", "Python", "Power BI", "Excel", "Data cleaning", "Statistics"]));
    expect(c.skills.map((s) => s.name).filter((n) => /:|-/.test(n))).toEqual([]);
  });
});

describe("protected personal details never reach a record", () => {
  test("ID number, date of birth, gender, marital status and nationality are dropped wherever they are written", () => {
    const cv = `Zanele Khumalo\nzanele@example.test | 072 555 0101 | Durban, South Africa\nID number: 9004015800081 | Date of birth: 1 April 1990 | Gender: Female | Marital status: Single | Nationality: South African | Driver's licence: Code 08\nI am a hard-working sales representative with six years of experience in retail and distribution across KwaZulu-Natal.\nExperience\nSales Representative, Acme Foods (Jan 2020 - Present)\nSold products to retailers.\nSkills\nNegotiation, CRM, Excel`;
    const c = parseCv(cv), blob = JSON.stringify(c);
    for (const secret of ["9004015800081", "1 April 1990", "Female", "Single", "South African", "Marital", "Nationality"]) expect(blob, secret).not.toContain(secret);
    expect(c.fullName).toBe("Zanele Khumalo"); expect(c.workHistory.length).toBe(1);                      // and nothing else was lost
    expect(JSON.stringify(parseCv("Age: 34\nGender: Male\nSipho Dlamini\nsipho@example.test"))).not.toMatch(/Male|34/);
  });
});
