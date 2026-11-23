import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { stopOcr } from "../src/ocr";
import { prepareDocument } from "../src/prepare";
import { defaultSettings } from "../src/settings";

// R81 on the very documents that failed, read by the real OCR. Invented people (test/fixtures/journey/README.md). What matters most: a contact detail is either right or not published. A wrong one must never reach the record.
const DIR = join(import.meta.dirname, "fixtures", "journey"), expected = JSON.parse(readFileSync(join(DIR, "expected.json"), "utf8"));
const read = async (id: string) => { const o = defaultSettings(); o.reading.candidatePipeline = true; return prepareDocument(new Uint8Array(readFileSync(join(DIR, `${id}.pdf`))), { kind: "cv", org: o, asOf: new Date("2026-10-28T00:00:00Z") }) as Promise<any>; };
afterAll(() => stopOcr());

test.each([["CV0554", "scan: the address wraps in a narrow table cell"], ["CV0525", "scan: spaces inside the address, a plus read as 4"], ["CV0519", "photo: the first letter of the address misread"]])("R81 %s, %s: right or not published, and a blank is explained", async (id) => {
  const r = await read(id), e = expected[id];
  expect(r.ok).toBe(true);
  for (const [field, want] of [["email", e.email], ["phone", e.phone]] as const) {
    const got = String(r.record[field] ?? "");
    if (got) expect(field === "phone" ? got.replace(/\D/g, "") : got, `${id} ${field}`).toBe(field === "phone" ? want.replace(/\D/g, "") : want);
    else expect(["unreadable", "missing"], `${id} ${field} says why`).toContain(r.meta.fields[field].state);
  }
}, 120_000);
test("R81 CV0525 reads whole: the case where every character was right and only the spaces were wrong", async () => {
  const r = await read("CV0525"); expect(r.record.email).toBe(expected.CV0525.email); expect(r.record.phone.replace(/\D/g, "")).toBe(expected.CV0525.phone.replace(/\D/g, ""));
}, 120_000);
test("R86 CV0530: a sentence from the column beside is not a location, and the place on the next line is", async () => {
  const r = await read("CV0530"); expect(r.record.location).toBe("Pretoria"); expect(r.record.email).toBe(expected.CV0530.email);
}, 120_000);
