import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { readText } from "../src/parse";
import { parseCv } from "../src/rules";

const read = async (dir: string, file: string) => readText(new Uint8Array(readFileSync(fileURLToPath(new URL(`../../sample-documents/${dir}/${file}`, import.meta.url)))), file.endsWith(".pdf") ? "pdf" : "docx");
const cv = async (f: string) => parseCv(await read("cvs", f));

// The sample job ads are read by Claude since 10 Nov 2026: their measurement is test/collection/aiJobFieldsEval.ts and test/collection/jobReaderEval.ts.

test("sample CVs: the well-structured ones are read fully", async () => {
  const t = await cv("cv01-thandi-mokoena.docx");
  expect(t.fullName).toBe("Thandi Mokoena"); expect(t.skills.length).toBeGreaterThanOrEqual(10); expect(t.workHistory.length).toBe(2);
  const j = await cv("cv07-johan-pretorius.docx"); // Afrikaans headings
  expect(j.workHistory.length).toBe(2);
  const a = await cv("cv06-aisha-patel.pdf"); // two columns
  expect(a.fullName).toBe("Aisha Patel"); expect(a.skills.length).toBe(7);
});

test("a CV written as plain sentences: dates and companies are found, nothing is invented, and no long sentence becomes a degree", async () => {
  const s = await cv("cv05-sipho-ndlovu.docx");
  expect(s.fullName).toBe("Sipho Ndlovu");
  expect(s.workHistory.map((w) => w.company)).toContain("Tswane Wholesalers");
  expect(s.workHistory.every((w) => w.position === "")).toBe(true); // the CV does not say what his position was
  for (const e of s.education) expect(e.qualification.length).toBeLessThan(60);
});
