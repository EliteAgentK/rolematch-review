// Experiment E1 (docs/assessment/EXPERIMENTS.md): a name printed over two lines (first name over surname, or surname first in large type) was not
// read, so the CV was refused as "no name". Fictional fixtures modelled on the failure class, plus counterexamples that must NOT become names.
import { expect, test } from "vitest";
import { parseCv } from "../src/rules";

const cv = (head: string, email: string) => `${head}\n\nSenior Executive Assistant\n\nStellenbosch | ${email} | +27 00 507 8759\n\nPROFILE\n\nBackground in administration.\n\nEXPERIENCE\n\nSenior Executive Assistant\n\nClearhaven Advisory | 2019-02 to Present | Permanent\n\nPrepared meeting packs.`;

test("first name over surname, surname in capitals: joined, Title Case", () => {
  expect(parseCv(cv("Tumelo\n\nDAVIDS", "tumelodavids.507@candidate.example")).fullName).toBe("Tumelo Davids");
});
test("surname printed first (oversized surname): the order the e-mail gives", () => {
  expect(parseCv(cv("Smith\n\nJessica", "jessicasmith.517@candidate.example")).fullName).toBe("Jessica Smith");
});
test("a three-part name over three lines, confirmed by the e-mail", () => {
  expect(parseCv(cv("Ana\nMaria\nSilva", "ana.maria.silva@x.example")).fullName).toBe("Ana Maria Silva");
});
test("counterexample: two single-word headings are never joined into a name", () => {
  expect(parseCv(cv("Profile\n\nSummary", "jobs@company.example")).fullName).not.toBe("Profile Summary");
});
test("counterexample: single-word lines the e-mail does not confirm are not joined", () => {
  expect(parseCv(cv("Smith\n\nJessica", "info@agency.example")).fullName).not.toMatch(/Smith Jessica|Jessica Smith/);
});
test("unchanged: a name on one line still wins", () => {
  expect(parseCv(cv("Tumelo Davids", "tumelodavids@candidate.example")).fullName).toBe("Tumelo Davids");
});
