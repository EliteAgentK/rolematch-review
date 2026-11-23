import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { expect, test } from "vitest";
import { prepareDocument } from "../src/prepare";
import { defaultSettings } from "../src/settings";

// Found on a long CV in Word: a rule that drops a table's column headings was dropping the first row of any labelled table with a year further down. The employer was lost, and a referee's number was taken as the candidate's.
const table = (rows: string[][]) => new Table({ width: { size: 9000, type: WidthType.DXA }, rows: rows.map((r) => new TableRow({ children: r.map((c) => new TableCell({ width: { size: 4500, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun(c)] })] })) })) });
const P = (t: string) => new Paragraph({ children: [new TextRun(t)] });
test("every row of a Word table of labels is read, and the person's details are theirs", async () => {
  const doc = new Document({ sections: [{ children: [P("CURRICULUM VITAE"), P("PERSONAL DETAILS"), table([["Full names", "Ruan Smith"], ["Identity number", "8001015800089"], ["Home languages", "English, isiZulu"], ["Residential area", "Port Elizabeth"], ["Contact number", "082 555 0142"], ["Email address", "ruan.smith@example.test"]]), P("SKILLS"), P("Python, SQL, Spark, Forecasting"), P("CAREER HISTORY"), table([["Company", "Karoo Corporation"], ["Position", "Head of Data Science"], ["Period", "Sep 2022 to To date"], ["Location", "Durban"]]), P("Led a team of nine analysts across three offices and reported to the board."), table([["Company", "Cape Union Holdings"], ["Position", "Senior Data Scientist"], ["Period", "May 2014 to Sep 2022"], ["Location", "Sandton"], ["Reason for leaving", "Career progression"]]), P("Built the churn models used by the retention team."), P("REFERENCES"), P("Sam Dlamini, Director, Karoo Corporation. Tel 082 555 0187. Email sam@example.test")] }] });
  const out: any = await prepareDocument(new Uint8Array(await Packer.toBuffer(doc)), { kind: "cv", org: defaultSettings(), asOf: new Date("2026-11-05T00:00:00Z") });
  expect(out.ok).toBe(true);
  const r = out.record;
  expect([r.name, r.phone, r.email, r.location]).toEqual(["Ruan Smith", "082 555 0142", "ruan.smith@example.test", "Port Elizabeth"]);
  expect(r.languages).toEqual(expect.arrayContaining(["English", "isiZulu"]));
  expect(r.workHistory.map((w: any) => [w.position, w.company])).toEqual([["Head of Data Science", "Karoo Corporation"], ["Senior Data Scientist", "Cape Union Holdings"]]);
  expect(JSON.stringify(r)).not.toContain("8001015800089");
});

test("a referee who shares the candidate's first name is still a referee", async () => {
  const doc = new Document({ sections: [{ children: [P("Ruan Smith"), P("Port Elizabeth | ruan.smith@example.test | 082 555 0142"), P("SKILLS"), P("Python, SQL, Spark, Forecasting"), P("REFERENCES"), P("Ruan du Plessis, Director. Tel 082 555 0187. Email ruan.duplessis@example.test")] }] });
  const r: any = (await prepareDocument(new Uint8Array(await Packer.toBuffer(doc)), { kind: "cv", org: defaultSettings(), asOf: new Date("2026-11-05T00:00:00Z") }) as any).record;
  expect([r.phone, r.email]).toEqual(["082 555 0142", "ruan.smith@example.test"]);
});
test("where a role was is not where the person lives", async () => {
  const doc = new Document({ sections: [{ children: [P("Ruan Smith"), P("PERSONAL DETAILS"), table([["Residential area", "Port Elizabeth"], ["Contact number", "082 555 0142"], ["Email address", "ruan.smith@example.test"]]), P("CAREER HISTORY"), table([["Company", "Karoo Corporation"], ["Position", "Head of Data Science"], ["Period", "Sep 2022 to To date"], ["Location", "Durban"]]), P("Led a team of nine analysts across three offices.")] }] });
  const r: any = (await prepareDocument(new Uint8Array(await Packer.toBuffer(doc)), { kind: "cv", org: defaultSettings(), asOf: new Date("2026-11-05T00:00:00Z") }) as any).record;
  expect(r.location).toBe("Port Elizabeth");
});
