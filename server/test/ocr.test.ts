import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, expect, test } from "vitest";
import { looksDamaged, markControl, repairWithVocabulary, strayHyphens } from "../src/glyphs";
import { stopOcr } from "../src/ocr";
import { readDocument } from "../src/parse";
import { parseCv } from "../src/rules";

afterAll(() => stopOcr());

test("a letter with no Unicode mapping is recovered from the page image; correct words are left alone", () => {
  const broken = markControl("Hands-on \u0004ork includes Tail\u0004ind CSS, and Soft\u0004are Design with \u0004ork"); // 'w' missing; one is a ghost
  const ocr = "Hands-on work includes Tailwind CSS, and Software Design with work. Workflow";
  const r = repairWithVocabulary(broken, ocr);
  expect(r.text).toBe("Hands-on work includes Tailwind CSS, and Software Design with work");
  expect(r.unresolved).toBe(0);
  expect(r.repaired).toBe(4);
});

test("a broken word the page does not confirm is reported, never guessed", () => {
  const r = repairWithVocabulary(markControl("A \u0004zxq of things"), "A thing of things and words");
  expect(r.unresolved).toBe(1); expect(r.text).toContain("zxq");
});

test("letters decoded as hyphens are repaired, but ordinary hyphens and line-break hyphens are not touched", () => {
  const text = "We -ork -ith client-facing teams and revie- code. Day-to-\nday: site- and library-level.";
  expect(strayHyphens(text)).toBeGreaterThanOrEqual(3);
  expect(looksDamaged(text)).toBe(true);
  const r = repairWithVocabulary(text, "We work with client-facing teams and review code. Day-to-day: site- and library-level.");
  expect(r.text).toBe("We work with client-facing teams and review code. Day-to-\nday: site- and library-level.");
});

test("a CV that is only a picture is read with OCR and then parsed like any other", async () => {
  const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL("../../sample-documents/cvs/cv11-zanele-scanned.pdf", import.meta.url))));
  const { text, issues } = await readDocument(bytes, "pdf");
  expect(issues.join(" ")).toMatch(/read by OCR/);
  expect(text).toMatch(/Zanele Khumalo/); expect(text).toMatch(/CCMA/);
  const cv = parseCv(text);
  expect(cv.fullName).toBe("Zanele Khumalo");
  expect(cv.workHistory.length).toBeGreaterThanOrEqual(1);
}, 60000);

test("a normal text PDF is not sent to OCR", async () => {
  const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL("../../sample-documents/cvs/cv06-aisha-patel.pdf", import.meta.url))));
  const { issues } = await readDocument(bytes, "pdf");
  expect(issues).toEqual([]);
});

import { repairEmails } from "../src/ocr";
test("OCR e-mail repair: dots come back only where the name and a real domain support them", () => {
  const head = "Pieter Lekota\nOperations Manager\n";
  expect(repairEmails(head + "pieter lekota@example. test | 082 555 0111")).toContain("pieter.lekota@example.test | 082");
  expect(repairEmails("Aisha Patel\nDigital Marketer\naisha patel @example test")).toContain("aisha.patel@example.test");
  expect(repairEmails(head + "Contact: pieter.lekota@acme co za")).toContain("pieter.lekota@acme.co.za");
  // letters misread: only words a hair away from the candidate's own name (or a well-known mail service) are corrected
  expect(repairEmails("Lindiwe Dlamini\nNurse\ntindiwe.diamini@gmaii.com | 071")).toContain("lindiwe.dlamini@gmaii.com | 071");
  expect(repairEmails("Lindiwe Dlamini\nNurse\nlindiwe.dlamini@hospital.co.za")).toContain("lindiwe.dlamini@hospital.co.za"); // an unknown domain is never guessed at
  expect(repairEmails("Lindiwe Dlamini\nNurse\nsomeone.else@gmaii.com")).toContain("someone.else@gmaii.com");                    // the local part is not in the name, so it stays
  // not supported by the page, so left alone: other words are not turned into an address
  expect(repairEmails(head + "send your CV to hiring team @example test")).not.toContain("hiring.team@");
  expect(repairEmails(head + "reach me on pieter.lekota@example.test")).toContain("pieter.lekota@example.test");
});

test("OCR e-mail repair: a misread letter and a stray space in the name part are fixed from the candidate's own name", () => {
  expect(repairEmails("Lindiwe Dlamini\nNurse\ntindiwe .dlamini@example.test | 071 555 0103")).toContain("lindiwe.dlamini@example.test");
});

import { repairLookalikes } from "../src/ocr";
test("OCR look-alike repair: a word is fixed only when it is exactly a known skill with I/l/1 or O/0 confused", () => {
  expect(repairLookalikes("Built Power Bl dashboards in Exce1 and SQL.")).toBe("Built Power BI dashboards in Excel and SQL.");
  expect(repairLookalikes("Skills: Pyth0n, Typescript, Postgre5QL")).toContain("Python");
  expect(repairLookalikes("Power BI and Excel")).toBe("Power BI and Excel");              // already right: untouched
  expect(repairLookalikes("She will fill the hall")).toBe("She will fill the hall");      // ordinary words are never turned into skills
  expect(repairLookalikes("Kill the lilies, Bill")).toBe("Kill the lilies, Bill");
});

test("in a scanned address, a letter that looks like a digit inside a number is that digit; a name stays a name", () => {
  const head = "James Mahlangu\nProject Manager\n";
  expect(repairEmails(head + "jamesmahlangu.l06@candidate.example")).toContain("jamesmahlangu.106@candidate.example");
  expect(repairEmails(head + "tariropatel.ll4@candidate.example")).toContain("tariropatel.114@candidate.example");
  expect(repairEmails(head + "james.2O21@candidate.example")).toContain("james.2021@candidate.example");
  // no digit in the token: nothing says it is a number
  expect(repairEmails(head + "james.lol@candidate.example")).toContain("james.lol@candidate.example");
  expect(repairEmails(head + "lol2@candidate.example")).toContain("lol2@candidate.example");
  expect(repairEmails(head + "alo2@candidate.example")).toContain("alo2@candidate.example");
});
