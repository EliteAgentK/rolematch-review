import { compareRank } from "../../server/src/scoring";

// The approved review order for a shortlist, the very rule the server uses for bulk matching (server/src/scoring.ts compareRank): supported score
// first, then score, evidence range, confidence, then a fixed tie-break on the other side's id. Never the headline score alone, never the stars.
type Row = { candidate: { id: string }; job: { id: string }; matchResult: { score: number; scoreFloor?: number; scoreCeiling: number; confidenceScore: number; assessment?: { state: string }; ai?: { state: string } } };
export function inReviewOrder<T extends Row>(rows: T[], direction: "candidate-to-jobs" | "job-to-candidates"): T[] {
  const key = (r: T) => ({ ...r.matchResult, scoreFloor: r.matchResult.scoreFloor ?? r.matchResult.score, id: direction === "candidate-to-jobs" ? r.job.id : r.candidate.id });
  // A match the AI could not score has no score at all: it goes after every scored one, never among them as a low score.
  const unscored = (r: T) => !!r.matchResult.ai && r.matchResult.ai.state !== "checked";
  return [...rows].sort((a, b) => Number(unscored(a)) - Number(unscored(b)) || compareRank(key(a), key(b)));
}
