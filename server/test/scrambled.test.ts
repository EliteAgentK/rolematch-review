import { PDFDocument, StandardFonts } from "pdf-lib";
import { expect, test } from "vitest";
import { extractCandidate } from "../src/extract";
import { readDocument, scrambled } from "../src/parse";

// Some exporters (design tools, "print to PDF") store a page's text in an order unrelated to the page: headings first, the name in the
// middle, a block from the bottom of the page before the top. The reader has to rebuild the order from where the text sits.
type Piece = { x: number; y: number; s: string; size?: number };
const page = [
  // contact block, drawn LATE on purpose
  { id: "name", x: 150, y: 790, s: "ZANELE DLAMINI", size: 18 },
  { id: "addr", x: 150, y: 765, s: "Address:" }, { id: "addrv", x: 220, y: 765, s: "Rosebank" },
  { id: "email", x: 150, y: 750, s: "zanele.dlamini@example.test" },
  { id: "sumh", x: 35, y: 715, s: "PROFESSIONAL SUMMARY", size: 12 },
  { id: "sum1", x: 35, y: 698, s: "Operations manager with fifteen years of experience leading logistics teams across Gauteng and the Western Cape." },
  { id: "exph", x: 35, y: 665, s: "WORK EXPERIENCE", size: 12 },
  { id: "r1", x: 35, y: 648, s: "Acme Logistics - Operations Manager" }, { id: "r1d", x: 440, y: 648, s: "Mar 2019 - Present" },
  { id: "r1b", x: 53, y: 633, s: "Led a team of forty drivers and planners across three depots." },
  { id: "r2", x: 35, y: 605, s: "Bolt Freight Group - Team Leader - Dispatch" }, { id: "r2d", x: 440, y: 605, s: "Jan 2014 - Feb 2019" },
  { id: "r2b", x: 53, y: 590, s: "Scheduled daily dispatch for a fleet of sixty vehicles." },
  { id: "cert", x: 35, y: 540, s: "CERTIFICATIONS", size: 12 },
  { id: "c1", x: 53, y: 523, s: "Advanced Fleet Management, Logistics Institute (2016)" },
  { id: "c2", x: 53, y: 509, s: "Occupational Health and Safety Level 2 (2012)" },
  { id: "skh", x: 35, y: 470, s: "KEY SKILLS", size: 12 },
  { id: "k1", x: 53, y: 453, s: "Route Planning: Planned and optimised delivery routes for large fleets across several provinces." },
  { id: "k2", x: 53, y: 439, s: "People Leadership: Coached supervisors and ran weekly performance reviews with every team." },
] as (Piece & { id: string })[];

async function build(order: string[]) {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), p = pdf.addPage([595, 842]);
  for (const id of order) { const it = page.find((x) => x.id === id)!; p.drawText(it.s, { x: it.x, y: it.y, size: it.size ?? 10, font }); }
  return new Uint8Array(await pdf.save());
}
const natural = page.map((x) => x.id);
// the stored order is shuffled the way a design tool does: certifications and skills first, then the headings, then the jobs, the name last
const jumbled = ["cert", "c1", "c2", "skh", "k1", "k2", "sumh", "exph", "r1d", "r1", "r1b", "r2d", "r2", "r2b", "sum1", "name", "addr", "addrv", "email"];

test("a PDF whose text is stored out of order is read in page order and parsed completely", async () => {
  const { text } = await readDocument(await build(jumbled), "pdf");
  const at = (s: string) => text.indexOf(s);
  expect([at("ZANELE DLAMINI"), at("PROFESSIONAL SUMMARY"), at("WORK EXPERIENCE"), at("CERTIFICATIONS"), at("KEY SKILLS")].every((n, i, a) => n >= 0 && (i === 0 || n > a[i - 1]))).toBe(true);
  const rec = (await extractCandidate(text)).record as any;
  expect(rec.name).toBe("Zanele Dlamini");
  expect(rec.location).toBe("Rosebank");                                                      // "Address: | Rosebank" is a label and its value
  expect(rec.summary).toMatch(/^Operations manager with fifteen years/);                       // the summary is the summary, not the job list
  expect(rec.workHistory.map((w: any) => [w.position, w.company, w.startDate, w.endDate])).toEqual([
    ["Operations Manager", "Acme Logistics", "Mar 2019", "Present"],
    ["Team Leader", "Bolt Freight Group", "Jan 2014", "Feb 2019"],                          // company first, title second, a department third
  ]);
  expect(rec.education.map((e: any) => [e.degree, e.institution, e.year, e.type, e.status])).toEqual([
    ["Advanced Fleet Management", "Logistics Institute", "2016", "certificate", "completed"],   // certifications are entries of the Education list, each with what it is and whether it was finished
    ["Occupational Health and Safety Level 2", "", "2012", "certificate", "completed"],
  ]);
  expect(rec.skills.map((s: any) => s.name ?? s)).toEqual(expect.arrayContaining(["Route Planning", "People Leadership"])); // a label is the skill; its sentence is not split into fragments
  for (const s of rec.skills.map((s: any) => s.name ?? s)) expect(s.split(" ").length, s).toBeLessThanOrEqual(4);
});

test("the same CV stored in natural order reads identically", async () => {
  const a = (await readDocument(await build(jumbled), "pdf")).text, b = (await readDocument(await build(natural), "pdf")).text;
  const norm = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
  expect(norm(a)).toBe(norm(b));
});

test("a normal two-column layout, with the sidebar stored first, is not mistaken for scrambled text", () => {
  const item = (s: string, x: number, y: number) => ({ s, x, y, w: s.length * 5, h: 10 });
  const sidebar = Array.from({ length: 12 }, (_, i) => item(`skill ${i}`, 30, 780 - i * 14));
  const main = Array.from({ length: 14 }, (_, i) => item(`main text line number ${i}`, 230, 780 - i * 14));
  expect(scrambled([...sidebar, ...main])).toBe(false);                      // one jump back up, to a column beside the first
  expect(scrambled([...main.slice(7), ...main.slice(0, 7), ...sidebar])).toBe(true); // lower half of the same column stored before the upper half
});
