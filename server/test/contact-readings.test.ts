import { expect, test } from "vitest";
import { addressesIn, endsInRealDomain, numbersIn, resolveAddress, resolveNumbers, wholeAddress, wrappedEnd } from "../src/docmodel/contactReadings";

// R81: each case is what OCR really returned for an invented person in the Visual Variety pack (visual60-b1). Which stage lost the value is in the name of the test.
test.each([
  ["Durban | tebellochauke.525@ candidate.example | 427 00", "tebellochauke.525@candidate.example"],
  ["ntandobaloyi.504 @candidate.example | +27", "ntandobaloyi.504@candidate.example"],
  ["Pretoria | nokuthulamadonsela.501@candidate. example | +27", "nokuthulamadonsela.501@candidate.example"],
  ["Windhoek | anathiramos. 502@candidate.example | +27", "anathiramos.502@candidate.example"],
  ["rorisangmoeketsi.5 10@candidate.example", "rorisangmoeketsi.510@candidate.example"],
  ["keitumetsesayed.51 1@candidate.example", "keitumetsesayed.511@candidate.example"],
  ["ntandosmith.534 @candidate. example | -_ N a", "ntandosmith.534@candidate.example"],
  ["East London | vuyaniramaphakela.529@candidate example | +27", "vuyaniramaphakela.529@candidate.example"],
  ["lethabomahlase,508@candidate.example | +27", "lethabomahlase.508@candidate.example"],
  ["vuyaniramaphakela 529@candidate.example | +27", "vuyaniramaphakela.529@candidate.example"],
  ["daniellekhoele.553@gmail. com", "daniellekhoele.553@gmail.com"],
])("spaces and marks, not characters: %s", (line, want) => { expect(addressesIn(line)).toContain(want); });

test("counterexample: a word after the domain that is no top-level domain stays out of the address", () => {
  expect(addressesIn("name@company Data Analyst")).toEqual([]);
  expect(addressesIn("a@b.co.za | Pretoria")).toEqual(["a@b.co.za"]);
});
test("only spaces and marks change: a misread letter stays misread for the vote to see", () => {
  expect(addressesIn("ficardontuli.519@candidate.example")).toEqual(["ficardontuli.519@candidate.example"]);
});
test("an address cut off at its end has no real top-level domain", () => {
  for (const cut of ["a@candidate.exampl", "a@candidate.examp", "a@candidate.e", "a@candidate.exampie", "a@candidate.cxample"]) expect(endsInRealDomain(cut)).toBe(false);
  for (const whole of ["a@candidate.example", "a@x.co.za", "a@gmail.com", "a@x.africa"]) expect(endsInRealDomain(whole)).toBe(true);
});

const name = ["ricardo", "ntuli"];
test("two readings that agree are published, and the odd one out loses", () => {
  const r = resolveAddress(["ficardontuli.519@candidate.example", "ricardontuli.519@candidate.example", "ricardontuli.519@candidate. example"], name)!;
  expect(r).toMatchObject({ value: "ricardontuli.519@candidate.example", status: "agreed" });
});
test("readings that disagree with no majority: the one carrying the whole name wins", () => {
  const r = resolveAddress(["ficardontuli.519@candidate.example", "ricardontuli.519@candidate.example"], name)!;
  expect(r).toMatchObject({ value: "ricardontuli.519@candidate.example", status: "single" });
});
test("readings that disagree on the domain, with the name no help: nothing is published and a person is told what was read", () => {
  const r = resolveAddress(["ricardontuli.519@candidare.example", "ricardontuli.519@candidate.exarnple"], name)!;
  expect(r.value).toBe(""); expect(r.status).toBe("uncertain");
});
test("one whole reading among cut-off ones is enough when it carries the name", () => {
  expect(resolveAddress(["shanicedavids.554@candidate.exampl", "shanicedavids.554@candidate.example"], ["shanice", "davids"])).toMatchObject({ value: "shanicedavids.554@candidate.example", status: "single" });
});
test("counterexample: one whole reading that shares nothing with the name is not enough", () => {
  expect(resolveAddress(["hello@firm.co.za"], ["ricardo", "ntuli"])).toMatchObject({ value: "", status: "uncertain" });
});
test("every reading cut off: nothing is published, ever", () => {
  expect(resolveAddress(["shanicedavids.554@candidate.exampl", "shanicedavids.554@candidate.exampl"], ["shanice", "davids"])).toMatchObject({ value: "", status: "uncertain" });
});
test("no address on the row at all is not a doubt", () => { expect(resolveAddress(["+27 00 518 9166"], name)).toBeNull(); });

