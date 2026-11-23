// Record types shared with the RoleMatch API: the shapes of candidates and jobs as the server returns them.
export interface ReviewInfo { state: "needs_review" | "ok" | "reviewed"; reasons: string[]; notes: string[]; rulesVersion: string; reviewedBy?: string; reviewedAt?: string }
interface ExtractionMeta {
  method: "ai" | "rules";
  model?: string;
  schemaVersion: string;
  warnings: string[];
  droppedUnsupported: string[];
  /** What happened to each field, from the candidate pipeline. Older records do not have it. */
  fields?: Partial<Record<"name" | "email" | "phone" | "location" | "role" | "skills" | "workHistory" | "education" | "certifications" | "languages", FieldReport>>;
}
/** "missing": the document does not state it. "unreadable": it seems to, but it could not be read. "conflict": it gives more than one with nothing to choose between them. "failed": the step itself failed. */
interface FieldReport { state: "found" | "missing" | "unreadable" | "conflict" | "failed"; reason?: string; source?: string }
/** A CV that came through a recruitment agency: who sent it and how to reach them. Never the candidate's own details. */
interface Submission {
  contactRoute: "direct" | "partly-direct" | "through-agency" | "none-found";
  agency: { name: string; domain: string; email: string; phone: string };
  recruiter: { name: string; email: string; phone: string };
  evidence: string[];
}

export interface Candidate {
  id: string;
  /** The standard department the person's work belongs to, the same list as a job's (server/src/department.ts); absent until placed. */
  group?: string;
  /** How details the CV writes in capitals are normally written, from the AI's reading; for the screen only. */
  displayNames?: Record<string, string>;
  /** Set while the AI reads this CV again (server, aiRead.ts): the card is locked and uploads are paused until it is cleared. */
  rereading?: { since: string };
  name: string;
  role: string;
  status: string; // a key from the organisation's own status list (see settings)
  avatar: string;
  skills: string[];
  rating: number; // legacy field; never displayed or used in matching
  experience: string;
  location: string;
  /** The city this place belongs to (server/src/places.ts), for grouping the Location filters. */
  city?: string;
  email: string;
  phone: string;
  appliedDate: string;
  /** when the CV was uploaded (server/src/store.ts hydrate) */
  uploadedAt?: string;
  workHistory: {
    company: string;
    position: string;
    startDate: string;
    endDate: string;
    responsibilities: string[];
    status?: string;
  }[];
  /** How the record was read and how sure it is of the work history (server/src/reconcile.ts). */
  reading?: { employment: { state: string; reasons: string[] } };
  summary?: string;
  education?: { degree: string; institution: string; year: string; type?: "degree" | "diploma" | "school" | "certificate" | "other"; level?: string; status?: "completed" | "listed" | "in_progress" | "not_completed" | "not_stated"; statusEvidence?: string; validity?: "current" | "expired" | "unknown"; validityEvidence?: string }[];
  projects?: string[];
  worthNoting?: string[];
  certifications?: string[];
  languages?: string[];
  recruiterNotes?: string;
  submission?: Submission;
  /** No name could be confirmed from the document; `name` holds wording to display until a person enters it. Set by the API client only, never sent to the server. */
  nameUnconfirmed?: boolean;
  originalDocumentName?: string;
  originalDocumentUrl?: string;
  documentId?: string;
  extractionConfidence?: number;
  extraction?: ExtractionMeta;
  review?: ReviewInfo;
  reviewState?: ReviewInfo["state"];
  version?: number;
}

export interface Job {
  id: string;
  title: string;
  location: string;
  /** The city this place belongs to (server/src/places.ts), for grouping the Location filters. */
  city?: string;
  /** The town of the job's location (server/src/places.ts): what its card shows. */
  town?: string;
  company: string;
  skills: string[];
  type: string;
  department: string;
  /** The standard department Claude placed the job in (server/src/jobReader.ts, JOB_DEPARTMENTS); absent on jobs read before 10 Nov 2026. */
  group?: string;
  description: string;
  requirements: string[];
  responsibilities: string[];
  postedDate: string;
  /** when the job description was uploaded */
  uploadedAt?: string;
  preferredRequirements?: string[];
  workArrangement?: string;
  remuneration?: string;
  reportsTo?: string;
  /** Facts the job gives beyond the fixed ones (closing date, job grade, reference), each in the job's own words. */
  keyFacts?: { label: string; value: string }[];
  /** Where the summary came from: the job description's own words, or two sentences written by the AI because the job has no summary of its own. */
  summarySource?: "document" | "ai" | "";
  /** The job's own headings over its lists, in order: the first `count` items of the list are under the first heading, and so on. */
  requirementGroups?: { heading: string; count: number }[];
  preferredGroups?: { heading: string; count: number }[];
  responsibilityGroups?: { heading: string; count: number }[];
  competencies?: { name: string; description: string }[];
  /** Everything else in the job description (benefits, how to apply, working relationships), under the job's own headings, so nothing is lost. */
  extras?: { heading: string; items: string[] }[];
  /** How the AI read this job (server/src/jobReader.ts). */
  aiReading?: { state: string; model?: string; version?: string; ms?: number; lines?: number; unlabelled?: number; dropped?: number };
  /** Set while the AI reads this job again: its panel is locked until the reading is saved. */
  rereading?: { since: string };
  rereadFailed?: string;
  /** Worked out by the server each time the job is loaded: a missing work location, wording to review. They never block anything. */
  status?: "draft" | "open" | "paused" | "closed" | "archived";
  originalDocumentName?: string;
  originalDocumentUrl?: string;
  documentId?: string;
  extractionConfidence?: number;
  extraction?: ExtractionMeta;
  review?: ReviewInfo;
  reviewState?: ReviewInfo["state"];
  version?: number;
}
