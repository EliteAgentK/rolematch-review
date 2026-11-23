// The Overview page's figures, the same shape for Live (the server: server/src/orgOverview.ts, GET /api/overview) and Demo (src/overview/demo.ts), so one
// page draws both and they can never drift apart.
export interface OverviewData {
  days: number; generatedAt: string;
  /** AI use this month. `allowanceRand` is null until an organisation has its own credit (per-company billing, planned 10 Nov 2026). */
  credits: { usedUsd: number; usedRand: number; month: string; allowanceRand: number | null };
  candidates: { total: number; inPeriod: number; previous: number };
  jobs: { open: number; newInPeriod: number };
  shortlisted: { count: number; jobs: number; previous: number };
  /** each day of the period: CVs read, jobs opened, matches run, people shortlisted */
  series: { dates: string[]; cv: number[]; jobs: number[]; match: number[]; sl: number[] };
  pipeline: { read: number; matched: number; shortlisted: number; interviewing: number; hired: number };
  strongest: { candidateId: string; candidateName: string; candidateRole: string; jobId: string; jobTitle: string; jobCompany?: string; jobLocation: string; score: number }[];
  /** every department with open jobs or candidates in it: `open` jobs, and `candidates` whose work belongs to it */
  families: { name: string; open: number; candidates: number }[];
  experience: { band: string; count: number }[];
  /** what waits on a recruiter, most urgent first (server/src/attention.ts); empty when nothing does */
  attention: { id: string; title: string; detail: string; count: number }[];
  /** the team's latest actions; `candidateId`/`jobId` name the records each was about, for the Matching Board to open (`match`: a match was run) */
  activity: { who: string; whoEmail?: string; what: string; at: string; candidateId?: string; jobId?: string; match?: boolean; /** what the details show beneath the line */ facts?: string[]; /** a batch's records, each to open on the board */ records?: { id: string; kind: "candidate" | "job"; name: string }[] }[];
}
