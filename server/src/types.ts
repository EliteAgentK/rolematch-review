// Record shapes deliberately mirror the frontend so the interface keeps working unchanged.
type CandidateStatus = "new" | "reviewed" | "shortlisted" | "awaiting interview" | "interviewing" | "interviewed" | "hired" | "declined" | "archived";
type JobStatus = "draft" | "open" | "paused" | "closed" | "archived";

/** Where a fact stands. Absence from a readable document ("not evidenced") is a different thing from a document that could not be read reliably ("uncertain"). */
export type FactState = "supported" | "uncertain" | "conflicting" | "not evidenced";
export interface WorkItem {
  company: string; position: string; startDate: string; endDate: string; responsibilities: string[];
  /** How sure the reading is of this role, the document lines and pages it stands on, and what the other reader made of it where they differ. Absent on records read before this. */
  status?: FactState; lines?: number[]; pages?: number[]; agreement?: "both" | "model" | "rules" | "conflict"; rulesReading?: { position: string; company: string };
}
/** How the record was read: the system and the model together. */
interface RecordReading { model: string; promptVersion: string; ms?: number; employment: { state: FactState; reasons: string[] }; unconfirmedRoles?: { position: string; company: string; startDate?: string; endDate?: string }[]; trace?: unknown; roles?: Record<string, number>; refused?: number; fromModel?: { location: boolean; agency: boolean } }
/** One line of the Education panel: a degree, a diploma, school, or a certification. Certifications are entries here (type "certificate"), not a list of their own. */
export interface EducationItem {
  degree: string; institution: string; year: string;
  /** what it is, from its own wording */
  type?: "degree" | "diploma" | "school" | "certificate" | "other";
  /** the words a person reads: "Honours degree", "Advanced diploma", "High school", "Certificate" */
  level?: string;
  /** whether the CV says it was finished; "not_stated" when it does not say */
  status?: "completed" | "listed" | "in_progress" | "not_completed" | "not_stated";
  /** the words or year that support the status */
  statusEvidence?: string;
  /** for a certificate: whether it still stands, as the CV shows it. Separate from whether it was finished. */
  validity?: "current" | "expired" | "unknown";
  validityEvidence?: string;
}

interface ReviewInfo { state: "needs_review" | "ok" | "reviewed"; reasons: string[]; notes: string[]; rulesVersion: string; reviewedBy?: string; reviewedAt?: string }
export interface ExtractionMeta {
  method: "ai" | "rules";
  model?: string;
  schemaVersion: string;
  /** the version of the reading behaviour that produced this record (src/version.ts) */
  parserVersion?: string;
  warnings: string[];
  droppedUnsupported: string[];
  /** the day the extraction treated as today (years of experience and finished-or-not depend on it) */
  asOf?: string;
  /** what the reader did for each part of the CV, in the fixed order: found or not, where, and every way it looked */
  sections?: { step: string; status: "found" | "not_found"; via: string; count: number; tried: string[] }[];
  /** Problems reading the document itself (damaged text, OCR). Each one makes a person look at the record. */
  readingIssues?: string[];
}

export interface Candidate {
  id: string;
  name: string;
  role: string;
  status: CandidateStatus;
  avatar: string;
  skills: string[];
  rating: number;
  experience: string;
  location: string;
  email: string;
  phone: string;
  appliedDate: string;
  uploadedAt?: string;
  /** The city the person's town belongs to (places.ts), for grouping; computed as the record leaves the server. */
  city?: string;
  workHistory: WorkItem[];
  reading?: RecordReading;
  summary?: string;
  education?: EducationItem[];
  projects?: string[];
  worthNoting?: string[];
  certifications?: string[];
  languages?: string[];
  recruiterNotes?: string;
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
  company: string;
  skills: string[];
  type: string;
  department: string;
  description: string;
  requirements: string[];
  responsibilities: string[];
  postedDate: string;
  uploadedAt?: string;
  /** The city the job's location belongs to (places.ts), for grouping. */
  city?: string;
  /** The town of the job's location, as places.ts reads it: what its card shows. */
  town?: string;
  preferredRequirements?: string[];
  workArrangement?: string;
  /** The pay as the job states it ("R2.1 million to R2.7 million annual total cost to company"), and who the role reports to: facts of the job's own key-facts table. */
  remuneration?: string;
  reportsTo?: string;
  status?: JobStatus;
  originalDocumentName?: string;
  originalDocumentUrl?: string;
  documentId?: string;
  extractionConfidence?: number;
  extraction?: ExtractionMeta;
  review?: ReviewInfo;
  reviewState?: ReviewInfo["state"];
  version?: number;
}

