// Within one profession, does the match put people in the right order, and say why truthfully? Written by hand as a hiring manager would judge them, independently of the rules, 2026-11-05. Each person differs from the others in a known way. Correct-profession ranking says nothing here: everyone is in the profession.
import { assess } from "../../src/match";
const AS_OF = new Date("2026-11-05T00:00:00Z");
const role = (position: string, company: string, startDate: string, endDate: string, responsibilities: string[]) => ({ position, company, startDate, endDate, responsibilities });
const person = (id: string, name: string, o: any) => ({ id, name, role: o.role ?? o.work?.[0]?.position ?? "", skills: o.skills ?? [], summary: o.summary ?? "", location: "Johannesburg", email: "", phone: "", experience: "", workHistory: o.work ?? [], education: o.education ?? [], certifications: o.certs ?? [], languages: [], projects: [], worthNoting: [], status: "new", version: 1 });
const job = (id: string, title: string, requirements: string[], preferred: string[] = []) => ({ id, title, company: "Northwind", location: "Johannesburg", skills: [], type: "Permanent", department: "", description: "", requirements, responsibilities: [], preferredRequirements: preferred, postedDate: "2026-10-01", status: "open", version: 1 });
const textOf = (c: any) => [c.name, c.summary, "Skills", c.skills.join(", "), "Experience", ...c.workHistory.flatMap((w: any) => [`${w.position} | ${w.company} | ${w.startDate} - ${w.endDate}`, ...w.responsibilities]), "Education", ...c.education.map((e: any) => `${e.degree}, ${e.institution}, ${e.year}`), "Certifications", ...c.certifications].join("\n");
const edu = (degree: string, institution = "University of Pretoria", year = "2012") => ({ degree, institution, year });

