// THE CAPABILITY GRAPH, first slice: knowledge areas (docs/architecture/CAPABILITY_GRAPH.md). Jobs say which areas they need and how deeply; qualifications
// and CV evidence say which areas a person has and how deeply. Each area has a stable ID, plain words for people, and a description the meaning reader
// compares sentences with. Versioned and fingerprinted like the rules; it grows by reviewed versions (ESCO, O*NET, ISCED-F and CESM are the planned sources).

export const GRAPH_VERSION = "0.1.0";

/** Depth of knowledge, the same scale on both sides. O*NET rates levels 0 to 7; four steps are what a CV can actually show. */
export type Depth = 0 | 1 | 2 | 3;
export const DEPTH_WORDS: Record<Depth, string> = { 0: "none shown", 1: "introductory", 2: "intermediate", 3: "advanced" };

export interface Area { id: string; name: string; description: string; aliases: string[] }

const A = (id: string, name: string, description: string, aliases: string[] = []): Area => ({ id: `area:${id}`, name, description, aliases });

export const AREAS: Area[] = [
  A("mathematics", "Mathematics", "Calculus, linear algebra and mathematical reasoning.", ["maths", "math", "applied mathematics", "pure mathematics"]),
  A("statistics", "Probability and statistics", "Probability, statistical inference, regression and statistical modelling.", ["statistics", "mathematical statistics", "probability", "econometrics", "biostatistics"]),
  A("financial-mathematics", "Financial mathematics", "Interest, annuities, valuation of cash flows and financial instruments.", ["financial mathematics", "investment mathematics"]),
  A("actuarial", "Actuarial science and risk", "Insurance and pension mathematics, risk modelling, pricing and reserving.", ["actuarial science", "actuarial", "risk management", "insurance mathematics"]),
  A("economics", "Economics", "Micro- and macroeconomics, markets and economic analysis.", ["economics", "economic science"]),
  A("accounting", "Accounting", "Financial accounting, reporting standards (IFRS) and bookkeeping.", ["accounting", "financial accounting", "accountancy", "bookkeeping"]),
  A("auditing", "Auditing", "External and internal audit, assurance and controls.", ["auditing", "audit", "internal audit"]),
  A("taxation", "Taxation", "Income tax, VAT and tax compliance.", ["taxation", "tax"]),
  A("finance", "Finance and investment", "Corporate finance, financial management, investments and banking.", ["finance", "financial management", "investment management", "corporate finance", "banking"]),
  A("law", "Law", "Legal principles, commercial and labour law, contracts and compliance.", ["law", "commercial law", "mercantile law", "labour law", "legal"]),
  A("management", "Business management", "Organisations, strategy, operations and general management.", ["business management", "management", "business administration", "strategy"]),
  A("marketing", "Marketing", "Marketing strategy, brands, digital marketing and consumer behaviour.", ["marketing", "digital marketing", "brand management"]),
  A("human-resources", "Human resources and industrial psychology", "People management, employment relations, recruitment and organisational psychology.", ["human resources", "human resource management", "industrial psychology", "organisational psychology", "labour relations", "hr"]),
  A("psychology", "Psychology", "Human behaviour, assessment and counselling.", ["psychology"]),
  A("computer-science", "Computer science", "Algorithms, data structures, programming and theory of computation.", ["computer science", "computing", "programming"]),
  A("software-engineering", "Software engineering", "Designing, building, testing and maintaining software systems.", ["software engineering", "software development"]),
  A("data-science", "Data science and analytics", "Data analysis, machine learning, data engineering and reporting.", ["data science", "data analytics", "analytics", "machine learning"]),
  A("information-systems", "Information systems", "Business information systems, databases and IT management.", ["information systems", "informatics", "information technology", "it", "information management"]),
  A("networks", "Networks and infrastructure", "Computer networks, servers, cloud and IT infrastructure.", ["networking", "networks", "infrastructure", "cloud computing", "cyber security", "cybersecurity"]),
  A("electrical-engineering", "Electrical and electronic engineering", "Power systems, circuits, electronics, control and electrical installation.", ["electrical engineering", "electronic engineering", "electrical", "electronics", "mechatronics"]),
  A("mechanical-engineering", "Mechanical engineering", "Mechanics, thermodynamics, machines and manufacturing.", ["mechanical engineering", "mechanical"]),
  A("civil-engineering", "Civil engineering", "Structures, construction, water and transport infrastructure.", ["civil engineering", "civil", "construction", "structural engineering"]),
  A("chemical-engineering", "Chemical engineering", "Chemical processes, plants and process engineering.", ["chemical engineering", "process engineering"]),
  A("industrial-engineering", "Industrial engineering and operations", "Operations research, process improvement and production systems.", ["industrial engineering", "operations research", "operations management"]),
  A("natural-sciences", "Natural sciences", "Physics, chemistry and biology.", ["physics", "chemistry", "biology", "life sciences", "physical sciences", "biochemistry", "microbiology"]),
  A("nursing", "Nursing", "Patient care, nursing practice and clinical procedures.", ["nursing", "nursing science"]),
  A("clinical-medicine", "Clinical medicine", "Diagnosis, treatment and medical practice.", ["medicine", "clinical medicine", "surgery"]),
  A("pharmacy", "Pharmacy and pharmacology", "Medicines, dispensing and pharmacology.", ["pharmacy", "pharmacology"]),
  A("education", "Education and teaching", "Teaching practice, curriculum and learning.", ["education", "teaching"]),
  A("communication", "Communication and media", "Writing, journalism, public relations and media.", ["communication", "communications", "journalism", "media studies", "public relations"]),
  A("languages", "Languages and linguistics", "Language study, translation and linguistics.", ["languages", "linguistics", "english", "afrikaans", "isizulu", "isixhosa"]),
  A("supply-chain", "Supply chain and logistics", "Procurement, logistics, transport and supply chain management.", ["supply chain management", "logistics", "procurement", "transport economics"]),
  A("project-management", "Project management", "Planning, scheduling and running projects.", ["project management"]),
  A("hospitality", "Hospitality and tourism", "Hotels, food service and tourism operations.", ["hospitality", "hospitality management", "tourism", "culinary arts"]),
  A("agriculture", "Agriculture", "Crop and animal production and agricultural economics.", ["agriculture", "agricultural science", "agricultural economics"]),
];

export const areaById = (id: string) => AREAS.find((a) => a.id === id);

/** The area a subject name refers to ("Economics" -> area:economics), by whole words, longest name first so "financial mathematics" is not "mathematics". */
export function areaOfSubject(subject: string): Area | undefined {
  const s = ` ${subject.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  let best: { a: Area; len: number } | undefined;
  for (const a of AREAS) for (const n of [a.name, ...a.aliases]) {
    const k = ` ${n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
    if (s.includes(k) && (!best || k.length > best.len)) best = { a, len: k.length };
  }
  return best?.a;
}
