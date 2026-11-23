import { PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, setTextRenderingMode, TextRenderingMode } from "pdf-lib";
import { expect, test } from "vitest";
import { readDocument } from "../src/parse";
import { defaultSettings } from "../src/settings";

// Text a person cannot see must not become evidence: white on white, fully transparent, invisible, or tiny. It is left out and reported.
const LINES = [
  "Zanele Dlamini", "Operations Manager", "zanele.dlamini@example.test | 082 555 0101 | Rosebank",
  "WORK EXPERIENCE", "Acme Logistics - Operations Manager | Mar 2019 - Present", "Led a team of forty drivers and planners across three depots.",
  "Bolt Freight Group - Team Leader | Jan 2014 - Feb 2019", "Scheduled daily dispatch for a fleet of sixty vehicles.",
  "EDUCATION", "BCom Logistics, University of Johannesburg, 2012",
  "KEY SKILLS", "Route planning, Fleet management, People leadership",
];

async function build(extra: (p: any, font: any, pdf: PDFDocument) => Promise<void> | void, encrypt = false) {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), page = pdf.addPage([595, 842]);
  LINES.forEach((s, i) => page.drawText(s, { x: 50, y: 790 - i * 22, size: i === 0 ? 18 : 11, font }));
  await extra(page, font, pdf);
  if (encrypt) (pdf as any).catalog; // permissions are set below through the raw encryption dictionary when supported
  return pdf.save();
}
const STUFF = "Kubernetes Machine learning Blockchain Python TensorFlow";

test("a normal PDF has nothing hidden and reads as before", async () => {
  const r = await readDocument(await build(() => {}), "pdf");
  expect(r.inspection?.hidden).toEqual([]);
  expect(r.text).toContain("Acme Logistics");
  expect(r.issues.join(" ")).not.toMatch(/cannot be seen/);
});

test("white text on a plain page is left out and reported", async () => {
  const r = await readDocument(await build((p, font) => p.drawText(STUFF, { x: 50, y: 300, size: 11, font, color: rgb(1, 1, 1) })), "pdf");
  expect(r.text).not.toContain("Kubernetes");
  expect(r.text).toContain("Acme Logistics");
  expect(r.inspection?.hidden.map((h) => h.why)).toContain("white");
  expect(r.issues.join(" ")).toMatch(/cannot be seen/);
});

test("fully transparent text is left out", async () => {
  const r = await readDocument(await build((p, font) => p.drawText(STUFF, { x: 50, y: 300, size: 11, font, opacity: 0 })), "pdf");
  expect(r.text).not.toContain("Blockchain");
  expect(r.inspection?.hidden.map((h) => h.why)).toContain("transparent");
});

test("invisible text (render mode 3) on a page without an image is left out", async () => {
  const r = await readDocument(await build((p, font) => {
    p.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
    p.drawText(STUFF, { x: 50, y: 300, size: 11, font });
    p.pushOperators(popGraphicsState());
  }), "pdf");
  expect(r.text).not.toContain("TensorFlow");
  expect(r.inspection?.hidden.map((h) => h.why)).toContain("invisible");
});

test("with the policy set to flag only, hidden text is kept but still reported", async () => {
  const bytes = await build((p, font) => p.drawText(STUFF, { x: 50, y: 300, size: 11, font, color: rgb(1, 1, 1) }));
  const r = await readDocument(bytes, "pdf", { reading: { hiddenText: "flag_only", forbiddenCopy: "read_and_flag" } });
  expect(r.text).toContain("Kubernetes");
  expect(r.inspection?.hidden.length).toBeGreaterThan(0);
  expect(r.issues.join(" ")).toMatch(/cannot be seen/);
});

test("white text on a dark panel is ordinary and is not hidden", async () => {
  const r = await readDocument(await build((p, font) => {
    p.drawRectangle({ x: 40, y: 200, width: 300, height: 40, color: rgb(0.1, 0.15, 0.3) });
    p.drawText("Available immediately", { x: 50, y: 215, size: 11, font, color: rgb(1, 1, 1) });
  }), "pdf");
  expect(r.inspection?.hidden).toEqual([]);
  expect(r.text).toContain("Available immediately");
});

test("the organisation's reading settings exist with safe defaults", () => {
  const s = defaultSettings().reading;
  expect(s).toEqual({ hiddenText:"exclude_and_flag",forbiddenCopy:"read_and_flag",pageSeconds:20,maxBatchFiles:50,hiddenTinyPoints:1 });
});

test("a scanner's invisible text layer over a page image is not treated as hidden text", async () => {
  const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  const r = await readDocument(await build(async (p, font, pdf) => {
    const img = await pdf.embedPng(png);
    p.drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
    p.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
    p.drawText("Scanner text layer words", { x: 50, y: 300, size: 11, font });
    p.pushOperators(popGraphicsState());
  }), "pdf");
  expect(r.inspection?.hidden).toEqual([]);
  expect(r.inspection?.scannerLayerPages).toBe(1);
});

test("the notes a person sees are plain and say what happened to the text", async () => {
  const { inspectionNotes } = await import("../src/inspect");
  const base = { producer: "", creator: "", createdAt: "", modifiedAt: "", pages: 1, pageWidth: 595, pageHeight: 842, encrypted: false, copyForbidden: false, hasForm: false, hasJavaScript: false, annotations: {}, attachments: 0, scannerLayerPages: 0, hidden: [] };
  const notes = inspectionNotes({ ...base, copyForbidden: true, hasJavaScript: true, attachments: 2, annotations: { Link: 3, Stamp: 1, Text: 2 }, hidden: [{ x: 0, y: 0, w: 1, h: 1, text: "x", why: "white" }] }, { hiddenText: "exclude_and_flag", forbiddenCopy: "read_and_flag" });
  expect(notes.join("\n")).toMatch(/cannot be seen.*left out/);
  expect(notes.join("\n")).toMatch(/may not be copied.*read anyway/);
  expect(notes.join("\n")).toMatch(/scripts.*not run/);
  expect(notes.join("\n")).toMatch(/2 attached files.*not opened/);
  expect(notes.join("\n")).toMatch(/3 notes or marks.*not used/);   // Link annotations are not counted as comments; Stamp and Text are (1 + 2)
});

test("a page that takes too long is given up instead of holding the document", async () => {
  const { withinBudget } = await import("../src/parse");
  const slow = new Promise<string>((resolve) => setTimeout(() => resolve("late"), 400));
  expect(await withinBudget(slow, 0.05)).toBe("TIMEOUT");
  expect(await withinBudget(Promise.resolve("on time"), 1)).toBe("on time");
});
