import { expect, test } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  setTextRenderingMode,
  TextRenderingMode,
} from "pdf-lib";
import { readDocument, withinBudget } from "../src/parse";
import { extractCandidate } from "../src/extract";
import { parseCv } from "../src/rules";
import { repairEmails } from "../src/ocr";
import { exifOrientation } from "../src/imageprep";
import { tiffPages } from "../src/tiff";

const CV =
  "Thandi Mokoena\nSoftware Developer\nthandi@example.test | 082 555 0101 | Cape Town\nSummary\nBuilds reliable web applications for local organisations.\nSkills\nTypeScript, React, Node.js\nExperience\nDeveloper, Acme (2020 - Present)\nEducation\nBSc Computer Science, University of Cape Town, 2019";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const wRun = (s: string, pr = "") =>
  `<w:r><w:rPr>${pr}</w:rPr><w:t>${esc(s)}</w:t></w:r>`;
function docx(extra: string, styles = "") {
  return zipSync({
    "[Content_Types].xml": strToU8(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
    "word/document.xml": strToU8(
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${CV.split(
        "\n",
      )
        .map((s) => `<w:p>${wRun(s)}</w:p>`)
        .join(
          "",
        )}${extra}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`,
    ),
    "word/styles.xml": strToU8(
      `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${styles}</w:styles>`,
    ),
  });
}
function odt(extra: string, styles = "") {
  return zipSync({
    mimetype: strToU8("application/vnd.oasis.opendocument.text"),
    "content.xml": strToU8(
      `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"><office:automatic-styles>${styles}</office:automatic-styles><office:body><office:text>${CV.split(
        "\n",
      )
        .map((s) => `<text:p>${esc(s)}</text:p>`)
        .join(
          "",
        )}${extra}</office:text></office:body></office:document-content>`,
    ),
  });
}

for (const [label, bytes, kind] of [
  [
    "DOCX inherited hidden",
    docx(
      `<w:p>${wRun("HIDDENMARKER", `<w:rStyle w:val="Secret"/>`)}</w:p>`,
      `<w:style w:styleId="Secret" w:type="character"><w:rPr><w:vanish/></w:rPr></w:style>`,
    ),
    "docx",
  ],
  [
    "DOCX off-page anchor",
    docx(
      `<w:p><w:r><w:drawing><wp:anchor><wp:positionH relativeFrom="page"><wp:posOffset>-91440000</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="914400" cy="914400"/><w:txbxContent><w:p>${wRun("HIDDENMARKER")}</w:p></w:txbxContent></wp:anchor></w:drawing></w:r></w:p>`,
    ),
    "docx",
  ],
  [
    "ODT white",
    odt(
      `<text:p><text:span text:style-name="S">HIDDENMARKER</text:span></text:p>`,
      `<style:style style:name="S" style:family="text"><style:text-properties fo:color="#ffffff"/></style:style>`,
    ),
    "odt",
  ],
  [
    "ODT tiny",
    odt(
      `<text:p><text:span text:style-name="S">HIDDENMARKER</text:span></text:p>`,
      `<style:style style:name="S" style:family="text"><style:text-properties fo:font-size="1pt"/></style:style>`,
    ),
    "odt",
  ],
  [
    "ODT hidden",
    odt(
      `<text:p><text:span text:style-name="S">HIDDENMARKER</text:span></text:p>`,
      `<style:style style:name="S" style:family="text"><style:text-properties text:display="none"/></style:style>`,
    ),
    "odt",
  ],
  [
    "ODT off-page frame",
    odt(
      `<draw:frame text:anchor-type="page" svg:x="-100cm" svg:y="0cm" svg:width="1cm" svg:height="1cm"><draw:text-box><text:p>HIDDENMARKER</text:p></draw:text-box></draw:frame>`,
    ),
    "odt",
  ],
  [
    "RTF hidden",
    strToU8(`{\\rtf1 ${CV.replace(/\n/g, "\\par ")}{\\v HIDDENMARKER}}`),
    "rtf",
  ],
  [
    "RTF tiny",
    strToU8(`{\\rtf1 ${CV.replace(/\n/g, "\\par ")}{\\fs2 HIDDENMARKER}}`),
    "rtf",
  ],
  [
    "RTF white",
    strToU8(
      `{\\rtf1{\\colortbl;\\red255\\green255\\blue255;} ${CV.replace(/\n/g, "\\par ")}{\\cf1 HIDDENMARKER}}`,
    ),
    "rtf",
  ],
  [
    "RTF off-page",
    strToU8(
      `{\\rtf1 ${CV.replace(/\n/g, "\\par ")}{\\posx-100000\\absw100 HIDDENMARKER}}`,
    ),
    "rtf",
  ],
] as const)
  test(`${label}: exclude and report`, async () => {
    const r = await readDocument(bytes, kind);
    expect(r.text).toContain("Thandi Mokoena");
    expect(r.text).not.toContain("HIDDENMARKER");
    expect(r.issues.join(" ")).toMatch(/cannot be seen|hidden|off.page/i);
  });

test("a dark DOCX paragraph does not legitimise white text elsewhere", async () => {
  const r = await readDocument(
    docx(
      `<w:p><w:pPr><w:shd w:fill="123456"/></w:pPr>${wRun("VISIBLE", `<w:color w:val="FFFFFF"/>`)}</w:p><w:p>${wRun("HIDDENMARKER", `<w:color w:val="FFFFFF"/>`)}</w:p>`,
    ),
    "docx",
  );
  expect(r.text).toContain("VISIBLE");
  expect(r.text).not.toContain("HIDDENMARKER");
});
const controls = [
  ...Array.from({ length: 5 }, (_, i) => 0x200b + i),
  0x2060,
  0xfeff,
  ...Array.from({ length: 5 }, (_, i) => 0x202a + i),
  ...Array.from({ length: 4 }, (_, i) => 0x2066 + i),
];
test.each(controls)(
  "U+%s cannot split TypeScript in CV and JD entry points",
  async (cp) => {
    const dirty = CV.replace(
      "TypeScript",
      `Type${String.fromCodePoint(cp)}Script`,
    );
    expect(parseCv(dirty).skills.map((s) => s.name)).toContain("TypeScript");
    expect(
      (await extractCandidate(dirty, { asOf: new Date("2026-10-21") })).record
        .skills,
    ).toContain("TypeScript");
    // a job description's invisible characters: test/job-reader.test.ts
  },
);
test("CR-only input preserves line boundaries", async () => {
  expect(
    (await readDocument(strToU8(CV.replace(/\n/g, "\r")), "txt")).text,
  ).toBe(CV);
});

// Expected failures document UNSOLVED safety properties, not evidence that the reader is safe.
test("timeout aborts work that can be stopped and releases what it held", async () => {
  let finished = false, released = false, aborted = false;
  const r = await withinBudget(
    (signal) => new Promise((res) => {
      const t = setTimeout(() => { finished = true; res(1); }, 30);
      signal.addEventListener("abort", () => { aborted = true; clearTimeout(t); });
    }),
    0.001,
    () => { released = true; },
  );
  expect(r).toBe("TIMEOUT");
  await new Promise((r) => setTimeout(r, 60));
  expect({ finished, released, aborted }).toEqual({ finished: false, released: true, aborted: true });
});
test("a valid email is never guessed", () => {
  expect(repairEmails("Thandi Mokoena\nthandi@gmaii.com")).toContain(
    "thandi@gmaii.com",
  );
});
test("invalid EXIF orientation is ignored", () => {
  const b = Buffer.alloc(40);
  b.set([
    255, 216, 255, 225, 0, 34, 69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0,
    0, 1, 0, 18, 1, 3, 0, 1, 0, 0, 0, 9, 0,
  ]);
  expect(exifOrientation(b)).toBe(1);
  b[30] = 6;
  expect(exifOrientation(b)).toBe(6);
  expect(exifOrientation(b.subarray(0, 26))).toBe(1);
});
test("TIFF page limit zero is refused", () => {
  // Minimal 1x1 uncompressed TIFF, directory only; zero page limit skips decode.
  const b = Buffer.alloc(38);
  b.write("II");
  b.writeUInt16LE(42, 2);
  b.writeUInt32LE(8, 4);
  b.writeUInt16LE(2, 8);
  for (const [offset, tag] of [
    [10, 256],
    [22, 257],
  ]) {
    b.writeUInt16LE(tag, offset);
    b.writeUInt16LE(3, offset + 2);
    b.writeUInt32LE(1, offset + 4);
    b.writeUInt16LE(1, offset + 8);
  }
  expect(() => tiffPages(b, 0)).toThrow(/page budget/);
});
test(
  "a tiny PDF logo must not legitimise invisible keywords",
  async () => {
    const d = await PDFDocument.create(),
      f = await d.embedFont(StandardFonts.Helvetica),
      p = d.addPage();
    CV.split("\n").forEach((s, i) =>
      p.drawText(s, { x: 40, y: 790 - i * 20, size: 10, font: f }),
    );
    const png = await d.embedPng(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    p.drawImage(png, { x: 0, y: 0, width: 1, height: 1 });
    p.pushOperators(
      pushGraphicsState(),
      setTextRenderingMode(TextRenderingMode.Invisible),
    );
    p.drawText("HIDDENMARKER", { x: 40, y: 200, size: 10, font: f });
    p.pushOperators(popGraphicsState());
    expect((await readDocument(await d.save(), "pdf")).text).not.toContain(
      "HIDDENMARKER",
    );
  },
);

test(
  "an unrelated coloured shape must not legitimise white text",
  async () => {
    const d = await PDFDocument.create(),
      f = await d.embedFont(StandardFonts.Helvetica),
      p = d.addPage();
    CV.split("\n").forEach((s, i) =>
      p.drawText(s, { x: 40, y: 790 - i * 20, size: 10, font: f }),
    );
    p.drawRectangle({ x: 0, y: 0, width: 1, height: 1, color: rgb(1, 0, 0) });
    p.drawText("HIDDENMARKER", {
      x: 40,
      y: 200,
      size: 10,
      font: f,
      color: rgb(1, 1, 1),
    });
    expect((await readDocument(await d.save(), "pdf")).text).not.toContain(
      "HIDDENMARKER",
    );
  },
);
