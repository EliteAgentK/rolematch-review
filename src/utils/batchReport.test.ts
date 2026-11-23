import { expect, test } from "vitest";
import { duration, reportCsv } from "./batchReport";
import type { BatchReport } from "../api/client";

const file = (fileName: string, over: object = {}) => ({ fileName, outcome: "failed", recordSaved: false, recordId: null, uploadedBy: "A, B", admittedAt: "t", finishedAt: null, problem: 'said "no"', retryEligible: false, retries: 0, nextAction: null, ...over });
test("the CSV quotes cells and a file name cannot run as a spreadsheet formula", () => {
  const r = { batch: {} as any, tally: {}, files: [file("=HYPERLINK(\"http://x\")"), file("+cmd.docx"), file("ok.docx", { outcome: "added", recordSaved: true })] } as BatchReport;
  const lines = reportCsv(r).split("\n");
  expect(lines[1]).toContain("'=HYPERLINK"); expect(lines[1].startsWith("=")).toBe(false); expect(lines[1].startsWith('"=')).toBe(false); expect(lines[2].startsWith("'+")).toBe(true);
  expect(lines[3]).toContain("Added,yes"); expect(lines[1]).toContain('"said ""no"""'); expect(lines[1]).toContain('"A, B"');
});
test("durations are plain", () => { expect(duration(42)).toBe("42 s"); expect(duration(300)).toBe("5 min"); expect(duration(7200)).toBe("2.0 h"); });

import { batchCompletedLine, batchSubmittedLine, localStamp } from "./batchReport";
test("times are shown in the viewer's own time zone with the zone named, and the history lines name the account by e-mail", () => {
  const JHB = "Africa/Johannesburg";
  expect(localStamp("2026-10-29T07:15:00.000Z", JHB)).toBe("29 October 2026, 09:15 SAST");
  expect(localStamp("2026-10-29T07:15:00.000Z", "Europe/London")).toBe("29 October 2026, 07:15 GMT");   // someone signing in from London sees London time
  expect(localStamp("2026-10-29T22:30:00.000Z", JHB)).toBe("30 October 2026, 00:30 SAST");   // across midnight: the South African date
  expect(localStamp("nonsense")).toBe("");
  expect(batchSubmittedLine({ kind: "cv", submittedByEmail: "recruiter@example.co.za", createdAt: "2026-10-29T07:15:00.000Z", counts: { declared: 100 } }, JHB)).toBe("CV batch submitted by recruiter@example.co.za · 29 October 2026, 09:15 SAST · 100 files");
  expect(batchCompletedLine({ kind: "cv", submittedByEmail: "recruiter@example.co.za", finishedAt: "2026-10-29T07:23:00.000Z", counts: { completed: 94, needsReview: 4, failed: 2, blocked: 0, cancelled: 0, duplicates: 0, refused: 0 } }, JHB)).toBe("CV batch completed · Submitted by recruiter@example.co.za · 09:23 SAST · 94 ready, 4 need review, 2 failed");
  expect(batchCompletedLine({ kind: "jd", submittedByEmail: "", finishedAt: null, counts: { completed: 1, needsReview: 0, failed: 0, blocked: 0, cancelled: 0, duplicates: 0, refused: 0 } })).toBe("Job description batch completed · Submitted by an unknown account · 1 ready");
});
