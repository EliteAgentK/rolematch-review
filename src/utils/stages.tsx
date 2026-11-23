// A candidate's status for each job (owner, 9 Nov 2026: status is per job, and the panel shows what stage someone is at and for which job). The board
// loads every application of the portal once and shares it here, so a card, a panel and a job's shortlist all read the same thing.
import { createContext, useContext } from "react";
import type { Application } from "@/api/client";
import type { Job } from "@/types/records";

export const NOT_SUITABLE = "declined";
export interface Stages {
  all: Application[];
  /** Sets one candidate's status for one job; null clears it. Resolves false when it was not saved (the person has been told why). */
  set: (candidateId: string, jobId: string, status: string | null) => Promise<boolean>;
  /** Opens a job's saved shortlist. */
  openShortlist: (job: Job) => Promise<void> | void;   // returns its promise, so the button shows it is working until the shortlist opens
  /** Opens the saved match of one person and one job, as it was recorded: nothing is matched again. */
  openMatch: (candidateId: string, jobId: string) => Promise<void> | void;
  readOnly: boolean;
}
export const StagesContext = createContext<Stages>({ all: [], set: async () => false, openShortlist: () => {}, openMatch: () => {}, readOnly: true });
export const useStages = () => useContext(StagesContext);
export const stagesOfCandidate = (all: Application[], candidateId: string) => all.filter((a) => a.candidateId === candidateId);
/** On the shortlist: moved to Shortlisted for the job, or to a stage after it. The server's one definition (server/src/shortlist.ts), held equal by a test,
 *  so a job's panel counts what the Overview and Needs attention count (code review, 16 Nov 2026, G-M3: anyone not marked Not suitable was counted here,
 *  Reviewed included). */
export const ON_SHORTLIST: readonly string[] = ["shortlisted", "awaiting interview", "interviewing", "interviewed", "hired"];
export const onShortlist = (status: unknown) => typeof status === "string" && ON_SHORTLIST.includes(status);
/** Everyone on a job's shortlist. */
export const shortlistedFor = (all: Application[], jobId: string) => all.filter((a) => a.jobId === jobId && onShortlist(a.status));
/** A person's stages that move them forward (everything but Not suitable), the most recently changed first: what the card names. */
export const forwardStagesOf = (all: Application[], candidateId: string) =>
  stagesOfCandidate(all, candidateId).filter((a) => a.status !== NOT_SUITABLE).sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
/** The jobs anyone on the board holds this stage for: under the Overview's "Shortlisted candidates", the roles column keeps only these (owner, 17 Nov 2026). */
export const jobsHolding = (all: Application[], candidateIds: ReadonlySet<string>, status: string) =>
  new Set(all.filter((a) => candidateIds.has(a.candidateId) && a.status === status).map((a) => a.jobId));
