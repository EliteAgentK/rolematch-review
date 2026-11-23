// Makes a very long, fictional CV (a 30-year career in 60 roles) to prove nothing is refused for being long.
// Run: npm run build:long   (needs Google Chrome; the result is committed so tests do not need it)
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnProc } from "../helpers";

const OUT = fileURLToPath(new URL("../../../sample-documents/cvs", import.meta.url));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const firms = ["Karoo Mining", "Cape Harbour Logistics", "Highveld Steel", "Limpopo Agri", "Durban Freight", "Tshwane Municipality", "Gauteng Rail", "Boland Wines", "Free State Grain", "Namaqua Energy"];
const titles = ["Project Engineer", "Senior Project Engineer", "Operations Manager", "Contracts Manager", "Plant Manager", "Regional Manager"];
const roles: string[] = [];
for (let i = 0; i < 60; i++) {
  const start = 1995 + Math.floor(i / 2), half = i % 2;
  const sm = half ? "Jul" : "Jan", em = half ? "Dec" : "Jun";
  roles.push(`<h3>${titles[i % titles.length]} | ${firms[i % firms.length]} (${sm} ${start} - ${em} ${start + (i === 59 ? 0 : 0)})</h3><ul>${Array.from({ length: 7 }, (_, k) => `<li>Delivered project ${i + 1}.${k + 1}: coordinated contractors, kept the programme and budget under review, reported weekly to the executive committee and resolved site safety findings within agreed deadlines.</li>`).join("")}</ul>`);
}
const html = `<html><style>body{font-family:Helvetica,Arial,sans-serif;font-size:11pt;margin:36px;color:#222}h1{margin:0}h2{border-bottom:1px solid #999}h3{margin:14px 0 2px}ul{margin:2px 0 2px 18px}</style><body>
<h1>Pieter Lekota</h1><p>Operations Executive</p><p>pieter.lekota@example.test | 082 555 0111 | Pretoria, South Africa</p>
<h2>Professional Summary</h2><p>Operations executive with three decades of experience delivering large infrastructure and logistics programmes across mining, rail, energy and agriculture.</p>
<h2>Experience</h2>${roles.join("")}
<h2>Education</h2><p>BEng Civil Engineering, University of Pretoria, 1994</p>
<h2>Skills</h2><p>Project management, Contract management, Budget control, Stakeholder reporting, Health and safety, Procurement</p></body></html>`;
const dir = join(tmpdir(), "th-long"); mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "long.html"), html);
await spawnProc([CHROME, "--headless=new", "--disable-gpu", `--user-data-dir=${join(dir, "profile")}`, "--no-pdf-header-footer", `--print-to-pdf=${join(OUT, "cv12-pieter-long-career.pdf")}`, `file://${join(dir, "long.html")}`], { stdout: "ignore", stderr: "ignore" }).exited;
console.log("built cv12-pieter-long-career.pdf");
