import type { Persona, Role } from "./personas";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const AF = ["Januarie", "Februarie", "Maart", "April", "Mei", "Junie", "Julie", "Augustus", "September", "Oktober", "November", "Desember"];
const p2 = (n: number) => String(n).padStart(2, "0");

export type DateStyle = "iso" | "long" | "short" | "slash" | "dot" | "apos" | "year" | "af";
export function fmt([y, m]: [number, number], style: DateStyle): string {
  switch (style) {
    case "iso": return `${y}-${p2(m)}`;
    case "long": return `${LONG[m - 1]} ${y}`;
    case "short": return `${MON[m - 1]} ${y}`;
    case "slash": return `${p2(m)}/${y}`;
    case "dot": return `${p2(m)}.${y}`;
    case "apos": return `${MON[m - 1]}'${String(y).slice(2)}`;
    case "year": return String(y);
    case "af": return `${AF[m - 1]} ${y}`;
  }
}
const PRESENT = ["Present", "Current", "To date", "Now", "Till date"];
export const range = (r: Role, style: DateStyle, sep = " - ", present = "Present") => `${fmt(r.start, style)}${sep}${r.end ? fmt(r.end, style) : present}`;

const page = (body: string, css = "") => `<html><head><meta charset="utf-8"><style>body{font-family:Helvetica,Arial,sans-serif;font-size:10.5pt;margin:36px;color:#222}h1{margin:0 0 4px}ul{margin:4px 0 10px 18px;padding:0}p{margin:3px 0}${css}</style></head><body>${body}</body></html>`;
const ul = (xs: string[], mark = "") => `<ul${mark ? ` style="list-style:none;margin-left:0"` : ""}>${xs.map((x) => `<li>${mark}${esc(x)}</li>`).join("")}</ul>`;
const roleHead = (r: Role) => (r.company ? `<b>${esc(r.position)}</b>, ${esc(r.company)}` : `<b>${esc(r.position)}</b>`);

export interface Layout { id: string; build: (p: Persona) => string; note: string }

