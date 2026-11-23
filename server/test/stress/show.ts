// npm run stress:show -- <seed> : the style, the text the reader gets, and what it extracts, for one generated CV
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { extractCandidate } from "../../src/extract";
import { readDocument } from "../../src/parse";
import { makePersona } from "./generate";
import { makeStyle } from "./render";
const seed = Number(process.argv[2]);
const OUT = fileURLToPath(new URL("../../data/stress/", import.meta.url));
const p = makePersona(seed), st = makeStyle(seed);
const { headings, order, ...rest } = st;
console.log("STYLE", JSON.stringify(rest), "order:", order.join(","), "\nHEADINGS", JSON.stringify(headings));
console.log("ANSWER", JSON.stringify({ name: p.name, headline: p.headline, city: p.city, skills: p.skills, edu: p.education.map((e, i) => [e.degree, e.institution, e.period, p.educationStatus[i]]), certs: p.certs, roles: p.roles.map((r) => [r.position, r.company, r.start.join("/"), r.end?.join("/") ?? "present", r.bullets.length]) }));
const text = (await readDocument(new Uint8Array(readFileSync(join(OUT, "pdf", `${seed}.pdf`))), "pdf")).text;
console.log("---- TEXT\n" + text.slice(0, Number(process.argv[3] ?? 1800)));
const r: any = (await extractCandidate(text, { asOf: new Date("2026-10-21") })).record;
console.log("---- EXTRACTED", JSON.stringify({ role: r.role, loc: r.location, skills: r.skills, edu: r.education.map((e: any) => [e.degree, e.institution, e.year, e.type, e.status]), roles: r.workHistory.map((w: any) => [w.position, w.company, w.startDate, w.endDate, w.responsibilities.length]) }));
process.exit(0);
