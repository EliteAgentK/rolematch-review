// LOGISTICS: can the hire happen in practice? Checked only for jobs tied to a place: on-site and hybrid work (or a job that names a place without
// saying it is remote). Remote jobs have no logistics check.
//
// This is a separate answer from requirement alignment and is never blended into the alignment percentage. A strong engineer in Pretoria is not a weaker
// engineer than one in Johannesburg; "can they be in the Johannesburg office three days a week?" is a different question, and the recruiter sees it on its
// own line. Where a person lives can also stand in for race and income in South Africa, so place must never move a capability score.
//
// Places are compared by level, as the owner asked: same city, same province, same country, or another country (geo.ts). People move for jobs, so a
// different province or country is "to confirm", never a mismatch. Only what the documents state is used: the job's place, the candidate's stated
// location, and explicit statements such as "willing to relocate" or "remote only", quoted back. Nothing is inferred, and the right to work in a country is
// asked of the candidate, never inferred from where they live.

import type { Candidate, Job } from "./types";
import { compareWhere, PLACES_VERSION, whereIs, type PlaceLevel } from "./geo";

const LOGISTICS_RULES = { version: "2.1.0", places: PLACES_VERSION } as const;   // 2.1.0: a refusal to move conflicts only with a job that means moving (C-M4)

export type Arrangement = "on-site" | "hybrid" | "remote" | "not stated";
type LogisticsStatus = "compatible" | "to_confirm" | "conflict" | "not_required";
interface LogisticsCheck { label: string; status: LogisticsStatus; explanation: string; source?: string; level?: PlaceLevel }
export interface Logistics { arrangement: Arrangement; required: boolean; status: LogisticsStatus; checks: LogisticsCheck[]; level?: PlaceLevel; rulesVersion?: string }

/** The job's work arrangement, from its own arrangement field first, then its location line. Hybrid wins over a passing mention of remote days. */
export function arrangementOf(job: Pick<Job, "workArrangement" | "location">): Arrangement {
  const own = job.workArrangement ?? "", t = `${own} ${job.location ?? ""}`;
  if (/\bhybrid\b/i.test(t)) return "hybrid";
  if (/\b(on[- ]?site|in[- ]office|office[- ]based|in[- ]person|at the office)\b/i.test(t)) return "on-site";
  if (/\b(remote|work from home|wfh|fully distributed)\b/i.test(t)) return "remote";
  return "not stated";
}

// Explicit statements only. Each is the candidate's own words and is quoted back; none is inferred from anything else.
// Not working at a place at all, and not moving house, are two different statements (code review, 16 Nov 2026, C-M4): the first conflicts with any job tied
// to a place; the second only with a job the person would have to move for, so "unable to relocate" is no conflict when the job is in their own city.
const REMOTE_ONLY = /\b(remote[- ]only|fully remote only|100% remote|only (?:open to|seeking|looking for|interested in|available for) remote(?: work| roles?)?|not (?:open|willing|available) to (?:work )?(?:on[- ]?site|in[- ]office|in an office|commute))\b/i;
const WONT_MOVE = /\b(not (?:open|willing|available) to (?:relocate|relocation)|unable to relocate|cannot relocate|can ?not relocate|no relocation)\b/i;
const WILL_RELOCATE = /\b(willing to relocate|open to relocat\w*|happy to relocate|available to relocate|able to relocate|can relocate)\b/i;

const lineWith = (text: string, re: RegExp) => text.split(/\r?\n/).find((l) => re.test(l))?.trim().slice(0, 220);

