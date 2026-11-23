// The job reader (src/jobReader.ts) with a stand-in for Claude: no credit is spent, and each mistake found while building it on 10 Nov 2026 is a case here,
// so it cannot come back unnoticed (owner: "from every single mistake ... it won't happen again, not just a quick patch").
import { expect, test } from "vitest";
import { factsOf, labelsOf, listsOf, numberedLines, readJobDocument, type Ask } from "../src/jobReader";

/** A stand-in for Claude: the facts answer and the line labels are given by the test, in the shape the real answers take. */
function fakeClaude(facts: object, labels: (user: string) => any[], refuse = false): { ask: Ask; asked: string[] } {
  const asked: string[] = [];
  const ask: Ask = async (o) => {
    asked.push(o.user);
    if (refuse) return { ok: false, why: "unavailable", detail: "the AI's credit is used up", ms: 1, model: "test" };
    const json = "writtenSummary" in (o.schema as any).properties ? facts : { lines: labels(o.user) };
    return { ok: true, json, raw: JSON.stringify(json), ms: 1, model: "test" };
  };
  return { ask, asked };
}
const label = (n: number, part: string, item = n, heading = 0) => ({ n, part, item, heading });

// The Absa job's opening, as Word gives it: the document's name first, then the title, then a key-facts table one cell per line (it was refused for its title).
const ABSA = ["JOB DESCRIPTION", "Head of Technology", "Job title", "Head of Technology", "Reports to", "Chief Technology Officer, Everyday Banking",
  "Purpose of the role", "The Head of Technology leads the technology function for Everyday Banking.",
  "Key responsibilities", "1. Technology strategy and architecture", "Define and own the technology strategy and roadmap for Everyday Banking.",
  "Set architecture principles and standards for the business unit.", "6. Information security, cyber resilience and technology risk",
  "Own the information security strategy through the Chief Information Security Officer.",
  "Behavioural competencies", "Strategic thinking", "Sees the long-term picture and connects technology choices to business results.",
  "How to apply", "Submit your CV to careers@absa-example.co.za before 28 November 2026.", "Page 2 of 6"].join("\n");

test("a job that opens with 'JOB DESCRIPTION' is read: the document's name is skipped, the title is the job's own", async () => {
  const { ask } = fakeClaude({ title: { line: 2, value: "Head of Technology" }, reportsTo: { line: 6, value: "Chief Technology Officer, Everyday Banking" }, writtenSummary: "" },
    () => [label(1, "skip"), label(2, "fact"), label(3, "fact", 3), label(4, "fact", 3), label(5, "fact", 5), label(6, "fact", 5), label(7, "heading"), label(8, "summary", 8, 7),
      label(9, "heading"), label(10, "heading", 10, 9), label(11, "responsibility", 11, 10), label(12, "responsibility", 12, 10), label(13, "heading", 13, 9),
      label(14, "responsibility", 14, 13), label(15, "heading"), label(16, "competency", 16, 15), label(17, "competency", 16, 15), label(18, "heading"), label(19, "extra", 19, 18), label(20, "skip")]);
  const r = await readJobDocument(ABSA, ask);
  if (!r.ok) throw new Error(r.why);
  expect(r.reading.title).toBe("Head of Technology");
  expect(r.reading.reportsTo).toBe("Chief Technology Officer, Everyday Banking");
  expect(r.reading.description).toBe("The Head of Technology leads the technology function for Everyday Banking.");
  expect(r.reading.summarySource).toBe("document");
  // a group heading with commas is a heading, never a duty (job-ai-1 added six such headings to a job's duties)
  expect(r.reading.responsibilities).toEqual(["Define and own the technology strategy and roadmap for Everyday Banking.", "Set architecture principles and standards for the business unit.", "Own the information security strategy through the Chief Information Security Officer."]);
  expect(r.reading.responsibilityGroups).toEqual([{ heading: "Technology strategy and architecture", count: 2 }, { heading: "Information security, cyber resilience and technology risk", count: 1 }]);
  // a competency table's two cells are one competency, never two missed items
  expect(r.reading.competencies).toEqual([{ name: "Strategic thinking", description: "Sees the long-term picture and connects technology choices to business results." }]);
  // an application address is the document's own line: Claude reads it hidden ("[email]") but the panel shows the job's words (job-ai-1 dropped such lines)
  expect(r.reading.extras).toEqual([{ heading: "How to apply", items: ["Submit your CV to careers@absa-example.co.za before 28 November 2026."] }]);
  expect(r.reading.aiReading.unlabelled).toBe(0);
});

