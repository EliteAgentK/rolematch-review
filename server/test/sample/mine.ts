// Parses the owner's own stored CV (from their dev database) with the current parser and prints a structure report. No file is written.
import { sql } from "../../src/db";
import { getObject } from "../../src/supabase";
import { readDocument } from "../../src/parse";
import { parseCv } from "../../src/rules";
import { stopOcr } from "../../src/ocr";
const id = process.argv[2] ?? "8f15bd54-6670-42ef-950b-c57349f9d3ae";
const [d] = await sql`select storage_path from documents where id = ${id}`;
const { text, issues } = await readDocument(await getObject(d.storage_path), "pdf");
const c = parseCv(text);
console.log("issues:", issues);
console.log("role:", c.currentRole, "| skills:", c.skills.length, "| summary:", JSON.stringify(c.summary.slice(0, 90)));
console.log("roles:", c.workHistory.map((w) => `${w.position} @ ${w.company} ${w.startDate}-${w.endDate} [${w.responsibilities.length}]`));
console.log("headings seen:", [...new Set(text.split("\n").filter((l) => /^[A-Z][A-Z &/,-]{5,50}$/.test(l.trim())))].join(" | "));
console.log("exp section sample:\n" + text.slice(text.indexOf("PROFESSIONAL EXPERIENCE"), text.indexOf("PROFESSIONAL EXPERIENCE") + 4200));
await stopOcr(); await sql.end();
