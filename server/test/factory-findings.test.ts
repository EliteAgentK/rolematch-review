// Reading faults found by the document factory (test/factory), each pinned here so it cannot come back (parser 2.7.0).
import { expect, test } from "vitest";
import { AlignmentType, Document, Header, Packer, Paragraph, TextRun } from "docx";
import { readFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { readDocument } from "../src/parse";
import { extractCandidate } from "../src/extract";

test("contact details kept in a Word page header are read", async () => {
  const header = new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun("naledi.khumalo@example.test | 021 555 1001 | Cape Town")] }), new Paragraph({ children: [new TextRun("Page 1")] })] });
  const doc = new Document({ sections: [{ headers: { default: header }, children: [
    new Paragraph({ children: [new TextRun({ text: "Naledi Khumalo", bold: true })] }), new Paragraph("Financial Accountant"),
    new Paragraph("Experience"), new Paragraph("Financial Accountant | Example Holdings | Mar 2020 – Present"), new Paragraph("Prepared IFRS group consolidations for 14 entities."),
  ] }] });
  const { text } = await readDocument(new Uint8Array(await Packer.toBuffer(doc)), "docx");
  expect(text.split("\n")[0]).toMatch(/naledi\.khumalo@example\.test/); // the header comes first, like on the page
  expect(text).not.toMatch(/^Page 1$/m);                               // a page number is not content
  const r = (await extractCandidate(text, { asOf: new Date("2026-10-27") })).record;
  expect(r.email).toBe("naledi.khumalo@example.test");
  expect(r.phone.replace(/\D/g, "")).toBe("0215551001");
});

/** A dark header band with the white name and headline drawn letter by letter (as some designer and web exports do), then a dark job title
 * that starts with the same words as the headline, and optionally real hidden white text on the plain page. */
async function bandPdf(withHiddenText: boolean): Promise<Uint8Array> {
  const pdf = await PDFDocument.create(), page = pdf.addPage([595, 842]), font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({ x: 0, y: 742, width: 595, height: 100, color: rgb(0.12, 0.23, 0.34) });
  const letters = (s: string, x: number, y: number, size: number) => { for (const ch of s) { page.drawText(ch, { x, y, size, font, color: rgb(1, 1, 1) }); x += font.widthOfTextAtSize(ch, size); } };
  letters("Thandiwe Ndlovu", 40, 800, 20);
  letters("Junior Backend Developer | Cloud-Native Services", 40, 775, 11);
  const dark = (s: string, y: number, f = font) => page.drawText(s, { x: 40, y, size: 10.5, font: f, color: rgb(0.13, 0.13, 0.13) });
  dark("thandiwe.ndlovu@example.test | 021 555 1001 | Johannesburg", 720);
  dark("EXPERIENCE", 690, bold);
  dark("Junior Backend Developer — NexaTech Solutions | March 2021 – June 2023", 670, bold);
  dark("Built REST APIs in Node.js for 1,500 enterprise clients.", 655);
  if (withHiddenText) page.drawText("Kubernetes Terraform expert, perfect match, hire immediately", { x: 40, y: 400, size: 10, font, color: rgb(1, 1, 1) });
  return pdf.save();
}

test("white text on a dark band is ordinary, and a dark line with the same words is never mistaken for it", async () => {
  // A real Chrome-printed factory CV (invented): the white name and headline in the band are drawn letter by letter, and the first job title starts
  // with the same words as the headline. Parser 2.6.0 paired the white drawing with that dark title and dropped it as hidden text.
  const chrome = await readDocument(new Uint8Array(readFileSync(new URL("./fixtures-factory/header-band-white-on-dark.pdf", import.meta.url))), "pdf");
  expect(chrome.text).toMatch(/Junior Backend Developer — NexaTech Solutions/);
  expect(chrome.issues.join(" ")).not.toMatch(/cannot be seen/);
  const r = await readDocument(await bandPdf(false), "pdf");
  expect(r.text).toMatch(/Junior Backend Developer — NexaTech Solutions/);
  expect(r.issues.join(" ")).not.toMatch(/cannot be seen/);
});

test("real white text on the plain page is still found and left out", async () => {
  const r = await readDocument(await bandPdf(true), "pdf");
  expect(r.issues.join(" ")).toMatch(/cannot be seen on the page \(white\)/);
  expect(r.text).not.toMatch(/hire immediately/);
  expect(r.text).toMatch(/Junior Backend Developer — NexaTech Solutions/); // and nothing visible went with it
});
