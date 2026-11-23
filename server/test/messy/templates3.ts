// Round 3: written after round 2 had been tuned on. Run BEFORE changing the parser to get an honest estimate.
import type { Persona } from "./personas";
import { fmt, range, type Layout } from "./templates";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const page = (body: string) => `<html><head><meta charset="utf-8"><style>body{font-family:Helvetica,Arial,sans-serif;font-size:10.5pt;margin:36px;color:#222}h1{margin:0 0 4px}ul{margin:4px 0 10px 18px;padding:0}p{margin:3px 0}</style></head><body>${body}</body></html>`;
const ul = (xs: string[]) => `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
const yy = ([y, m]: [number, number]) => `${String(m).padStart(2, "0")}/${String(y).slice(2)}`;
const REFS = `<h2>References</h2><p>Mr J. Referee, Head of Department</p><p>jordan.referee@othercompany.test</p><p>Cell: 083 999 0000</p><p>Ms K. Sponsor, Director</p><p>k.sponsor@anotherfirm.test | 082 888 1111</p>`;

export const LAYOUTS_R3: Layout[] = [
  { id: "datefirst", note: "dates lead each role line: 'Mar 2021 – Present | Title | Company'", build: (p) => page(`
    <h1>${esc(p.name)}</h1><p>${p.email} | ${p.phone} | ${esc(p.location)}</p><h2>Experience</h2>
    ${p.roles.map((r) => `<p><b>${range(r, "short", " – ")}</b> | ${esc(r.position)}${r.company ? ` | ${esc(r.company)}` : ""}</p>${ul(r.bullets)}`).join("")}
    <h2>Education</h2>${p.education.map((e) => `<p>${e.year} | ${esc(e.degree)} | ${esc(e.institution)}</p>`).join("")}<h2>Skills</h2><p>${p.skills.map(esc).join(", ")}</p>`) },

  { id: "companyfirst", note: "company first: 'Brightpath Software — Senior Developer (Mar 2021 – Present)'", build: (p) => page(`
    <h1>${esc(p.name)}</h1><p>${p.email} | ${p.phone} | ${esc(p.location)}</p><h2>Work History</h2>
    ${p.roles.map((r) => `<p><b>${r.company ? `${esc(r.company)} — ` : ""}${esc(r.position)}</b> (${range(r, "long", " – ")})</p>${ul(r.bullets)}`).join("")}
    <h2>Education</h2>${p.education.map((e) => `<p>${esc(e.institution)} — ${esc(e.degree)} (${e.period})</p>`).join("")}<h2>Skills</h2><p>${p.skills.map(esc).join(", ")}</p>`) },

  { id: "nodates", note: "experience listed with no dates at all (typical for students and juniors)", build: (p) => page(`
    <h1>${esc(p.name)}</h1><p>${p.email} | ${p.phone} | ${esc(p.location)}</p><h2>Experience</h2>
    ${p.roles.map((r) => `<p><b>${esc(r.position)}</b>${r.company ? `, ${esc(r.company)}` : ""}</p>${ul(r.bullets)}`).join("")}
    <h2>Education</h2>${p.education.map((e) => `<p>${esc(e.degree)}, ${esc(e.institution)}</p>`).join("")}<h2>Skills</h2><p>${p.skills.map(esc).join(", ")}</p>`) },

  { id: "skilllevels", note: "skills with proficiency levels: 'Python (Advanced)', 'SQL - Intermediate'", build: (p) => page(`
    <h1>${esc(p.name)}</h1><p>${p.email} | ${p.phone} | ${esc(p.location)}</p><h2>Skills</h2>
    <p>${p.skills.map((s, i) => `${esc(s)} (${["Advanced", "Intermediate", "Expert", "Beginner"][i % 4]})`).join(", ")}</p>
    <h2>Experience</h2>${p.roles.map((r) => `<p><b>${esc(r.position)}</b>${r.company ? `, ${esc(r.company)}` : ""} | ${range(r, "short", " – ")}</p>${ul(r.bullets)}`).join("")}
    <h2>Education</h2>${p.education.map((e) => `<p>${esc(e.degree)}, ${esc(e.institution)}, ${e.year}</p>`).join("")}`) },

  { id: "references", note: "referees with their own e-mail and phone numbers at the end", build: (p) => page(`
    <h1>${esc(p.name)}</h1><p>${p.email} | ${p.phone} | ${esc(p.location)}</p><h2>Experience</h2>${p.roles.map((r) => `<p><b>${esc(r.position)}</b>${r.company ? `, ${esc(r.company)}` : ""} | ${range(r, "short", " – ")}</p>${ul(r.bullets)}`).join("")}
    <h2>Education</h2>${p.education.map((e) => `<p>${esc(e.degree)}, ${esc(e.institution)}, ${e.year}</p>`).join("")}<h2>Skills</h2><p>${p.skills.map(esc).join(", ")}</p>${REFS}`) },

  { id: "contactrefs", note: "the referees come BEFORE the candidate's own contact block at the end", build: (p) => page(`
    <h1>${esc(p.name)}</h1><h2>Experience</h2>${p.roles.map((r) => `<p><b>${esc(r.position)}</b>${r.company ? `, ${esc(r.company)}` : ""} | ${range(r, "short", " – ")}</p>${ul(r.bullets)}`).join("")}
    <h2>Education</h2>${p.education.map((e) => `<p>${esc(e.degree)}, ${esc(e.institution)}, ${e.year}</p>`).join("")}<h2>Skills</h2><p>${p.skills.map(esc).join(", ")}</p>${REFS}
    <h2>Contact Details</h2><p>Email: ${p.email}</p><p>Cell: ${p.phone}</p><p>Address: ${esc(p.location)}</p>`) },

  { id: "educationrich", note: "education with NQF level, cum laude, majors and wrapped detail lines", build: (p) => page(`
    <h1>${esc(p.name)}</h1><p>${p.email} | ${p.phone} | ${esc(p.location)}</p><h2>Experience</h2>${p.roles.map((r) => `<p><b>${esc(r.position)}</b>${r.company ? `, ${esc(r.company)}` : ""} | ${range(r, "short", " – ")}</p>${ul(r.bullets)}`).join("")}
    <h2>Education</h2>${p.education.map((e) => `<p><b>${esc(e.degree)}</b> (NQF Level 7), cum laude</p><p>${esc(e.institution)} | ${e.period}</p><p>Major subjects: coursework, research project and practical modules</p>`).join("")}<h2>Skills</h2><p>${p.skills.map(esc).join(", ")}</p>`) },

  { id: "shortyears", note: "two-digit years: '03/21 – 02/23' and 'Mar 21 – Present'", build: (p) => page(`
    <h1>${esc(p.name)}</h1><p>${p.email} | ${p.phone} | ${esc(p.location)}</p><h2>Experience</h2>
    ${p.roles.map((r, i) => `<p><b>${esc(r.position)}</b>${r.company ? `, ${esc(r.company)}` : ""} | ${i % 2 ? `${yy(r.start)} – ${r.end ? yy(r.end) : "Present"}` : `${fmt(r.start, "short").replace(/\d{2}(\d{2})$/, "$1")} – ${r.end ? fmt(r.end, "short").replace(/\d{2}(\d{2})$/, "$1") : "Present"}`}</p>${ul(r.bullets)}`).join("")}
    <h2>Education</h2>${p.education.map((e) => `<p>${esc(e.degree)}, ${esc(e.institution)}, ${e.year}</p>`).join("")}<h2>Skills</h2><p>${p.skills.map(esc).join(", ")}</p>`) },
];
