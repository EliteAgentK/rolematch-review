// The Hiring manager / HR role (owner's decisions, 2026-11-05): read-only, and among candidates sees only those a recruiter has shortlisted. Enforced here on the server, whatever a screen shows.
// Deny by default: a route that is not named below is refused, so a route added later cannot show this role other people's CVs by being forgotten. Each read route named here limits what it returns (server/src/index.ts, server/src/history.ts).
import { ON_SHORTLIST } from "./shortlist";

export const HIRING_MANAGER = "hiring_manager";
/** The stages at which this role sees a candidate: on some job's shortlist, or further along (owner, 9 Nov 2026: status is per job; the candidate's own
 *  status is the furthest stage any job has them at). Named one by one: a status an organisation adds later is not visible to this role until it is listed
 *  here. Moving someone off every shortlist ends this role's sight of them on the next request: nothing is cached or copied. */
export const VISIBLE_STATUSES: readonly string[] = ON_SHORTLIST;   // the one definition of "on the shortlist" (shortlist.ts)
export const visibleToHiringManager = (status: unknown) => typeof status === "string" && VISIBLE_STATUSES.includes(status);

const MAY_READ = [
  /^\/api\/candidates$/, /^\/api\/candidates\/[\w-]+$/,   // shortlisted only; anyone else looks like a record that does not exist
  /^\/api\/jobs$/, /^\/api\/jobs\/[\w-]+$/,
  /^\/api\/applications$/, /^\/api\/jobs\/[\w-]+\/shortlist$/,   // which job each visible candidate is shortlisted (or further) for; setting a status is a change, and is refused
  /^\/api\/matches$/,                                     // saved results of shortlisted candidates; running a match is a change, and is refused
  /^\/api\/documents$/,                                   // always empty for this role: files still being read carry names of people nobody has shortlisted
  /^\/api\/documents\/[\w-]+\/original$/,                 // a shortlisted candidate's CV, or a job description
  /^\/api\/batches$/,                                     // always empty, for the same reason
  /^\/api\/portal\/members$/, /^\/api\/history\/(uploads|invitations|activity)$/,   // every role sees the team and the history (file names of everyone else are hidden)
  /^\/api\/settings$/, /^\/api\/settings\/history$/, /^\/api\/capacity$/, /^\/api\/usage$/,
  /^\/api\/errors$/,                                      // organisation administrators only, checked by the route
];
// What is still open: leaving the portal, and organisation-level actions that check the person's own organisation role.
const MAY_CHANGE = [/^\/api\/portal\/leave$/, /^\/api\/settings$/, /^\/api\/errors\/[\w-]+\/status$/];

export const mayEnter = (method: string, path: string) => ((method === "GET" || method === "HEAD") ? MAY_READ : MAY_CHANGE).some((r) => r.test(path));