export const LAYOUTS: Layout[] = [
  { id: "classic", note: "single column, uppercase headings, bullets", build: (p) => page(`
    <h1>${esc(p.name)}</h1><p>${esc(p.headline)}</p><p>${p.email} | ${p.phone} | ${esc(p.location)}</p>
    <h2>PROFILE</h2><p>${esc(p.summary)}</p>
    <h2>SKILLS</h2><p>${p.skills.map(esc).join(", ")}</p>
    <h2>EXPERIENCE</h2>${p.roles.map((r) => `<p>${roleHead(r)} | ${range(r, "short", " – ")}</p>${ul(r.bullets)}`).join("")}
    <h2>EDUCATION</h2>${p.education.map((e) => `<p><b>${esc(e.degree)}</b>, ${esc(e.institution)}, ${e.period}</p>`).join("")}
    <h2>CERTIFICATIONS</h2>${ul(p.certs)}<h2>LANGUAGES</h2><p>${p.languages.join(", ")}</p>`) },

  { id: "sidebar", note: "coloured sidebar with contact/skills/education, main column with experience", build: (p) => page(`
    <div style="display:flex"><div style="width:32%;background:#2c3e50;color:#fff;padding:22px">
      <h1 style="font-size:17pt">${esc(p.name)}</h1><p>${esc(p.headline)}</p><h3>CONTACT</h3><p>${p.email}</p><p>${p.phone}</p><p>${esc(p.location)}</p>
      <h3>SKILLS</h3>${p.skills.map((s) => `<p>${esc(s)}</p>`).join("")}<h3>LANGUAGES</h3>${p.languages.map((s) => `<p>${s}</p>`).join("")}
      <h3>EDUCATION</h3>${p.education.map((e) => `<p><b>${esc(e.degree)}</b></p><p>${esc(e.institution)}</p><p>${e.period}</p>`).join("")}</div>
      <div style="width:68%;padding:22px"><h2>PROFILE</h2><p>${esc(p.summary)}</p><h2>WORK EXPERIENCE</h2>
      ${p.roles.map((r) => `<p>${roleHead(r)}</p><p><i>${range(r, "long")}</i></p>${ul(r.bullets)}`).join("")}<h2>CERTIFICATIONS</h2>${ul(p.certs)}</div></div>`, "body{margin:0}") },

  { id: "datecol", note: "experience in a table: narrow date column that wraps, details beside it", build: (p) => page(`
    <h1>${esc(p.name)}</h1><p>${p.email} · ${p.phone} · ${esc(p.location)}</p><h2>Profile</h2><p>${esc(p.summary)}</p>
    <h2>Experience</h2><table cellpadding="6">${p.roles.map((r) => `<tr><td style="width:90px;vertical-align:top">${fmt(r.start, "short")} –<br>${r.end ? fmt(r.end, "short") : "Present"}</td><td>${roleHead(r)}${ul(r.bullets)}</td></tr>`).join("")}</table>
    <h2>Education</h2><table cellpadding="6">${p.education.map((e) => `<tr><td style="width:90px">${e.year}</td><td><b>${esc(e.degree)}</b><br>${esc(e.institution)}</td></tr>`).join("")}</table>
    <h2>Skills</h2><p>${p.skills.map(esc).join(" · ")}</p><h2>Languages</h2><p>${p.languages.join(", ")}</p>`) },

  { id: "bars", note: "skills shown as bars and star ratings, languages as dots", build: (p) => page(`
    <h1>${esc(p.name)}</h1><p>${esc(p.headline)} | ${p.email} | ${p.phone} | ${esc(p.location)}</p>
    <h2>Skills</h2>${p.skills.map((s, i) => `<p>${esc(s)} &nbsp; ${"█".repeat(8 - (i % 4))}${"░".repeat(2 + (i % 4))} &nbsp; ${"★".repeat(5 - (i % 3))}${"☆".repeat(i % 3)}</p>`).join("")}
    <h2>Languages</h2>${p.languages.map((l, i) => `<p>${l} ${"●".repeat(5 - i)}${"○".repeat(i)}</p>`).join("")}
    <h2>Experience</h2>${p.roles.map((r) => `<p>${roleHead(r)}</p><p>${range(r, "short")}</p>${ul(r.bullets)}`).join("")}
    <h2>Education</h2>${p.education.map((e) => `<p>${esc(e.degree)} – ${esc(e.institution)} (${e.year})</p>`).join("")}`) },

  { id: "spaced", note: "designer headings with wide letter-spacing and a tracked-out name", build: (p) => page(`
    <h1 style="letter-spacing:0.4em;text-transform:uppercase;font-size:20pt">${esc(p.name)}</h1><p style="letter-spacing:0.2em">${esc(p.headline.toUpperCase())}</p><p>${p.email} | ${p.phone} | ${esc(p.location)}</p>
    <h2 style="letter-spacing:0.35em;text-transform:uppercase">Profile</h2><p>${esc(p.summary)}</p>
    <h2 style="letter-spacing:0.35em;text-transform:uppercase">Work Experience</h2>${p.roles.map((r) => `<p>${roleHead(r)}</p><p>${range(r, "short", " – ")}</p>${ul(r.bullets)}`).join("")}
    <h2 style="letter-spacing:0.35em;text-transform:uppercase">Education</h2>${p.education.map((e) => `<p>${esc(e.degree)}, ${esc(e.institution)}, ${e.period}</p>`).join("")}
    <h2 style="letter-spacing:0.35em;text-transform:uppercase">Skills</h2><p>${p.skills.map(esc).join(", ")}</p>`) },

  { id: "multipage", note: "running header and footer repeated on every page, sections forced across pages", build: (p) => page(`
    <div style="position:fixed;top:8px;left:36px;right:36px;font-size:8pt;color:#777;border-bottom:1px solid #ccc">${esc(p.name)} – Curriculum Vitae – ${p.email}</div>
    <div style="position:fixed;bottom:8px;left:36px;right:36px;font-size:8pt;color:#777;border-top:1px solid #ccc">Confidential – Page footer – ${esc(p.name)}</div>
    <div style="margin-top:30px"><h1>${esc(p.name)}</h1><p>${p.email} | ${p.phone} | ${esc(p.location)}</p><h2>Summary</h2><p>${esc(p.summary)}</p><h2>Skills</h2><p>${p.skills.map(esc).join(", ")}</p></div>
    <div style="page-break-before:always;margin-top:30px"><h2>Experience</h2>${p.roles.map((r, i) => `<div ${i ? 'style="page-break-before:always;margin-top:30px"' : ""}><p>${roleHead(r)} (${range(r, "iso")})</p>${ul(r.bullets)}</div>`).join("")}</div>
    <div style="page-break-before:always;margin-top:30px"><h2>Education</h2>${p.education.map((e) => `<p>${esc(e.degree)} – ${esc(e.institution)} – ${e.period}</p>`).join("")}<h2>Languages</h2><p>${p.languages.join(", ")}</p></div>`) },

  { id: "narrative", note: "prose paragraphs, no bullets, dates inside sentences", build: (p) => page(`
    <h1>${esc(p.name)}</h1><p>Contact: ${p.email}, ${p.phone}, ${esc(p.location)}</p><h2>About me</h2><p>${esc(p.summary)}</p>
    <h2>Employment history</h2>${p.roles.map((r) => `<p>From ${fmt(r.start, "long")} ${r.end ? `until ${fmt(r.end, "long")}` : "until the present"} I worked as ${esc(r.position)}${r.company ? ` at ${esc(r.company)}` : ""}. ${r.bullets.map(esc).join(" ")}</p>`).join("")}
    <h2>Qualifications</h2>${p.education.map((e) => `<p>I obtained a ${esc(e.degree)} from ${esc(e.institution)} in ${e.year}.</p>`).join("")}
    <h2>Skills</h2><p>I am proficient in ${p.skills.slice(0, -1).map(esc).join(", ")} and ${esc(p.skills[p.skills.length - 1])}.</p>`) },

  { id: "keyvalue", note: "each role as Position:/Company:/Period:/Duties: lines", build: (p) => page(`
    <h1>${esc(p.name)}</h1><p>E-mail: ${p.email}</p><p>Cell: ${p.phone}</p><p>Location: ${esc(p.location)}</p>
    <h2>Employment History</h2>${p.roles.map((r) => `<p>Position: ${esc(r.position)}</p>${r.company ? `<p>Company: ${esc(r.company)}</p>` : ""}<p>Period: ${range(r, "slash", " to ")}</p><p>Duties: ${r.bullets.map(esc).join(" ")}</p><br>`).join("")}
    <h2>Education</h2>${p.education.map((e) => `<p>Qualification: ${esc(e.degree)}</p><p>Institution: ${esc(e.institution)}</p><p>Year: ${e.year}</p>`).join("")}<h2>Skills</h2><p>${p.skills.map(esc).join(", ")}</p>`) },

  { id: "personal", note: "personal details block (ID number, birth date, marital status), references, declaration", build: (p) => page(`
    <h1>CURRICULUM VITAE</h1><h2>${esc(p.name)}</h2>
    <h3>PERSONAL DETAILS</h3><p>ID Number: ${p.sensitive.idNumber}</p><p>Date of Birth: ${p.sensitive.dob}</p><p>Gender: ${p.sensitive.gender}</p><p>Marital Status: ${p.sensitive.marital}</p><p>Nationality: ${p.sensitive.nationality}</p><p>Driver's Licence: ${p.sensitive.licence}</p>
    <p>Cell: ${p.phone}</p><p>Email: ${p.email}</p><p>Address: ${esc(p.location)}</p>
    <h3>CAREER OBJECTIVE</h3><p>${esc(p.summary)}</p><h3>WORK EXPERIENCE</h3>${p.roles.map((r) => `<p>${roleHead(r)}</p><p>${range(r, "long")}</p>${ul(r.bullets)}`).join("")}
    <h3>EDUCATION</h3>${p.education.map((e) => `<p>${esc(e.degree)} – ${esc(e.institution)} – ${e.year}</p>`).join("")}<h3>SKILLS</h3>${ul(p.skills)}
    <h3>REFERENCES</h3><p>References available upon request.</p><h3>DECLARATION</h3><p>I declare that the information above is true and correct.</p>`) },

  { id: "afrikaans", note: "Afrikaans headings and month names", build: (p) => page(`
    <h1>${esc(p.name)}</h1><p>${p.email} | ${p.phone} | ${esc(p.location)}</p>
    <h2>PROFIEL</h2><p>${esc(p.summary)}</p><h2>VAARDIGHEDE</h2><p>${p.skills.map(esc).join(", ")}</p>
    <h2>WERKSERVARING</h2>${p.roles.map((r) => `<p>${roleHead(r)} | ${range(r, "af", " – ", "Hede")}</p>${ul(r.bullets)}`).join("")}
    <h2>OPLEIDING</h2>${p.education.map((e) => `<p><b>${esc(e.degree)}</b>, ${esc(e.institution)}, ${e.period}</p>`).join("")}<h2>TALE</h2><p>${p.languages.join(", ")}</p><h2>VERWYSINGS</h2><p>Beskikbaar op aanvraag.</p>`) },

  { id: "inline", note: "dense run-in paragraphs: skills sentence, experience as one line per role", build: (p) => page(`
    <h1>${esc(p.name)}</h1><p>${esc(p.headline)} – ${p.email} – ${p.phone} – ${esc(p.location)}</p>
    <p><b>Key skills:</b> ${p.skills.map(esc).join(", ")}. <b>Languages:</b> ${p.languages.join(", ")}.</p>
    <h2>Experience</h2>${p.roles.map((r) => `<p><b>${esc(r.position)}</b>${r.company ? ` (${esc(r.company)})` : ""} ${range(r, "short", " - ")}: ${r.bullets.map(esc).join(" ")}</p>`).join("")}
    <h2>Education</h2>${p.education.map((e) => `<p>${esc(e.degree)} (${esc(e.institution)}, ${e.year})</p>`).join("")}`) },

  { id: "datesmix", note: "many date styles: Mar'19, 03.2019, till date, bare years", build: (p) => page(`
    <h1>${esc(p.name)}</h1><p>${p.email} | ${p.phone} | ${esc(p.location)}</p><h2>Experience</h2>
    ${p.roles.map((r, i) => { const st = (["apos", "dot", "year", "slash"] as DateStyle[])[i % 4]; const pr = PRESENT[(i + 2) % 5]; return `<p>${roleHead(r)} (${range(r, st, " – ", pr)})</p>${ul(r.bullets)}`; }).join("")}
    <h2>Education</h2>${p.education.map((e) => `<p>${esc(e.degree)}, ${esc(e.institution)} (${e.year})</p>`).join("")}<h2>Skills</h2><p>${p.skills.map(esc).join(" | ")}</p>`) },

  { id: "icons", note: "icon characters before contact lines and emoji in headings", build: (p) => page(`
    <h1>${esc(p.name)}</h1><p>${esc(p.headline)}</p><p>✉ ${p.email}</p><p>☎ ${p.phone}</p><p>⌂ ${esc(p.location)}</p>
    <h2>👤 Profile</h2><p>${esc(p.summary)}</p><h2>💼 Experience</h2>${p.roles.map((r) => `<p>► ${roleHead(r)} — ${range(r, "short")}</p>${ul(r.bullets, "► ")}`).join("")}
    <h2>🎓 Education</h2>${p.education.map((e) => `<p>${esc(e.degree)} – ${esc(e.institution)} – ${e.year}</p>`).join("")}<h2>🛠 Skills</h2><p>${p.skills.map(esc).join(" • ")}</p>`) },

  { id: "sidehead", note: "section titles in a left margin column with content to the right", build: (p) => page(`
    <h1>${esc(p.name)}</h1><p>${p.email} | ${p.phone} | ${esc(p.location)}</p>
    <table cellpadding="8"><tr><td style="width:110px;vertical-align:top"><b>PROFILE</b></td><td>${esc(p.summary)}</td></tr>
    <tr><td style="vertical-align:top"><b>EXPERIENCE</b></td><td>${p.roles.map((r) => `<p>${roleHead(r)}<br>${range(r, "short", " – ")}</p>${ul(r.bullets)}`).join("")}</td></tr>
    <tr><td style="vertical-align:top"><b>EDUCATION</b></td><td>${p.education.map((e) => `<p>${esc(e.degree)}, ${esc(e.institution)}, ${e.period}</p>`).join("")}</td></tr>
    <tr><td style="vertical-align:top"><b>SKILLS</b></td><td>${p.skills.map(esc).join(", ")}</td></tr></table>`) },
];
