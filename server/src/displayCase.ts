// Details a CV writes in capitals ("SENIOR MANAGER: SUPPLY CHAIN", "STANDARD BANK") are shown in normal capitalisation (owner, 9 Nov 2026: "some panels
// have all caps"). On screen only: the record, the evidence and the original CV keep the CV's own wording, and a value with any small letter in it is the
// CV's own capitalisation and is shown as written. The AI gives each detail's normal written form when it reads the CV (owner: "the point of AI is
// flexibility"; record.displayNames, held to the same words by the server); the rules below are only for records it has not read since.

/** Kept in capitals: initialisms a CV writes in capitals on purpose. Anything of four letters or fewer with no vowel is kept too (MTN, KPMG, SQL). */
const INITIALISMS = new Set([
  "CEO", "CFO", "COO", "CTO", "CIO", "CMO", "CRO", "CHRO", "CISO", "CDO", "MD", "GM", "VP", "SVP", "EVP", "HOD",
  "IT", "ICT", "HR", "PR", "QA", "QC", "UX", "UI", "BI", "AI", "ML", "IOT", "API", "ERP", "CRM", "SAP", "AWS", "GCP", "SQL", "ETL", "SEO", "KPI", "OKR", "SLA",
  "PMO", "PMP", "ITIL", "TOGAF", "COBIT", "CISA", "CISSP", "CCNA", "MCSE", "CPA", "ACCA", "CIMA", "CFA", "SAIPA", "SAICA", "IRBA", "HPCSA",
  "MBA", "LLB", "LLM", "CA", "SA", "RSA", "USA", "UK", "EU", "UAE", "UN", "NGO", "SME", "FMCG", "B2B", "B2C",
  "KPMG", "PWC", "EY", "BDO", "IBM", "HP", "AVI", "MTN", "FNB", "SAB", "SABC", "SARS", "SAA", "NHS", "CSIR", "UCT", "UJ", "UP", "UKZN", "UWC", "TUT", "CPUT", "DUT", "NMU", "NWU", "NQF",
  "MANCOSA", "REGENESYS", "IMM", "IIE", "CIPS", "SAQA", "SETA", "BBBEE", "BEE",
]);
/** Three-letter words that are words, not initialisms: anything else of three letters stays in capitals (CCI, CTI, AVI). */
const WORDS3 = new Set(["ACE", "AGE", "AID", "AIR", "ALL", "AND", "ANY", "APP", "ARM", "ART", "BAR", "BAY", "BED", "BET", "BIG", "BOX", "BUS", "BUY", "CAB", "CAN", "CAP", "CAR", "CUP", "CUT", "DAY", "DOG", "DRY", "DUE", "EAR", "EAT", "ECO", "END", "ERA", "EYE", "FAN", "FAR", "FIT", "FLY", "FOR", "FOX", "FUN", "GAS", "GEO", "GYM", "HAT", "HIT", "HOT", "HUB", "ICE", "INK", "JET", "JOB", "JOY", "KEY", "KID", "LAB", "LAW", "LOW", "MAN", "MAP", "MAX", "MEN", "MIX", "NET", "NEW", "NOW", "OAK", "OIL", "OLD", "ONE", "ORB", "OUR", "OUT", "OWN", "PAN", "PAY", "PEN", "PET", "PRO", "PUB", "RAW", "RED", "RUN", "SEA", "SET", "SKY", "SUN", "TAX", "TEA", "TEN", "THE", "TOP", "TWO", "USE", "VAN", "WAY", "WEB", "WET", "WIN", "ZOO"]);
/** Their usual written form. */
const FORMS: Record<string, string> = {
  BCOM: "BCom", BSC: "BSc", BA: "BA", BED: "BEd", BENG: "BEng", BTECH: "BTech", BCOMPT: "BCompt", BACC: "BAcc", BPROC: "BProc", BAdmin: "BAdmin", BADMIN: "BAdmin",
  MCOM: "MCom", MSC: "MSc", MENG: "MEng", MTECH: "MTech", MPHIL: "MPhil", PHD: "PhD", DPHIL: "DPhil", HONS: "Hons", PGDIP: "PGDip",
  PTY: "Pty", LTD: "Ltd", INC: "Inc", LLC: "LLC", PLC: "PLC", NPC: "NPC", SOC: "SOC",
  ESKOM: "Eskom", ABSA: "Absa", NEDBANK: "Nedbank", UNISA: "Unisa", MCDONALDS: "McDonalds",
  // Products written with their own capitals.
  SHAREPOINT: "SharePoint", VMWARE: "VMware", VSPHERE: "vSphere", JAVASCRIPT: "JavaScript", TYPESCRIPT: "TypeScript", GITHUB: "GitHub", GITLAB: "GitLab",
  POWERSHELL: "PowerShell", MYSQL: "MySQL", POSTGRESQL: "PostgreSQL", MONGODB: "MongoDB", DEVOPS: "DevOps", LINKEDIN: "LinkedIn", YOUTUBE: "YouTube",
  IPHONE: "iPhone", IOS: "iOS", MACOS: "macOS", PYTHON: "Python", NET: "NET", JIRA: "Jira", SERVICENOW: "ServiceNow", SALESFORCE: "Salesforce", PAYPAL: "PayPal",
};
/** Written small inside a name or title: "Head of IT", "Bachelor of Commerce". */
const SMALL = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "of", "on", "or", "the", "to", "with", "per", "via"]);

