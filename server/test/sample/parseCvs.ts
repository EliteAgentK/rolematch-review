// Parses the sample CVs with the built-in parser only (no server), to iterate quickly on the parser.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readText } from "../../src/parse";
import { parseCv } from "../../src/rules";
const ROOT = fileURLToPath(new URL("../../../sample-documents/cvs", import.meta.url));
const only = process.argv[2];
for (const f of readdirSync(ROOT).filter((x) => !only || x.includes(only))) {
  const text = await readText(new Uint8Array(readFileSync(join(ROOT, f))), f.endsWith(".pdf") ? "pdf" : "docx");
  const c = parseCv(text);
  console.log(`${f}\n  name=${c.fullName} | role=${c.currentRole} | email=${c.email} | phone=${c.phone} | loc=${c.location}\n  skills(${c.skills.length}): ${c.skills.map((s) => s.name).join(", ")}\n  jobs: ${c.workHistory.map((w) => `${w.position}@${w.company} ${w.startDate}-${w.endDate} [${w.responsibilities.length}]`).join("; ")}\n  edu: ${c.education.map((e) => e.qualification + "/" + e.institution + "/" + e.period).join("; ")}`);
}
