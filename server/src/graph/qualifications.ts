// THE CAPABILITY GRAPH, qualifications: what each kind of qualification is (NQF level, normal length) and what common named qualifications teach (a
// knowledge profile: area -> depth). This is what lets an actuarial degree and a general BCom carry different weight for an actuarial job.
//
// STATUS OF THE PROFILES: drafts written by the assistant on 2026-10-23 from general knowledge of South African programmes, to be reviewed by a person
// against SAQA's register and the institutions' curricula before any is relied on (`reviewed: false` on every entry). A profile describes what the
// programme typically teaches; a candidate's own majors and modules, when the CV states them, override it. Depth comes from content only, never from
// which institution awarded it.
import type { Depth } from "./knowledge";

/** NQF level and normal full-time length in years, by the level words classifyQualification() gives. */
export const LEVELS: Record<string, { nqf: number; years: number }> = {
  "High school": { nqf: 4, years: 0 },
  "Higher certificate": { nqf: 5, years: 1 },
  "Diploma": { nqf: 6, years: 3 },
  "National diploma": { nqf: 6, years: 3 },
  "TVET qualification": { nqf: 4, years: 1 },
  "Advanced diploma": { nqf: 7, years: 1 },
  "Bachelor's degree": { nqf: 7, years: 3 },
  "Degree": { nqf: 7, years: 3 },
  "Postgraduate diploma": { nqf: 8, years: 1 },
  "Honours degree": { nqf: 8, years: 1 },
  "Master's degree": { nqf: 9, years: 1 },
  "Doctorate": { nqf: 10, years: 3 },
};
/** Professional degrees that take longer than three years (a four-year BEng in four years is on time, not slow). */
const LONGER: [RegExp, number, number][] = [
  [/\b(b\.?eng|b\.?sc\.?\s*\(?eng|bsc engineering|bachelor of engineering|b\.?ing)\b/i, 4, 8],
  [/\bllb\b|bachelor of laws/i, 4, 8],
  [/\bmbch?b\b|bachelor of medicine/i, 6, 8],
  [/\bb\.?pharm\b|bachelor of pharmacy/i, 4, 8],
  [/\bb\.?(?:cur|nursing)\b|bachelor of nursing/i, 4, 8],
  [/\bb\.?ed\b|bachelor of education/i, 4, 7],
  [/\bb\.?arch\b|bachelor of architecture/i, 4, 8],
];
export function levelOf(degree: string, level: string): { nqf: number; years: number } {
  for (const [re, years, nqf] of LONGER) if (re.test(degree)) return { nqf, years };
  return LEVELS[level] ?? { nqf: 0, years: 0 };
}

export interface NamedQualification { id: string; name: string; match: RegExp; profile: Record<string, Depth>; reviewed: boolean }
const Q = (id: string, name: string, match: RegExp, profile: Record<string, Depth>): NamedQualification =>
  ({ id: `qual:${id}`, name, match, profile: Object.fromEntries(Object.entries(profile).map(([k, v]) => [`area:${k}`, v])) as Record<string, Depth>, reviewed: false });

/** Most specific first: the first match wins. */
export const NAMED: NamedQualification[] = [
  Q("actuarial-science", "Actuarial Science", /actuarial/i, { actuarial: 3, statistics: 3, "financial-mathematics": 3, mathematics: 3, economics: 2, finance: 2, accounting: 1 }),
  Q("data-science", "Data Science", /data science/i, { "data-science": 3, statistics: 3, "computer-science": 2, mathematics: 2 }),
  Q("statistics", "Statistics / Mathematical Statistics", /\b(mathematical statistics|statistics|econometrics)\b/i, { statistics: 3, mathematics: 3, "data-science": 2, "computer-science": 1 }),
  Q("mathematics", "Mathematics / Applied Mathematics", /\b(applied )?mathematics\b|\bmaths\b/i, { mathematics: 3, statistics: 2, "computer-science": 1 }),
  Q("computer-science", "Computer Science", /computer science|\bcomp\.?\s*sci/i, { "computer-science": 3, "software-engineering": 2, mathematics: 2, statistics: 1, "data-science": 1 }),
  Q("software-engineering", "Software Engineering", /software (engineering|development)/i, { "software-engineering": 3, "computer-science": 2, "project-management": 1 }),
  Q("information-systems", "Information Systems / Informatics", /information systems|informatics/i, { "information-systems": 3, "computer-science": 2, management: 2, "data-science": 1, accounting: 1 }),
  Q("information-technology", "Information Technology", /information technology|\bb\.?sc\.?\s*it\b|\bnd\s*it\b/i, { "information-systems": 2, "computer-science": 2, "software-engineering": 2, networks: 2 }),
  Q("computer-engineering", "Computer Engineering", /computer engineering/i, { "electrical-engineering": 3, "computer-science": 3, "software-engineering": 2, mathematics: 3, networks: 2 }),
  Q("electrical-engineering", "Electrical / Electronic Engineering", /electrical|electronic|mechatronic/i, { "electrical-engineering": 3, mathematics: 3, "natural-sciences": 2, "computer-science": 1, "project-management": 1 }),
  Q("mechanical-engineering", "Mechanical Engineering", /mechanical/i, { "mechanical-engineering": 3, mathematics: 3, "natural-sciences": 2 }),
  Q("civil-engineering", "Civil Engineering", /\bcivil\b/i, { "civil-engineering": 3, mathematics: 3, "natural-sciences": 2, "project-management": 1 }),
  Q("chemical-engineering", "Chemical Engineering", /chemical engineering/i, { "chemical-engineering": 3, mathematics: 3, "natural-sciences": 3 }),
  Q("industrial-engineering", "Industrial Engineering", /industrial engineering/i, { "industrial-engineering": 3, mathematics: 3, statistics: 2, "project-management": 2, "supply-chain": 2, management: 2 }),
  Q("chartered-accounting", "Accounting (BAcc, BCompt, BCom Accounting)", /\b(bacc|b\.acc|bcompt|b\.compt|accounting|accountancy|chartered accountan)/i, { accounting: 3, auditing: 2, taxation: 2, finance: 2, law: 1, economics: 1, statistics: 1, management: 1 }),
  Q("finance", "Finance / Financial Management / Investment", /\bfinanc|investment/i, { finance: 3, accounting: 2, economics: 2, statistics: 2, "financial-mathematics": 2 }),
  Q("economics", "Economics", /economics|economic science/i, { economics: 3, statistics: 2, mathematics: 2, finance: 1 }),
  Q("industrial-psychology", "Industrial Psychology / Human Resources", /industrial psych|human resource|\bhrm\b|labour relations|organisational psych/i, { "human-resources": 3, psychology: 2, management: 2, law: 1, statistics: 1 }),
  Q("psychology", "Psychology", /psycholog/i, { psychology: 3, statistics: 1, communication: 1 }),
  Q("marketing", "Marketing", /marketing/i, { marketing: 3, management: 2, communication: 2, economics: 1, statistics: 1 }),
  Q("supply-chain", "Supply Chain / Logistics", /supply chain|logistics|procurement/i, { "supply-chain": 3, management: 2, economics: 1 }),
  Q("law", "Law (LLB)", /\bllb\b|\blaws?\b/i, { law: 3, communication: 2 }),
  Q("nursing", "Nursing", /nursing|\bb\.?cur\b|nurse/i, { nursing: 3, "clinical-medicine": 2, "natural-sciences": 1 }),
  Q("medicine", "Medicine (MBChB)", /\bmbch?b\b|medicine/i, { "clinical-medicine": 3, "natural-sciences": 3, pharmacy: 1 }),
  Q("pharmacy", "Pharmacy", /pharm/i, { pharmacy: 3, "natural-sciences": 3, "clinical-medicine": 2 }),
  Q("education", "Education (BEd, PGCE)", /\bb\.?ed\b|education|\bpgce\b|teaching/i, { education: 3 }),
  Q("communication", "Communication / Journalism / Media", /communication|journalism|media/i, { communication: 3, marketing: 1 }),
  Q("hospitality", "Hospitality / Tourism", /hospitality|tourism|culinary/i, { hospitality: 3, management: 1 }),
  Q("agriculture", "Agriculture", /agricultur/i, { agriculture: 3, "natural-sciences": 2 }),
  Q("natural-sciences", "Natural sciences (Physics, Chemistry, Biology)", /physics|chemistry|biology|life sciences|biochem|microbio/i, { "natural-sciences": 3, mathematics: 2 }),
  Q("commerce-general", "Commerce (general BCom)", /\b(bcom|b\.com|bachelor of commerce)\b/i, { economics: 2, management: 2, accounting: 1, statistics: 1, marketing: 1, law: 1, finance: 1 }),
  Q("business-administration", "Business Administration / Management", /business (administration|management)|\bmba\b|\bbba\b|management/i, { management: 3, finance: 1, marketing: 1, "human-resources": 1 }),
  Q("arts-general", "Arts / Humanities (general BA)", /\b(ba|b\.a|bachelor of arts|humanities|social science)\b/i, { communication: 2, languages: 1 }),
];

/** The named qualification a degree's own words describe, or undefined. A diploma is one step shallower than a degree in the same field (depth capped at 2). */
export function namedQualification(degree: string, level: string): { q: NamedQualification; profile: Record<string, Depth> } | undefined {
  const q = NAMED.find((n) => n.match.test(degree));
  if (!q) return undefined;
  const nqf = LEVELS[level]?.nqf ?? 7;
  const profile = Object.fromEntries(Object.entries(q.profile).map(([k, v]) => [k, (nqf <= 6 ? Math.min(v, 2) : v) as Depth])) as Record<string, Depth>;
  return { q, profile };
}
