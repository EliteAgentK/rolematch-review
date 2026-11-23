// Reading faults found by the four-to-five-page invented CVs (npm run eval:extensive), each pinned here so it cannot come back (parser 2.6.0).
import { expect, test } from "vitest";
import { parseCv } from "../src/rules";
import { describeQualification } from "../src/qualifications";

const cv = (...sections: [string, string[]][]) => ["Test Person", "test.person@example.test", "", ...sections.flatMap(([h, ls]) => [h, ...ls, ""])].join("\n");
const roles = (text: string) => parseCv(text).workHistory.map((r) => ({ position: r.position, company: r.company, start: r.startDate, end: r.endDate }));
const quals = (text: string) => parseCv(text).education.map((e) => ({ q: e.qualification, i: e.institution, p: e.period }));

test("a comma inside a job title is part of the title, not a company", () => {
  const r = roles(cv(["Experience", ["Unit Manager, Adult ICU | Umhlanga Private Hospital | Mar 2019 - Present", "Leads a 14-bed adult ICU and its nursing team.", "Teaching Assistant, Programming | University of the Witwatersrand | 2010 - 2012", "Marked first-year programming assignments and ran tutorials."]]));
  expect(r[0]).toMatchObject({ position: "Unit Manager, Adult ICU", company: "Umhlanga Private Hospital" });
  expect(r[1]).toMatchObject({ position: "Teaching Assistant, Programming", company: "University of the Witwatersrand" });
});

test("a comma still separates title and company when the only other part is a place", () => {
  const r = roles(cv(["Experience", ["Software Engineer, Acme Ltd | Cape Town | Jan 2020 - Present", "Built the payments service in Java."]]));
  expect(r[0]).toMatchObject({ position: "Software Engineer", company: "Acme Ltd" });
});

test("roles written as paragraphs, title first, are read with their dates", () => {
  const r = roles(cv(["Work History", ["Sales Rep at Border Distributors from Jan 2019 till date. Responsible for sales in the area. Visited clients.", "Sales Rep at Amatola Beverages 2016 to 2018. Visited spaza shops and taverns.", "Merchandiser at Amatola Beverages 2014 to 2016. Packed shelves.", "Petrol attendant at Buffalo Fuel 2012 to 2014."]]));
  expect(r.map((x) => [x.position, x.company])).toEqual([["Sales Rep", "Border Distributors"], ["Sales Rep", "Amatola Beverages"], ["Merchandiser", "Amatola Beverages"], ["Petrol attendant", "Buffalo Fuel"]]);
  expect(r[0].start).toMatch(/2019/); expect(r[3]).toMatchObject({ start: "2012", end: "2014" });
});

test("a sentence that is not a role stays a sentence", () => {
  const r = roles(cv(["Experience", ["Senior Developer | Acme Ltd | 2018 - 2023", "Worked at full stretch from 2019 to 2021 on the migration.", "Our team at Head Office from 2019 to 2020 grew to twelve."]]));
  expect(r).toHaveLength(1);
});

test("a status wrapped onto the next line stays with its qualification", () => {
  const text = cv(["Education", ["BEd (Senior Phase and FET Mathematics), Sol Plaatje University, 2008 - 2010 (did not", "complete; left in third year)", "Matric, 2007"]]);
  const e = parseCv(text).education[0];
  expect(e.qualification).toBe("BEd (Senior Phase and FET Mathematics)");
  expect(describeQualification({ degree: e.qualification, institution: e.institution, year: e.period }, 2026).status).toBe("not_completed");
});

test("professional designations are read as qualifications", () => {
  const q = quals(cv(["Education", ["CA(SA), South African Institute of Chartered Accountants, 2014", "PMP (in progress)"]]));
  expect(q.map((x) => x.q)).toEqual(["CA(SA)", "PMP"]);
  expect(q[0].i).toBe("South African Institute of Chartered Accountants");
  expect(describeQualification({ degree: "PMP", year: q[1].p }, 2026).status).toBe("in_progress");
});
