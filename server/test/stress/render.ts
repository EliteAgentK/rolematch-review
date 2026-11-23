// How a CV LOOKS: a random style drawn from independent choices, applied to a persona. Each choice is a way real CVs differ from each other; a failure is
// then traced back to the choices that were common among the failures. HTML is rendered to PDF by headless Chrome, so the PDF has a real text layer
// with real fonts, ligatures, columns and page breaks.
import { formatDate, presentWord, rng, type Rng, type StressPersona } from "./generate";

export interface Style {
  seed: number;
  font: string; size: number; lineHeight: number; justify: boolean; margin: number;
  headingCase: "none" | "upper" | "smallcaps"; headingSpacing: number; headingKind: "plain" | "underline" | "colon" | "band" | "boxed" | "side";
  columns: "one" | "sidebarLeft" | "sidebarRight" | "two";
  order: string[]; bullet: string;
  dates: "mon-yyyy" | "month-yyyy" | "mm-yyyy" | "yyyy" | "yy-apos" | "iso" | "todate";
  roleStyle: "title-company-paren" | "pipes" | "company-title-right" | "stacked" | "title-at-company" | "datecol";
  contact: "line" | "stacked" | "labelled" | "icons" | "footer"; nameAlign: "left" | "center" | "banner";
  photo: boolean; skillsStyle: "comma" | "bullets" | "tags" | "table" | "levels" | "pipes";
  furniture: boolean; pageBreak: boolean; eduStyle: "line" | "pipes" | "stacked" | "inst-first";
  headings: Record<string, string>; bodyCaps: boolean; boldAll: boolean; personal: boolean;
  // colours: drawn from a separate generator so older seeds keep the layout they always had
  theme: "light" | "darkSide" | "darkPage" | "colorHeads" | "lowContrast" | "tinted";
}

const FONTS = ["Arial", "Georgia", "Times New Roman", "Courier New", "Verdana", "Trebuchet MS", "Palatino", "Tahoma", "Helvetica", "Garamond", "Century Gothic", "Optima", "Futura", "Gill Sans", "Baskerville"];
const HEADS: Record<string, string[]> = {
  summary: ["Profile", "Summary", "Professional Summary", "About Me", "Personal Statement", "Career Objective"],
  skills: ["Skills", "Key Skills", "Technical Skills", "Core Competencies", "Skills and Tools"],
  experience: ["Experience", "Work Experience", "Employment History", "Career History", "Professional Experience", "Where I Worked"],
  education: ["Education", "Qualifications", "Education and Training", "Academic Background", "Education & Qualifications"],
  certs: ["Certifications", "Courses", "Training", "Licences and Certifications"],
  languages: ["Languages", "Language Skills"],
};
export const SECTION_KEYS = ["summary", "skills", "experience", "education", "certs", "languages"] as const;

// Colour treatments. Backgrounds are printed exactly, as they are when a real CV is exported.
const THEMES: Record<Style["theme"], (st: Style) => string> = {
  light: () => "",
  darkSide: (st) => `html { -webkit-print-color-adjust: exact; print-color-adjust: exact } .cols .side { background:#1f2a44 !important; color:#f2f2f2 !important; padding:10px } .header.banner { background:#1f2a44 } ${st.columns === "one" || st.columns === "two" ? ".header { background:#1f2a44; color:#fff; padding:12px }" : ""}`,
  darkPage: () => `html, body { background:#14181f !important; color:#e6e6e6 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact } .h { color:#7fe0d0 !important } .photo { background:#555 }`,
  colorHeads: () => `html { -webkit-print-color-adjust: exact; print-color-adjust: exact } .h { color:#b03a2e !important; border-color:#b03a2e } .name { color:#1a5276 } .contact { color:#1a5276 }`,
  lowContrast: () => `html, body { background:#f3f3f3 !important; color:#8c8c8c !important; -webkit-print-color-adjust: exact; print-color-adjust: exact } .h { color:#6f6f6f !important }`,
  tinted: () => `html, body { background:#fff6e5 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact } .h { color:#7b4b12 !important }`,
};

