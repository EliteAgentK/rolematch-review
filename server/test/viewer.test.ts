// "View Original CV" opens in its own tab and never has to be downloaded: a browser shows PDF and text itself; Word and other office files become a
// read-only page that cannot run anything and does not follow links written in the CV. Invented sample documents only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Document, ExternalHyperlink, Packer, Paragraph, TextRun } from "docx";
import { expect, test } from "vitest";
import UTIF from "utif2";
import { VIEW_CSP, viewResponse } from "../src/viewer";

const sample = (f: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../../sample-documents/cvs/${f}`, import.meta.url))));

test("a PDF and a text file are sent as they are, to be shown inline (never as an attachment)", async () => {
  for (const [f, kind, type] of [["cv03-lindiwe-dlamini.pdf", "pdf", "application/pdf"], ["cv16-michael-chen.txt", "txt", "text/plain"]] as const) {
    const r = await viewResponse(sample(f), kind, f);
    expect(r.headers.get("content-type")).toContain(type);
    expect(r.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(sample(f));
  }
});

test("a Word CV becomes a read-only page with the document's own content, its own strict content policy, and no live links", async () => {
  const r = await viewResponse(sample("cv01-thandi-mokoena.docx"), "docx", "cv01-thandi-mokoena.docx");
  expect(r.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(r.headers.get("content-security-policy")).toBe(VIEW_CSP);
  expect(VIEW_CSP).toContain("default-src 'none'"); expect(VIEW_CSP).not.toContain("script-src");
  const html = await r.text();
  expect(html).toContain("Thandi Mokoena");
  expect(html).toContain("page layout and fonts may differ");
  // a CV with a link (and a script-looking name) cannot turn the page into anything active
  const hostile = new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children: [
    new Paragraph({ children: [new TextRun("<script>alert(1)</script> Lerato Example")] }),
    new Paragraph({ children: [new ExternalHyperlink({ link: "javascript:alert(1)", children: [new TextRun("portfolio")] })] }),
  ] }] })));
  const h = await (await viewResponse(hostile, "docx", "hostile.docx")).text();
  expect(h).not.toMatch(/<script/i); expect(h).not.toMatch(/<a\b/i); expect(h).toContain("&lt;script&gt;");
  expect(h).toContain("portfolio");
});

test("Word 97, RTF and OpenDocument files are shown as the text RoleMatch read, labelled as such", async () => {
  for (const [f, kind] of [["cv16-michael-chen.rtf", "rtf"], ["cv16-michael-chen.odt", "odt"], ["cv16-michael-chen.doc", "doc"]] as const) {
    const r = await viewResponse(sample(f), kind, f);
    expect(r.headers.get("content-security-policy")).toBe(VIEW_CSP);
    const html = await r.text();
    expect(html, f).toContain("Michael Chen");
    expect(html).toContain("the text RoleMatch read");
  }
}, 60000);

test("a TIFF is shown as a PNG picture of its first page, by the same decoder and limits that read it, with no image library outside the permissive licences", async () => {
  const rgba = new Uint8Array(4 * 4 * 4).fill(255);
  const r = await viewResponse(new Uint8Array(UTIF.encodeImage(rgba, 4, 4)), "tiff", "scan.tiff");
  expect(r.headers.get("content-type")).toContain("image/png");
  expect(r.headers.get("content-disposition")).toMatch(/^inline;/);
  expect([...new Uint8Array(await r.arrayBuffer()).slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
});
