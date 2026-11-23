// Round 2: layouts written AFTER the parser was tuned on round 1, to measure how well it generalises.
import type { Persona, Role } from "./personas";
import { fmt, range, type Layout } from "./templates";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const page = (body: string, css = "") => `<html><head><meta charset="utf-8"><style>body{font-family:Helvetica,Arial,sans-serif;font-size:10.5pt;margin:36px;color:#222}h1{margin:0 0 4px}ul{margin:4px 0 10px 18px;padding:0}p{margin:3px 0}${css}</style></head><body>${body}</body></html>`;
const ul = (xs: string[]) => `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
const noDot = (s: string) => s.replace(/\.$/, "");

export const LAYOUTS_R2: Layout[] = [
  { id: "noperiod", note: "company above title above dates; bullets are short phrases with no full stops", build: (p) => page(`
    <h1>${esc(p.name)}</h1><p>${p.email} | ${p.phone} | ${esc(p.location)}</p><h2>Skills</h2><p>${p.skills.map(esc).join(", ")}</p>
    <h2>Work Experience</h2>${p.roles.map((r) => `${r.company ? `<p><b>${esc(r.company)}</b></p>` : ""}<p>${esc(r.position)}</p><p>${range(r, "long", " – ")}</p>${ul(r.bullets.map(noDot))}`).join("")}
    <h2>Education</h2>${p.education.map((e) => `<p>${esc(e.degree)}</p><p>${esc(e.institution)}</p><p>${e.period}</p>`).join("")}`) },

  { id: "progression", note: "company shown once with several titles beneath it", build: (p) => page(`
    <h1>${esc(p.name)}</h1><p>${p.email} | ${p.phone} | ${esc(p.location)}</p><h2>Experience</h2>
    ${p.roles.reduce<{ company: string; roles: Role[] }[]>((groups, r) => { const g = groups[groups.length - 1]; if (g && g.company === r.company && r.company) g.roles.push(r); else groups.push({ company: r.company, roles: [r] }); return groups; }, [])
      .map((g) => `${g.company ? `<p><b>${esc(g.company)}</b></p>` : ""}${g.roles.map((r) => `<p>${esc(r.position)} &nbsp; ${range(r, "short", " – ")}</p>${ul(r.bullets)}`).join("")}`).join("")}
    <h2>Education</h2>${p.education.map((e) => `<p>${esc(e.degree)}, ${esc(e.institution)}, ${e.year}</p>`).join("")}<h2>Skills</h2><p>${p.skills.map(esc).join(", ")}</p>`) },

  { id: "twocolrows", note: "two-column table where each row pairs a sidebar item with a main-column line (lines interleave)", build: (p) => {
    const left = [p.email, p.phone, p.location, "SKILLS", ...p.skills, "LANGUAGES", ...p.languages];
    const right = ["PROFILE", p.summary, "EXPERIENCE", ...p.roles.flatMap((r) => [`${r.position}${r.company ? `, ${r.company}` : ""}`, range(r, "short", " – "), ...r.bullets]), "EDUCATION", ...p.education.map((e) => `${e.degree}, ${e.institution}, ${e.year}`)];
    const rows = Math.max(left.length, right.length);
    return page(`<h1>${esc(p.name)}</h1><table cellpadding="3" style="width:100%"><tr><td style="width:35%"></td><td></td></tr>${Array.from({ length: rows }, (_, i) => `<tr><td style="vertical-align:top;width:35%">${esc(left[i] ?? "")}</td><td style="vertical-align:top">${esc(right[i] ?? "")}</td></tr>`).join("")}</table>`);
  } },

  { id: "allcaps", note: "the whole CV in capital letters", build: (p) => page(`
    <h1>${esc(p.name.toUpperCase())}</h1><p>${p.email.toUpperCase()} | ${p.phone} | ${esc(p.location.toUpperCase())}</p><h2>PROFILE</h2><p>${esc(p.summary.toUpperCase())}</p>
    <h2>SKILLS</h2><p>${p.skills.map((s) => esc(s.toUpperCase())).join(", ")}</p><h2>EXPERIENCE</h2>
    ${p.roles.map((r) => `<p><b>${esc(r.position.toUpperCase())}${r.company ? `, ${esc(r.company.toUpperCase())}` : ""}</b> | ${range(r, "short", " – ").toUpperCase()}</p>${ul(r.bullets.map((b) => b.toUpperCase()))}`).join("")}
    <h2>EDUCATION</h2>${p.education.map((e) => `<p>${esc(e.degree.toUpperCase())}, ${esc(e.institution.toUpperCase())}, ${e.period}</p>`).join("")}`) },

  { id: "noheadings", note: "no section headings at all: bold role lines, a Skills: label, plain paragraphs", build: (p) => page(`
    <h1>${esc(p.name)}</h1><p>${esc(p.headline)}</p><p>${p.email} | ${p.phone} | ${esc(p.location)}</p><p>${esc(p.summary)}</p><p>Skills: ${p.skills.map(esc).join(", ")}</p>
    ${p.roles.map((r) => `<p><b>${esc(r.position)}</b>${r.company ? ` at ${esc(r.company)}` : ""}, ${range(r, "short", " – ")}</p>${ul(r.bullets)}`).join("")}
    ${p.education.map((e) => `<p>${esc(e.degree)}, ${esc(e.institution)}, ${e.year}</p>`).join("")}`) },

  { id: "numbered", note: "numbered section headings (1. Personal Information, 2. Work Experience ...)", build: (p) => page(`
    <h1>${esc(p.name)}</h1><h2>1. Contact Details</h2><p>${p.email}</p><p>${p.phone}</p><p>${esc(p.location)}</p><h2>2. Profile</h2><p>${esc(p.summary)}</p>
    <h2>3. Work Experience</h2>${p.roles.map((r) => `<p><b>${esc(r.position)}</b>${r.company ? `, ${esc(r.company)}` : ""} (${range(r, "iso", " to ")})</p>${ul(r.bullets)}`).join("")}
    <h2>4. Education</h2>${p.education.map((e) => `<p>${esc(e.degree)}, ${esc(e.institution)}, ${e.year}</p>`).join("")}<h2>5. Skills</h2><p>${p.skills.map(esc).join(", ")}</p>`) },

  { id: "colonheads", note: "headings written with a colon (Experience:, Skills:) and role lines using 'Title - Company - dates'", build: (p) => page(`
    <h1>${esc(p.name)}</h1><p>Email: ${p.email}</p><p>Phone: ${p.phone}</p><p>Location: ${esc(p.location)}</p>
    <h3>Profile:</h3><p>${esc(p.summary)}</p><h3>Skills:</h3><p>${p.skills.map(esc).join(", ")}</p>
    <h3>Experience:</h3>${p.roles.map((r) => `<p>${esc(r.position)}${r.company ? ` - ${esc(r.company)}` : ""} - ${range(r, "short", " to ")}</p>${ul(r.bullets)}`).join("")}
    <h3>Education:</h3>${p.education.map((e) => `<p>${esc(e.degree)} - ${esc(e.institution)} - ${e.year}</p>`).join("")}`) },

  { id: "tabs", note: "columns aligned with spaces/tabs and no separator characters between title, company and dates", build: (p) => page(`
    <h1>${esc(p.name)}</h1><p>${p.email} &nbsp; ${p.phone} &nbsp; ${esc(p.location)}</p><h2>Experience</h2>
    ${p.roles.map((r) => `<table style="width:100%"><tr><td style="width:36%"><b>${esc(r.position)}</b></td><td style="width:34%">${esc(r.company)}</td><td>${range(r, "short", " – ")}</td></tr></table>${ul(r.bullets)}`).join("")}
    <h2>Education</h2>${p.education.map((e) => `<table style="width:100%"><tr><td style="width:36%"><b>${esc(e.degree)}</b></td><td style="width:34%">${esc(e.institution)}</td><td>${e.year}</td></tr></table>`).join("")}<h2>Skills</h2><p>${p.skills.map(esc).join(", ")}</p>`) },

  { id: "portuguese", note: "Portuguese headings and month names", build: (p) => {
    const PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    const d = (x: [number, number] | null) => (x ? `${PT[x[1] - 1]} ${x[0]}` : "Presente");
    return page(`<h1>${esc(p.name)}</h1><p>${p.email} | ${p.phone} | ${esc(p.location)}</p><h2>PERFIL</h2><p>${esc(p.summary)}</p><h2>COMPETÊNCIAS</h2><p>${p.skills.map(esc).join(", ")}</p>
    <h2>EXPERIÊNCIA PROFISSIONAL</h2>${p.roles.map((r) => `<p><b>${esc(r.position)}</b>${r.company ? `, ${esc(r.company)}` : ""} | ${d(r.start)} – ${d(r.end)}</p>${ul(r.bullets)}`).join("")}
    <h2>FORMAÇÃO ACADÉMICA</h2>${p.education.map((e) => `<p>${esc(e.degree)}, ${esc(e.institution)}, ${e.period}</p>`).join("")}<h2>IDIOMAS</h2><p>${p.languages.join(", ")}</p>`);
  } },

  { id: "longprose", note: "long sentences with numbers and date ranges inside the duties", build: (p) => page(`
    <h1>${esc(p.name)}</h1><p>${p.email} | ${p.phone} | ${esc(p.location)}</p><h2>Experience</h2>
    ${p.roles.map((r, i) => `<p><b>${esc(r.position)}</b>${r.company ? `, ${esc(r.company)}` : ""}, ${range(r, "short", " – ")}</p><ul><li>${esc(r.bullets[0])} Between 2018 and 2020 this grew from 12 to 40 users, and in 2021 - 2022 it doubled again.</li>${r.bullets.slice(1).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`).join("")}
    <h2>Education</h2>${p.education.map((e) => `<p>${esc(e.degree)}, ${esc(e.institution)}, ${e.period}</p>`).join("")}<h2>Skills</h2><p>${p.skills.map(esc).join(", ")}</p>`) },

  { id: "contactlast", note: "contact details and address only at the very bottom of the CV", build: (p) => page(`
    <h1>${esc(p.name)}</h1><h2>Profile</h2><p>${esc(p.summary)}</p><h2>Experience</h2>${p.roles.map((r) => `<p><b>${esc(r.position)}</b>${r.company ? `, ${esc(r.company)}` : ""} | ${range(r, "short", " – ")}</p>${ul(r.bullets)}`).join("")}
    <h2>Education</h2>${p.education.map((e) => `<p>${esc(e.degree)}, ${esc(e.institution)}, ${e.year}</p>`).join("")}<h2>Skills</h2><p>${p.skills.map(esc).join(", ")}</p>
    <h2>Contact</h2><p>Email: ${p.email}</p><p>Cell: ${p.phone}</p><p>Address: ${esc(p.location)}</p>`) },

  { id: "skillstable", note: "skills laid out in a three-column table, so a row reads as 'A B C' with no commas", build: (p) => page(`
    <h1>${esc(p.name)}</h1><p>${p.email} | ${p.phone} | ${esc(p.location)}</p><h2>Skills</h2>
    <table cellpadding="4">${Array.from({ length: Math.ceil(p.skills.length / 3) }, (_, i) => `<tr>${p.skills.slice(i * 3, i * 3 + 3).map((s) => `<td style="width:150px">${esc(s)}</td>`).join("")}</tr>`).join("")}</table>
    <h2>Experience</h2>${p.roles.map((r) => `<p><b>${esc(r.position)}</b>${r.company ? `, ${esc(r.company)}` : ""} | ${range(r, "short", " – ")}</p>${ul(r.bullets)}`).join("")}
    <h2>Education</h2>${p.education.map((e) => `<p>${esc(e.degree)}, ${esc(e.institution)}, ${e.year}</p>`).join("")}`) },
];