export function assessLogistics(job: Job, candidate: Candidate, sourceText = ""): Logistics {
  const arrangement = arrangementOf(job);
  const required = arrangement === "on-site" || arrangement === "hybrid" || (arrangement === "not stated" && !!job.location.trim());
  if (!required) return { arrangement, required, status: "not_required", checks: [] };

  const said = [candidate.summary ?? "", sourceText].join("\n");
  const remoteOnly = lineWith(said, REMOTE_ONLY), wontMove = lineWith(said, WONT_MOVE), relocate = wontMove ? undefined : lineWith(said, WILL_RELOCATE);
  const where = arrangement === "not stated" ? "The job does not say whether it is on-site, hybrid or remote" : `The job is ${arrangement}${job.workArrangement && !new RegExp(`^${arrangement}$`, "i").test(job.workArrangement.trim()) ? ` ("${job.workArrangement.trim()}")` : ""}`;
  const checks: LogisticsCheck[] = [];

  if (!job.location.trim()) checks.push({ label: "Job location", status: "to_confirm", explanation: `${where}, but no place is given. Add the town or city where the work happens.` });
  else if (!candidate.location.trim()) checks.push({ label: "Candidate location", status: "to_confirm", explanation: `${where} in ${job.location}. The CV does not state where the candidate is based.` });
  else checks.push(locationCheck(job, candidate, where, relocate));

  // A refusal to move matters only where taking the job would mean moving: another province or country is a conflict to resolve with the person; the same
  // city or province is a commute, so it says nothing against this job; where the places cannot be compared, whether they would have to move is a question.
  const level = checks.find((c) => c.level)?.level;
  if (wontMove && !remoteOnly && level !== "same city" && level !== "same province") {
    const moving = level === "same country" || level === "different country";
    checks.push({ label: "Stated willingness to move", status: moving ? "conflict" : "to_confirm", source: wontMove, explanation: moving
      ? `The CV says "${wontMove}", and the job is in ${job.location}, away from where they are based. Preferences change: confirm with the candidate rather than assume.`
      : `The CV says "${wontMove}". Whether this job would mean moving cannot be told from what is written: confirm where they would work from.` });
  }

  if (remoteOnly) checks.push({ label: "Stated work arrangement", status: "conflict", explanation: `The CV says "${remoteOnly}", but the job is ${arrangement === "not stated" ? "tied to a place" : arrangement}. Preferences change: confirm with the candidate rather than assume.`, source: remoteOnly });

  const status: LogisticsStatus = checks.some((c) => c.status === "conflict") ? "conflict" : checks.some((c) => c.status === "to_confirm") ? "to_confirm" : "compatible";
  return { arrangement, required, status, checks, ...(level ? { level } : {}), rulesVersion: LOGISTICS_RULES.version };
}

/** Where the candidate is against where the job is, by level: same city, same province, same country or another country. Never a mismatch. */
function locationCheck(job: Job, candidate: Candidate, where: string, relocate?: string): LogisticsCheck {
  const label = "Candidate location";
  const jw = whereIs(job.location), cw = whereIs(candidate.location), level = compareWhere(jw, cw);
  const at = `${where} in ${job.location}; the candidate is based in ${candidate.location}`;
  const willMove = relocate ? " The CV says they are willing to relocate (their own statement; confirm it)." : "";
  const src = relocate ?? candidate.location;
  switch (level) {
    case "same city":
      return { label, status: "compatible", level, explanation: `${at}: the same city (${jw.city}).`, source: candidate.location };
    case "same province":
      return { label, status: "compatible", level, explanation: `${at}: the same province (${jw.province}), a different city. Confirm the commute suits them.`, source: candidate.location };
    case "same country":
      return { label, status: relocate ? "compatible" : "to_confirm", level, explanation: `${at}: ${jw.province && cw.province ? `another province (${cw.province}, the job is in ${jw.province})` : `the same country (${jw.country}); the province cannot be compared from what is written`}.${willMove || " Whether they would commute or move is not stated. People often move for a job, so this is a question to ask, not a mismatch."}`, source: src };
    case "different country":
      return { label, status: relocate ? "compatible" : "to_confirm", level, explanation: `${at}: another country (${cw.country}; the job is in ${jw.country}).${willMove || " Whether they would relocate is not stated."} The right to work in ${jw.country} is asked of the candidate, never assumed either way.`, source: src };
    default: {
      const unknown = [!jw.country ? `"${job.location}"` : "", !cw.country ? `"${candidate.location}"` : ""].filter(Boolean).join(" and ");
      return { label, status: relocate ? "compatible" : "to_confirm", level, explanation: `${at}. ${unknown} could not be placed as a town, city, province or country from RoleMatch's place list.${willMove || " Confirm where they would work from."}`, source: src };
    }
  }
}