test("every line is kept: a line Claude did not label is asked about by number once, and one still unlabelled is kept, never lost", async () => {
  const lines = ["Duties", "Prepare the monthly management accounts.", "Reconcile the supplier and control accounts.", "Investigate ledger variances with budget owners."];
  const { ask, asked } = fakeClaude({ writtenSummary: "" }, (user) => (user.includes("Label only these lines") ? [label(3, "responsibility", 3, 1)] : [label(1, "heading"), label(2, "responsibility", 2, 1)]));
  const r = await readJobDocument(lines.join("\n"), ask);
  if (!r.ok) throw new Error(r.why);
  expect(asked.some((u) => u.includes("Label only these lines, which were left out: 3, 4."))).toBe(true);
  expect(r.reading.responsibilities).toEqual(["Prepare the monthly management accounts.", "Reconcile the supplier and control accounts."]);
  expect(r.reading.extras).toEqual([{ heading: "Also in the job description", items: ["Investigate ledger variances with budget owners."] }]);
  expect(r.reading.aiReading).toMatchObject({ askedAgain: true, unlabelled: 1 });
});

test("one item is one line: bullets are never joined, a paragraph is never split, and a table row's cells become one item", () => {
  const lines = numberedLines(["Requirements", "- A degree in Accounting.", "- Five years in audit.", "Key performance areas", "Delivery", "Projects on time", "Percentage on budget"].join("\n"));
  const lists = listsOf(lines, labelsOf({ lines: [label(1, "heading"), label(2, "requirement", 2, 1), label(3, "requirement", 3, 1), label(4, "heading"), label(5, "extra", 5, 4), label(6, "extra", 5, 4), label(7, "extra", 5, 4)] }, lines.length));
  expect(lists.requirements).toEqual(["A degree in Accounting.", "Five years in audit."]);
  expect(lists.extras).toEqual([{ heading: "Key performance areas", items: ["Delivery · Projects on time · Percentage on budget"] }]);
});

test("the same answer builds the same panel every time: nothing on it depends on copied wording", () => {
  const lines = numberedLines(ABSA), labels = labelsOf({ lines: [label(11, "responsibility", 11, 10), label(12, "responsibility", 12, 10)] }, lines.length);
  expect(listsOf(lines, labels)).toEqual(listsOf(lines, labels));
});

test("a fact must be on the line it came from, or anywhere in the job; anything else is dropped and counted, never shown", () => {
  const lines = numberedLines(ABSA);
  const f = factsOf({ title: { line: 2, value: "Head of Technology" }, remuneration: { line: 4, value: "R2.5 million a year" }, location: { line: 9, value: "Johannesburg" },
    otherFacts: [{ label: "Closing date", line: 19, value: "28 November 2026" }], skills: [{ name: "TOGAF", line: 0 }, { name: "Technology strategy", line: 11 }] }, lines);
  expect(f.title).toBe("Head of Technology");
  expect(f.remuneration).toBe("");   // not in the document: never invented
  expect(f.location).toBe("");
  expect(f.keyFacts).toEqual([{ label: "Closing date", value: "28 November 2026" }]);
  expect(f.skills).toEqual(["Technology strategy"]);
  expect(f.dropped).toEqual(["Johannesburg", "R2.5 million a year", "TOGAF"]);
});

test("a job with no summary of its own gets two sentences from Claude, labelled as written by AI; a job with neither has none", async () => {
  const text = "Payroll Administrator\nRequirements\nTwo years of payroll experience.";
  const written = await readJobDocument(text, fakeClaude({ title: { line: 1, value: "Payroll Administrator" }, writtenSummary: "Runs the monthly payroll. Answers staff questions about pay." }, () => [label(1, "fact"), label(2, "heading"), label(3, "requirement", 3, 2)]).ask);
  if (!written.ok) throw new Error(written.why);
  expect(written.reading).toMatchObject({ description: "Runs the monthly payroll. Answers staff questions about pay.", summarySource: "ai" });
  const none = await readJobDocument(text, fakeClaude({ writtenSummary: "" }, () => [label(1, "fact"), label(2, "heading"), label(3, "requirement", 3, 2)]).ask);
  if (!none.ok) throw new Error(none.why);
  expect(none.reading).toMatchObject({ description: "", summarySource: "", title: "" });   // no title: published for a recruiter to add one, never guessed
});

test("labels outside the document, or a second label for a line, are ignored", () => {
  const labels = labelsOf({ lines: [label(1, "heading"), label(1, "requirement"), label(0, "requirement"), label(99, "requirement"), { n: 2, part: "nonsense", item: 2, heading: 2 }] }, 3);
  expect([...labels.values()]).toEqual([{ n: 1, part: "heading", item: 1, heading: 0 }, { n: 2, part: "extra", item: 2, heading: 0 }]);
});

test("when Claude cannot answer, the reading says why and nothing is guessed", async () => {
  const r = await readJobDocument(ABSA, fakeClaude({}, () => [], true).ask);
  expect(r).toMatchObject({ ok: false, why: "unavailable: the AI's credit is used up" });
});

