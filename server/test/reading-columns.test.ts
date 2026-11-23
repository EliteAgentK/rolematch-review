import { expect, test } from "vitest";
import { inColumns, rowText } from "../src/docmodel/columns";
import { isFurniture, pageFurniture } from "../src/parse";

// Words at given x positions on rows going down the page. Each is about 6 units a letter, 10 high, with the writer's spacing.
const row = (y: number, ...words: [string, number][]) => words.map(([s, x]) => ({ s, x, y, w: s.length * 6, h: 10 })) as any[];
const WIDTH = 600, text = (rows: any[][]) => rows.map((r) => r.map((i) => i.s).join(" "));

test("short lines with a word gap that happens to line up are not columns: a sentence is not torn at a word space (found on photos, 2026-11-05)", () => {
  // Most rows are short, so nothing crosses x = 400. The long rows have a normal word space there.
  const rows = [
    row(700, ["Payroll Administrator", 20]), row(686, ["Permanent", 20]),
    row(672, ["Reconciled accounts.", 20]),
    row(658, ["Cleared 66 outstanding documentation items during the 2018", 44], ["review", 400], ["cycle.", 440]),
    row(644, ["Processed payroll input.", 20]), row(630, ["Checked leave records.", 20]), row(616, ["Answered queries.", 20]),
    row(602, ["Assistant Administrator at Marlowe Group from 2006-02 until", 38], ["2012-01", 400]),
    row(588, ["Maintained records.", 20]), row(574, ["Resolved queries.", 20]),
    row(560, ["Prepared the monthly pack and sent to all the branch heads", 44], ["on time.", 400]),
    row(546, ["Filed records.", 20]),
  ];
  const out = text(inColumns(rows, WIDTH));
  expect(out[3]).toBe("Cleared 66 outstanding documentation items during the 2018 review cycle.");
  expect(out[7]).toBe("Assistant Administrator at Marlowe Group from 2006-02 until 2012-01");
});
test("two real columns, with a real gap between them, are still read one after the other", () => {
  const rows = [row(714, ["Experience", 30], ["Skills", 320]), ...Array.from({ length: 10 }, (_, k) => row(700 - k * 14, [`Left side line number ${k} of it`, 30], [`Right side line number ${k} of it`, 320]))];
  const out = text(inColumns(rows, WIDTH));
  expect(out[0]).toBe("Experience");
  expect(out[1]).toBe("Left side line number 0 of it");
  expect(out[11]).toBe("Skills");
  expect(out[12]).toBe("Right side line number 0 of it");
});
test("a tight real gutter still separates columns: the gap between them is wider than the words on either side, even if not by much", () => {
  const rows = [row(714, ["Experience", 30], ["Skills", 216]), ...Array.from({ length: 10 }, (_, k) => row(700 - k * 14, [`Left line number ${k} is here`, 30], [`Right line number ${k} of it`, 200 + 2]))];
  // left items end at about 30 + 26 x 6 = 186; the gutter is 16 units, one and a half times the line height
  const out = text(inColumns(rows, WIDTH));
  expect(out[1]).toBe("Left line number 0 is here");
});
test("dates in a margin belong to the rows beside them: they are not a column to read afterwards", () => {
  const rows = [
    row(714, ["Experience", 30]),
    row(700, ["Sep 2021 - Present", 30], ["Data Analyst, Zenith Logistics", 200]), row(686, ["Built dashboards for the operations managers.", 200]), row(672, ["Automated weekly reporting in Python.", 200]),
    row(658, ["Feb 2019 - Aug 2021", 30], ["Junior Analyst, Zenith Logistics", 200]), row(644, ["Cleaned and validated delivery data.", 200]),
    row(630, ["Education", 30]), row(616, ["2018", 30], ["BSc Statistics", 200]), row(602, ["University of Johannesburg", 200]),
  ];
  const out = text(inColumns(rows, WIDTH)), at = (s: string) => out.findIndex((l) => l.includes(s));
  expect(at("Sep 2021")).toBeLessThan(at("Built dashboards"));
  expect(at("Feb 2019")).toBeGreaterThan(at("Automated weekly"));
  expect(at("Feb 2019")).toBeLessThan(at("Cleaned and validated"));
});
test("a date margin that wraps leads the job beside it, each date whole (found on real CVs, register R143)", () => {
  const left = 30, right = 150;
  const rows = [
    row(800, ["July 2021 -", left], ["Acme Traders", right]), row(786, ["October", left], ["Contact Agent", right]), row(772, ["2021", left], ["Answered calls from customers.", right]),
    row(758, ["Followed up on complaints.", right]), row(744, ["Recorded call notes.", right]), row(730, ["Generated statements.", right]),
    row(600, ["November", left], ["Baobab Solutions", right]), row(586, ["2020 -", left], ["Junior Analyst", right]), row(572, ["December", left], ["Captured wireframes.", right]), row(558, ["2020", left], ["Checked spreadsheets.", right]),
    row(400, ["Mar", left], ["Cedar Mutual", right]), row(386, ["- May 2020", left], ["Business Analyst", right]), row(372, ["Mapped processes.", right]),
  ];
  rows[10] = [{ s: "Mar", x: left, y: 400, w: 18, h: 10 }, { s: "ch 2019", x: left + 19, y: 400, w: 40, h: 10 }, { s: "Cedar Mutual", x: right, y: 400, w: 72, h: 10 }] as any;
  const out = inColumns(rows, WIDTH).map(rowText);
  expect(out).toContain("July 2021 - October 2021");
  expect(out).toContain("November 2020 - December 2020");
  expect(out).toContain("March 2019 - May 2020");
  expect(out.indexOf("Acme Traders")).toBe(out.indexOf("July 2021 - October 2021") + 1);
  expect(out.indexOf("Cedar Mutual")).toBe(out.indexOf("March 2019 - May 2020") + 1);
});
test("a year alone in a page's margin is a date that wrapped, not a page number (found on real CVs, register R143)", () => {
  const line = (s: string, y: number) => [{ s, x: 30, y, w: s.length * 6, h: 10 }] as any[];
  const f = pageFurniture([{ lines: [line("2021", 790), line("Ordinary words", 500)], height: 842 }, { lines: [line("Other words", 500), line("7", 20)], height: 842 }]);
  expect(isFurniture(line("2021", 790), 842, f)).toBe(false);
  expect(isFurniture(line("7", 20), 842, f)).toBe(true);
});