export type EvidenceState = "verified" | "partial" | "not_demonstrated" | "contradicted" | "not_applicable";

/** A share of a requirement's weight, in [0, 1]: what the documents prove (low), the expected value (exp), and the most it could be if every gap were met (high). */
interface Credit { low: number; exp: number; high: number }
import type { Logistics } from "./logistics";
import type { ReviewFlag } from "./jobReview";
import type { Notice, Overview } from "./overview";

export interface MatchEvidence {
  /** The three views of the credit earned; points and possible are in weight units (exp x possible, and the weight). */
  credit?: Credit;
  /** Set when this requirement repeats an earlier one: it is shown, but counted once (it carries no weight of its own). */
  duplicateOf?: string;
  label: string;
  state: EvidenceState;
  points: number;
  possible: number;
  explanation: string;
  source?: string;
  mandatory?: boolean;
  /** This requirement's weight as points out of 100 (all requirements' shares add up to 100), and the points the documents prove (credit.low x share). */
  share?: number;
  pointsProved?: number;
  /** Share of this requirement's parts the documents say anything about, in [0, 1]. */
  covered?: number;
  /** Wording a recruiter should review (possible unfairness, unclear or excessive). Never changes the score. */
  reviewFlags?: ReviewFlag[];
  /** One short sentence (at most 160 characters) from the same finding as the explanation, for the at-a-glance view. */
  reason?: string;
  /** What this requirement stands on in the candidate's documents: their dated work history is what a years requirement counts. */
  basis?: "employment";
  /** Which part of the job this line belongs to (score v3): role fit, experience, skills and requirements, or qualifications. */
  dimension?: "role" | "experience" | "skills" | "qualification";
  /** "ai" when Claude judged this line (aiMatch.ts); ruleState is what the rules said. */
  judgedBy?: "ai";
  /** How a recruiter screens on it (aiJobRead.ts), and whether the AI credited it from a close equivalent rather than a line that shows it. */
  importance?: "must_have" | "important" | "nice_to_have";
  inferred?: boolean;
  ruleState?: EvidenceState;
  /** The same finding as separate dimensions, never one label standing in for another. */
  contract?: EvidenceContract;
}
export interface EvidenceContract {
  requirement: string; requirementSource: "mandatory" | "preferred";
  candidateEvidence: string | null;
  /** direct: the document shows it being done. listed: named only. none: nothing found. Transferable and progression evidence are not assessed by this version, and say so. */
  support: "direct" | "listed" | "none"; transferable: "not assessed"; progression: "not assessed";
  missingEvidence: string | null; extractionUncertain: boolean; contradiction: string | null;
}
/** Whether a percentage can honestly be given. Incomplete means the document could not be read reliably on something that would change the answer: it is not a low score, and it is not ranked as one. */
export interface AssessmentState { state: "complete" | "incomplete"; reasons: string[]; affected: string[] }

export interface MatchResult {
  id?: string;
  assessment?: AssessmentState;
  score: number;
  /** What the documents prove (the floor), the expected score, and the most it could be if every gap were confirmed (the ceiling). */
  scoreFloor: number;
  scoreCeiling: number;
  band: string;
  confidence: "High" | "Medium" | "Low";
  confidenceScore: number;
  confidenceReasons: string[];
  evidence: MatchEvidence[];
  matchingSkills: string[];
  locationMatch: boolean | null;
  experienceYears: number;
  recommendation: string;
  counts: { verified: number; partial: number; notDemonstrated: number; contradicted: number };
  disclaimer: string;
  warnings: string[];
  engineVersion: string;
  rulesVersion: string;
  rulesFingerprint: string;
  candidateVersion: number;
  jobVersion: number;
  /** Facts worth knowing that are shown and never scored (for example the level the job title implies). */
  context?: string[];
  /** Share of the job's requirement weight the documents give any evidence for (0 to 100). Separate from the score and from confidence. */
  coverage?: number;
  /** Place, on-site or hybrid: a separate answer, never part of the alignment percentage. */
  logistics?: Logistics;
  /** The date used for "Present" in the CV (YYYY-MM-DD), so the calculation can be repeated exactly. */
  referenceDate?: string;
  reviewRulesVersion?: string;
  /** The warnings with a code: consequential ones stay in view at a glance, the rest belong with the method notes. Same words and order as warnings. */
  notices?: Notice[];
  /** The at-a-glance view, written only from this result's evidence (overview.ts). Presentation only. */
  overview?: Overview;
}