test("characters a reader cannot see are taken out before Claude reads the job, so a skill hidden by one is still the job's own words", async () => {
  for (const cp of [0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]) {
    const { ask, asked } = fakeClaude({ title: { line: 1, value: "Software Developer" }, skills: [{ name: "TypeScript", line: 3 }], writtenSummary: "" }, () => [label(1, "fact"), label(2, "heading"), label(3, "requirement", 3, 2)]);
    const r = await readJobDocument(`Software Developer\nRequirements\nType${String.fromCodePoint(cp)}Script, React`, ask);
    if (!r.ok) throw new Error(r.why);
    expect(asked[0]).toContain("[3] TypeScript, React");
    expect(r.reading.skills).toEqual(["TypeScript"]);
    expect(r.reading.requirements).toEqual(["TypeScript, React"]);
  }
});

test("every job is placed in one standard department; Executive leadership only for the head of a whole business, otherwise Claude's second choice", async () => {
  const { departmentOf } = await import("../src/jobReader");
  const exec = "Executive leadership: only the chief executive, managing director or general manager of a whole business";
  const tech = "Technology: software, cloud, infrastructure, IT, security; including the CIO, CTO and heads of technology";
  expect(departmentOf([exec, tech], "Chief Information Officer (CIO)")).toBe("Technology");
  expect(departmentOf([exec, tech], "Group Chief Executive Officer")).toBe("Executive leadership");
  expect(departmentOf([tech], "Senior Software Engineer")).toBe("Technology");
  expect(departmentOf(["something else"], "Clerk")).toBe("");   // never a department outside the list
});

// A long job description (code review, 16 Nov 2026, B-M9). Claude labels one line per answer object, and an answer has a ceiling on what it can write, so a job of
// several hundred lines asked as one question was cut off every time, and each of the queue's three tries was paid for. The stand-in below has that ceiling:
// asked to label more than 300 lines in one answer, it is cut off, as Claude was.
function cappedClaude(cap = 300) {
  const sizes: number[] = []; let asks = 0;
  const ask: Ask = async (o) => {
    asks++;
    if ("writtenSummary" in (o.schema as any).properties) { const json = { title: { line: 1, value: "Senior Data Engineer" }, writtenSummary: "" }; return { ok: true, json, raw: JSON.stringify(json), ms: 1, model: "test" }; }
    const all = [...o.user.matchAll(/^\[(\d+)\] (.*)$/gm)].map((m) => Number(m[1]));
    const range = o.user.match(/Label only lines (\d+) to (\d+)\./), wanted = range ? all.filter((n) => n >= Number(range[1]) && n <= Number(range[2])) : all;
    sizes.push(wanted.length);
    if (wanted.length > cap) return { ok: false, why: "truncated", detail: "the answer was cut off", ms: 1, model: "test", cost: { promptTokens: 1000, outTokens: 16000, loadMs: 0, readMs: 0, writeMs: 0 } };
    const json = { lines: wanted.map((n) => (n === 1 ? label(1, "fact") : n === 2 ? label(2, "heading") : label(n, "requirement", n, 2))) };
    return { ok: true, json, raw: JSON.stringify(json), ms: 1, model: "test" };
  };
  return { ask, sizes, asks: () => asks };
}
const longJob = (requirements: number, pad = "") => ["Senior Data Engineer", "Requirements", ...Array.from({ length: requirements }, (_, i) => `- Requirement ${i + 1}: experience with pipeline number ${i + 1}${pad}.`)].join("\n");

test("a long job description is labelled in parts, so every line is read however long it is (code review, 16 Nov 2026, B-M9)", async () => {
  const c = cappedClaude();
  const r = await readJobDocument(longJob(698), c.ask);
  if (!r.ok) throw new Error(r.why);
  expect(r.reading.requirements.length).toBe(698);
  expect(r.reading.requirements[697]).toBe("Requirement 698: experience with pipeline number 698.");
  expect(r.reading.requirementGroups).toEqual([{ heading: "Requirements", count: 698 }]);   // the heading above the first part still heads the items of the last
  expect(Math.max(...c.sizes)).toBeLessThanOrEqual(300);
  expect(r.reading.aiReading.unlabelled).toBe(0);
});

test("a job description too long to read is refused before anything is paid, and as final: asking again cannot succeed (code review, 16 Nov 2026, B-M9)", async () => {
  const c = cappedClaude();
  const r = await readJobDocument(longJob(2500, " and a long sentence that goes on to describe the work in some detail"), c.ask);
  expect(r).toMatchObject({ ok: false, final: true });
  expect(c.asks()).toBe(0);
  // A question the model says is too long, or an answer it could not finish, is final too; a busy or unreachable AI is not, and the queue asks again.
  const refusing = (why: "too_long" | "truncated" | "unavailable"): Ask => async () => ({ ok: false, why, detail: why, ms: 1, model: "test" });
  expect(await readJobDocument(ABSA, refusing("too_long"))).toMatchObject({ ok: false, final: true });
  expect(await readJobDocument(ABSA, refusing("truncated"))).toMatchObject({ ok: false, final: true });
  const busy: any = await readJobDocument(ABSA, refusing("unavailable"));
  expect(busy.ok).toBe(false); expect(busy.final).toBeFalsy();
});
