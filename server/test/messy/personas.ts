// Fictional people with an answer key. Nothing here is a real person; the ID numbers are not valid IDs.
export interface Role { position: string; company: string; start: [number, number]; end: [number, number] | null; bullets: string[] }
export interface Persona {
  id: string; name: string; email: string; phone: string; city: string; location: string; headline: string; summary: string;
  skills: string[]; roles: Role[]; education: { degree: string; institution: string; period: string; year: number }[];
  certs: string[]; languages: string[];
  sensitive: { idNumber: string; dob: string; gender: string; marital: string; nationality: string; licence: string };
}

export const PERSONAS: Persona[] = [
  { id: "lerato", name: "Lerato Mokoena", email: "lerato.mokoena@example.test", phone: "082 555 0101", city: "Johannesburg", location: "Johannesburg, South Africa", headline: "Full-Stack Developer",
    summary: "Full-stack developer with a focus on accessible web applications and reliable APIs.",
    skills: ["TypeScript", "React", "Node.js", "PostgreSQL", "Docker", "Git", "REST APIs", "Jest"],
    roles: [
      { position: "Senior Developer", company: "Brightpath Software", start: [2021, 3], end: null, bullets: ["Led a team of four building a React and TypeScript client portal.", "Designed REST APIs on Node.js with PostgreSQL.", "Introduced automated testing with Jest and code review."] },
      { position: "Developer", company: "Cobalt Digital", start: [2018, 1], end: [2021, 2], bullets: ["Built internal tools in JavaScript and Node.js.", "Deployed services with Docker."] },
      { position: "Freelance Web Developer", company: "", start: [2016, 6], end: [2017, 12], bullets: ["Built websites for small businesses using HTML, CSS and JavaScript."] },
    ],
    education: [{ degree: "BSc Computer Science", institution: "University of the Witwatersrand", period: "2013 - 2015", year: 2015 }],
    certs: ["AWS Certified Cloud Practitioner"], languages: ["English", "Sesotho", "isiZulu"],
    sensitive: { idNumber: "9004015800081", dob: "1 April 1990", gender: "Female", marital: "Single", nationality: "South African", licence: "Code 08" } },
  { id: "pieter", name: "Pieter van der Merwe", email: "pieter.vdm@example.test", phone: "083 555 0102", city: "Pretoria", location: "Pretoria, South Africa", headline: "Regional Sales Manager",
    summary: "Results-driven sales leader with eleven years in FMCG distribution and key-account management.",
    skills: ["Negotiation", "Account management", "Forecasting", "CRM", "Excel", "Team leadership"],
    roles: [
      { position: "Regional Sales Manager", company: "FreshLine Distributors", start: [2019, 8], end: null, bullets: ["Managed a team of nine representatives across Gauteng.", "Grew regional revenue by 18% through key-account programmes."] },
      { position: "Key Account Manager", company: "Savanna Foods", start: [2014, 2], end: [2019, 7], bullets: ["Handled national retail accounts and quarterly negotiations."] },
    ],
    education: [{ degree: "National Diploma in Marketing", institution: "Tshwane University of Technology", period: "2010 - 2013", year: 2013 }],
    certs: ["Sales Leadership Programme"], languages: ["Afrikaans", "English"],
    sensitive: { idNumber: "8506125045086", dob: "12 June 1985", gender: "Male", marital: "Married", nationality: "South African", licence: "Code 10" } },
  { id: "nomvula", name: "Nomvula Dlamini", email: "nomvula.dlamini@example.test", phone: "071 555 0103", city: "Durban", location: "Durban, South Africa", headline: "Registered Nurse",
    summary: "Registered nurse experienced in surgical and high-care wards with a commitment to patient safety.",
    skills: ["Patient care", "Wound management", "IV therapy", "Medication administration", "Infection control"],
    roles: [
      { position: "Professional Nurse", company: "Coastal Private Hospital", start: [2017, 1], end: null, bullets: ["Provided care in a 30-bed surgical ward.", "Mentored student nurses and enrolled nursing assistants."] },
      { position: "Staff Nurse", company: "Umhlanga Day Clinic", start: [2013, 3], end: [2016, 12], bullets: ["Assisted in theatre and post-operative recovery."] },
    ],
    education: [{ degree: "Bachelor of Nursing Science", institution: "University of KwaZulu-Natal", period: "2009 - 2012", year: 2012 }],
    certs: ["Basic Life Support", "Advanced Cardiac Life Support"], languages: ["isiZulu", "English"],
    sensitive: { idNumber: "8802140120082", dob: "14 February 1988", gender: "Female", marital: "Married", nationality: "South African", licence: "Code 08" } },
  { id: "zoe", name: "Zoë Fernandes", email: "zoe.fernandes@example.test", phone: "+27 76 555 0104", city: "Cape Town", location: "Cape Town, South Africa", headline: "Digital Marketing Specialist",
    summary: "Digital marketer who combines content strategy with analytics to grow engaged audiences.",
    skills: ["SEO", "Content strategy", "Google Analytics", "Email marketing", "Social media", "Copywriting"],
    roles: [
      { position: "Digital Marketing Specialist", company: "Lumen Agency", start: [2020, 5], end: null, bullets: ["Managed paid and organic campaigns for 12 clients.", "Improved average email open rates from 18% to 31%."] },
      { position: "Marketing Coordinator", company: "Fynbos Travel", start: [2016, 9], end: [2020, 4], bullets: ["Produced newsletters, blog posts and social content."] },
    ],
    education: [{ degree: "BCom Marketing Management", institution: "Stellenbosch University", period: "2012 - 2015", year: 2015 }],
    certs: ["Google Analytics Certification"], languages: ["English", "Portuguese", "Afrikaans"],
    sensitive: { idNumber: "9209120230084", dob: "12 September 1992", gender: "Female", marital: "Single", nationality: "South African", licence: "Code 08" } },
  { id: "joao", name: "João Pereira", email: "joao.pereira@example.test", phone: "084 555 0105", city: "Gqeberha", location: "Gqeberha, South Africa", headline: "Civil Engineer",
    summary: "Civil engineer with experience in roads, stormwater and site supervision.",
    skills: ["AutoCAD", "Civil 3D", "Project management", "Site supervision", "Stormwater design"],
    roles: [
      { position: "Civil Engineer", company: "Bayside Consulting Engineers", start: [2018, 4], end: null, bullets: ["Designed stormwater and roads for municipal projects.", "Supervised contractors on site."] },
      { position: "Graduate Engineer", company: "Eastern Cape Infrastructure", start: [2015, 2], end: [2018, 3], bullets: ["Prepared drawings in AutoCAD and quantities for tenders."] },
    ],
    education: [{ degree: "BEng Civil Engineering", institution: "Nelson Mandela University", period: "2011 - 2014", year: 2014 }],
    certs: ["Pr Eng candidate"], languages: ["English", "Portuguese"],
    sensitive: { idNumber: "9101285177089", dob: "28 January 1991", gender: "Male", marital: "Single", nationality: "South African", licence: "Code 10" } },
  { id: "thandeka", name: "Thandeka Nkosi", email: "thandeka.nkosi@example.test", phone: "072 555 0106", city: "Johannesburg", location: "Johannesburg, South Africa", headline: "Financial Accountant",
    summary: "Chartered accountant with expertise in month-end reporting, audit and IFRS.",
    skills: ["IFRS", "Financial reporting", "Pastel", "Excel", "Budgeting", "Audit"],
    roles: [
      { position: "Financial Accountant", company: "Meridian Holdings", start: [2019, 1], end: null, bullets: ["Prepared monthly management accounts and annual financial statements.", "Coordinated external audits."] },
      { position: "Audit Trainee", company: "Greyson & Partners", start: [2015, 1], end: [2018, 12], bullets: ["Completed articles in audit and assurance."] },
    ],
    education: [{ degree: "BCompt Accounting", institution: "University of South Africa", period: "2011 - 2014", year: 2014 }],
    certs: ["SAICA Associate General Accountant"], languages: ["English", "isiZulu"],
    sensitive: { idNumber: "9307120310085", dob: "12 July 1993", gender: "Female", marital: "Single", nationality: "South African", licence: "Code 08" } },
  { id: "ahmed", name: "Ahmed Patel", email: "ahmed.patel@example.test", phone: "060 555 0107", city: "Johannesburg", location: "Johannesburg, South Africa", headline: "Data Analyst",
    summary: "Data analyst who turns messy operational data into clear dashboards and decisions.",
    skills: ["SQL", "Python", "Power BI", "Excel", "Data cleaning", "Statistics"],
    roles: [
      { position: "Data Analyst", company: "Zenith Logistics", start: [2021, 9], end: null, bullets: ["Built Power BI dashboards used by operations managers.", "Automated weekly reporting with Python and SQL."] },
      { position: "Junior Analyst", company: "Zenith Logistics", start: [2019, 2], end: [2021, 8], bullets: ["Cleaned and validated delivery data in Excel and SQL."] },
    ],
    education: [{ degree: "BSc Statistics", institution: "University of Johannesburg", period: "2015 - 2018", year: 2018 }],
    certs: ["Microsoft Power BI Data Analyst"], languages: ["English", "Gujarati"],
    sensitive: { idNumber: "9605105020087", dob: "10 May 1996", gender: "Male", marital: "Single", nationality: "South African", licence: "Code 08" } },
  { id: "sarah", name: "Sarah Müller", email: "sarah.muller@example.test", phone: "073 555 0108", city: "Bloemfontein", location: "Bloemfontein, South Africa", headline: "Secondary School Teacher",
    summary: "Mathematics and science teacher dedicated to building confidence in learners.",
    skills: ["Lesson planning", "Classroom management", "Mathematics", "Curriculum design", "Assessment"],
    roles: [
      { position: "Mathematics Teacher", company: "Hoërskool Dr Havenga", start: [2016, 1], end: null, bullets: ["Taught Grades 10 to 12 mathematics.", "Coached the school maths olympiad team."] },
      { position: "Intern Teacher", company: "Westdene Secondary School", start: [2014, 7], end: [2015, 12], bullets: ["Supported senior teachers and marked assessments."] },
    ],
    education: [{ degree: "PGCE Senior Phase", institution: "University of the Free State", period: "2013 - 2014", year: 2014 }, { degree: "BSc Mathematics", institution: "University of the Free State", period: "2010 - 2012", year: 2012 }],
    certs: ["SACE Registration"], languages: ["Afrikaans", "English"],
    sensitive: { idNumber: "9007080140080", dob: "8 July 1990", gender: "Female", marital: "Married", nationality: "South African", licence: "Code 08" } },
];
