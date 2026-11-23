import { zipSync, strToU8 } from "fflate";
import { expect, test } from "vitest";
import { extractCandidate } from "../src/extract";
import { cleanInvisible, removeHiddenFromDocx } from "../src/invisible";
import { readDocument } from "../src/parse";
import { expandedSize } from "../src/readers";

// What a person cannot see must not become evidence, and characters with no shape must not decide what a word is.
const para = (runs: string) => `<w:p>${runs}</w:p>`;
const run = (text: string, props = "") => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
function docx(paragraphs: string[], extraBody = "") {
  const body = paragraphs.join("") + extraBody;
  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
    "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`),
  });
}
const CV = [para(run("Thandi Mokoena")), para(run("Software Developer")), para(run("thandi.mokoena@example.test | 082 555 0101 | Cape Town")), para(run("Skills")), para(run("TypeScript, React, Node.js")), para(run("Experience")), para(run("Developer, Acme (2020 - Present)"))];

test("a normal Word file has nothing hidden", () => {
  expect(removeHiddenFromDocx(docx(CV)).hidden).toEqual([]);
});

test("hidden, white and one-point text in a Word file is left out and reported", async () => {
  const bytes = docx([...CV, para(run("VANISH-MARKER Kubernetes", "<w:vanish/>")), para(run("WHITE-MARKER Blockchain", `<w:color w:val="FFFFFF"/>`)), para(run("TINY-MARKER Rust", `<w:sz w:val="2"/>`))]);
  const r = await readDocument(bytes, "docx");
  for (const m of ["VANISH-MARKER", "WHITE-MARKER", "TINY-MARKER", "Kubernetes", "Blockchain"]) expect(r.text, m).not.toContain(m);
  expect(r.text).toContain("Developer, Acme");
  expect(r.issues.join(" ")).toMatch(/cannot be seen.*left out/);
});

test("white writing on a shaded panel is ordinary and stays", async () => {
  const bytes = docx([...CV, para(`<w:pPr><w:shd w:val="clear" w:color="auto" w:fill="1F2A44"/></w:pPr>` + run("Available immediately", `<w:color w:val="FFFFFF"/>`))]);
  const r = await readDocument(bytes, "docx");
  expect(r.text).toContain("Available immediately");
});

test("with the policy set to flag only, hidden Word text is kept but reported", async () => {
  const bytes = docx([...CV, para(run("WHITE-MARKER Blockchain", `<w:color w:val="FFFFFF"/>`))]);
  const r = await readDocument(bytes, "docx", { reading: { hiddenText: "flag_only", forbiddenCopy: "read_and_flag" } });
  expect(r.text).toContain("WHITE-MARKER");
  expect(r.issues.join(" ")).toMatch(/cannot be seen.*read/);
});

test("a Word file that unpacks to an absurd size is not expanded", () => {
  const bomb = zipSync({ "word/document.xml": new Uint8Array(100 * 1024 * 1024) });   // compresses to a few kilobytes
  expect(()=>removeHiddenFromDocx(bomb)).toThrow(/safety budget/);
});

test("zero-width and direction characters are removed, and ligature characters are written out", async () => {
  const dirty = "Skills: Type​Script, Re​act, Java​Script⁠, Node‌.js, ‮evil‬, ﬁnancial, oﬃce";
  const { text, removed } = cleanInvisible(dirty);
  expect(text).toBe("Skills: TypeScript, React, JavaScript, Node.js, evil, financial, office");
  expect(removed).toBe(7);
  const e: any = await extractCandidate(`Thandi Mokoena\nSoftware Developer\nthandi@example.test | 082 555 0101\nSkills\nType​Script, Re​act, Java​Script⁠, Node‌.js\nExperience\nDeveloper, Acme (2020 - Present)`, { asOf: new Date("2026-10-21") });
  expect(e.record.skills.slice(0, 4)).toEqual(["TypeScript", "React", "JavaScript", "Node.js"]);
});

// A scanned CV can arrive with its page printed twice, a running header and page numbers. None of it may be read twice or joined into one invented line.
test("a repeated page, a running header and page numbers do not damage the record", async () => {
  const page = ["Thandi Mokoena", "Senior Full-Stack Developer", "thandi.mokoena@example.test | 082 555 0101 | Cape Town, South Africa", "Summary", "Full-stack developer with eight years of experience building web applications in TypeScript and React.", "Experience", "Senior Developer, Cobalt Travel (Mar 2020 - Present)", "Led a team of four building a booking platform used by 200 hotels.", "Education", "BSc Computer Science, University of Cape Town, 2015", "Skills", "TypeScript, JavaScript, React, Node.js, PostgreSQL, Docker, Git, REST APIs, Jest, AWS"];
  const text = [...page, "Page 1 of 2", ...page, "Page 2 of 2"].join("\n");
  const e: any = await extractCandidate(text, { asOf: new Date("2026-10-21") });
  expect(e.record.skills.slice(0, 10)).toEqual(["TypeScript", "JavaScript", "React", "Node.js", "PostgreSQL", "Docker", "Git", "REST APIs", "Jest", "AWS"]);
  expect(e.meta.droppedUnsupported).toEqual([]);
  expect(e.record.workHistory.length).toBe(1);
});

// Review 16 Nov 2026 (B-H2): the size check trusted the sizes a zip declares. A Word file that says its parts are tiny, while they unpack to
// tens of megabytes, passed it, and the Word reader then unpacked the real data. The check now unpacks every entry, up to a budget, and an
// archive whose declared sizes are not its real ones is never opened.
test("a Word file that lies about its sizes is measured by what it really unpacks to", () => {
  const real = 30 * 1024 * 1024;
  const lying = zipSync({ "word/document.xml": new Uint8Array(real), "[Content_Types].xml": new TextEncoder().encode("<Types/>") }, { level: 9 });
  const view = new DataView(lying.buffer, lying.byteOffset, lying.byteLength);
  for (let i = 0; i + 4 <= lying.length; i++) {   // say "1,000 bytes" in the entry's local header and in the central directory
    const sig = view.getUint32(i, true);
    if (sig === 0x04034b50 && view.getUint32(i + 22, true) === real) view.setUint32(i + 22, 1000, true);
    if (sig === 0x02014b50 && view.getUint32(i + 24, true) === real) view.setUint32(i + 24, 1000, true);
  }
  const honest = zipSync({ "word/document.xml": new TextEncoder().encode("<w:document/>") });
  expect(expandedSize(honest, 1024 * 1024)).toMatchObject({ honest: true, entries: 1 });
  const measured = expandedSize(lying, 10 * 1024 * 1024)!;
  expect(measured.honest).toBe(false);
  expect(measured.bytes).toBeGreaterThan(10 * 1024 * 1024);   // what it really unpacks to, cut off at the budget, never the 1,000 it claims
});
