// What a recruiter may change in a candidate or a job, field by field. One place decides it; the server enforces it and the panels read it.
//
// Three kinds of field:
//  * ALWAYS editable: the recruiter's own work (notes; a job's own status). Nobody needs a setting to write their own notes. A person's workflow
//    stage is set for each job (applications.ts), never on the person.
//  * CONFIGURABLE: facts read from a document. Whether a recruiter may change them is a decision for the organisation (Settings > What can be edited),
//    with a default that favours leaving the CV's own words alone and allowing corrections to contact details.
//  * NEVER editable: what the platform worked out (years of experience, confidence, evidence, review state, the original document). Changing these
//    would make a record say something the document does not.
// Every change that is allowed is audited with what it was and what it became (see store.ts).
export type RecordKind = "candidate" | "job";

export const ALWAYS_EDITABLE: Record<RecordKind, string[]> = {
  candidate: ["recruiterNotes"],
  job: ["status"],
};

/** Worked out by the platform from the document. Never editable by anyone, whatever the settings say. */
export const NEVER_EDITABLE: Record<RecordKind, string[]> = {
  // status: the person's headline stage, worked out from their status for each job (applications.ts; production review, 12 Nov 2026, P4)
  candidate: ["experience", "certifications", "languages", "status"],
  job: [],
};

export interface FieldRule { label: string; group: string; defaultEditable: boolean; why: string }

/** The fields an organisation can choose to allow or lock. The keys are the record's own field names. */
export const CONFIGURABLE: Record<RecordKind, Record<string, FieldRule>> = {
  candidate: {
    name: { label: "Name", group: "Who they are", defaultEditable: true, why: "To correct a name the reader got wrong." },
    email: { label: "Email address", group: "Who they are", defaultEditable: true, why: "To correct a misread address so the candidate can be reached." },
    phone: { label: "Phone number", group: "Who they are", defaultEditable: true, why: "To correct a misread number." },
    location: { label: "Location", group: "Who they are", defaultEditable: true, why: "To correct or add where the candidate is based." },
    role: { label: "Current occupation", group: "What the CV says", defaultEditable: false, why: "The occupation is the CV's own claim." },
    summary: { label: "Professional summary", group: "What the CV says", defaultEditable: false, why: "The summary is the candidate's own words." },
    skills: { label: "Skills", group: "What the CV says", defaultEditable: false, why: "Skills are matched against evidence in the CV; adding one would claim something the CV does not." },
    workHistory: { label: "Work history", group: "What the CV says", defaultEditable: false, why: "Employers, titles and dates are facts a match depends on." },
    education: { label: "Education and certifications", group: "What the CV says", defaultEditable: false, why: "Qualifications and whether they were finished are facts the CV states." },
    projects: { label: "Projects", group: "What the CV says", defaultEditable: false, why: "Projects are the candidate's own description." },
    worthNoting: { label: "Worth noting", group: "What the CV says", defaultEditable: false, why: "These are the candidate's own words." },
    submission: { label: "Recruiting agency and recruiter", group: "What the CV says", defaultEditable: false, why: "Who sent the CV is what the document states, and it is kept apart from the candidate's own details." },
  },
  job: {
    title: { label: "Job title", group: "The role", defaultEditable: true, why: "The organisation owns its own job specification." },
    company: { label: "Company", group: "The role", defaultEditable: true, why: "To correct the company name." },
    location: { label: "Location", group: "The role", defaultEditable: true, why: "To correct where the job is." },
    department: { label: "Department", group: "The role", defaultEditable: true, why: "To correct the department." },
    type: { label: "Employment type", group: "The role", defaultEditable: true, why: "To correct full-time, contract and so on." },
    workArrangement: { label: "Work arrangement", group: "The role", defaultEditable: true, why: "To correct remote, hybrid or on-site." },
    description: { label: "Overview", group: "The role", defaultEditable: true, why: "To correct the overview." },
    responsibilities: { label: "Responsibilities", group: "The role", defaultEditable: true, why: "To correct what the job involves." },
    requirements: { label: "Mandatory requirements", group: "What a match is judged on", defaultEditable: true, why: "Moving a requirement between mandatory and preferred is a hiring decision the recruiter must be able to make." },
    preferredRequirements: { label: "Preferred requirements", group: "What a match is judged on", defaultEditable: true, why: "As above." },
    skills: { label: "Skills", group: "What a match is judged on", defaultEditable: false, why: "Skills are worked out from the requirements; edit the requirements instead." },
  },
};

export type EditingSettings = { candidate: Record<string, boolean>; job: Record<string, boolean> };

export const defaultEditing = (): EditingSettings => ({
  candidate: Object.fromEntries(Object.entries(CONFIGURABLE.candidate).map(([k, v]) => [k, v.defaultEditable])),
  job: Object.fromEntries(Object.entries(CONFIGURABLE.job).map(([k, v]) => [k, v.defaultEditable])),
});

/** The fields a person may change in this organisation, for this kind of record. */
export function editableFields(kind: RecordKind, editing: EditingSettings): string[] {
  const configured = Object.keys(CONFIGURABLE[kind]).filter((k) => editing[kind][k] ?? CONFIGURABLE[kind][k].defaultEditable);
  return [...ALWAYS_EDITABLE[kind], ...configured];
}

export class PolicyError extends Error {
  constructor(public fields: string[], public kind: RecordKind) {
    super(`These fields are read from the document and are not editable here: ${fields.join(", ")}.`);
  }
}
