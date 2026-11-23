import { Document, Paragraph, Table, TableCell, TableRow, TextRun, WidthType, BorderStyle } from "docx";
import type { Persona } from "./personas";
import { fmt, range } from "./templates";

const P = (t: string, o: { bold?: boolean; size?: number } = {}) => new Paragraph({ children: [new TextRun({ text: t, bold: o.bold, size: o.size })] });
const B = (t: string) => new Paragraph({ text: t, bullet: { level: 0 } });
const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: none, bottom: none, left: none, right: none };
const cell = (children: Paragraph[], width: number) => new TableCell({ children, width: { size: width, type: WidthType.PERCENTAGE }, borders: noBorders });
const table = (rows: TableRow[]) => new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE }, borders: { ...noBorders, insideHorizontal: none, insideVertical: none } });
const doc = (children: (Paragraph | Table)[]) => new Document({ sections: [{ children }] });

export const DOCX_LAYOUTS: { id: string; build: (p: Persona) => Document }[] = [
  { id: "docx-classic", build: (p) => doc([
    P(p.name, { bold: true, size: 36 }), P(`${p.email} | ${p.phone} | ${p.location}`),
    P("PROFESSIONAL SUMMARY", { bold: true }), P(p.summary), P("SKILLS", { bold: true }), P(p.skills.join(", ")),
    P("PROFESSIONAL EXPERIENCE", { bold: true }),
    ...p.roles.flatMap((r) => [P(`${r.position}${r.company ? `, ${r.company}` : ""} (${range(r, "iso")})`, { bold: true }), ...r.bullets.map(B)]),
    P("EDUCATION", { bold: true }), ...p.education.map((e) => P(`${e.degree}, ${e.institution}, ${e.period}`)),
    P("LANGUAGES", { bold: true }), P(p.languages.join(", ")),
  ]) },
  { id: "docx-table", build: (p) => doc([
    P(p.name, { bold: true, size: 36 }), P(`${p.email} | ${p.phone} | ${p.location}`), P("Experience", { bold: true }),
    table(p.roles.map((r) => new TableRow({ children: [cell([P(fmt(r.start, "short") + " –"), P(r.end ? fmt(r.end, "short") : "Present")], 22), cell([P(r.position, { bold: true }), ...(r.company ? [P(r.company)] : []), ...r.bullets.map(B)], 78)] }))),
    P("Education", { bold: true }), table(p.education.map((e) => new TableRow({ children: [cell([P(String(e.year))], 22), cell([P(e.degree, { bold: true }), P(e.institution)], 78)] }))),
    P("Skills", { bold: true }), P(p.skills.join(" · ")),
  ]) },
  { id: "docx-sidebar", build: (p) => doc([table([new TableRow({ children: [
    cell([P(p.name, { bold: true, size: 32 }), P(p.headline), P("CONTACT", { bold: true }), P(p.email), P(p.phone), P(p.location), P("SKILLS", { bold: true }), ...p.skills.map((s) => P(s)), P("LANGUAGES", { bold: true }), ...p.languages.map((s) => P(s)), P("EDUCATION", { bold: true }), ...p.education.flatMap((e) => [P(e.degree, { bold: true }), P(e.institution), P(e.period)])], 32),
    cell([P("PROFILE", { bold: true }), P(p.summary), P("WORK EXPERIENCE", { bold: true }), ...p.roles.flatMap((r) => [P(`${r.position}${r.company ? `, ${r.company}` : ""}`, { bold: true }), P(range(r, "long")), ...r.bullets.map(B)])], 68),
  ] })])]) },
  { id: "docx-tracked", build: (p) => doc([
    P(p.name.toUpperCase().split("").join(" "), { bold: true, size: 32 }), P(`${p.email} | ${p.phone} | ${p.location}`),
    P("P R O F I L E", { bold: true }), P(p.summary), P("W O R K   E X P E R I E N C E", { bold: true }),
    ...p.roles.flatMap((r) => [P(`${r.position}${r.company ? ` | ${r.company}` : ""} | ${range(r, "short", " – ")}`, { bold: true }), ...r.bullets.map(B)]),
    P("E D U C A T I O N", { bold: true }), ...p.education.map((e) => P(`${e.degree}, ${e.institution}, ${e.period}`)), P("S K I L L S", { bold: true }), P(p.skills.join(", ")),
  ]) },
];