test("numbers: a plus read as a 4 or a # is put back, and only there", () => {
  expect(numbersIn("427 00 525 9425")[0].digits).toBe("27005259425");
  expect(numbersIn("#27 00 514 9018")[0].digits).toBe("27005149018");
  expect(numbersIn("011 427 1234")[0].digits).toBe("0114271234");
});
test("numbers: two readings agree", () => {
  expect(resolveNumbers(["+27 00 505 8685", "+27 00 505 8685", "+27 66 505 8685"])[0]).toMatchObject({ value: "+27 00 505 8685", status: "agreed" });
});
test("numbers: two readings that disagree, nothing published", () => {
  const r = resolveNumbers(["+27 69 512 8944", "+27 00 512 8944"]);
  expect(r).toHaveLength(1); expect(r[0]).toMatchObject({ value: "", status: "uncertain" }); expect(r[0].readings).toHaveLength(2);
});
test("numbers: one reading and no rival stands", () => { expect(resolveNumbers(["no number here", "+27 00 505 8685"])[0]).toMatchObject({ value: "+27 00 505 8685", status: "single" }); });
test("numbers: two different numbers on one row stay two", () => { expect(resolveNumbers(["+27 82 111 2222 | +27 11 999 8888", "+27 82 111 2222 | +27 11 999 8888"]).map((n) => n.value)).toEqual(["+27 82 111 2222", "+27 11 999 8888"]); });
test("numbers: a date range is not a number", () => { expect(numbersIn("2019 - 2021")).toEqual([]); });

test("an address that wrapped in a narrow cell: its end is joined only where that makes a real domain", () => {
  expect(addressesIn("shanicedavids.554@candidate.exampl e | +27 00")).toEqual(["shanicedavids.554@candidate.example"]);
  expect(addressesIn("mandisasteyn.530@candidate.exam ple")).toEqual(["mandisasteyn.530@candidate.example"]);
  expect(wrappedEnd("mandisaabrahams.560@candidate.e", ["Rustenburg", "xample", "+27 00 560 0720"])).toBe("xample");
  expect(wrappedEnd("a@b.example", ["xample"])).toBeNull();
  expect(wrappedEnd("a@candidate.exampl", ["Durban", "report"])).toBeNull();
  expect(addressesIn("name@firm.com and more text")).toEqual(["name@firm.com"]);
});

test("a near-miss of the person's own name is not published, even when two readings share it", () => {
  expect(resolveAddress(["kgomatsoralepelle.535@candidate.example", "kgomatsoralepelle.535@candidate.example"], ["kgomotso", "ralepelle"])).toMatchObject({ value: "", status: "uncertain" });
  expect(resolveAddress(["lumelodavids.507@candidate.example", "tumelodavids.507@candidate.example"], ["tumelo", "davids"])).toMatchObject({ value: "tumelodavids.507@candidate.example" });
});
test("counterexample: an address that is nothing like the name is not a slip", () => {
  expect(resolveAddress(["info@firm.co.za", "info@firm.co.za"], ["ricardo", "ntuli"])).toMatchObject({ value: "info@firm.co.za", status: "agreed" });
  expect(resolveAddress(["r.ntuli@firm.co.za", "r.ntuli@firm.co.za"], ["ricardo", "ntuli"])).toMatchObject({ value: "r.ntuli@firm.co.za", status: "agreed" });
});
test("a neighbouring word stuck to the front of an address is left out when another reading shows it apart", () => {
  expect(resolveAddress(["londonlethabomthethwa.538@candidate.example", "London | lethabomthethwa. 538@candidate.example"], ["lethabo", "mthethwa"])).toMatchObject({ value: "lethabomthethwa.538@candidate.example" });
});

// From the failed run lf-unseen-4 (R88), which then became development material.
test("an address that lost its start is no address", () => {
  for (const cut of ["578@candidate.example", ".cv0648@candidate.example", "-s04@candidate.example"]) expect(wholeAddress(cut)).toBe(false);
  for (const whole of ["a.b@firm.co.za", "jo@firm.com", "name.cv0648@candidate.example"]) expect(wholeAddress(whole)).toBe(true);
  expect(resolveAddress(["578@candidate.example", "578@candidate.example"], ["oarabile", "manuel"])).toMatchObject({ value: "", status: "uncertain" });
});
// From the 8 Nov pack check through live's upload path (CV0518 as a phone photo): a number with a letter in it is a number before the readings are compared, not only after.
test("a digit read as a letter does not split a vote that the number settles", () => {
  expect(resolveAddress(["abigailralepelle.518@candidate.example", "abigailralepelle.5i8@candidate.example", "abigailralepelle.518@icandidate.example"], ["abigail", "ralepelle"])).toMatchObject({ value: "abigailralepelle.518@candidate.example", status: "agreed" });
});
test("counterexample: a letter in a word is not a digit, and the first word is never touched", () => {
  expect(resolveAddress(["thandi.mokoena@firm.co.za", "thandi.mokoena@firm.co.za"], ["thandi", "mokoena"])).toMatchObject({ value: "thandi.mokoena@firm.co.za" });
  expect(resolveAddress(["lio.518@firm.co.za", "lio.518@firm.co.za"], ["lio", "smith"])).toMatchObject({ value: "lio.518@firm.co.za" });
  expect(resolveAddress(["thandi.mi5@firm.co.za", "thandi.mi5@firm.co.za"], ["thandi", "mokoena"])).toMatchObject({ value: "thandi.mi5@firm.co.za" });
});
test("a domain one letter from a common word is not published, even when two readings agree", () => {
  const near = (w: string) => w === "eandidate";
  expect(resolveAddress(["thandimokoena@eandidate.example", "thandimokoena@eandidate.example"], ["thandi", "mokoena"], near)).toMatchObject({ value: "", status: "uncertain" });
  expect(resolveAddress(["thandimokoena@candidate.example", "thandimokoena@candidate.example"], ["thandi", "mokoena"], near)).toMatchObject({ value: "thandimokoena@candidate.example", status: "agreed" });
});
