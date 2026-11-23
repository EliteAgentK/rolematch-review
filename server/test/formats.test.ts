import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { expect, test } from "vitest";
import { extractCandidate } from "../src/extract";
import { FORMATS, describeFormats, sniff } from "../src/formats";
import { readDocument } from "../src/parse";
import { odtToText, rtfToText } from "../src/readers";

const CVS = fileURLToPath(new URL("../../sample-documents/cvs/", import.meta.url));
const file = (name: string) => new Uint8Array(readFileSync(CVS + name));

// cv16 is cv04 (Michael Chen) saved by the operating system as .doc, .rtf, .odt and .txt: the same CV in four more formats.
const facts = async (bytes: Uint8Array) => {
  const kind = sniff(bytes)!;
  const rec: any = (await extractCandidate((await readDocument(bytes, kind)).text)).record;
  return { name: rec.name, email: rec.email, role: rec.workHistory.map((w: any) => [w.position, w.company, w.startDate, w.endDate]), skills: rec.skills.map((s: any) => s.name ?? s).sort(), education: rec.education.length };
};

test("each format is recognised from its bytes, whatever the file is called", () => {
  expect(sniff(file("cv04-michael-chen.docx"))).toBe("docx");
  expect(sniff(file("cv03-lindiwe-dlamini.pdf"))).toBe("pdf");
  expect(sniff(file("cv16-michael-chen.doc"))).toBe("doc");
  expect(sniff(file("cv16-michael-chen.rtf"))).toBe("rtf");
  expect(sniff(file("cv16-michael-chen.odt"))).toBe("odt");       // a zip, but not a Word one
  expect(sniff(file("cv16-michael-chen.txt"))).toBe("txt");
});

test("things that are not documents are refused, even when they look a little like one", () => {
  expect(sniff(zipSync({ "hello.txt": new TextEncoder().encode("just a zip of files") }))).toBeNull();      // a zip archive is not a Word or OpenDocument file
  expect(sniff(new Uint8Array(2000).map((_, i) => (i * 7) % 256))).toBeNull();                              // binary noise
  expect(sniff(new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff, 0, 0, 0xb8, 0, 0, 0]))).toBeNull(); // a Windows program
  expect(sniff(new TextEncoder().encode("short"))).toBeNull();
});

test("the same CV reads the same in every format", async () => {
  const docx = await facts(file("cv04-michael-chen.docx"));
  expect(docx.name).toBe("Michael Chen"); expect(docx.role.length).toBeGreaterThan(0); expect(docx.skills.length).toBeGreaterThan(2);
  for (const ext of ["doc", "rtf", "odt", "txt"]) {
    const got = await facts(file(`cv16-michael-chen.${ext}`));
    expect(got, `.${ext}`).toEqual(docx);
  }
});

test("RTF: escapes, Unicode, hidden groups and list bullets", () => {
  const rtf = "{\\rtf1\\ansi\\ansicpg1252{\\fonttbl{\\f0 Arial;}}{\\colortbl;\\red0\\green0\\blue0;}{\\*\\generator Hidden 1.0;}\\pard Caf\\'e9 \\u8211? Ren\\u233? {\\b bold} \\{braces\\}\\par Second line\\tab tabbed\\par}";
  expect(rtfToText(rtf)).toBe("Café – René bold {braces}\nSecond line\ttabbed\n");
  expect(rtfToText("{\\rtf1{\\info{\\title Secret}}Visible{\\header Page header}}")).toBe("Visible");
});

test("ODT: tabs, spaces, bullets, entities", () => {
  const xml = `<office:text><text:h>Skills &amp; Tools</text:h><text:p>A<text:tab/>B<text:s text:c="3"/>C</text:p><text:list><text:list-item><text:p>R&#38;D &lt;lead&gt;</text:p></text:list-item></text:list></office:text>`;
  expect(odtToText(xml)).toBe("Skills & Tools\nA\tB   C\n• R&D <lead>\n");
});

test("one list drives what the app says it accepts", () => {
  expect(FORMATS.map((f) => f.kind)).toEqual(["pdf", "docx", "odt", "jpeg", "png", "tiff", "bmp", "gif", "doc", "rtf", "txt"]);
  expect(describeFormats()).toMatch(/PDF.*Word \(\.docx\).*Photo \(JPEG\).*Plain text \(\.txt\)$/);
});

import { splitDateCells } from "../src/readers";
test("a table row flattened with tabs (older Word, RTF) is split back into cells where the first cell is a date", () => {
  expect(splitDateCells("Sep 2021 -\nPresent\tData Analyst\nZenith Logistics\n2018\tBSc Statistics")).toBe("Sep 2021 -\nPresent\nData Analyst\nZenith Logistics\n2018\nBSc Statistics");
  expect(splitDateCells("\t•\tBuilt dashboards.\nName\tValue")).toBe("\t•\tBuilt dashboards.\nName\tValue");  // anything else is left as it was
});

test("a file named as one format whose contents are another is refused with the reason; a name we do not know is judged by its contents", async () => {
  const { nameDisagrees } = await import("../src/formats");
  expect(nameDisagrees("not-a-cv.pdf", "txt")).toMatch(/named \.pdf but is not a genuine PDF/);
  expect(nameDisagrees("cv.docx", "pdf")).toMatch(/named \.docx but is not a genuine Word/);
  expect(nameDisagrees("cv.pdf", "pdf")).toBeNull();
  expect(nameDisagrees("CV.PDF", "pdf")).toBeNull();
  expect(nameDisagrees("scan", "pdf")).toBeNull();
  expect(nameDisagrees("cv.pages", "pdf")).toBeNull();
  expect(nameDisagrees("photo.jpg", "png")).toBeNull();
});
