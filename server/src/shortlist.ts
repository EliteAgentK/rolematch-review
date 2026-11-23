// What "on the shortlist" means, everywhere it is counted or shown (code review, 16 Nov 2026, G-M3): a person a recruiter has moved to Shortlisted for a job,
// or to a stage after it. A job's shortlist on the board (applications.ts shortlistOf), the Overview's "on shortlists" (orgOverview.ts), Needs attention
// (attention.ts) and what a hiring manager may see (hiringManager.ts) all read this one list; the board's own copy (src/utils/stages.tsx) is held equal
// to it by a test. Statuses are per job since migration 043 (docs/architecture/PLAN_STATUS_PER_APPLICATION.md). Named one by one: Reviewed, Archived, Not
// suitable and any status an organisation adds are not on a shortlist until listed here. No imports, so the board's test can read it.
export const ON_SHORTLIST: readonly string[] = ["shortlisted", "awaiting interview", "interviewing", "interviewed", "hired"];