/** True when the value has letters and every one of them is a capital: the only values this changes. */
export const allCaps = (s: string) => /[A-Z]/.test(s) && !/[a-z]/.test(s) && (s.match(/[A-Z]/g) ?? []).length >= 4;

/** A detail as shown: in normal capitalisation when the CV wrote it all in capitals; otherwise exactly as written. */
export function displayCase(value: string | null | undefined, names?: Record<string, string> | null): string {
  const s = String(value ?? "");
  if (!allCaps(s)) return s;
  if (names?.[s]) return names[s];   // the AI's normal written form of this detail
  let first = true;
  return s.replace(/[A-Z0-9][A-Z0-9']*/g, (word, at: number) => {
    const out = (() => {
      if (FORMS[word]) return FORMS[word];
      if (INITIALISMS.has(word)) return word;
      if (/\d/.test(word)) return word;   // N6, B2B, 4IR
      const lower = word.toLowerCase();
      // After an opening bracket, a colon or a dash a new phrase starts; otherwise a small word stays small.
      const before = s.slice(0, at).trimEnd().slice(-1);
      if (SMALL.has(lower)) return !first && !/[(:\-–—/]/.test(before) ? lower : word[0] + lower.slice(1);   // "On Site Supervisor", "Head of IT"
      if (word.length <= 4 && !/[AEIOUY]/.test(word)) return word;   // KPMG, MTN, SQL
      if (word.length <= 3 && !WORDS3.has(word)) return word;   // CCI, CTI: initialisms; "Old", "New", "Bet" are words
      return word[0] + word.slice(1).toLowerCase();
    })();
    first = false;
    return out;
  });
}

/** An employer as a recruiter writes it: without the legal ending (owner, 9 Nov 2026: "no need for Pty Ltd stuff"). "Discovery Health (Pty) Ltd" is shown as
 *  "Discovery Health"; the record keeps the full name. Only endings at the very end are taken off, one after another ("(RF) (Pty) Ltd"); "SA" is kept, as it
 *  is usually South Africa. A name that would be left empty is shown as written. */
const LEGAL_ENDING = /[\s,]*(?:\(\s*pty\s*\)\s*,?\s*(?:ltd|limited)|pty\.?\s*,?\s*(?:ltd|limited)|\(\s*proprietary\s*\)\s*limited|proprietary\s+limited|ltd|limited|inc|incorporated|llc|plc|cc|npc|soc|gmbh|\(\s*rf\s*\)|\(\s*pty\s*\))\.?\s*$/i;
export function employerName(value: string | null | undefined, names?: Record<string, string> | null): string {
  const shown = displayCase(value, names);
  let out = shown.trim(), before = "";
  while (out !== before) { before = out; out = out.replace(LEGAL_ENDING, "").trim(); }
  return out || shown;
}

/** A name, title or stated fact as shown, the same everywhere (owner, 11 Nov 2026: "how can we have lowercase there ... configurations again"): in
 *  capitals → normal capitalisation (displayCase); a title in all small letters ("department manager") → each word capitalised as a title is; any other
 *  value starting with a small letter ("one calendar month", "hybrid, 2 days in CPT") → its first letter capitalised. A value written with its own mixed capitals at the
 *  start (iOS, eThekwini, "R2.1 million") is shown exactly as written. */
export function shownCase(value: string | null | undefined, names?: Record<string, string> | null, title = false): string {
  const s = String(value ?? "");
  if (allCaps(s)) return displayCase(s, names);
  if (title && /\p{Ll}/u.test(s) && !/\p{Lu}/u.test(s) && (s.match(/\p{L}/gu) ?? []).length >= 3) return displayCase(s.toUpperCase(), names);
  return /^\p{Ll}(?!\p{Lu})/u.test(s) ? s[0].toUpperCase() + s.slice(1) : s;
}
