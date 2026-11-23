import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { extractionConfig, extractionConfigFingerprint, identityPatterns, type ExtractionConfig } from "../src/extractionConfig";

// Three levels: the code's structure (the words live in configuration, not in the parser), the configuration itself (valid, frozen, versioned, and it really drives behaviour),
// and extraction (test/parser-identity-forms.test.ts, on whole documents).
const rules = readFileSync(new URL("../src/rules.ts", import.meta.url), "utf8");

test("structure: the parser takes these rules from configuration and holds no copy of them", () => {
  expect(rules).toMatch(/from "\.\/extractionConfig"/);
  for (const copy of [/const FORM_WORD\s*=/, /const AGENCY_WHO\s*=/, /const AGENCY_WHAT\s*=/, /const GIVEN_LABEL\s*=/, /const SURNAME_LABEL\s*=/, /consultants\?/]) expect(rules, String(copy)).not.toMatch(copy);
});

test("configuration: frozen at every level, versioned, with no empty or duplicate entries, and a stable fingerprint", () => {
  expect(extractionConfig.version).toMatch(/^\d+\.\d+\.\d+$/);
  expect(Object.isFrozen(extractionConfig)).toBe(true); expect(Object.isFrozen(extractionConfig.identity.formWords)).toBe(true);
  expect(() => (extractionConfig.identity.formWords as string[]).push("x")).toThrow();
  for (const list of [...Object.values(extractionConfig.identity), ...Object.values(extractionConfig.agency)]) {
    expect(list.length).toBeGreaterThan(0); expect(new Set(list).size).toBe(list.length);
    for (const w of list) { expect(w.trim()).toBe(w); expect(w).toBe(w.toLowerCase()); expect(w.length).toBeGreaterThan(1); }
  }
  expect(extractionConfigFingerprint).toMatch(/^[0-9a-f]{16}$/);
});

test("configuration drives behaviour: a label added or removed changes the result, with no change to code", () => {
  const edited = (f: (c: any) => void): ExtractionConfig => { const c = JSON.parse(JSON.stringify(extractionConfig)); f(c); return c; };
  const standard = identityPatterns();
  expect(standard.agencyLabelValue.test("Talent Partner Email: a@b.example")).toBe(false);
  expect(identityPatterns(edited((c) => c.agency.who.push("talent partner"))).agencyLabelValue.test("Talent Partner Email: a@b.example")).toBe(true);
  expect(standard.agencyLabelOnly.test("Consultants Number")).toBe(true);
  expect(identityPatterns(edited((c) => { c.agency.who = c.agency.who.filter((w: string) => !w.startsWith("consultant")); })).agencyLabelOnly.test("Consultants Number")).toBe(false);
  expect(standard.givenLabel.test("Employee Name: Thandi Mokoena")).toBe(false);
  expect(identityPatterns(edited((c) => c.identity.givenNameQualifiers.push("employee"))).givenLabel.test("Employee Name: Thandi Mokoena")).toBe(true);
  expect(standard.formWord.test("Marketing Director")).toBe(false);
  expect(identityPatterns(edited((c) => c.identity.formWords.push("marketing"))).formWord.test("Marketing Director")).toBe(true);
});

test("configuration: words are matched whole, so a name containing a form word is not refused", () => {
  const { formWord } = identityPatterns();
  for (const name of ["Thandi Mokoena", "Skillman Dlamini", "Historia Naidoo", "Noticia Botha"]) expect(formWord.test(name), name).toBe(false);
  expect(formWord.test("Personal Details")).toBe(true);
});
