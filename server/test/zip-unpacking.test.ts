// Independent security review, 23 Nov 2026: unpackers size their output by what a zip SAYS it holds, so a few megabytes could claim, and take, gigabytes
// of the server's memory. Three ways in: the file-type check run on every upload unpacked the "mimetype" entry at its claimed size; "View Original" and
// several readers unpacked without the size check; and the size check counted entries from a field a zip can set apart from the one unpackers use.
// Every unpacking now goes through one measured routine (readers.ts unzipChecked / unpacksSafely). Invented files only.
import { strToU8, zipSync } from "fflate";
import { expect, test } from "vitest";
import { sniff } from "../src/formats";
import { unpacksSafely, unzipChecked } from "../src/readers";
import { viewResponse } from "../src/viewer";

const docx = () => zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": strToU8('<w:document><w:body><w:p><w:r><w:t>Invented Person</w:t></w:r></w:p></w:body></w:document>') });
/** The central directory entry for `name`, so a test can make the zip claim what it likes about it. */
function centralEntry(z: Uint8Array, name: string) {
  const v = new DataView(z.buffer, z.byteOffset, z.byteLength);
  for (let i = 0; i < z.length - 46; i++) {
    if (v.getUint32(i, true) !== 0x02014b50) continue;
    const n = new TextDecoder().decode(z.subarray(i + 46, i + 46 + v.getUint16(i + 28, true)));
    if (n === name) return { v, at: i };
  }
  throw new Error(`no entry ${name}`);
}
const endRecord = (z: Uint8Array) => { const v = new DataView(z.buffer, z.byteOffset, z.byteLength); for (let i = z.length - 22; i >= 0; i--) if (v.getUint32(i, true) === 0x06054b50) return { v, at: i }; throw new Error("no end record"); };

test("an OpenDocument file whose mimetype entry claims two gigabytes is recognised without unpacking it", () => {
  const z = zipSync({ mimetype: strToU8("application/vnd.oasis.opendocument.text"), "content.xml": strToU8("<office:document-content/>") });
  const { v, at } = centralEntry(z, "mimetype");
  v.setUint32(at + 24, 0x7fff0000, true);                       // the size it claims to unpack to
  const before = process.memoryUsage().arrayBuffers, t0 = performance.now();
  expect(() => sniff(z)).not.toThrow();
  expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(50 * 1024 * 1024);
  expect(performance.now() - t0).toBeLessThan(2000);
});

test("a Word file whose index counts its entries two ways is refused before anything unpacks it", () => {
  const z = docx();
  expect(unpacksSafely(z)).toBe(true);
  const { v, at } = endRecord(z);
  v.setUint16(at + 10, v.getUint16(at + 10, true) - 1, true);   // "total entries" one short of the entries on this disk
  expect(unpacksSafely(z)).toBe(false);
  expect(() => unzipChecked(z)).toThrow(/unpacks to far more data than a document should/);
});

test("a Word file that claims more than it holds is refused by every reader, and View Original says so without opening it", async () => {
  const z = docx(), { v, at } = centralEntry(z, "word/document.xml");
  v.setUint32(at + 24, 0x7fff0000, true);
  expect(unpacksSafely(z)).toBe(false);
  expect(() => unzipChecked(z)).toThrow();
  const res = await viewResponse(z, "docx", "cv.docx");
  expect(await res.text()).toContain("unpacks to far more data than a document should");
  expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
});
