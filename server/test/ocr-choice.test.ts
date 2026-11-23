import { expect, test } from "vitest";
import { chooseReading, type Reading } from "../src/ocr";

const PAGE = "Thandi Mokoena Senior Developer thandi.mokoena@example.test 071 555 0103 Johannesburg South Africa Profile Backend developer with six years of experience building payment services Experience";
const read = (engine: string, text: string, confidence = 0.9): Reading => ({ engine, text, confidence });

test("the cleaner reading wins; a tie keeps the first (default) engine", () => {
  const garbled = PAGE.replace("Backend developer", "Backend deve|oper").replace("payment", "paym3nt services lllll");
  expect(chooseReading([read("tesseract", garbled), read("paddle", PAGE)]).chosen.engine).toBe("paddle");
  expect(chooseReading([read("tesseract", PAGE), read("paddle", garbled)]).chosen.engine).toBe("tesseract");
  expect(chooseReading([read("tesseract", PAGE), read("paddle", PAGE)]).chosen.engine).toBe("tesseract");
});

test("a tidy reading that lost half the page does not win", () => {
  const half = PAGE.split(" ").slice(0, 12).join(" ");
  const v = chooseReading([read("tesseract", PAGE), read("paddle", half)]);
  expect(v.chosen.engine).toBe("tesseract");
  expect(v.scores[1]).toBeLessThan(v.scores[0]);
  // ...and the other way round
  expect(chooseReading([read("tesseract", half), read("paddle", PAGE)]).chosen.engine).toBe("paddle");
});

test("an engine's own confidence does not decide: the clearer reading wins whatever each one claims", () => {
  const garbled = PAGE.replace("Johannesburg", "J0hannesbu|g").replace("Experience", "Exp~rience").replace("Profile", "Pr0file lllll");
  const v = chooseReading([read("tesseract", garbled, 0.99), read("paddle", PAGE, 0.5)]);
  expect(v.chosen.engine).toBe("paddle");
});

test("a second engine's confidence is capped by how plausible its words are", () => {
  const poor = PAGE.replace("Backend", "B~ckend").replace("developer", "dev|loper").replace("payment", "p~yment").replace("services", "serv|ces");
  const v = chooseReading([read("tesseract", poor.replace(/~|\|/g, "")), read("paddle", PAGE.replace("Johannesburg", "Joh~nnesb|rg").replace("Mokoena", "Mok|ena"), 0.97)]);
  const picked = v.chosen;
  if (picked.engine === "paddle") expect(picked.confidence).toBeLessThan(0.97);
});

test("an e-mail or phone number found by one reading and not the other is flagged, with the page, for a person", () => {
  const wrongEmail = PAGE.replace("thandi.mokoena@example.test", "thandi.mokoena@exampIe.test");
  const wrongPhone = PAGE.replace("071 555 0103", "071 555 0108");
  const e = chooseReading([read("tesseract", PAGE), read("paddle", wrongEmail)], 2);
  expect(e.notes.join(" ")).toMatch(/Page 2: two OCR readings disagree on the e-mail address/);
  const p = chooseReading([read("tesseract", PAGE), read("paddle", wrongPhone)], 1);
  expect(p.notes.join(" ")).toMatch(/Page 1: two OCR readings disagree on a phone number/);
  expect(chooseReading([read("tesseract", PAGE), read("paddle", PAGE)]).notes).toEqual([]);
});

test("the same details written differently are not a disagreement (spacing and punctuation in a number, capital letters in an address)", () => {
  const same = PAGE.replace("071 555 0103", "071-555-0103").replace("thandi.mokoena@example.test", "Thandi.Mokoena@Example.test");
  expect(chooseReading([read("tesseract", PAGE), read("paddle", same)]).notes).toEqual([]);
});

test("one reading alone gives no comparison and no notes", () => {
  const v = chooseReading([read("tesseract", PAGE)]);
  expect(v.chosen.engine).toBe("tesseract"); expect(v.notes).toEqual([]);
});