export const FAMILIES: { name: string; jobs: any[]; people: any[]; order: Record<string, string[][]>; byJob?: any }[] = [
  { name: "accounting",
    jobs: [job("A1", "Financial Accountant", ["BCom degree in Accounting", "5 years of experience in financial accounting", "Experience with IFRS reporting", "Experience with month-end close"], ["Experience with SAP"]),
           job("A2", "Payroll Accountant", ["BCom degree in Accounting", "3 years of experience in payroll", "Experience with payroll tax submissions", "Experience with VIP Payroll"]),
           job("A3", "Internal Auditor", ["Degree in Internal Auditing or Accounting", "3 years of experience in internal audit", "Experience with risk-based audit planning", "Experience with control testing"])],
    people: [
      person("strong", "Strong Fit", { skills: ["IFRS", "SAP", "Month-end close"], education: [edu("BCom Accounting")], work: [role("Financial Accountant", "Elmstead", "2017-01", "Present", ["Prepared IFRS financial statements every quarter for the group.", "Ran the month-end close for four entities using SAP."]), role("Assistant Accountant", "Oakridge", "2013-01", "2016-12", ["Reconciled the general ledger each month and prepared journals."])] }),
      person("partial", "Partial Fit", { skills: ["Month-end close", "Excel"], education: [edu("BCom Accounting")], work: [role("Assistant Accountant", "Oakridge", "2023-01", "Present", ["Helped run the month-end close and posted journals for the manager."])] }),
      person("payroll", "Payroll Specialist", { skills: ["VIP Payroll", "Payroll tax"], education: [edu("BCom Accounting")], work: [role("Payroll Accountant", "Sunvale", "2018-01", "Present", ["Ran the monthly payroll on VIP Payroll for 800 staff.", "Made payroll tax submissions to SARS each month."])] }),
      person("auditor", "Internal Audit Person", { skills: ["Risk-based audit", "Control testing"], education: [edu("BCom Internal Auditing")], work: [role("Internal Auditor", "Greenvale", "2016-01", "Present", ["Planned risk-based audit programmes for the group.", "Carried out control testing and reported findings to the committee."])] }),
      person("unsuitable", "Wrong Level", { skills: ["Filing"], education: [edu("National Senior Certificate", "Pretoria Boys High", "2020")], work: [role("Accounts Clerk", "Sunvale", "2022-01", "Present", ["Filed invoices and answered supplier calls."])] }),
      person("named", "Only Lists It", { skills: ["IFRS", "SAP", "Month-end close"], education: [edu("BCom Accounting")], work: [role("Accountant", "Elmstead", "2017-01", "Present", ["Worked in the finance department of a mid-sized firm."])] }),
    ],
    order: { A1: [["strong", "named"], ["strong", "partial"], ["named", "unsuitable"], ["partial", "unsuitable"], ["strong", "payroll"], ["strong", "auditor"]], A2: [["payroll", "strong"], ["payroll", "partial"], ["payroll", "unsuitable"]], A3: [["auditor", "strong"], ["auditor", "partial"], ["auditor", "unsuitable"]] } },
  { name: "software",
    jobs: [job("S1", "Senior Java Developer", ["5 years of experience in Java development", "Experience with Spring Boot", "Experience with PostgreSQL", "Degree in Computer Science"], ["Experience with Kubernetes"]),
           job("S2", "Frontend Developer", ["3 years of experience in frontend development", "Experience with React", "Experience with TypeScript"]),
           job("S3", "DevOps Engineer", ["3 years of experience in DevOps", "Experience with Kubernetes", "Experience with Terraform"])],
    people: [
      person("java", "Java Senior", { skills: ["Java", "Spring Boot", "PostgreSQL"], education: [edu("BSc Computer Science")], work: [role("Senior Java Developer", "Elmstead", "2017-01", "Present", ["Built payment services in Java with Spring Boot.", "Designed PostgreSQL schemas and tuned slow queries."]), role("Java Developer", "Oakridge", "2014-01", "2016-12", ["Maintained Java services for the billing team."])] }),
      person("javaJunior", "Java Junior", { skills: ["Java", "Spring Boot"], education: [edu("BSc Computer Science")], work: [role("Junior Java Developer", "Oakridge", "2024-01", "Present", ["Fixed bugs in Java services under supervision."])] }),
      person("react", "React Person", { skills: ["React", "TypeScript"], education: [edu("BSc Information Technology")], work: [role("Frontend Developer", "Sunvale", "2019-01", "Present", ["Built customer screens in React and TypeScript."])] }),
      person("devops", "Platform Person", { skills: ["Kubernetes", "Terraform"], education: [edu("BSc Computer Science")], work: [role("DevOps Engineer", "Greenvale", "2018-01", "Present", ["Ran Kubernetes clusters for six product teams.", "Wrote Terraform modules for all cloud accounts."])] }),
      person("dotnet", "Transferable Dotnet", { skills: ["C#", "SQL Server", ".NET"], education: [edu("BSc Computer Science")], work: [role("Senior C# Developer", "Elmstead", "2015-01", "Present", ["Built services in C# and .NET and tuned SQL Server queries."])] }),
      person("support", "IT Support", { skills: ["Windows", "Ticketing"], education: [edu("National Diploma in Information Technology")], work: [role("IT Support Technician", "Oakridge", "2018-01", "Present", ["Answered support tickets and set up laptops."])] }),
    ],
    order: { S1: [["java", "javaJunior"], ["java", "dotnet"], ["java", "react"], ["javaJunior", "support"], ["dotnet", "support"]], S2: [["react", "java"], ["react", "support"], ["react", "devops"]], S3: [["devops", "java"], ["devops", "react"], ["devops", "support"]] } },
  { name: "nursing",
    jobs: [job("N1", "ICU Nurse", ["Registered Nurse with SANC registration", "Postgraduate Diploma in Critical Care Nursing", "3 years of experience in intensive care", "Experience with ventilator management"]),
           job("N2", "Theatre Nurse", ["Registered Nurse with SANC registration", "2 years of experience in theatre nursing", "Experience with scrubbing and circulating"]),
           job("N3", "Clinic Nurse", ["Registered Nurse with SANC registration", "Experience with primary health care", "Experience with immunisation"])],
    people: [
      person("icu", "ICU Experienced", { skills: ["Ventilator management", "Critical care"], certs: ["SANC registration"], education: [edu("Postgraduate Diploma in Critical Care Nursing"), edu("Bachelor of Nursing Science")], work: [role("ICU Registered Nurse", "Netcare", "2016-01", "Present", ["Cared for ventilated patients in a 20-bed intensive care unit.", "Managed ventilator settings with the intensivist on ward rounds."])] }),
      person("theatre", "Theatre Experienced", { skills: ["Scrubbing", "Circulating"], certs: ["SANC registration"], education: [edu("Bachelor of Nursing Science")], work: [role("Theatre Nurse", "Mediclinic", "2018-01", "Present", ["Scrubbed and circulated in general and orthopaedic theatre lists."])] }),
      person("clinic", "Clinic Experienced", { skills: ["Primary health care", "Immunisation"], certs: ["SANC registration"], education: [edu("Diploma in General Nursing")], work: [role("Clinic Sister", "City Health", "2017-01", "Present", ["Ran primary health care consultations in a community clinic.", "Gave childhood immunisation every week."])] }),
      person("enrolled", "Enrolled Nurse", { skills: ["Patient care"], education: [edu("Higher Certificate in Auxiliary Nursing")], work: [role("Enrolled Nursing Auxiliary", "Netcare", "2021-01", "Present", ["Helped patients wash and eat and took their temperatures."])] }),
    ],
    order: { N1: [["icu", "theatre"], ["icu", "clinic"], ["theatre", "enrolled"]], N2: [["theatre", "icu"], ["theatre", "clinic"], ["icu", "enrolled"]], N3: [["clinic", "icu"], ["clinic", "enrolled"]] } },
];
const run = (c: any, j: any) => assess(c as any, j as any, textOf(c), AS_OF) as any;
if (process.argv[1]?.endsWith("withinProfession.ts")) {
  let right = 0, total = 0, truthful = 0, truthTotal = 0; const wrong: string[] = [];
  for (const f of FAMILIES) {
    console.log(`\n${f.name}`);
    for (const j of f.jobs) { const scored = f.people.map((p) => ({ id: p.id, m: run(p, j) })).sort((a, b) => b.m.score - a.m.score); console.log(` ${j.title.padEnd(24)} ${scored.map((s) => `${s.id} ${s.m.score}`).join("  ")}`);
      for (const [a, b] of f.order[j.id]) { total++; const sa = scored.find((x) => x.id === a)!.m.score, sb = scored.find((x) => x.id === b)!.m.score; if (sa > sb) right++; else wrong.push(`${f.name} ${j.title}: ${a} ${sa} should beat ${b} ${sb}`); }
      for (const s of scored) for (const e of s.m.evidence) { truthTotal++; const src = String(e.source ?? ""), text = textOf(f.people.find((p) => p.id === s.id)); const ok = !src || /^Implied by/.test(src) || src.split(/;\s*/).every((q: string) => q.split(/,\s*/).every((part) => text.toLowerCase().includes(part.trim().toLowerCase()))); if (ok) truthful++; else wrong.push(`source not in CV: ${s.id} ${e.label}: ${src.slice(0, 60)}`); }
    }
    // the other direction: for a person, the job that suits them
    const best: Record<string, string> = { accounting: "payroll:A2,auditor:A3,strong:A1", software: "java:S1,react:S2,devops:S3", nursing: "icu:N1,theatre:N2,clinic:N3" };
    for (const pair of best[f.name].split(",")) { const [id, jobId] = pair.split(":"), p = f.people.find((x) => x.id === id)!, ranked = f.jobs.map((j) => ({ j, s: run(p, j).score })).sort((a, b) => b.s - a.s); total++; if (ranked[0].j.id === jobId) right++; else wrong.push(`${f.name} ${id}: best job should be ${jobId}, got ${ranked.map((r) => `${r.j.id} ${r.s}`).join(" ")}`); }
  }
  // Years credited from a role that does not do this work are a wrong reason, even when the order comes out right.
  for (const [fam, jobId, who, req] of [["nursing", "N1", "clinic", "intensive care"], ["nursing", "N1", "theatre", "intensive care"], ["software", "S2", "java", "frontend"], ["software", "S2", "dotnet", "frontend"], ["accounting", "A2", "strong", "payroll"], ["accounting", "A3", "payroll", "internal audit"]] as const) { const f = FAMILIES.find((x) => x.name === fam)!, m = run(f.people.find((p) => p.id === who), f.jobs.find((j) => j.id === jobId)), e = m.evidence.find((x: any) => x.label.toLowerCase().includes(req) && /year/i.test(x.label)); total++; if (e && e.credit.exp === 0) right++; else wrong.push(`${who} earns years toward "${e?.label}" from ${String(e?.source).slice(0, 50)}, credit ${e?.credit?.exp}`); }
  console.log(`\nordering judgements right ${right} of ${total} (${((100 * right) / total).toFixed(1)}%); sources in the CV ${truthful} of ${truthTotal}`);
  for (const w of wrong) console.log("  WRONG", w);
}
