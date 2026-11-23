// How the reader recognises identity on forms and agency layouts: what would otherwise be word lists buried in the parser. Platform configuration: the same for every organisation, frozen,
// and changed only by a reviewed change that bumps `version`. Every evaluation run records the version and fingerprint, so a result can be traced to exactly these words.
// Started with E4 and E5 (register R44); older word lists in rules.ts move here as they are worked on, not in one risky sweep.
import { createHash } from "node:crypto";

const deepFreeze = <T>(o: T): T => { if (o && typeof o === "object") { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };

export interface ExtractionConfig {
  legalParagraph: { agencyVoice: string[]; speaksOfDocument: string[]; speaksOfCandidate: string[]; terms: string[] };
  /** What the words of a job description's own headings say the section holds. A heading matching none ends the section before it and holds nothing scored. `itemWords`: a short line with one of these is asking for something, so it is an item in a list and never a heading. */
  /** What the label of a row in a CV's table says the row holds. "drop": details the platform has no use for and should not hold. */
  labelledFacts: Record<"name" | "phone" | "email" | "languages" | "employer" | "position" | "period" | "place" | "leaving" | "drop", string[]>;
  version: string;
  /** Text marked as hidden is looked for on the rendered page, since only that settles what a person sees. Costs an OCR pass per page, so it is bounded. */
  hiddenTextCheck: { maxPages: number; minAgreement: number; tinyPoints: number; /** Pieces the whole-page reading did not confirm get a closer look, up to this many in a document. */ closerLooks: number };
  identity: {
    /** A line containing one of these is a form label or heading, never a person. A real surname among them would be refused, not misread, so the list stays short. */
    formWords: string[];
    /** Words before "name" that mean the candidate's own name: "Candidate Name: ...". Anything else ("Company Name") is not. */
    givenNameQualifiers: string[];
    surnameLabels: string[];
    /** The lower-case words a person's name may contain. Any other lower-case word makes a line a sentence, not a name. */
    nameParticles: string[];
    /** Headings that may carry the person's name after a dash, used only as a last resort. */
    summaryHeadingWords: string[];
  };
  /** Names of languages. A line under a Languages heading that names none of these (a table's "Excellent", "Read", "Speak") is not a language. An unlisted language is left out and counted, not guessed. */
  languageNames: string[];
  agency: {
    businessWords: string[];
    freeMail: string[];
    /** Words before "by" in a line saying who put the document together: "Prepared by: ...". */
    preparedBy: string[];
    /** Who a contact block belongs to, when it is not the candidate. */
    who: string[];
    /** What such a label gives. */
    what: string[];
  };
  /** How agency forms and tables print a role. Labels in the longest form first are matched first; "skip" is what a block holds that is not the role. */
  roleForms: { labels: { company: string[]; title: string[]; start: string[]; end: string[]; dates: string[]; skip: string[] }; tripleHeads: string[][]; tripleWords: { dates: string[]; company: string[]; title: string[] }; summaryHeads: string[]; detailHeads: string[]; otherHeads: string[]; titleWords: string[] };
  modelReader: { addressedToSoftware: string[];
    /** One whole-document reading: how much of the document one request holds, and room for the answer. */
    maxChars: number; maxTokens: number;
    /** A role's facts must sit within this many lines of what the model cited. */
    evidenceReach: number;
    /** A second look at what stayed unresolved: lines either side of it, how many places, and room for them. */
    regionReach: number; maxRegions: number; regionMaxTokens: number;
    /** Headings that open and close the parts of a CV where a date range is not a job. */
    notEmploymentHeadings: string[]; employmentHeadings: string[];
    /** A role cited only from lines this long is told in a sentence, and is left for a person. */
    sentenceWords: number };
  /** Words used when a requirement's field is compared by its own words, which happens only when the language model is off or down. */
  qualifications: { notSubjectWords: string[]; sharedSubjectWords: string[]; broadAreas: string[]; personEndings: [string, string][]; nameWordsAtMost: number; notAName: string[] };
  /** How far apart words on one line may be, as a share of their height, for that space to be the writer's word space and not a gutter between columns. */
  layout: { wordSpaceOfHeight: number };
  /** The document-model prototype (src/docmodel/identity.ts): evidence, not rules. Each word list and weight only moves a candidate's score; nothing here excludes a value outright, and what scored what is kept. */
  evidence: {
    decision: { minScore: number; minMargin: number };
    /** The hash of src/docmodel/ordinaryWords.txt, so the list is part of this configuration's identity. */
    ordinaryWordsSha: string;
    name: Record<string, number>;
    agencyName: Record<string, number>;
    recruiter: Record<string, number>;
    contact: Record<string, number>;
    titleWords: string[];
    organisationWords: string[];
    sectionHeadings: string[];
    /** What agency forms print straight after the agency's name. */
    afterAgencyName: string[];
    dutyVerbs: string[];
  };
}

export const extractionConfig: ExtractionConfig = deepFreeze({
  version: "1.7.0",
  // Register R112. A list of words, so a patch, kept because agency terms are written in very regular language. A paragraph of them is about the document or the engagement, not the person.
  labelledFacts: {
    name: ["full names", "full name", "name and surname", "names", "candidate name"],
    phone: ["contact number", "contact no", "cell", "cell number", "cellphone", "cell phone", "mobile", "mobile number", "telephone", "telephone number", "tel"],
    email: ["email address", "e-mail address", "email", "e-mail"],
    languages: ["home languages", "home language", "languages", "language", "languages spoken"],
    employer: ["company", "company name", "employer", "organisation", "organization"],
    position: ["position", "position held", "job title", "title", "role", "designation"],
    period: ["period", "dates", "duration", "date", "period of employment", "employment period"],
    place: ["location", "residential area", "area", "city", "town", "residential address", "home address", "address"],
    leaving: ["reason for leaving", "reasons for leaving"],
    drop: ["identity number", "id number", "id no", "identity no", "passport number", "nationality", "driver's licence", "drivers licence", "driver's license", "gender", "race", "ethnicity", "marital status", "date of birth", "dependants", "health", "criminal record"],
  },
  legalParagraph: { agencyVoice: ["our terms", "our standard terms", "our fee", "our fees"], speaksOfDocument: ["this cv", "this document", "this resume", "this curriculum vitae"], speaksOfCandidate: ["the candidate", "candidate"], terms: ["terms", "conditions", "liability", "liable", "consent", "popia", "data protection", "protection of personal", "fee", "fees", "placement", "invoice", "without prejudice", "warranty", "accept"] },
  hiddenTextCheck: { maxPages: 12, minAgreement: 0.8, tinyPoints: 1, closerLooks: 40 },
  languageNames: ["english", "afrikaans", "isizulu", "zulu", "isixhosa", "xhosa", "sesotho", "sotho", "setswana", "tswana", "sepedi", "pedi", "siswati", "swati", "swazi", "tshivenda", "venda", "xitsonga", "tsonga", "isindebele", "ndebele", "shona", "swahili", "kiswahili", "chichewa", "nyanja", "lingala", "kikuyu", "luganda", "yoruba", "igbo", "hausa", "amharic", "somali", "oromo", "kinyarwanda", "french", "german", "portuguese", "spanish", "italian", "dutch", "flemish", "greek", "russian", "polish", "czech", "hungarian", "romanian", "bulgarian", "serbian", "croatian", "ukrainian", "turkish", "hebrew", "arabic", "persian", "farsi", "hindi", "urdu", "gujarati", "tamil", "telugu", "punjabi", "bengali", "marathi", "kannada", "malayalam", "mandarin", "cantonese", "chinese", "japanese", "korean", "vietnamese", "thai", "indonesian", "malay", "tagalog", "filipino", "norwegian", "swedish", "danish", "finnish", "icelandic", "sign language", "sasl"],
  identity: {
    formWords: ["names", "curriculum", "vitae", "resume", "position", "applied", "personal", "information", "particulars", "details", "biography", "address", "nationality", "citizenship", "gender", "marital", "birth", "location", "availability", "available", "relocate", "salary", "notice", "disclaimer", "declaration", "consent", "education", "qualification", "qualifications", "employment", "experience", "history", "skill", "skills", "language", "languages", "reference", "references", "objective", "overview", "achievement", "achievements", "office", "based", "remote", "hybrid", "onsite", "senior", "junior", "principal", "preference"],
    givenNameQualifiers: ["candidate", "applicant", "full", "your", "legal", "given", "first", "christian"],
    surnameLabels: ["surname", "last name", "family name"],
    nameParticles: ["van", "der", "den", "de", "du", "von", "le", "la", "di", "da", "bin", "al", "ten", "ter", "te"],
    summaryHeadingWords: ["summary", "profile", "overview", "statement"],
  },
  agency: {
    /** Words in an organisation's name that say it places people. Evidence for reading that line as the agency, nothing more. */
    businessWords: ["recruitment", "recruiters", "recruiting", "staffing", "personnel", "placements", "placement", "resourcing", "talent", "headhunters", "headhunting", "search", "careers", "agency", "human capital", "executive search"],
    preparedBy: ["prepared", "presented", "submitted", "compiled", "represented"],
    /** Mail services anyone can use: an address there says nothing about which organisation sent it. */
    freeMail: ["gmail", "googlemail", "yahoo", "ymail", "outlook", "hotmail", "live", "msn", "icloud", "me", "aol", "proton", "protonmail", "gmx", "mweb", "webmail", "vodamail", "telkomsa", "absamail", "lantic", "iafrica", "mail"],
    who: ["recruiter", "recruiters", "recruitment", "consultant", "consultants", "account manager", "agency"],
    what: ["name", "number", "phone", "telephone", "tel", "mobile", "cell", "email", "e-mail", "contact", "contact details"],
  },
  qualifications: {
    notSubjectWords: ["studies", "science", "sciences", "general", "applied", "advanced", "postgraduate", "diploma", "degree", "certificate", "bachelor", "bachelors", "master", "masters", "honours", "national", "higher", "tertiary", "undergraduate", "university", "recognised", "recognized", "accredited", "completed", "relevant", "related", "appropriate", "suitable", "required", "minimum", "formal", "with", "must", "have", "hold"],
    sharedSubjectWords: ["management", "manager", "administration", "business", "development", "practice", "technology", "system", "systems"],
    broadAreas: ["area:management", "area:communication", "area:languages", "area:project-management"],
    nameWordsAtMost: 14,
    // A patch, and called one: words a qualification's name has no use for and a line talking to a model does. The cut in qualificationName does the real work.
    notAName: ["same_field", "related_field", "different_field", "instruction", "ignore ", "override", "verdict", "system:", "the model"],
    personEndings: [["ant", "ing"], ["e", "ing"], ["er", "ing"], ["or", "ing"], ["ist", "y"], ["ist", "ics"], ["er", "ment"], ["ian", "y"], ["ary", "arial"], ["yst", "ytics"]],
  },
  roleForms: {
    labels: { company: ["name of company", "company name", "company", "name of employer", "employer"], title: ["job title", "position held", "occupation", "position", "designation"], start: ["start date", "date started", "date of appointment"], end: ["end date", "date ended", "date left"], dates: ["duration", "period of employment", "dates employed", "employment period", "period"], skip: ["industry", "reason for leaving", "reporting structure", "reporting to", "reports to", "nature of business"] },
    tripleHeads: [["date", "company", "position"], ["company", "position", "date"], ["company", "position held", "dates employed"], ["company", "position held", "dates"], ["employer", "position", "dates"], ["dates", "company", "position"]],
    tripleWords: { dates: ["date", "dates", "dates employed"], company: ["company", "employer"], title: ["position", "position held"] },
    summaryHeads: ["summary of employment history", "work history (overview)", "employment summary", "summary of employment", "positions held", "career summary"],
    detailHeads: ["employment history", "employment details", "career details", "career history", "work experience", "professional experience", "experience", "work history"],
    otherHeads: ["education", "qualifications", "tertiary qualifications", "educational qualifications", "courses", "skills", "certifications", "references", "languages", "personal details", "achievements", "profile", "summary"],
    titleWords: ["developer", "engineer", "manager", "analyst", "designer", "consultant", "architect", "specialist", "officer", "administrator", "director", "lead", "head", "intern", "assistant", "coordinator", "executive", "associate", "technician", "representative", "supervisor", "accountant", "programmer", "clerk", "agent", "scientist", "teacher", "lecturer", "recruiter", "controller", "founder", "receptionist", "nurse", "auditor", "tester", "administration"],
  },
  modelReader: { sentenceWords: 11, notEmploymentHeadings: ["education", "academic", "qualification", "tertiary", "training", "certificat", "course", "reference", "referee", "publication", "award"], employmentHeadings: ["work", "employment", "experience", "career", "professional", "summary of employment", "positions held"], maxChars: 18_000, maxTokens: 2600, evidenceReach: 3, regionReach: 14, maxRegions: 3, regionMaxTokens: 900, addressedToSoftware: ["ignore all", "ignore previous", "ignore the above", "previous instructions", "system:", "assistant:", "system prompt", "note to the ai", "to the ai", "ai reading", "automated reader", "for automated", "instruction to the parser", "to the parser", "to the model", "language model", "this job first", "skip everything", "include it", "<!--", "fill agency", "add it to skills", "to roles", "must include"] },
  layout: { wordSpaceOfHeight: 0.9 },
  evidence: {
    decision: { minScore: 3.5, minMargin: 1 },
    ordinaryWordsSha: "96708f426b7f4493",
    name: {
      labelledCandidate: 7, summaryHeading: 2, besideContact: 1.5, tallest: 3, tallestAtTop: 1, nearlyTallest: 1.5, bold: 0.5, firstLines: 2, nearTop: 1, emailAllWords: 4, emailSomeWord: 2.5, linkSlug: 2, restoredFromLink: 3, usedInBody: 1.5, aboveTitle: 2, aboveContact: 2, twoOrThreeWords: 1, splitOverLines: 0.5,
      ordinaryWords: -9, awayFromTop: -6, formWord: -4, titleWord: -4, organisationWord: -4, sectionHeading: -6, headingWord: -5, lettersOnly: -6, sentence: -6, wholeIsPlace: -4, answerToLabel: -4, beside_dates: -5, otherPersonLabel: -7, agencyBlock: -6, dutyVerb: -3, inReferences: -8, oneWord: -2,
    },
    agencyName: { labelled: 7, matchesAgencyMail: 5, aboveLetterhead: 3, beforeRepeatedNumber: 3, businessWord: 3, inContactBlock: 2, onEveryPage: 2, atTop: 1, organisationWord: 1, sameAsCandidate: -9 },
    recruiter: { labelled: 6, preparedBy: 5, inContactBlock: 3, matchesTheirMail: 3, twoOrThreeWords: 0.5, titleWord: -4, organisationWord: -5, sameAsCandidate: -9 },
    contact: { base: 1, carriesName: 4, nearName: 2, beforeFirstSection: 1.5, nearOwnAddress: 2, agencyLabel: 6, agencyBlock: 4, letterhead: 5, repeatedOnPages: 5, referee: 5 },
    titleWords: ["leader", "developer", "engineer", "manager", "analyst", "designer", "consultant", "architect", "specialist", "officer", "administrator", "director", "scientist", "programmer", "accountant", "teacher", "lecturer", "recruiter", "coordinator", "executive", "assistant", "technician", "supervisor", "intern", "researcher", "strategist", "tester", "planner", "partner", "advisor", "adviser", "head", "lead", "clerk", "controller", "auditor", "nurse", "attorney", "secretary", "buyer", "trainer", "representative", "management", "operations"],
    organisationWords: ["partners", "associates", "ltd", "limited", "pty", "inc", "llc", "plc", "cc", "group", "holdings", "services", "solutions", "consulting", "recruitment", "technologies", "technology", "bank", "university", "college", "institute", "school", "traders", "company", "agency", "hospital", "programme", "foundation", "corporation", "international", "partners", "systems", "africa", "certificate", "diploma", "degree", "fundamentals"],
    afterAgencyName: ["interview feedback", "candidate feedback", "recruitment consultant"],
    sectionHeadings: ["contact information", "personal information", "profile", "summary", "experience", "work experience", "employment history", "work history", "career history", "education", "qualifications", "skills", "key skills", "technical skills", "courses", "projects", "details", "personal details", "contact", "contact details", "languages", "references", "certifications", "achievements", "interests", "objective", "career profile", "professional summary", "curriculum vitae", "resume", "cv", "disclaimer"],
    dutyVerbs: ["updated", "tracked", "managed", "prepared", "led", "worked", "supported", "reviewed", "maintained", "developed", "built", "delivered", "coordinated", "responsible", "assisted", "checked"],
  },
});

export const extractionConfigFingerprint = createHash("sha256").update(JSON.stringify(extractionConfig)).digest("hex").slice(0, 16);

const SEP = "\\s*(?:\\|\\s*)?[:|–—-]\\s*";   // a wide gap before the colon reads as a column bar: "Full names | : Anna"
const alt = (words: string[]) => words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")).join("|");
/** Turns configuration into the patterns the reader uses. Takes the configuration as an argument so the tests can show that a change to it changes behaviour. */
export function identityPatterns(c: ExtractionConfig = extractionConfig) {
  const who = `(?:${alt(c.agency.who)})['’]?s?`, what = `(?:${alt(c.agency.what)})`;
  return {
    nameParticle: new RegExp(`^(?:${alt(c.identity.nameParticles)})$`),
    formWord: new RegExp(`\\b(?:${alt(c.identity.formWords)})\\b`, "i"),
    givenLabel: new RegExp(`^(?:(?:${alt(c.identity.givenNameQualifiers)})\\s+)?(?:names?|forenames?)(?:\\s*\\(s\\))?${SEP}(.+)$`, "i"),
    surnameLabel: new RegExp(`^(?:${alt(c.identity.surnameLabels)})${SEP}(.+)$`, "i"),
    summaryHeading: new RegExp(`^(?:(?:executive|professional|career|candidate|personal)\\s+)?(?:${alt(c.identity.summaryHeadingWords)})(?:\\s+of)?\\s*[–—-]\\s*(.+)$`, "i"),
    agencyLabelOnly: new RegExp(`^${who}\\s+${what}\\s*:?$`, "i"),
    agencyLabelValue: new RegExp(`^${who}(?:\\s+${what})?\\s*[:|]\\s*\\S`, "i"),
  };
}
