// Reading faults found on CV0565 of the owner's fictional "RoleMatch 300" pack (read in place, never copied here), pinned so they cannot come back.
import { expect, test } from "vitest";
import { parseCv } from "../src/rules";
import { rescueContact, stopOcr } from "../src/ocr";

// The pack's layout: employer on its own line, then "Title | dates | employment type", under a capitals section heading.
const cv = (third: string) => ["Test Person", "test.person@example.test", "", "EMPLOYMENT HISTORY", "Elmstead Advisory", "Senior Internal Auditor | 2022/01 - Current | Permanent", "- Tested controls across nine departments.",
  "Dalesford Industries", `Internal Auditor | 2018/01 - 2021/12 | ${third}`, "- Reviewed access and approval processes.",
  "EARLIER EXPERIENCE", "Crestmoor Services", "Internal Auditor Assistant | 2014/01 - 2017/12 | Permanent", "- Documented audit evidence."].join("\n");
const roles = (t: string) => parseCv(t).workHistory.map((w) => `${w.position} @ ${w.company}`);

test("an employment type is never read as the employer; the employer on the line above is", () => {
  expect(roles(cv("Permanent"))).toEqual(["Senior Internal Auditor @ Elmstead Advisory", "Internal Auditor @ Dalesford Industries", "Internal Auditor Assistant @ Crestmoor Services"]);
});

test("a job line ending in an employment type of several words is still a job line, not a sentence", () => {
  for (const t of ["Fixed term contract", "Fixed-term contract", "Full time", "Part-time position"]) expect(roles(cv(t)), t).toContain("Internal Auditor @ Dalesford Industries");
  // a real sentence with dates is still a sentence
  expect(roles(cv("Permanent") + "\nWe grew the team from 2019 to 2021 across three regions and many sites.")).toHaveLength(3);
});

test("a capitals section heading above an employer is never taken as the employer", () => {
  expect(roles(cv("Permanent")).join(" ")).not.toMatch(/EARLIER EXPERIENCE/);
  expect(roles(cv("Permanent"))).toContain("Internal Auditor Assistant @ Crestmoor Services");
});

test("contact rescue: a contact line the first OCR reading missed is read again from the top of the page; nothing is invented", async () => {
  const { createCanvas } = await import("@napi-rs/canvas");
  const c = createCanvas(1240, 1754), x = c.getContext("2d");
  x.fillStyle = "#fbfaf7"; x.fillRect(0, 0, 1240, 1754);
  x.fillStyle = "#5a5a5a"; x.fillRect(100, 60, 1040, 120);
  x.fillStyle = "#ffffff"; x.font = "bold 44px sans-serif"; x.fillText("Nonhlanhla Appollis", 120, 120);
  x.fillStyle = "#555555"; x.font = "22px sans-serif"; x.fillText("Gqeberha | nonhlanhla.appollis@example.test | +27 00 565 1509", 100, 210);
  x.fillStyle = "#222222"; x.font = "26px sans-serif"; x.fillText("PROFESSIONAL PROFILE", 100, 300);
  const page = Buffer.from(await c.encode("png"));
  const firstReading = "Nonhlanhla Appollis\nSenior Internal Auditor\nPROFESSIONAL PROFILE";   // what the first reading gave: no contact line
  const r = await rescueContact(page, firstReading, 1);
  expect(r.note).toMatch(/read again from the top of the page/);
  expect(r.text).toMatch(/example\.test|\+?27 ?00 ?565 ?1509/);
  expect(r.text.split("\n").slice(0, 2)).toEqual(["Nonhlanhla Appollis", "Senior Internal Auditor"]);   // placed after the first two lines
  // when the first reading already has contact details, nothing is re-read or added
  expect(await rescueContact(page, "Someone\nsomeone@example.test", 1)).toEqual({ text: "Someone\nsomeone@example.test" });
  await stopOcr();
}, 120_000);
