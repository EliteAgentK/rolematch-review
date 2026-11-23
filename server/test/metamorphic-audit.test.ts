import { expect, test } from "vitest";
import { extractCandidate } from "../src/extract";
import { readDocument } from "../src/parse";
import { rejoinWrappedDates, type Item } from "../src/layout";
import { parseCv } from "../src/rules";
import { spawnSync } from "node:child_process";
import { vi } from "vitest";

const head = [
  "Thandi Mokoena",
  "Software Developer",
  "thandi@example.test | 082 555 0101 | Cape Town",
];
const sections = [
  ["Summary", "Builds reliable software and supports local organisations."],
  ["Skills", "TypeScript, React, Node.js"],
  [
    "Experience",
    "Developer, Acme (2020 - Present)",
    "• Builds web applications and maintains automated tests.",
  ],
  ["Education", "BSc Computer Science, University of Cape Town, 2019"],
];
const cv = [...head, ...sections.flat()].join("\n"),
  opts = { asOf: new Date("2026-10-21") };
const record = async (s: string) => (await extractCandidate(s, opts)).record;
test.each(["\n", "\r\n", "\r"])(
  "line ending %j leaves the complete candidate record unchanged",
  async (e) =>
    expect(await record(cv.replace(/\n/g, e))).toEqual(await record(cv)),
);
test("adding page furniture leaves the complete record unchanged", async () =>
  expect(
    await record(
      cv + "\nPage 1 of 2\nConfidential\nThandi Mokoena – Curriculum Vitae",
    ),
  ).toEqual(await record(cv)));
test("duplicating the complete page leaves the complete record unchanged", async () =>
  expect(await record(cv + "\nPage 1 of 2\n" + cv + "\nPage 2 of 2")).toEqual(
    await record(cv),
  ));
test("moving complete, labelled sections leaves the complete record unchanged", async () => {
  for (const order of [
    [3, 2, 1, 0],
    [1, 3, 0, 2],
    [2, 0, 3, 1],
  ])
    expect(
      await record([...head, ...order.flatMap((i) => sections[i])].join("\n")),
    ).toEqual(await record(cv));
});
test("soft rewrapping prose at a space preserves the complete record", async () => {
  for (const phrase of ["software and", "applications and"])
    expect(await record(cv.replace(phrase, phrase.replace(" ", "\n")))).toEqual(
      await record(cv),
    );
});
test("readDocument normalisation is idempotent on TXT", async () => {
  const once = await readDocument(
    Buffer.from(cv.replace("TypeScript", "Type\u200bScript")),
    "txt",
  );
  expect((await readDocument(Buffer.from(once.text), "txt")).text).toBe(
    once.text,
  );
});

test(
  "omitted asOf never depends on the clock",
  async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2024-10-21"));
      const a = await extractCandidate(cv);
      vi.setSystemTime(new Date("2026-10-21"));
      const b = await extractCandidate(cv);
      expect(a.record.experience).toBe(b.record.experience);
    } finally {
      vi.useRealTimers();
    }
  },
);

test(
  "a role does not inherit an employer without an explicit grouping",
  () => {
    const r = parseCv(
      "Thandi Mokoena\nthandi@example.test\nExperience\nDeveloper, Acme (2020 - 2022)\n• Built applications.\nSenior Developer (2023 - Present)\n• Maintained systems.\nSkills\nTypeScript",
    );
    expect(r.workHistory[1].company).toBe("");
  },
);
test("wrapped-date ordering preserves caller-owned source geometry", () => {
  const rows: Item[][] = [
    [{ s: "2014 -", x: 10, y: 100, w: 40, h: 10 }],
    [{ s: "2017", x: 10, y: 85, w: 25, h: 10 }],
  ];
  const before = JSON.stringify(rows);
  rejoinWrappedDates(rows);
  expect(JSON.stringify(rows)).toBe(before);
});
test("cyclic TIFF directory is refused before entering the decoder", () => {
  const script = `import {tiffPages} from './src/tiff.ts';const b=Buffer.alloc(14);b.write('II');b.writeUInt16LE(42,2);b.writeUInt32LE(8,4);b.writeUInt32LE(8,10);tiffPages(b,1);`;
  const r = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { cwd: process.cwd(), timeout: 3000, encoding: "utf8", maxBuffer: 4096 },
  );
  expect(r.error).toBeUndefined();
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("Cyclic");
});