export function makeStyle(seed: number): Style {
  const r = rng(seed * 104729 + 7), c = rng(seed * 7919 + 3);
  const rest = r.shuffle(["summary", "skills", "education", "certs", "languages"]);
  const exp = r.int(0, 3);
  const order = [...rest.slice(0, exp), "experience", ...rest.slice(exp)];
  const headings: Record<string, string> = {};
  for (const k of SECTION_KEYS) headings[k] = r.pick(HEADS[k]);
  return {
    seed, font: r.pick(FONTS), size: r.pick([8, 9, 10, 10, 11, 11, 12, 13, 14]), lineHeight: r.pick([1.0, 1.15, 1.3, 1.5, 1.8]), justify: r.chance(0.25), margin: r.pick([20, 30, 40, 50, 70]),
    headingCase: r.pick(["none", "none", "upper", "upper", "smallcaps"]), headingSpacing: r.pick([0, 0, 0, 0.08, 0.2]), headingKind: r.pick(["plain", "underline", "colon", "band", "boxed", "side"]),
    columns: r.pick(["one", "one", "one", "sidebarLeft", "sidebarRight", "two"]), order, bullet: r.pick(["•", "•", "▪", "➤", "✔", "–", "*", "○", "·", "none"]),
    dates: r.pick(["mon-yyyy", "mon-yyyy", "month-yyyy", "mm-yyyy", "yyyy", "yy-apos", "iso", "todate"]),
    roleStyle: r.pick(["title-company-paren", "pipes", "company-title-right", "stacked", "title-at-company", "datecol"]),
    contact: r.pick(["line", "line", "stacked", "labelled", "icons", "footer"]), nameAlign: r.pick(["left", "center", "banner"]),
    photo: r.chance(0.2), skillsStyle: r.pick(["comma", "comma", "bullets", "tags", "table", "levels", "pipes"]), furniture: r.chance(0.25), pageBreak: r.chance(0.2),
    eduStyle: r.pick(["line", "pipes", "stacked", "inst-first"]), headings, bodyCaps: r.chance(0.06), boldAll: r.chance(0.05), personal: r.chance(0.25),
    theme: c.pick(["light", "light", "light", "light", "darkSide", "darkPage", "colorHeads", "lowContrast", "tinted"] as const),
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

export function renderHtml(p: StressPersona, st: Style): string {
  const r: Rng = rng(st.seed * 31 + 5);
  const dStyle = st.dates;
  const present = presentWord(dStyle, r);
  const when = (role: StressPersona["roles"][number]) => {
    const a = formatDate(role.start[0], role.start[1], dStyle);
    if (dStyle === "yyyy") return role.end ? (role.start[0] === role.end[0] ? `${role.start[0]}` : `${role.start[0]} - ${role.end[0]}`) : `${role.start[0]} - ${present}`;
    const b = role.end ? formatDate(role.end[0], role.end[1], dStyle) : present;
    return `${a} ${r.pick(["-", "–", "—", "to"])} ${b}`.replace(/ to ([^ ]+ [^ ]+)$/, " to $1");
  };
  const bullet = (t: string) => (st.bullet === "none" ? `<p>${esc(t)}</p>` : `<li>${esc(t)}</li>`);
  const bulletList = (xs: string[]) => (!xs.length ? "" : st.bullet === "none" ? xs.map(bullet).join("") : `<ul>${xs.map(bullet).join("")}</ul>`);

  // ---- one section's heading
  const h = (key: string) => {
    const t = st.headings[key];
    return `<div class="h h-${st.headingKind}">${esc(t)}${st.headingKind === "colon" ? ":" : ""}</div>`;
  };

  // ---- sections
  const roleHtml = (ro: StressPersona["roles"][number]) => {
    const w = when(ro), t = esc(ro.position), c = esc(ro.company);
    const b = bulletList(ro.bullets);
    switch (st.roleStyle) {
      case "title-company-paren": return `<div class="role"><b>${t}</b>${c ? `, ${c}` : ""} (${w})</div>${b}`;
      case "pipes": return `<div class="role"><b>${t}</b>${c ? ` | ${c}` : ""} | ${w}</div>${b}`;
      case "company-title-right": return `<div class="role flex"><span>${c ? `<b>${c}</b> - ` : ""}${t}</span><span>${w}</span></div>${b}`;
      case "stacked": return `<div class="role"><b>${t}</b></div>${c ? `<div>${c}</div>` : ""}<div><i>${w}</i></div>${b}`;
      case "title-at-company": return `<div class="role"><b>${t}</b>${c ? ` at ${c}` : ""}, ${w}</div>${b}`;
      case "datecol": return `<table class="dc"><tr><td class="dd">${w}</td><td><b>${t}</b>${c ? `<br>${c}` : ""}${b}</td></tr></table>`;
    }
  };
  const eduHtml = () => p.education.map((e, i) => {
    const status = p.educationStatus[i], tail = status === "not_completed" ? " (did not complete)" : "";
    const per = e.period;
    switch (st.eduStyle) {
      case "line": return `<div>${esc(e.degree)}, ${esc(e.institution)}, ${esc(per)}${tail}</div>`;
      case "pipes": return `<div>${esc(e.degree)} | ${esc(e.institution)} | ${esc(per)}${tail}</div>`;
      case "stacked": return `<div><b>${esc(e.degree)}</b></div><div>${esc(e.institution)}</div><div>${esc(per)}${tail}</div>`;
      case "inst-first": return `<div>${esc(e.institution)} - ${esc(e.degree)} (${esc(per)})${tail}</div>`;
    }
  }).join("");
  const skills = () => {
    const xs = p.skills.map(esc);
    switch (st.skillsStyle) {
      case "comma": return `<div>${xs.join(", ")}</div>`;
      case "bullets": return `<ul>${xs.map((x) => `<li>${x}</li>`).join("")}</ul>`;
      case "tags": return `<div>${xs.map((x) => `<span class="tag">${x}</span>`).join(" ")}</div>`;
      case "table": return `<table class="sk">${xs.reduce<string[][]>((a, x, i) => { (i % 3 === 0 ? a.push([x]) : a[a.length - 1].push(x)); return a; }, []).map((row) => `<tr>${row.map((x) => `<td>${x}</td>`).join("")}</tr>`).join("")}</table>`;
      case "levels": return `<div>${xs.map((x) => `${x} (${r.pick(["Advanced", "Expert", "Intermediate"])})`).join("<br>")}</div>`;
      case "pipes": return `<div>${xs.join(" | ")}</div>`;
    }
  };
  const sec: Record<string, () => string> = {
    summary: () => `${h("summary")}<p>${esc(p.summary)}</p>`,
    skills: () => `${h("skills")}${skills()}`,
    experience: () => `${h("experience")}${p.roles.map(roleHtml).join("")}`,
    education: () => (p.education.length ? `${h("education")}${eduHtml()}` : ""),
    certs: () => (p.certs.length ? `${h("certs")}<ul>${p.certs.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""),
    languages: () => (p.languages.length ? `${h("languages")}<div>${p.languages.join(", ")}</div>` : ""),
  };

  // ---- the header block
  const icons = { email: "✉", phone: "☎", place: "⌂" };
  const contact = () => {
    switch (st.contact) {
      case "line": return `<div class="contact">${esc(p.email)} | ${esc(p.phone)} | ${esc(p.location)}</div>`;
      case "stacked": return `<div class="contact">${esc(p.email)}<br>${esc(p.phone)}<br>${esc(p.location)}</div>`;
      case "labelled": return `<div class="contact">Email: ${esc(p.email)}<br>Phone: ${esc(p.phone)}<br>Address: ${esc(p.city)}</div>`;
      case "icons": return `<div class="contact">${icons.email} ${esc(p.email)} &nbsp; ${icons.phone} ${esc(p.phone)} &nbsp; ${icons.place} ${esc(p.city)}</div>`;
      case "footer": return "";
    }
  };
  const nameBlock = `<div class="name">${esc(p.name)}</div><div class="headline">${esc(p.headline)}</div>`;
  const photo = st.photo ? `<div class="photo"></div>` : "";
  const personal = st.personal ? `<div class="contact">ID number: ${p.sensitive.idNumber} | Date of birth: ${p.sensitive.dob} | Gender: ${p.sensitive.gender} | Marital status: ${p.sensitive.marital} | Nationality: ${p.sensitive.nationality} | Driver's licence: ${p.sensitive.licence}</div>` : "";
  const header = `<div class="header ${st.nameAlign}">${photo}<div>${nameBlock}${contact()}${personal}</div></div>`;
  const footer = st.contact === "footer" ? `<div class="contact footer">${esc(p.email)} | ${esc(p.phone)} | ${esc(p.location)}</div>` : "";
  const furniture = "";   // running headers and footers are @page margin boxes (below), which is where real ones sit

  // ---- columns
  const parts = st.order.map((k) => ({ k, html: sec[k]() })).filter((x) => x.html);
  let body: string;
  if (st.columns === "one") body = parts.map((x, i) => (st.pageBreak && x.k === "experience" ? `<div style="break-before:page"></div>` : "") + x.html).join("");
  else {
    const sideKeys = st.columns === "two" ? [] : ["skills", "education", "certs", "languages"];
    const side = parts.filter((x) => sideKeys.includes(x.k)), main = parts.filter((x) => !sideKeys.includes(x.k));
    if (st.columns === "two") { const half = Math.ceil(parts.length / 2); body = `<div class="cols2"><div>${parts.slice(0, half).map((x) => x.html).join("")}</div><div>${parts.slice(half).map((x) => x.html).join("")}</div></div>`; }
    else body = `<div class="cols ${st.columns}"><div class="side">${side.map((x) => x.html).join("")}</div><div class="main">${main.map((x) => x.html).join("")}</div></div>`;
  }

  const headCss: Record<Style["headingKind"], string> = {
    plain: "font-weight:bold;margin:14px 0 4px", underline: "font-weight:bold;margin:14px 0 4px;border-bottom:1px solid #444", colon: "font-weight:bold;margin:12px 0 3px",
    band: "font-weight:bold;margin:14px 0 6px;background:#223;color:#fff;padding:3px 6px", boxed: "font-weight:bold;margin:14px 0 6px;border:1px solid #333;padding:2px 6px", side: "font-weight:bold;margin:14px 0 4px;color:#335",
  };
  const css = `
    @page { margin: ${st.margin}px; ${st.furniture ? `@top-right { content: "${p.name.replace(/"/g, "")} - Curriculum Vitae"; font-size: 8pt; color: #666 } @bottom-center { content: "Page " counter(page) " of " counter(pages); font-size: 8pt; color: #666 }` : ""} }
    body { font-family: '${st.font}', serif; font-size: ${st.size}pt; line-height: ${st.lineHeight}; margin: 0; ${st.justify ? "text-align:justify;" : ""} ${st.bodyCaps ? "text-transform:uppercase;" : ""} ${st.boldAll ? "font-weight:bold;" : ""} }
    .h { ${headCss[st.headingKind]}; ${st.headingCase === "upper" ? "text-transform:uppercase;" : st.headingCase === "smallcaps" ? "font-variant:small-caps;" : ""} letter-spacing:${st.headingSpacing}em }
    .name { font-size: 2.1em; font-weight:bold } .headline { font-size:1.05em; margin-bottom:4px } .contact { margin:4px 0 8px }
    .header { display:flex; gap:16px; align-items:center; margin-bottom:6px } .header.center { text-align:center; justify-content:center }
    .header.banner { background:#233; color:#fff; padding:14px } .photo { width:70px; height:80px; background:#bbb; border-radius:6px }
    ul { margin:3px 0 6px 20px; padding:0 ${st.bullet === "none" ? "" : ""}} li { margin:1px 0; ${["▪", "➤", "✔", "–", "*", "○", "·"].includes(st.bullet) ? `list-style:none; margin-left:-4px;` : ""} }
    ${["▪", "➤", "✔", "–", "*", "○", "·"].includes(st.bullet) ? `li::before { content:'${st.bullet} ' }` : ""}
    .role { margin-top:8px } .flex { display:flex; justify-content:space-between } .tag { border:1px solid #888; border-radius:10px; padding:0 7px; margin:1px; display:inline-block }
    table.dc { width:100%; border-collapse:collapse; margin-top:6px } .dd { width:130px; vertical-align:top; padding-right:10px } table.sk td { padding:1px 10px 1px 0 }
    .cols { display:flex; gap:22px } .cols.sidebarLeft .side { width:30%; order:0; background:#eef; padding:8px } .cols.sidebarLeft .main { width:70% }
    .cols.sidebarRight .side { width:30%; order:2; background:#efe; padding:8px } .cols.sidebarRight .main { width:70%; order:1 }
    .cols2 { display:flex; gap:22px } .cols2 > div { width:50% }
    .furn { position:fixed; left:0; right:0; font-size:8pt; color:#666; text-align:center } .furn.top { top:-${Math.max(10, st.margin - 6)}px } .furn.bottom { bottom:-${Math.max(10, st.margin - 6)}px }
    .footer { margin-top:16px; border-top:1px solid #999; padding-top:4px }
  `;
  const themeCss = THEMES[st.theme](st);
  return `<!doctype html><meta charset="utf-8"><style>${css}${themeCss}</style>${furniture}${header}${body}${footer}`;
}
